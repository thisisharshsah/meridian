//! The generic repository: one implementation of list / get / create / update /
//! delete that every entity in the registry shares.
//!
//! Two rules hold everywhere in this file:
//!   1. No identifier is ever interpolated into SQL unless it came from an
//!      `EntityDef` - i.e. from our own `&'static str` metadata, never from the
//!      request. Values are always bound.
//!   2. Every statement is scoped by `org_id`. Tenant isolation lives here, so
//!      no handler can forget it.

use std::collections::{BTreeMap, HashMap, HashSet};

use chrono::Utc;
use serde_json::{json, Map, Value};
use sqlx::{Row, SqlitePool};

use crate::auth::ctx::Ctx;
use crate::common::ids::new_id;
use crate::common::pagination::{Page, PageParams};
use crate::engine::schema::{EntityDef, FieldDef, FieldKind, Registry, SortDir};
use crate::engine::value::{bind_one, to_bind, Bind};
use crate::error::{AppError, AppResult, FieldError};

#[derive(Debug, Default, Clone)]
pub struct ListQuery {
    pub page: i64,
    pub per_page: i64,
    pub search: Option<String>,
    pub sort: Option<String>,
    /// `("status", Op::Eq, "open")`
    pub filters: Vec<(String, Op, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Op {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    In,
    Like,
    IsNull,
    NotNull,
}

const RESERVED: [&str; 5] = ["page", "per_page", "q", "sort", "view"];

impl ListQuery {
    /// Query-string conventions: `?status=open&amount__gte=100&owner_id__null=1&q=acme&sort=-created_at`
    pub fn from_params(params: &HashMap<String, String>) -> Self {
        let mut q = ListQuery {
            page: params.get("page").and_then(|v| v.parse().ok()).unwrap_or(1),
            per_page: params.get("per_page").and_then(|v| v.parse().ok()).unwrap_or(25),
            search: params.get("q").filter(|s| !s.trim().is_empty()).cloned(),
            sort: params.get("sort").cloned(),
            filters: Vec::new(),
        };
        for (k, v) in params {
            if RESERVED.contains(&k.as_str()) {
                continue;
            }
            let (field, op) = match k.split_once("__") {
                Some((f, "ne")) => (f, Op::Ne),
                Some((f, "gt")) => (f, Op::Gt),
                Some((f, "gte")) => (f, Op::Gte),
                Some((f, "lt")) => (f, Op::Lt),
                Some((f, "lte")) => (f, Op::Lte),
                Some((f, "in")) => (f, Op::In),
                Some((f, "like")) => (f, Op::Like),
                Some((f, "null")) => (f, if v == "0" || v == "false" { Op::NotNull } else { Op::IsNull }),
                Some((f, _)) => (f, Op::Eq),
                None => (k.as_str(), Op::Eq),
            };
            q.filters.push((field.to_string(), op, v.clone()));
        }
        q
    }

    fn page_params(&self) -> PageParams {
        PageParams { page: self.page, per_page: self.per_page }
    }
}

fn quote_ident(name: &str) -> String {
    // Names always come from EntityDef metadata; the quoting is belt-and-braces
    // so a column that collides with a SQL keyword still works.
    format!("\"{}\"", name.replace('"', ""))
}

struct Where {
    sql: Vec<String>,
    binds: Vec<Bind>,
}

impl Where {
    fn new(org_id: &str) -> Self {
        Self {
            sql: vec!["org_id = ?".to_string(), "deleted_at IS NULL".to_string()],
            binds: vec![Bind::Text(org_id.to_string())],
        }
    }
    fn clause(&self) -> String {
        format!("WHERE {}", self.sql.join(" AND "))
    }
}

fn build_where(def: &EntityDef, ctx: &Ctx, q: &ListQuery) -> AppResult<Where> {
    let mut w = Where::new(&ctx.org_id);

    for (name, op, raw) in &q.filters {
        let Some(field) = def.field(name) else { continue };
        let col = quote_ident(field.name);

        match op {
            Op::IsNull => w.sql.push(format!("{col} IS NULL")),
            Op::NotNull => w.sql.push(format!("{col} IS NOT NULL")),
            Op::In => {
                let parts: Vec<&str> = raw.split(',').filter(|s| !s.is_empty()).collect();
                if parts.is_empty() {
                    // `field__in=` with nothing in it matches nothing, rather
                    // than silently matching everything.
                    w.sql.push("1 = 0".to_string());
                    continue;
                }
                let placeholders = vec!["?"; parts.len()].join(", ");
                w.sql.push(format!("{col} IN ({placeholders})"));
                for p in parts {
                    w.binds.push(coerce_filter(field, p)?);
                }
            }
            Op::Like => {
                w.sql.push(format!("{col} LIKE ? ESCAPE '\\'"));
                w.binds.push(Bind::Text(format!("%{}%", escape_like(raw))));
            }
            _ => {
                let sym = match op {
                    Op::Eq => "=",
                    Op::Ne => "!=",
                    Op::Gt => ">",
                    Op::Gte => ">=",
                    Op::Lt => "<",
                    Op::Lte => "<=",
                    _ => unreachable!(),
                };
                w.sql.push(format!("{col} {sym} ?"));
                w.binds.push(coerce_filter(field, raw)?);
            }
        }
    }

    if let Some(search) = &q.search {
        let fields = def.searchable_fields();
        if !fields.is_empty() {
            let ors: Vec<String> = fields
                .iter()
                .map(|f| format!("{} LIKE ? ESCAPE '\\'", quote_ident(f.name)))
                .collect();
            w.sql.push(format!("({})", ors.join(" OR ")));
            for _ in &fields {
                w.binds.push(Bind::Text(format!("%{}%", escape_like(search))));
            }
        }
    }

    Ok(w)
}

fn escape_like(s: &str) -> String {
    s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_")
}

fn coerce_filter(field: &FieldDef, raw: &str) -> AppResult<Bind> {
    to_bind(field, &Value::String(raw.to_string()))
        .map_err(|e| AppError::bad_request(format!("filter `{}`: {}", e.field, e.message)))
}

fn order_by(def: &EntityDef, sort: &Option<String>) -> String {
    let (name, dir) = match sort.as_deref() {
        Some(s) if !s.is_empty() => {
            let (n, d) = match s.strip_prefix('-') {
                Some(rest) => (rest, SortDir::Desc),
                None => (s, SortDir::Asc),
            };
            let valid = def.field(n).map(|f| f.sortable).unwrap_or(false)
                || ["created_at", "updated_at", "id"].contains(&n);
            if valid {
                (n.to_string(), d)
            } else {
                (def.default_sort.0.to_string(), def.default_sort.1)
            }
        }
        _ => (def.default_sort.0.to_string(), def.default_sort.1),
    };
    // `id` is a UUIDv7, so it breaks ties in creation order and keeps
    // pagination stable when the sort column has duplicates.
    format!("ORDER BY {} {}, id DESC", quote_ident(&name), dir.sql())
}

pub fn row_to_json(row: &sqlx::sqlite::SqliteRow, def: &EntityDef) -> Value {
    let mut map = Map::new();
    map.insert("id".into(), Value::String(row.try_get::<String, _>("id").unwrap_or_default()));

    for f in &def.fields {
        map.insert(f.name.to_string(), read_field(row, f));
    }
    for sys in ["created_at", "updated_at", "created_by", "updated_by"] {
        let v: Option<String> = row.try_get(sys).ok().flatten();
        map.insert(sys.to_string(), v.map(Value::String).unwrap_or(Value::Null));
    }
    Value::Object(map)
}

fn read_field(row: &sqlx::sqlite::SqliteRow, f: &FieldDef) -> Value {
    read_kind(row, f.name, &f.kind)
}

/// Decode one column by the type the metadata says it holds. Split out from
/// `read_field` because aggregates read the same kinds from a SQL alias
/// (`bucket`) rather than from the field's own column name.
fn read_kind(row: &sqlx::sqlite::SqliteRow, column: &str, kind: &FieldKind) -> Value {
    match kind {
        FieldKind::Int | FieldKind::Money | FieldKind::Percent | FieldKind::Quantity => {
            let v: Option<i64> = row.try_get(column).ok().flatten();
            v.map(|i| Value::Number(i.into())).unwrap_or(Value::Null)
        }
        FieldKind::Bool => {
            let v: Option<i64> = row.try_get(column).ok().flatten();
            v.map(|i| Value::Bool(i != 0)).unwrap_or(Value::Null)
        }
        FieldKind::Json => {
            let v: Option<String> = row.try_get(column).ok().flatten();
            v.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null)
        }
        _ => {
            let v: Option<String> = row.try_get(column).ok().flatten();
            v.map(Value::String).unwrap_or(Value::Null)
        }
    }
}

/// SQLite decides a column's storage class per value, and aggregates change it:
/// SUM over INTEGER stays INTEGER, AVG returns REAL. Try both.
fn read_number(row: &sqlx::sqlite::SqliteRow, column: &str) -> i64 {
    if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(column) {
        return v;
    }
    if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(column) {
        return v.round() as i64;
    }
    0
}

/// For every `Ref` field on the returned rows, fetch the referenced record's
/// title in one query per target entity and attach it as `<field>__label`.
/// Two queries beat N joins, and the UI gets readable rows for free.
pub async fn enrich_refs(
    pool: &SqlitePool,
    registry: &Registry,
    def: &EntityDef,
    ctx: &Ctx,
    rows: &mut [Value],
) -> AppResult<()> {
    let ref_fields: Vec<&FieldDef> = def
        .fields
        .iter()
        .filter(|f| matches!(f.kind, FieldKind::Ref { .. }))
        .collect();
    if ref_fields.is_empty() || rows.is_empty() {
        return Ok(());
    }

    // entity key -> set of ids we need titles for
    let mut wanted: BTreeMap<&'static str, HashSet<String>> = BTreeMap::new();
    for f in &ref_fields {
        let FieldKind::Ref { entity } = &f.kind else { continue };
        for row in rows.iter() {
            if let Some(Value::String(id)) = row.get(f.name) {
                wanted.entry(entity).or_default().insert(id.clone());
            }
        }
    }

    let mut labels: HashMap<(&'static str, String), String> = HashMap::new();
    for (entity_key, ids) in wanted {
        let Some(target) = registry.get(entity_key) else { continue };
        if ids.is_empty() {
            continue;
        }
        let ids: Vec<String> = ids.into_iter().collect();
        // Chunked so a large page never blows past SQLite's variable limit.
        for chunk in ids.chunks(400) {
            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!(
                "SELECT id, {title} AS title FROM {table} WHERE org_id = ? AND id IN ({placeholders})",
                title = quote_ident(target.title_field),
                table = quote_ident(target.table),
            );
            let mut query = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(ctx.org_id.clone());
            for id in chunk {
                query = query.bind(id.clone());
            }
            for row in query.fetch_all(pool).await? {
                let id: String = row.try_get("id").unwrap_or_default();
                let title: Option<String> = row.try_get("title").ok().flatten();
                labels.insert((entity_key, id), title.unwrap_or_else(|| "-".into()));
            }
        }
    }

    for row in rows.iter_mut() {
        let Some(obj) = row.as_object_mut() else { continue };
        for f in &ref_fields {
            let FieldKind::Ref { entity } = &f.kind else { continue };
            let key = match obj.get(f.name) {
                Some(Value::String(id)) => Some(id.clone()),
                _ => None,
            };
            if let Some(id) = key {
                let label = labels
                    .get(&(*entity, id))
                    .cloned()
                    .unwrap_or_else(|| "-".into());
                obj.insert(format!("{}__label", f.name), Value::String(label));
            }
        }
    }

    Ok(())
}

pub async fn list(
    pool: &SqlitePool,
    registry: &Registry,
    def: &EntityDef,
    ctx: &Ctx,
    q: &ListQuery,
) -> AppResult<Page<Value>> {
    let w = build_where(def, ctx, q)?;
    let params = q.page_params();

    let count_sql = format!("SELECT COUNT(*) AS n FROM {} {}", quote_ident(def.table), w.clause());
    let mut count_q = sqlx::query(sqlx::AssertSqlSafe(count_sql));
    for b in &w.binds {
        count_q = bind_one(count_q, b);
    }
    let total: i64 = count_q.fetch_one(pool).await?.try_get("n").unwrap_or(0);

    let cols = def
        .selectable_columns()
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {cols} FROM {table} {where_clause} {order} LIMIT ? OFFSET ?",
        table = quote_ident(def.table),
        where_clause = w.clause(),
        order = order_by(def, &q.sort),
    );
    let mut sel = sqlx::query(sqlx::AssertSqlSafe(sql));
    for b in &w.binds {
        sel = bind_one(sel, b);
    }
    sel = sel.bind(params.limit()).bind(params.offset());

    let mut rows: Vec<Value> = sel
        .fetch_all(pool)
        .await?
        .iter()
        .map(|r| row_to_json(r, def))
        .collect();

    enrich_refs(pool, registry, def, ctx, &mut rows).await?;

    Ok(Page::new(rows, &params, total))
}

pub async fn get(
    pool: &SqlitePool,
    registry: &Registry,
    def: &EntityDef,
    ctx: &Ctx,
    id: &str,
) -> AppResult<Value> {
    let cols = def
        .selectable_columns()
        .iter()
        .map(|c| quote_ident(c))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT {cols} FROM {} WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
        quote_ident(def.table)
    );
    let row = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(&ctx.org_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found(def.label))?;

    let mut rows = vec![row_to_json(&row, def)];
    enrich_refs(pool, registry, def, ctx, &mut rows).await?;
    Ok(rows.remove(0))
}

/// Coerce and validate an incoming payload against the entity definition.
///
/// A field the client did not send is left out of the statement entirely, so
/// on insert the column's own default applies and on update the stored value
/// stands. Clearing a field is done by sending it explicitly as `null` - which
/// keeps "I didn't mention it" and "set it to nothing" as different requests.
/// `partial` (PATCH) additionally waives the required-field checks.
pub fn prepare_write(
    def: &EntityDef,
    body: &Map<String, Value>,
    partial: bool,
) -> AppResult<Vec<(&'static str, Bind)>> {
    let mut out: Vec<(&'static str, Bind)> = Vec::new();
    let mut errors: Vec<FieldError> = Vec::new();

    // Every field is considered here, including server-computed ones: the
    // route strips read-only keys out of the client's payload first, so
    // anything still present at this point was put there by the server.
    for f in &def.fields {
        match body.get(f.name) {
            Some(v) => match to_bind(f, v) {
                Ok(b) => out.push((f.name, b)),
                Err(e) => errors.push(e),
            },
            None if partial => {}
            None => match f.default {
                // Fill the declared default rather than demanding the client
                // restate it; it is validated like any other incoming value.
                Some(d) => match to_bind(f, &Value::String(d.to_string())) {
                    Ok(b) => out.push((f.name, b)),
                    Err(e) => errors.push(e),
                },
                None if f.required => {
                    errors.push(FieldError::new(f.name, format!("{} is required", f.label)));
                }
                None => {}
            },
        }
    }

    if !errors.is_empty() {
        return Err(AppError::Validation(errors));
    }
    Ok(out)
}

pub async fn create(
    pool: &SqlitePool,
    registry: &Registry,
    def: &EntityDef,
    ctx: &Ctx,
    body: &Map<String, Value>,
) -> AppResult<Value> {
    let id = create_on(pool, def, ctx, body).await?;
    get(pool, registry, def, ctx, &id).await
}

/// Insert against any executor, so a caller that needs the insert to share a
/// transaction with something else - allocating an invoice number, say - can
/// pass its connection instead of the pool.
pub async fn create_on<'e, E>(
    exec: E,
    def: &EntityDef,
    ctx: &Ctx,
    body: &Map<String, Value>,
) -> AppResult<String>
where
    E: sqlx::Executor<'e, Database = sqlx::Sqlite>,
{
    let values = prepare_write(def, body, false)?;
    let id = new_id();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let mut cols: Vec<String> = vec!["id".into(), "org_id".into()];
    let mut binds: Vec<Bind> = vec![Bind::Text(id.clone()), Bind::Text(ctx.org_id.clone())];
    for (name, b) in values {
        cols.push(quote_ident(name));
        binds.push(b);
    }
    for (c, v) in [
        ("created_at", now.clone()),
        ("updated_at", now.clone()),
        ("created_by", ctx.user_id.clone()),
        ("updated_by", ctx.user_id.clone()),
    ] {
        cols.push(quote_ident(c));
        binds.push(Bind::Text(v));
    }

    let placeholders = vec!["?"; cols.len()].join(", ");
    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({placeholders})",
        quote_ident(def.table),
        cols.join(", ")
    );
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for b in &binds {
        q = bind_one(q, b);
    }
    q.execute(exec).await?;

    Ok(id)
}

pub async fn update(
    pool: &SqlitePool,
    registry: &Registry,
    def: &EntityDef,
    ctx: &Ctx,
    id: &str,
    body: &Map<String, Value>,
) -> AppResult<Value> {
    let values = prepare_write(def, body, true)?;
    if values.is_empty() {
        return get(pool, registry, def, ctx, id).await;
    }

    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let mut sets: Vec<String> = Vec::new();
    let mut binds: Vec<Bind> = Vec::new();
    for (name, b) in values {
        sets.push(format!("{} = ?", quote_ident(name)));
        binds.push(b);
    }
    sets.push("updated_at = ?".into());
    binds.push(Bind::Text(now));
    sets.push("updated_by = ?".into());
    binds.push(Bind::Text(ctx.user_id.clone()));

    let sql = format!(
        "UPDATE {} SET {} WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
        quote_ident(def.table),
        sets.join(", ")
    );
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for b in &binds {
        q = bind_one(q, b);
    }
    let res = q.bind(&ctx.org_id).bind(id).execute(pool).await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(def.label));
    }

    get(pool, registry, def, ctx, id).await
}

/// Soft delete: the row stays for audit and for foreign keys that still point
/// at it, but disappears from every read path.
pub async fn delete(pool: &SqlitePool, def: &EntityDef, ctx: &Ctx, id: &str) -> AppResult<()> {
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let sql = format!(
        "UPDATE {} SET deleted_at = ?, updated_at = ?, updated_by = ? \
         WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
        quote_ident(def.table)
    );
    let res = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(&now)
        .bind(&now)
        .bind(&ctx.user_id)
        .bind(&ctx.org_id)
        .bind(id)
        .execute(pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found(def.label));
    }
    Ok(())
}

/// Grouped aggregate used by dashboards and charts.
///
/// `group` and `measure` are `FieldDef`s the caller already resolved through
/// the registry, so the only strings reaching SQL are our own column names.
pub async fn aggregate(
    pool: &SqlitePool,
    def: &EntityDef,
    ctx: &Ctx,
    group: Option<&FieldDef>,
    measure: Option<&FieldDef>,
    agg: &str,
    filters: &HashMap<String, String>,
) -> AppResult<Vec<Value>> {
    let q = ListQuery::from_params(filters);
    let w = build_where(def, ctx, &q)?;

    let value_expr = match measure {
        Some(f) => format!("{agg}({})", quote_ident(f.name)),
        // COUNT(*) counts rows; every other aggregate needs a column.
        None => {
            if agg != "COUNT" {
                return Err(AppError::bad_request(format!(
                    "`{agg}` needs a measure field"
                )));
            }
            "COUNT(*)".to_string()
        }
    };

    let sql = match group {
        Some(g) => format!(
            "SELECT {gcol} AS bucket, {value_expr} AS value, COUNT(*) AS count \
             FROM {table} {where_clause} GROUP BY {gcol} ORDER BY value DESC",
            gcol = quote_ident(g.name),
            table = quote_ident(def.table),
            where_clause = w.clause(),
        ),
        None => format!(
            "SELECT NULL AS bucket, {value_expr} AS value, COUNT(*) AS count FROM {table} {where_clause}",
            table = quote_ident(def.table),
            where_clause = w.clause(),
        ),
    };

    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for b in &w.binds {
        query = bind_one(query, b);
    }

    let rows = query.fetch_all(pool).await?;
    Ok(rows
        .iter()
        .map(|r| {
            // The bucket keeps the group field's own type, so a money bucket
            // stays a number and a select bucket stays a string.
            // The group column is aliased to `bucket`, so decode from the
            // alias while still honouring the field's declared kind.
            let bucket = match group {
                Some(g) => read_kind(r, "bucket", &g.kind),
                None => Value::Null,
            };
            json!({
                "bucket": bucket,
                "value": read_number(r, "value"),
                "count": read_number(r, "count"),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::schema::{money, select, opt, text, SortDir};

    fn def() -> EntityDef {
        EntityDef {
            key: "test.things",
            table: "things",
            module: "test",
            label: "Thing",
            label_plural: "Things",
            icon: "box",
            title_field: "name",
            fields: vec![
                text("name", "Name").required().in_list(),
                money("amount", "Amount").in_list(),
                select("status", "Status", vec![opt("open", "Open", "blue")]),
            ],
            default_sort: ("created_at", SortDir::Desc),
            children: vec![],
            has_activities: false,
            has_notes: false,
            global_search: true,
            embedded: false,
            read_only: false,
        }
    }

    fn ctx() -> Ctx {
        Ctx {
            user_id: "u1".into(),
            org_id: "org1".into(),
            email: "a@b.c".into(),
            name: "A".into(),
            role_key: "admin".into(),
            is_owner: true,
            permissions: Default::default(),
        }
    }

    #[test]
    fn where_clause_always_scopes_to_the_tenant() {
        let q = ListQuery::default();
        let w = build_where(&def(), &ctx(), &q).unwrap();
        assert!(w.clause().contains("org_id = ?"));
        assert!(w.clause().contains("deleted_at IS NULL"));
        assert_eq!(w.binds[0], Bind::Text("org1".into()));
    }

    #[test]
    fn unknown_filter_fields_are_ignored_not_injected() {
        let mut params = HashMap::new();
        params.insert("name\" OR 1=1 --".to_string(), "x".to_string());
        let q = ListQuery::from_params(&params);
        let w = build_where(&def(), &ctx(), &q).unwrap();
        assert!(!w.clause().contains("1=1"));
    }

    #[test]
    fn sort_falls_back_to_the_default_for_unknown_columns() {
        let d = def();
        assert!(order_by(&d, &Some("name".into())).starts_with("ORDER BY \"name\" ASC"));
        assert!(order_by(&d, &Some("-name".into())).starts_with("ORDER BY \"name\" DESC"));
        assert!(order_by(&d, &Some("; DROP TABLE things".into()))
            .starts_with("ORDER BY \"created_at\" DESC"));
    }

    #[test]
    fn empty_in_filter_matches_nothing() {
        let mut params = HashMap::new();
        params.insert("status__in".to_string(), String::new());
        let q = ListQuery::from_params(&params);
        let w = build_where(&def(), &ctx(), &q).unwrap();
        assert!(w.clause().contains("1 = 0"));
    }

    #[test]
    fn search_wildcards_are_escaped() {
        assert_eq!(escape_like("100%_x"), "100\\%\\_x");
    }

    #[test]
    fn a_declared_default_satisfies_a_required_field() {
        let mut d = def();
        d.fields.push(
            select("kind", "Kind", vec![opt("basic", "Basic", "info")])
                .required()
                .with_default("basic"),
        );
        let body: Map<String, Value> = serde_json::from_str(r#"{"name":"Acme"}"#).unwrap();
        let out = prepare_write(&d, &body, false).expect("default should satisfy `required`");
        assert!(out.iter().any(|(n, b)| *n == "kind" && *b == Bind::Text("basic".into())));
    }

    #[test]
    fn required_fields_are_enforced_on_create_but_not_patch() {
        let d = def();
        let body: Map<String, Value> = serde_json::from_str(r#"{"amount":"10.00"}"#).unwrap();
        assert!(prepare_write(&d, &body, false).is_err());
        assert!(prepare_write(&d, &body, true).is_ok());
    }

    #[test]
    fn omitted_fields_are_left_to_the_column_default() {
        let d = def();
        let body: Map<String, Value> = serde_json::from_str(r#"{"name":"Acme"}"#).unwrap();
        let out = prepare_write(&d, &body, false).unwrap();
        assert!(
            !out.iter().any(|(n, _)| *n == "amount"),
            "an unmentioned column must not be written, or NOT NULL DEFAULT columns break"
        );
    }

    #[test]
    fn an_explicit_null_still_clears_a_field() {
        let d = def();
        let body: Map<String, Value> = serde_json::from_str(r#"{"name":"Acme","amount":null}"#).unwrap();
        let out = prepare_write(&d, &body, true).unwrap();
        assert!(out.iter().any(|(n, b)| *n == "amount" && *b == Bind::Null));
    }
}
