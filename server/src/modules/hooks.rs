//! Business rules that the generic CRUD engine cannot know about.
//!
//! The engine handles shape (types, tenancy, permissions, audit). Everything
//! here handles *meaning*: what an invoice total is, what happens to stock when
//! a movement is recorded, when a deal counts as closed. Hooks run after the
//! engine's write, inside their own transaction, and are keyed by entity.

use chrono::Utc;
use serde_json::{Map, Value};
use sqlx::{Row, SqliteConnection, SqlitePool};

use crate::auth::ctx::Ctx;
use crate::common::money::{apply_percent, line_subtotal};
use crate::common::sequences::next_number;
use crate::error::AppResult;

/// (entity key, sequence key, prefix) for entities whose `number` is allocated
/// by the server rather than supplied by the client.
const NUMBERED: &[(&str, &str)] = &[
    ("sales.quotes", "sales.quotes"),
    ("sales.orders", "sales.orders"),
    ("books.invoices", "books.invoices"),
    ("books.payments", "books.payments"),
    ("books.bills", "books.bills"),
    ("books.expenses", "books.expenses"),
    ("inventory.purchase_orders", "inventory.purchase_orders"),
    ("desk.tickets", "desk.tickets"),
    ("recruit.candidates", "recruit.candidates"),
];

/// Fill server-owned columns that a create cannot leave empty.
///
/// Runs after the route has stripped read-only fields from the client payload,
/// so whatever this sets is the server's value by construction. It exists for
/// the case where a column is both NOT NULL and not the client's to choose —
/// a recurring profile's next billing date being the obvious one.
pub fn before_create(entity: &str, body: &mut Map<String, Value>) {
    if entity == "books.recurring" {
        // The first invoice is due on the day the schedule starts.
        if !body.contains_key("next_run_date") {
            if let Some(start) = body.get("start_date").and_then(|v| v.as_str()) {
                body.insert("next_run_date".into(), Value::String(start.to_string()));
            }
        }
    }
}

/// Column on a line-item entity that points at its parent document, or `None`
/// for entities that stand on their own.
pub fn parent_key(entity: &str) -> Option<&'static str> {
    document_link(entity).map(|l| l.foreign_key)
}

pub fn needs_number(entity: &str) -> Option<&'static str> {
    NUMBERED.iter().find(|(e, _)| *e == entity).map(|(_, k)| *k)
}

fn default_prefix(key: &str) -> &'static str {
    crate::modules::SEQUENCE_SEEDS
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, p)| *p)
        .unwrap_or("")
}

/// Allocate a document number into `body`, inside the caller's transaction so
/// the number and the row it belongs to commit or roll back together.
pub async fn assign_number(
    tx: &mut SqliteConnection,
    ctx: &Ctx,
    entity: &str,
    body: &mut Map<String, Value>,
) -> AppResult<()> {
    let Some(key) = needs_number(entity) else {
        return Ok(());
    };
    // A client-supplied number is ignored: numbering is the server's job.
    let number = next_number(tx, &ctx.org_id, key, default_prefix(key)).await?;
    body.insert("number".into(), Value::String(number));
    Ok(())
}

/// Which document a line-item entity belongs to.
struct DocumentLink {
    doc_table: &'static str,
    items_table: &'static str,
    foreign_key: &'static str,
}

/// Same mapping keyed by the *document* rather than its line entity, so a
/// caller holding an invoice id can ask for a retotal.
fn document_link_for_doc(entity: &str) -> Option<DocumentLink> {
    Some(match entity {
        "sales.quotes" => DocumentLink { doc_table: "quotes", items_table: "quote_items", foreign_key: "quote_id" },
        "sales.orders" => DocumentLink { doc_table: "sales_orders", items_table: "sales_order_items", foreign_key: "sales_order_id" },
        "books.invoices" => DocumentLink { doc_table: "invoices", items_table: "invoice_items", foreign_key: "invoice_id" },
        "inventory.purchase_orders" => DocumentLink { doc_table: "purchase_orders", items_table: "purchase_order_items", foreign_key: "purchase_order_id" },
        "books.recurring" => DocumentLink { doc_table: "recurring_profiles", items_table: "recurring_profile_items", foreign_key: "recurring_profile_id" },
        _ => return None,
    })
}

/// Recompute a document's totals from its lines, addressed by document entity.
pub async fn retotal_document(
    pool: &SqlitePool,
    ctx: &Ctx,
    doc_entity: &str,
    doc_id: &str,
) -> AppResult<()> {
    let Some(link) = document_link_for_doc(doc_entity) else {
        return Ok(());
    };
    recalc_document(pool, ctx, &link, doc_id).await
}

fn document_link(entity: &str) -> Option<DocumentLink> {
    Some(match entity {
        "sales.quote_items" => DocumentLink { doc_table: "quotes", items_table: "quote_items", foreign_key: "quote_id" },
        "sales.order_items" => DocumentLink { doc_table: "sales_orders", items_table: "sales_order_items", foreign_key: "sales_order_id" },
        "books.invoice_items" => DocumentLink { doc_table: "invoices", items_table: "invoice_items", foreign_key: "invoice_id" },
        "inventory.purchase_order_items" => DocumentLink { doc_table: "purchase_orders", items_table: "purchase_order_items", foreign_key: "purchase_order_id" },
        "books.recurring_items" => DocumentLink { doc_table: "recurring_profiles", items_table: "recurring_profile_items", foreign_key: "recurring_profile_id" },
        _ => return None,
    })
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Run after any successful create/update/delete. Errors here are real errors:
/// a document whose total does not match its lines is worse than a failed write.
pub async fn after_write(pool: &SqlitePool, ctx: &Ctx, entity: &str, id: &str) -> AppResult<()> {
    if let Some(link) = document_link(entity) {
        let parent = parent_id_of(pool, ctx, link.items_table, link.foreign_key, id).await?;
        if let Some(parent_id) = parent {
            recalc_document(pool, ctx, &link, &parent_id).await?;
        }
        return Ok(());
    }

    match entity {
        "crm.deals" => recalc_deal(pool, ctx, id).await,
        "books.payments" => {
            let invoice_id: Option<String> =
                scalar(pool, "SELECT invoice_id FROM payments WHERE org_id = ? AND id = ?", &ctx.org_id, id).await?;
            if let Some(inv) = invoice_id {
                recalc_invoice_balance(pool, ctx, &inv).await?;
            }
            Ok(())
        }
        "books.invoices" => recalc_invoice_balance(pool, ctx, id).await,
        "inventory.stock_moves" => {
            let item_id: Option<String> =
                scalar(pool, "SELECT item_id FROM stock_moves WHERE org_id = ? AND id = ?", &ctx.org_id, id).await?;
            if let Some(item) = item_id {
                recalc_item_stock(pool, ctx, &item).await?;
            }
            Ok(())
        }
        "projects.timesheets" => {
            let task_id: Option<String> =
                scalar(pool, "SELECT task_id FROM timesheets WHERE org_id = ? AND id = ?", &ctx.org_id, id).await?;
            if let Some(task) = task_id {
                recalc_task_hours(pool, ctx, &task).await?;
            }
            Ok(())
        }
        "projects.tasks" => recalc_project_progress_from_task(pool, ctx, id).await,
        // A profile whose schedule is already due should bill now, not at the
        // next sweep. The job's dedupe key keeps this from double-billing.
        "books.recurring" => crate::modules::recurring::sweep_one(pool, &ctx.org_id, id).await,
        _ => Ok(()),
    }
}

/// A deleted line still needs its parent retotalled, so callers capture the
/// parent id before the delete and pass it here.
pub async fn after_child_delete(
    pool: &SqlitePool,
    ctx: &Ctx,
    entity: &str,
    parent_id: &str,
) -> AppResult<()> {
    if let Some(link) = document_link(entity) {
        recalc_document(pool, ctx, &link, parent_id).await?;
    }
    Ok(())
}

async fn scalar<T>(pool: &SqlitePool, sql: &'static str, org: &str, id: &str) -> AppResult<Option<T>>
where
    T: for<'r> sqlx::Decode<'r, sqlx::Sqlite> + sqlx::Type<sqlx::Sqlite> + Send + Unpin,
{
    let row = sqlx::query(sql).bind(org).bind(id).fetch_optional(pool).await?;
    Ok(row.and_then(|r| r.try_get::<Option<T>, _>(0).ok().flatten()))
}

async fn parent_id_of(
    pool: &SqlitePool,
    ctx: &Ctx,
    items_table: &str,
    foreign_key: &str,
    id: &str,
) -> AppResult<Option<String>> {
    let sql = format!("SELECT {foreign_key} FROM {items_table} WHERE org_id = ? AND id = ?");
    let row = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(&ctx.org_id)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(row.and_then(|r| r.try_get::<Option<String>, _>(0).ok().flatten()))
}

/// Recompute a document's line totals and header totals from its lines.
///
/// Per line: gross = qty x unit price; discount comes off the gross; tax is
/// charged on what is left. `line_total` is the net of discount and excludes
/// tax, which is how the totals block reads on the printed document.
async fn recalc_document(
    pool: &SqlitePool,
    ctx: &Ctx,
    link: &DocumentLink,
    doc_id: &str,
) -> AppResult<()> {
    let mut tx = pool.begin().await?;

    let sql = format!(
        "SELECT id, quantity, unit_price, discount_percent, tax_rate
         FROM {} WHERE org_id = ? AND {} = ? AND deleted_at IS NULL",
        link.items_table, link.foreign_key
    );
    let rows = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(&ctx.org_id)
        .bind(doc_id)
        .fetch_all(&mut *tx)
        .await?;

    let (mut subtotal, mut discount_total, mut tax_total) = (0i64, 0i64, 0i64);
    let mut line_updates: Vec<(String, i64)> = Vec::new();

    for r in &rows {
        let id: String = r.try_get("id").unwrap_or_default();
        let qty: i64 = r.try_get("quantity").unwrap_or(0);
        let unit_price: i64 = r.try_get("unit_price").unwrap_or(0);
        let discount_percent: i64 = r.try_get("discount_percent").unwrap_or(0);
        let tax_rate: i64 = r.try_get("tax_rate").unwrap_or(0);

        let gross = line_subtotal(qty, unit_price);
        let discount = apply_percent(gross, discount_percent);
        let net = gross - discount;
        let tax = apply_percent(net, tax_rate);

        subtotal += gross;
        discount_total += discount;
        tax_total += tax;
        line_updates.push((id, net));
    }

    for (id, net) in line_updates {
        let sql = format!("UPDATE {} SET line_total = ? WHERE org_id = ? AND id = ?", link.items_table);
        sqlx::query(sqlx::AssertSqlSafe(sql))
            .bind(net)
            .bind(&ctx.org_id)
            .bind(&id)
            .execute(&mut *tx)
            .await?;
    }

    let total = subtotal - discount_total + tax_total;
    let sql = format!(
        "UPDATE {} SET subtotal = ?, discount_total = ?, tax_total = ?, total = ?, updated_at = ?
         WHERE org_id = ? AND id = ?",
        link.doc_table
    );
    sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(subtotal)
        .bind(discount_total)
        .bind(tax_total)
        .bind(total)
        .bind(now())
        .bind(&ctx.org_id)
        .bind(doc_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    if link.doc_table == "invoices" {
        recalc_invoice_balance(pool, ctx, doc_id).await?;
    }
    Ok(())
}

/// Roll payments up onto the invoice and move its status accordingly.
/// `draft` and `void` are left alone: those are decisions, not derived state.
pub async fn recalc_invoice_balance(pool: &SqlitePool, ctx: &Ctx, invoice_id: &str) -> AppResult<()> {
    let paid: i64 = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
         WHERE org_id = ? AND invoice_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(invoice_id)
    .fetch_one(pool)
    .await?
    .try_get("paid")
    .unwrap_or(0);

    let Some(inv) = sqlx::query("SELECT total, status, due_date FROM invoices WHERE org_id = ? AND id = ?")
        .bind(&ctx.org_id)
        .bind(invoice_id)
        .fetch_optional(pool)
        .await?
    else {
        return Ok(());
    };

    let total: i64 = inv.try_get("total").unwrap_or(0);
    let status: String = inv.try_get("status").unwrap_or_else(|_| "draft".into());
    let due_date: String = inv.try_get("due_date").unwrap_or_default();
    let balance = total - paid;

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let new_status = match status.as_str() {
        "draft" | "void" => status.clone(),
        _ if total > 0 && paid >= total => "paid".to_string(),
        _ if paid > 0 => "partial".to_string(),
        _ if !due_date.is_empty() && due_date < today => "overdue".to_string(),
        // Falling out of overdue (the due date moved) returns it to `sent`.
        "overdue" => "sent".to_string(),
        other => other.to_string(),
    };

    let paid_at = if new_status == "paid" { Some(now()) } else { None };

    sqlx::query(
        "UPDATE invoices SET amount_paid = ?, balance_due = ?, status = ?,
           paid_at = CASE WHEN ? IS NOT NULL THEN COALESCE(paid_at, ?) ELSE NULL END,
           updated_at = ?
         WHERE org_id = ? AND id = ?",
    )
    .bind(paid)
    .bind(balance)
    .bind(&new_status)
    .bind(&paid_at)
    .bind(&paid_at)
    .bind(now())
    .bind(&ctx.org_id)
    .bind(invoice_id)
    .execute(pool)
    .await?;

    Ok(())
}

/// Expected revenue is amount x probability, recomputed rather than trusted
/// from the client, and `closed_at` is stamped the first time a deal closes.
async fn recalc_deal(pool: &SqlitePool, ctx: &Ctx, deal_id: &str) -> AppResult<()> {
    let Some(row) = sqlx::query("SELECT amount, probability, stage, closed_at FROM deals WHERE org_id = ? AND id = ?")
        .bind(&ctx.org_id)
        .bind(deal_id)
        .fetch_optional(pool)
        .await?
    else {
        return Ok(());
    };

    let amount: i64 = row.try_get("amount").unwrap_or(0);
    let probability: i64 = row.try_get("probability").unwrap_or(0);
    let stage: String = row.try_get("stage").unwrap_or_default();
    let closed_at: Option<String> = row.try_get("closed_at").ok().flatten();

    let expected = apply_percent(amount, probability);
    let is_closed = stage.starts_with("closed_");
    let new_closed_at = if is_closed {
        Some(closed_at.unwrap_or_else(now))
    } else {
        None
    };

    sqlx::query("UPDATE deals SET expected_revenue = ?, closed_at = ? WHERE org_id = ? AND id = ?")
        .bind(expected)
        .bind(new_closed_at)
        .bind(&ctx.org_id)
        .bind(deal_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Stock on hand is the sum of the movement ledger, so the number on the item
/// can always be explained by the rows behind it.
async fn recalc_item_stock(pool: &SqlitePool, ctx: &Ctx, item_id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE items SET stock_on_hand = (
             SELECT COALESCE(SUM(quantity), 0) FROM stock_moves
             WHERE org_id = ? AND item_id = ? AND deleted_at IS NULL
         ) WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(item_id)
    .bind(&ctx.org_id)
    .bind(item_id)
    .execute(pool)
    .await?;
    Ok(())
}

async fn recalc_task_hours(pool: &SqlitePool, ctx: &Ctx, task_id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE project_tasks SET logged_hours = (
             SELECT COALESCE(SUM(hours), 0) FROM timesheets
             WHERE org_id = ? AND task_id = ? AND deleted_at IS NULL
         ) WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(task_id)
    .bind(&ctx.org_id)
    .bind(task_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Project progress is the share of its tasks that are done, so the number on
/// the project card cannot drift from the board.
async fn recalc_project_progress_from_task(pool: &SqlitePool, ctx: &Ctx, task_id: &str) -> AppResult<()> {
    let Some(project_id): Option<String> =
        scalar(pool, "SELECT project_id FROM project_tasks WHERE org_id = ? AND id = ?", &ctx.org_id, task_id).await?
    else {
        return Ok(());
    };

    let row = sqlx::query(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done
         FROM project_tasks WHERE org_id = ? AND project_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&project_id)
    .fetch_one(pool)
    .await?;

    let total: i64 = row.try_get("total").unwrap_or(0);
    let done: i64 = row.try_get("done").unwrap_or(0);
    // Percent is scaled by 10_000, so 100% is 1_000_000.
    let progress = if total > 0 { done * 1_000_000 / total } else { 0 };

    sqlx::query("UPDATE projects SET progress = ? WHERE org_id = ? AND id = ?")
        .bind(progress)
        .bind(&ctx.org_id)
        .bind(&project_id)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbered_entities_all_have_a_seeded_sequence() {
        for (entity, key) in NUMBERED {
            assert!(
                crate::modules::SEQUENCE_SEEDS.iter().any(|(k, _)| k == key),
                "{entity} allocates from `{key}`, which is never seeded"
            );
        }
    }

    #[test]
    fn line_maths_discounts_before_tax() {
        // 3 units at 100.00, 10% off, 20% tax
        let gross = line_subtotal(3_000, 10_000);
        assert_eq!(gross, 30_000);
        let discount = apply_percent(gross, 10 * crate::common::money::PERCENT_SCALE);
        assert_eq!(discount, 3_000);
        let net = gross - discount;
        let tax = apply_percent(net, 20 * crate::common::money::PERCENT_SCALE);
        assert_eq!(tax, 5_400, "tax is charged on the discounted amount");
        assert_eq!(net + tax, 32_400);
    }
}
