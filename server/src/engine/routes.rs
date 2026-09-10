//! Registry-driven HTTP surface.
//!
//! These handlers are entity-agnostic: `/api/e/crm.deals` and
//! `/api/e/books.invoices` run the same code, differing only in the
//! `EntityDef` they resolve. Module-specific behaviour hangs off this via
//! hooks rather than duplicating CRUD.

use std::collections::HashMap;

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::auth::ctx::{Action, Ctx};
use crate::common::audit;
use crate::common::pagination::Page;
use crate::engine::repo::{self, ListQuery};
use crate::engine::search;
use crate::engine::schema::EntityDef;
use crate::modules::automations::{self, Trigger};
use crate::modules::approvals;
use crate::modules::webhooks;
use crate::modules::hooks;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/meta", get(meta))
        .route("/meta/{entity}", get(entity_meta))
        .route("/e/{entity}", get(list).post(create))
        .route("/e/{entity}/{id}", get(show).patch(update).delete(destroy))
        .route("/e/{entity}/{id}/audit", get(audit_trail))
        .route("/search", get(search))
        .route("/lookup/{entity}", get(lookup))
        .route("/stats/{entity}", post(stats))
}

/// Drop any read-only field the client tried to set. Totals, balances, stock
/// levels and document numbers are the server's to decide; silently ignoring
/// them beats trusting them and beats a confusing error.
fn strip_readonly(def: &EntityDef, body: &mut Map<String, Value>) {
    for f in &def.fields {
        if f.readonly {
            body.remove(f.name);
        }
    }
}

/// Entities backed by a view (or otherwise owned by a dedicated endpoint) are
/// readable through the engine but never writable through it.
fn guard_writable(def: &EntityDef) -> AppResult<()> {
    if def.read_only {
        return Err(AppError::forbidden(format!(
            "{} is managed elsewhere and cannot be edited here",
            def.label_plural
        )));
    }
    Ok(())
}

fn resolve<'a>(state: &'a AppState, key: &str) -> AppResult<&'a EntityDef> {
    state
        .registry
        .get(key)
        .ok_or_else(|| AppError::not_found(format!("Entity `{key}`")))
}

/// The whole application map in one call: the sidebar, the routes and every
/// form in the UI are generated from this payload.
async fn meta(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    // Which parts of the suite this business says it uses. No rows means it
    // has never been asked, and everything shows — the state every workspace
    // was in before the question existed.
    let chosen: Vec<String> = sqlx::query_scalar(
        "SELECT module_key FROM org_modules WHERE org_id = ?",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;
    // `core` is the workspace itself and is never switched off, so it is
    // never stored and never filtered.
    let in_use = |key: &str| {
        key == crate::modules::CORE || chosen.is_empty() || chosen.iter().any(|m| m == key)
    };

    let modules: Vec<Value> = state
        .registry
        .modules()
        .iter()
        .filter(|m| in_use(m.key))
        .map(|m| {
            let entities: Vec<Value> = state
                .registry
                .entities_in(m.key)
                .into_iter()
                .filter(|e| !e.embedded && ctx.can(e.key, Action::View))
                .map(|e| {
                    json!({
                        "key": e.key,
                        "label": e.label,
                        "label_plural": e.label_plural,
                        "icon": e.icon,
                    })
                })
                .collect();
            json!({
                "key": m.key,
                "label": m.label,
                "icon": m.icon,
                "color": m.color,
                "description": m.description,
                "entities": entities,
            })
        })
        .filter(|m| !m["entities"].as_array().map(|a| a.is_empty()).unwrap_or(true))
        .collect();

    Ok(Json(json!({ "modules": modules })))
}

/// Full definition of one entity: fields, kinds, options, child collections.
async fn entity_meta(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(entity): Path<String>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;

    Ok(Json(json!({
        "key": def.key,
        "module": def.module,
        "table": def.table,
        "label": def.label,
        "label_plural": def.label_plural,
        "icon": def.icon,
        "title_field": def.title_field,
        "fields": def.fields,
        "children": def.children,
        "default_sort": { "field": def.default_sort.0, "dir": def.default_sort.1 },
        "has_activities": def.has_activities,
        "has_notes": def.has_notes,
        "permissions": {
            "view": ctx.can(def.key, Action::View),
            "create": ctx.can(def.key, Action::Create),
            "edit": ctx.can(def.key, Action::Edit),
            "delete": ctx.can(def.key, Action::Delete),
        },
    })))
}

async fn list(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(entity): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<Page<Value>>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;
    let q = ListQuery::from_params(&params);
    let page = repo::list(&state.pool, &state.registry, def, &ctx, &q).await?;
    Ok(Json(page))
}

async fn show(
    State(state): State<AppState>,
    ctx: Ctx,
    Path((entity, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;
    Ok(Json(repo::get(&state.pool, &state.registry, def, &ctx, &id).await?))
}

async fn create(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(entity): Path<String>,
    Json(mut body): Json<Map<String, Value>>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::Create)?;
    guard_writable(def)?;
    strip_readonly(def, &mut body);
    // Anything the server owns but the column requires is filled in here,
    // after the client's read-only fields have been discarded.
    hooks::before_create(def.key, &mut body);
    // Rules that need to see the rest of the table. Before the insert, so a
    // rejected write leaves nothing behind to clean up.
    hooks::validate(&state.pool, &ctx, def.key, None, &body).await?;

    // Documents that carry a number allocate it in the same transaction as the
    // insert, so a failed insert does not burn an invoice number.
    let id = if hooks::needs_number(def.key).is_some() {
        let mut tx = state.pool.begin().await?;
        hooks::assign_number(&mut tx, &ctx, def.key, &mut body).await?;
        let id = repo::create_on(&mut *tx, def, &ctx, &body).await?;
        tx.commit().await?;
        id
    } else {
        repo::create_on(&state.pool, def, &ctx, &body).await?
    };

    hooks::after_write(&state.pool, &ctx, def.key, &id).await?;
    let record = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;

    // User rules run after the server's own derivations, so a rule sees (and
    // can act on) the totals and derived values the write produced.
    automations::run(&state, &ctx, def.key, &id, Trigger::OnCreate, None, &record).await;
    let record = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;

    // Index after the hooks and rules, so what is searchable is the record as
    // it finally stands rather than as it was first posted.
    if let Err(e) = search::index_record(&state.pool, def, &ctx.org_id, &id, &record).await {
        tracing::warn!(error = %e, entity = def.key, "could not index a new record");
    }

    webhooks::dispatch(&state, &ctx, &format!("{}.create", def.key), &id, &record).await;
    approvals::evaluate_record(&state, &ctx, def.key, &id, &record, None).await;

    audit::record(
        &state.pool,
        &ctx,
        def.key,
        &id,
        "create",
        Some(format!("Created {}", title_of(def, &record))),
        None,
    )
    .await?;

    Ok(Json(record))
}

async fn update(
    State(state): State<AppState>,
    ctx: Ctx,
    Path((entity, id)): Path<(String, String)>,
    Json(mut body): Json<Map<String, Value>>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::Edit)?;
    guard_writable(def)?;
    strip_readonly(def, &mut body);

    let before = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;
    hooks::validate(&state.pool, &ctx, def.key, Some(&id), &body).await?;
    repo::update(&state.pool, &state.registry, def, &ctx, &id, &body).await?;
    hooks::after_write(&state.pool, &ctx, def.key, &id).await?;
    // Re-read after the hooks, so the response carries the derived values
    // (totals, balances, expected revenue) rather than the pre-hook row.
    let after = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;

    automations::run(&state, &ctx, def.key, &id, Trigger::OnUpdate, Some(&before), &after).await;
    // A rule may have set fields of its own; return what actually landed.
    let after = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;

    if let Err(e) = search::index_record(&state.pool, def, &ctx.org_id, &id, &after).await {
        tracing::warn!(error = %e, entity = def.key, "could not reindex a record");
    }

    webhooks::dispatch(&state, &ctx, &format!("{}.update", def.key), &id, &after).await;
    approvals::evaluate_record(&state, &ctx, def.key, &id, &after, Some(&before)).await;

    if let Some(changes) = audit::diff(&before, &after) {
        let summary = changes
            .as_object()
            .map(|c| {
                let mut names: Vec<String> = c
                    .keys()
                    .map(|k| def.field(k).map(|f| f.label.to_string()).unwrap_or_else(|| k.clone()))
                    .collect();
                names.sort();
                format!("Updated {}", names.join(", "))
            })
            .unwrap_or_else(|| "Updated".into());
        audit::record(&state.pool, &ctx, def.key, &id, "update", Some(summary), Some(changes)).await?;
    }

    Ok(Json(after))
}

async fn destroy(
    State(state): State<AppState>,
    ctx: Ctx,
    Path((entity, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::Delete)?;
    guard_writable(def)?;

    let before = repo::get(&state.pool, &state.registry, def, &ctx, &id).await?;
    // Capture the parent before the row goes, so its document can be retotalled.
    let parent = hooks::parent_key(def.key)
        .and_then(|fk| before.get(fk))
        .and_then(|v| v.as_str())
        .map(str::to_string);

    repo::delete(&state.pool, def, &ctx, &id).await?;

    // A deleted record must stop being findable.
    if let Err(e) = search::remove_record(&state.pool, def.key, &ctx.org_id, &id).await {
        tracing::warn!(error = %e, entity = def.key, "could not remove a record from the index");
    }

    if let Some(parent_id) = parent {
        hooks::after_child_delete(&state.pool, &ctx, def.key, &parent_id).await?;
    }

    webhooks::dispatch(&state, &ctx, &format!("{}.delete", def.key), &id, &before).await;

    audit::record(
        &state.pool,
        &ctx,
        def.key,
        &id,
        "delete",
        Some(format!("Deleted {}", title_of(def, &before))),
        None,
    )
    .await?;

    Ok(Json(json!({ "ok": true })))
}

fn title_of(def: &EntityDef, record: &Value) -> String {
    record
        .get(def.title_field)
        .and_then(|v| v.as_str())
        .map(|s| format!("{} {s}", def.label))
        .unwrap_or_else(|| def.label.to_string())
}

/// Chronological history of a record, for the detail-page timeline.
async fn audit_trail(
    State(state): State<AppState>,
    ctx: Ctx,
    Path((entity, id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;

    let rows = sqlx::query(
        "SELECT a.id, a.action, a.summary, a.changes, a.created_at, u.name AS user_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.org_id = ? AND a.entity = ? AND a.record_id = ?
         ORDER BY a.created_at DESC, a.id DESC LIMIT 100",
    )
    .bind(&ctx.org_id)
    .bind(def.key)
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    let events: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "action": r.try_get::<String, _>("action").unwrap_or_default(),
                "summary": r.try_get::<Option<String>, _>("summary").ok().flatten(),
                "changes": r.try_get::<Option<String>, _>("changes").ok().flatten()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok()),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
                "user_name": r.try_get::<Option<String>, _>("user_name").ok().flatten(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": events })))
}

#[derive(serde::Deserialize)]
pub struct SearchParams {
    pub q: String,
    #[serde(default)]
    pub limit: Option<i64>,
}

/// Cross-module search: the command palette's backend.
///
/// One FTS5 query across every entity, then grouped for display. Previously
/// this ran a `LIKE '%term%'` scan per entity — correct, but a table scan each,
/// and the cost grew with every module added.
async fn search(
    State(state): State<AppState>,
    ctx: Ctx,
    Query(params): Query<SearchParams>,
) -> AppResult<Json<Value>> {
    let term = params.q.trim();
    if term.len() < 2 {
        return Ok(Json(json!({ "groups": [] })));
    }
    let per_entity = params.limit.unwrap_or(5).clamp(1, 20);

    let hits = search::query(&state.pool, &state.registry, &ctx, term, per_entity * 8).await?;

    // Group in registry order so the palette lists modules the same way the
    // sidebar does.
    let mut groups: Vec<Value> = Vec::new();
    for def in state.registry.entities() {
        let items: Vec<Value> = hits
            .iter()
            .filter(|h| h.entity == def.key)
            .take(per_entity as usize)
            .map(|h| json!({ "id": h.record_id, "title": h.title }))
            .collect();
        if items.is_empty() {
            continue;
        }
        let total = hits.iter().filter(|h| h.entity == def.key).count();
        groups.push(json!({
            "entity": def.key,
            "label": def.label_plural,
            "icon": def.icon,
            "total": total,
            "items": items,
        }));
    }

    Ok(Json(json!({ "groups": groups })))
}

/// Minimal `{id, label}` list that powers reference pickers without shipping
/// whole records to a dropdown.
async fn lookup(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(entity): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;

    let mut q = ListQuery::from_params(&params);
    q.per_page = q.per_page.clamp(1, 50);
    let page = repo::list(&state.pool, &state.registry, def, &ctx, &q).await?;

    Ok(Json(json!({
        "data": page.data.iter().map(|r| json!({
            "id": r["id"],
            "label": r.get(def.title_field).cloned().unwrap_or(Value::Null),
        })).collect::<Vec<_>>(),
        "total": page.total,
    })))
}

#[derive(serde::Deserialize)]
pub struct StatsRequest {
    /// Field to group by; omit for a single total.
    #[serde(default)]
    pub group_by: Option<String>,
    /// Field to aggregate; omit to count records.
    #[serde(default)]
    pub measure: Option<String>,
    #[serde(default)]
    pub agg: Option<String>,
    #[serde(default)]
    pub filters: HashMap<String, String>,
}

/// Grouped aggregate over an entity - the one query shape every chart and KPI
/// tile on the dashboards needs.
async fn stats(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(entity): Path<String>,
    Json(req): Json<StatsRequest>,
) -> AppResult<Json<Value>> {
    let def = resolve(&state, &entity)?;
    ctx.require(def.key, Action::View)?;

    let group = match &req.group_by {
        Some(name) => Some(
            def.field(name)
                .ok_or_else(|| AppError::bad_request(format!("Unknown field `{name}`")))?,
        ),
        None => None,
    };
    let measure = match &req.measure {
        Some(name) => Some(
            def.field(name)
                .ok_or_else(|| AppError::bad_request(format!("Unknown field `{name}`")))?,
        ),
        None => None,
    };
    let agg = match req.agg.as_deref().unwrap_or("count") {
        "sum" => "SUM",
        "avg" => "AVG",
        "min" => "MIN",
        "max" => "MAX",
        "count" => "COUNT",
        other => return Err(AppError::bad_request(format!("Unsupported aggregate `{other}`"))),
    };

    let rows = repo::aggregate(&state.pool, def, &ctx, group, measure, agg, &req.filters).await?;
    Ok(Json(json!({ "data": rows })))
}
