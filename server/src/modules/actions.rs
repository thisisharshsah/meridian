//! Conversions — the steps that turn one record into the next one along.
//!
//! These are the joins that make a suite a suite rather than nine address
//! books: a lead becomes an account + contact (+ deal), a quote becomes a
//! sales order, an order becomes an invoice. Each runs in one transaction and
//! records lineage on both sides, so you can always answer "where did this
//! invoice come from".

use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::auth::ctx::{Action, Ctx};
use crate::common::audit;
use crate::engine::repo;
use crate::error::{AppError, AppResult};
use crate::modules::hooks;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/actions/crm.leads/{id}/convert", post(convert_lead))
        .route("/actions/sales.quotes/{id}/convert", post(quote_to_order))
        .route("/actions/sales.orders/{id}/convert", post(order_to_invoice))
        .route("/actions/books.invoices/{id}/send", post(mark_invoice_sent))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn today() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

/// Insert through the engine so validation, defaults and audit columns all
/// apply, allocating a document number first when the entity uses one.
async fn create_via_engine(
    state: &AppState,
    ctx: &Ctx,
    entity: &str,
    mut body: Map<String, Value>,
) -> AppResult<String> {
    let def = state
        .registry
        .get(entity)
        .ok_or_else(|| AppError::not_found(format!("Entity `{entity}`")))?;

    for f in &def.fields {
        if f.readonly {
            body.remove(f.name);
        }
    }

    // Same order as the engine's own create route: strip what the client does
    // not own, then let the server fill in what the columns require. This path
    // skipped the second half, so a record created by an action was missing
    // anything a hook composes -- which stayed invisible only for as long as
    // nothing it creates had such a column.
    hooks::before_create(def.key, &mut body);

    if hooks::needs_number(def.key).is_some() {
        let mut tx = state.pool.begin().await?;
        hooks::assign_number(&mut tx, ctx, def.key, &mut body).await?;
        let id = repo::create_on(&mut *tx, def, ctx, &body).await?;
        tx.commit().await?;
        Ok(id)
    } else {
        repo::create_on(&state.pool, def, ctx, &body).await
    }
}

fn obj(pairs: Vec<(&str, Value)>) -> Map<String, Value> {
    pairs
        .into_iter()
        .filter(|(_, v)| !v.is_null())
        .map(|(k, v)| (k.to_string(), v))
        .collect()
}

// ------------------------------------------------------------------ leads ---

#[derive(Deserialize, Default)]
pub struct ConvertLeadBody {
    /// Attach to an account that already exists instead of creating one.
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub create_deal: bool,
    #[serde(default)]
    pub deal_name: Option<String>,
    #[serde(default)]
    pub deal_amount: Option<String>,
    #[serde(default)]
    pub deal_closing_date: Option<String>,
}

/// Lead → Account + Contact (+ Deal).
///
/// The lead is *not* deleted. Zoho keeps converted leads addressable and so do
/// we: a deleted lead would silently rewrite last quarter's conversion rate.
async fn convert_lead(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<ConvertLeadBody>,
) -> AppResult<Json<Value>> {
    ctx.require("crm.leads", Action::Edit)?;
    ctx.require("crm.accounts", Action::Create)?;
    ctx.require("crm.contacts", Action::Create)?;
    if body.create_deal {
        ctx.require("crm.deals", Action::Create)?;
    }

    let lead = sqlx::query(
        "SELECT first_name, last_name, full_name, company, title, email, phone, mobile,
                website, industry, annual_revenue, employees, owner_id, street, city,
                country, description, status, converted_at
         FROM leads WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Lead"))?;

    if lead.try_get::<Option<String>, _>("converted_at").ok().flatten().is_some() {
        return Err(AppError::conflict("This lead has already been converted"));
    }

    let text = |c: &str| lead.try_get::<Option<String>, _>(c).ok().flatten();
    let number = |c: &str| lead.try_get::<Option<i64>, _>(c).ok().flatten();

    let company = text("company").unwrap_or_else(|| "Untitled company".into());
    let full_name = text("full_name").unwrap_or_else(|| "Unnamed contact".into());
    let owner_id = text("owner_id");

    // Reuse the caller's account when given, otherwise mint one from the
    // lead's company. Either way the contact ends up attached to something.
    let account_id = match &body.account_id {
        Some(existing) => {
            let ok = sqlx::query("SELECT 1 FROM accounts WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
                .bind(&ctx.org_id)
                .bind(existing)
                .fetch_optional(&state.pool)
                .await?;
            if ok.is_none() {
                return Err(AppError::not_found("Account"));
            }
            existing.clone()
        }
        None => {
            create_via_engine(
                &state,
                &ctx,
                "crm.accounts",
                obj(vec![
                    ("name", json!(company)),
                    ("account_type", json!("customer")),
                    ("industry", text("industry").map(Value::from).unwrap_or(Value::Null)),
                    ("website", text("website").map(Value::from).unwrap_or(Value::Null)),
                    ("phone", text("phone").map(Value::from).unwrap_or(Value::Null)),
                    ("annual_revenue", number("annual_revenue").map(minor_to_decimal).unwrap_or(Value::Null)),
                    ("employees", number("employees").map(Value::from).unwrap_or(Value::Null)),
                    ("owner_id", owner_id.clone().map(Value::from).unwrap_or(Value::Null)),
                    ("billing_street", text("street").map(Value::from).unwrap_or(Value::Null)),
                    ("billing_city", text("city").map(Value::from).unwrap_or(Value::Null)),
                    ("billing_country", text("country").map(Value::from).unwrap_or(Value::Null)),
                    ("description", text("description").map(Value::from).unwrap_or(Value::Null)),
                ]),
            )
            .await?
        }
    };

    let contact_id = create_via_engine(
        &state,
        &ctx,
        "crm.contacts",
        obj(vec![
            ("full_name", json!(full_name)),
            ("first_name", text("first_name").map(Value::from).unwrap_or(Value::Null)),
            ("last_name", json!(text("last_name").unwrap_or_else(|| full_name.clone()))),
            ("account_id", json!(account_id)),
            ("title", text("title").map(Value::from).unwrap_or(Value::Null)),
            ("email", text("email").map(Value::from).unwrap_or(Value::Null)),
            ("phone", text("phone").map(Value::from).unwrap_or(Value::Null)),
            ("mobile", text("mobile").map(Value::from).unwrap_or(Value::Null)),
            ("owner_id", owner_id.clone().map(Value::from).unwrap_or(Value::Null)),
            ("mailing_street", text("street").map(Value::from).unwrap_or(Value::Null)),
            ("mailing_city", text("city").map(Value::from).unwrap_or(Value::Null)),
            ("mailing_country", text("country").map(Value::from).unwrap_or(Value::Null)),
        ]),
    )
    .await?;

    let deal_id = if body.create_deal {
        let name = body
            .deal_name
            .clone()
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| format!("{company} opportunity"));
        let id = create_via_engine(
            &state,
            &ctx,
            "crm.deals",
            obj(vec![
                ("name", json!(name)),
                ("account_id", json!(account_id)),
                ("contact_id", json!(contact_id)),
                ("stage", json!("qualification")),
                ("amount", body.deal_amount.clone().map(Value::from).unwrap_or(json!("0"))),
                (
                    "closing_date",
                    body.deal_closing_date.clone().map(Value::from).unwrap_or(Value::Null),
                ),
                ("owner_id", owner_id.clone().map(Value::from).unwrap_or(Value::Null)),
                ("deal_type", json!("new_business")),
            ]),
        )
        .await?;
        hooks::after_write(&state.pool, &ctx, "crm.deals", &id).await?;
        Some(id)
    } else {
        None
    };

    // Mark the lead converted only if it is still unconverted. The account,
    // contact and deal above are separate writes, so two clicks landing
    // together would otherwise both build a full set of records and the second
    // would overwrite the first's links — leaving the first set orphaned, with
    // no way to find them from the lead. Losing the race here means the caller
    // is told, and their extra records are cleaned up below.
    let ts = now();
    let claimed = sqlx::query(
        "UPDATE leads SET status = 'converted', converted_at = ?, converted_contact_id = ?,
                converted_account_id = ?, converted_deal_id = ?, updated_at = ?, updated_by = ?
         WHERE org_id = ? AND id = ? AND converted_at IS NULL",
    )
    .bind(&ts)
    .bind(&contact_id)
    .bind(&account_id)
    .bind(&deal_id)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if claimed.rows_affected() == 0 {
        // Someone else converted it first. Soft-delete what this request
        // created so the workspace is not left with a duplicate customer.
        for (table, row_id) in [
            ("deals", deal_id.as_deref()),
            ("contacts", Some(contact_id.as_str())),
            // Only if we made it — an account the caller chose stays.
            ("accounts", if body.account_id.is_none() { Some(account_id.as_str()) } else { None }),
        ] {
            let Some(row_id) = row_id else { continue };
            let sql = format!("UPDATE {table} SET deleted_at = ? WHERE org_id = ? AND id = ?");
            let _ = sqlx::query(sqlx::AssertSqlSafe(sql))
                .bind(&ts)
                .bind(&ctx.org_id)
                .bind(row_id)
                .execute(&state.pool)
                .await;
        }
        return Err(AppError::conflict("This lead has already been converted"));
    }

    audit::record(
        &state.pool,
        &ctx,
        "crm.leads",
        &id,
        "convert",
        Some(format!(
            "Converted to account and contact{}",
            if deal_id.is_some() { " with a new deal" } else { "" }
        )),
        Some(json!({
            "account_id": { "from": Value::Null, "to": account_id },
            "contact_id": { "from": Value::Null, "to": contact_id },
        })),
    )
    .await?;

    Ok(Json(json!({
        "account_id": account_id,
        "contact_id": contact_id,
        "deal_id": deal_id,
    })))
}

/// Money is stored in minor units; the engine's writer wants a decimal string.
///
/// The sign comes from the value, not from the integer part: `-50` divided by
/// 100 truncates to `0`, so building the string from the quotient turns minus
/// fifty pence into plus fifty pence. A credit note copied through a document
/// conversion would silently become a charge.
fn minor_to_decimal(minor: i64) -> Value {
    let sign = if minor < 0 { "-" } else { "" };
    let m = minor.unsigned_abs();
    Value::String(format!("{sign}{}.{:02}", m / 100, m % 100))
}

// -------------------------------------------------------------- documents ---

/// Copy every line from one document to another, preserving order and pricing.
async fn copy_lines(
    state: &AppState,
    ctx: &Ctx,
    from_table: &str,
    from_key: &str,
    from_id: &str,
    to_entity: &str,
    to_key: &str,
    to_id: &str,
) -> AppResult<usize> {
    let sql = format!(
        "SELECT item_id, description, quantity, unit_price, discount_percent, tax_rate, sort_order
         FROM {from_table} WHERE org_id = ? AND {from_key} = ? AND deleted_at IS NULL
         ORDER BY sort_order, id"
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(&ctx.org_id)
        .bind(from_id)
        .fetch_all(&state.pool)
        .await?;

    let def = state
        .registry
        .get(to_entity)
        .ok_or_else(|| AppError::not_found(format!("Entity `{to_entity}`")))?;

    for (i, r) in rows.iter().enumerate() {
        let body: Map<String, Value> = obj(vec![
            (to_key, json!(to_id)),
            (
                "item_id",
                r.try_get::<Option<String>, _>("item_id").ok().flatten().map(Value::from).unwrap_or(Value::Null),
            ),
            (
                "description",
                json!(r.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default()),
            ),
            ("quantity", scaled(r.try_get::<i64, _>("quantity").unwrap_or(0), 1000)),
            ("unit_price", minor_to_decimal(r.try_get::<i64, _>("unit_price").unwrap_or(0))),
            ("discount_percent", scaled(r.try_get::<i64, _>("discount_percent").unwrap_or(0), 10_000)),
            ("tax_rate", scaled(r.try_get::<i64, _>("tax_rate").unwrap_or(0), 10_000)),
            ("sort_order", json!(i as i64)),
        ]);
        repo::create_on(&state.pool, def, ctx, &body).await?;
    }

    Ok(rows.len())
}

/// Turn a scaled integer back into the decimal string the writer parses.
/// Signed from the value itself, for the reason given on `minor_to_decimal`.
fn scaled(value: i64, scale: i64) -> Value {
    let digits = (scale as f64).log10().round() as usize;
    let sign = if value < 0 { "-" } else { "" };
    let v = value.unsigned_abs();
    let s = scale.unsigned_abs().max(1);
    Value::String(format!("{sign}{}.{:0width$}", v / s, v % s, width = digits))
}

#[derive(Deserialize, Default)]
pub struct ConvertDocBody {
    /// Days from today until the new document is due. Defaults to net 30.
    #[serde(default)]
    pub payment_terms_days: Option<i64>,
}

/// Quote → Sales order. Accepting a quote is what creates the order, so the
/// quote is marked accepted at the same time.
async fn quote_to_order(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require("sales.quotes", Action::Edit)?;
    ctx.require("sales.orders", Action::Create)?;

    let q = sqlx::query(
        "SELECT subject, account_id, contact_id, currency, owner_id, notes, status
         FROM quotes WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Quote"))?;

    // As above: the index in 0016 is the guarantee, this is the message.
    let existing = sqlx::query("SELECT id FROM sales_orders WHERE org_id = ? AND quote_id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    if let Some(row) = existing {
        return Err(AppError::conflict(format!(
            "This quote was already converted into order {}",
            row.try_get::<String, _>("id").unwrap_or_default()
        )));
    }

    let text = |c: &str| q.try_get::<Option<String>, _>(c).ok().flatten();

    let order_id = create_via_engine(
        &state,
        &ctx,
        "sales.orders",
        obj(vec![
            ("subject", json!(text("subject").unwrap_or_else(|| "Order".into()))),
            ("account_id", text("account_id").map(Value::from).unwrap_or(Value::Null)),
            ("contact_id", text("contact_id").map(Value::from).unwrap_or(Value::Null)),
            ("quote_id", json!(id)),
            ("status", json!("open")),
            ("order_date", json!(today())),
            ("currency", json!(text("currency").unwrap_or_else(|| "USD".into()))),
            ("owner_id", text("owner_id").map(Value::from).unwrap_or(Value::Null)),
            ("notes", text("notes").map(Value::from).unwrap_or(Value::Null)),
        ]),
    )
    .await?;

    let lines = copy_lines(
        &state, &ctx, "quote_items", "quote_id", &id, "sales.order_items", "sales_order_id", &order_id,
    )
    .await?;
    hooks::retotal_document(&state.pool, &ctx, "sales.orders", &order_id).await?;

    let ts = now();
    sqlx::query("UPDATE quotes SET status = 'accepted', updated_at = ?, updated_by = ? WHERE org_id = ? AND id = ?")
        .bind(&ts).bind(&ctx.user_id).bind(&ctx.org_id).bind(&id)
        .execute(&state.pool)
        .await?;

    audit::record(&state.pool, &ctx, "sales.quotes", &id, "convert",
        Some(format!("Accepted and converted to a sales order ({lines} lines)")), None).await?;
    audit::record(&state.pool, &ctx, "sales.orders", &order_id, "create",
        Some("Created from a quote".into()), None).await?;

    Ok(Json(json!({ "sales_order_id": order_id, "lines": lines })))
}

/// Sales order → Invoice.
async fn order_to_invoice(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<ConvertDocBody>,
) -> AppResult<Json<Value>> {
    ctx.require("sales.orders", Action::Edit)?;
    ctx.require("books.invoices", Action::Create)?;

    let o = sqlx::query(
        "SELECT subject, account_id, contact_id, currency, owner_id, notes
         FROM sales_orders WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Sales order"))?;

    let text = |c: &str| o.try_get::<Option<String>, _>(c).ok().flatten();
    let account_id = text("account_id")
        .ok_or_else(|| AppError::bad_request("This order has no customer, so it cannot be invoiced"))?;

    // The read is a courtesy for the error message; the unique index added in
    // migration 0016 is what actually prevents two concurrent conversions from
    // both creating an invoice.
    let existing = sqlx::query("SELECT id FROM invoices WHERE org_id = ? AND sales_order_id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id).bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::conflict("This order has already been invoiced"));
    }

    let terms = body.payment_terms_days.unwrap_or(30).clamp(0, 365);
    let due = (Utc::now() + chrono::Duration::days(terms)).format("%Y-%m-%d").to_string();

    let invoice_id = create_via_engine(
        &state,
        &ctx,
        "books.invoices",
        obj(vec![
            ("subject", text("subject").map(Value::from).unwrap_or(Value::Null)),
            ("account_id", json!(account_id)),
            ("contact_id", text("contact_id").map(Value::from).unwrap_or(Value::Null)),
            ("sales_order_id", json!(id)),
            ("status", json!("draft")),
            ("invoice_date", json!(today())),
            ("due_date", json!(due)),
            ("currency", json!(text("currency").unwrap_or_else(|| "USD".into()))),
            ("owner_id", text("owner_id").map(Value::from).unwrap_or(Value::Null)),
            ("terms", json!(format!("Net {terms}."))),
            ("notes", text("notes").map(Value::from).unwrap_or(Value::Null)),
        ]),
    )
    .await?;

    let lines = copy_lines(
        &state, &ctx, "sales_order_items", "sales_order_id", &id, "books.invoice_items", "invoice_id", &invoice_id,
    )
    .await?;
    hooks::retotal_document(&state.pool, &ctx, "books.invoices", &invoice_id).await?;

    let ts = now();
    sqlx::query("UPDATE sales_orders SET status = 'invoiced', updated_at = ?, updated_by = ? WHERE org_id = ? AND id = ?")
        .bind(&ts).bind(&ctx.user_id).bind(&ctx.org_id).bind(&id)
        .execute(&state.pool)
        .await?;

    audit::record(&state.pool, &ctx, "sales.orders", &id, "convert",
        Some(format!("Invoiced ({lines} lines)")), None).await?;
    audit::record(&state.pool, &ctx, "books.invoices", &invoice_id, "create",
        Some("Created from a sales order".into()), None).await?;

    Ok(Json(json!({ "invoice_id": invoice_id, "lines": lines })))
}

/// Issue a draft invoice. Separate from a plain status edit because sending is
/// the point at which the document stops being a draft anyone can restructure.
async fn mark_invoice_sent(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require("books.invoices", Action::Edit)?;

    let inv = sqlx::query("SELECT status, total FROM invoices WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id).bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Invoice"))?;

    let status: String = inv.try_get("status").unwrap_or_default();
    let total: i64 = inv.try_get("total").unwrap_or(0);

    if status != "draft" {
        return Err(AppError::conflict(format!("This invoice is already {status}")));
    }
    if total <= 0 {
        return Err(AppError::bad_request("Add at least one line before issuing this invoice"));
    }

    let ts = now();
    sqlx::query(
        "UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ?, updated_by = ?
         WHERE org_id = ? AND id = ?",
    )
    .bind(&ts).bind(&ts).bind(&ctx.user_id).bind(&ctx.org_id).bind(&id)
    .execute(&state.pool)
    .await?;

    // Re-derive, so an invoice issued past its due date lands on `overdue`.
    hooks::recalc_invoice_balance(&state.pool, &ctx, &id).await?;
    audit::record(&state.pool, &ctx, "books.invoices", &id, "update", Some("Issued".into()), None).await?;

    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scaled_values_round_trip_as_decimal_strings() {
        assert_eq!(scaled(2_500, 1000), json!("2.500"));
        assert_eq!(scaled(185_000, 10_000), json!("18.5000"));
        assert_eq!(minor_to_decimal(123_456), json!("1234.56"));
        assert_eq!(minor_to_decimal(5), json!("0.05"));
    }

    #[test]
    fn a_sub_unit_negative_keeps_its_sign() {
        // The bug: -50 / 100 truncates to 0, so the sign was lost and a credit
        // came back through a conversion as a charge.
        assert_eq!(minor_to_decimal(-5), json!("-0.05"));
        assert_eq!(minor_to_decimal(-50), json!("-0.50"));
        assert_eq!(minor_to_decimal(-123_456), json!("-1234.56"));
        assert_eq!(scaled(-500, 1000), json!("-0.500"));
        assert_eq!(scaled(-1_500, 1000), json!("-1.500"));
    }
}
