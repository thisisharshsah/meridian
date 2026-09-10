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
use crate::error::{AppError, AppResult, FieldError};

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
    ("sales.counter_sales", "sales.counter_sales"),
    ("desk.tickets", "desk.tickets"),
    ("recruit.candidates", "recruit.candidates"),
    ("hospitality.reservations", "hospitality.reservations"),
];

/// Fill server-owned columns that a create cannot leave empty.
///
/// Runs after the route has stripped read-only fields from the client payload,
/// so whatever this sets is the server's value by construction. It exists for
/// the case where a column is both NOT NULL and not the client's to choose —
/// a recurring profile's next billing date being the obvious one.
pub fn before_create(entity: &str, body: &mut Map<String, Value>) {
    // full_name is a read-only column the client never sends, and it is NOT
    // NULL, so the insert needs it composed before it runs.
    if matches!(entity, "crm.leads" | "crm.contacts") {
        body.insert("full_name".into(), Value::String(person_name(body)));
    }

    if entity == "books.recurring" {
        // The first invoice is due on the day the schedule starts.
        if !body.contains_key("next_run_date") {
            if let Some(start) = body.get("start_date").and_then(|v| v.as_str()) {
                body.insert("next_run_date".into(), Value::String(start.to_string()));
            }
        }
    }
}

/// "First Last", from whichever halves are present. A mononym is a real name,
/// so a missing first name yields the surname rather than a leading space.
fn person_name(body: &Map<String, Value>) -> String {
    let part = |k: &str| body.get(k).and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let (first, last) = (part("first_name"), part("last_name"));
    format!("{first} {last}").trim().to_string()
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
        "sales.counter_sales" => DocumentLink { doc_table: "counter_sales", items_table: "counter_sale_items", foreign_key: "counter_sale_id" },
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
        "sales.counter_sale_items" => DocumentLink { doc_table: "counter_sales", items_table: "counter_sale_items", foreign_key: "counter_sale_id" },
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
        "crm.leads" => recompose_name(pool, ctx, RECOMPOSE_LEAD_NAME, id).await,
        "crm.contacts" => recompose_name(pool, ctx, RECOMPOSE_CONTACT_NAME, id).await,
        "hr.attendance" => recalc_attendance(pool, ctx, id).await,
        "hospitality.reservations" => recalc_reservation(pool, ctx, id).await,
        "sales.counter_sales" => settle_counter_sale(pool, ctx, id).await,
        "hr.payslips" => recalc_payslip(pool, ctx, id).await,
        "hr.pay_runs" => recalc_pay_run(pool, ctx, id).await,
        "books.payments" => {
            let invoice_id: Option<String> =
                scalar(pool, "SELECT invoice_id FROM payments WHERE org_id = ? AND id = ?", &ctx.org_id, id).await?;
            if let Some(inv) = invoice_id {
                recalc_invoice_balance(pool, ctx, &inv).await?;
            }
            Ok(())
        }
        "books.invoices" => recalc_invoice_balance(pool, ctx, id).await,
        "books.bills" => recalc_bill_balance(pool, ctx, id).await,
        "inventory.item_batches" => sync_batch(pool, ctx, id).await,
        "inventory.stock_moves" => {
            let row: Option<(String, Option<String>)> = sqlx::query_as(
                "SELECT item_id, batch_id FROM stock_moves WHERE org_id = ? AND id = ?",
            )
            .bind(&ctx.org_id)
            .bind(id)
            .fetch_optional(pool)
            .await?;
            if let Some((item, batch)) = row {
                if let Some(batch_id) = batch {
                    recalc_batch_left(pool, ctx, &batch_id).await?;
                }
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

/// Column whose value a delete has to re-derive from, for every entity that
/// contributes to a stored total somewhere else.
///
/// Line items feed a document's totals, payments feed an invoice's balance,
/// stock moves feed an item's level, timesheets feed a task's hours. Deleting
/// any of them has to recompute the thing it fed, or the parent keeps reporting
/// a number that no longer has rows behind it.
pub fn parent_key(entity: &str) -> Option<&'static str> {
    if let Some(link) = document_link(entity) {
        return Some(link.foreign_key);
    }
    match entity {
        "books.payments" => Some("invoice_id"),
        "inventory.stock_moves" => Some("item_id"),
        "inventory.item_batches" => Some("item_id"),
        "projects.timesheets" => Some("task_id"),
        "projects.tasks" => Some("project_id"),
        "hr.payslips" => Some("pay_run_id"),
        _ => None,
    }
}

/// A deleted row still needs whatever it fed into recomputed, so callers
/// capture the parent id before the delete and pass it here.
pub async fn after_child_delete(
    pool: &SqlitePool,
    ctx: &Ctx,
    entity: &str,
    parent_id: &str,
) -> AppResult<()> {
    if let Some(link) = document_link(entity) {
        return recalc_document(pool, ctx, &link, parent_id).await;
    }
    match entity {
        "books.payments" => recalc_invoice_balance(pool, ctx, parent_id).await,
        "inventory.stock_moves" => recalc_item_stock(pool, ctx, parent_id).await,
        // A deleted batch takes its receipt with it. Leaving the movement
        // behind would keep the item claiming stock that no batch holds.
        "inventory.item_batches" => {
            sqlx::query(
                "UPDATE stock_moves SET deleted_at = ?
                  WHERE org_id = ? AND item_id = ? AND deleted_at IS NULL
                    AND batch_id IN (SELECT id FROM item_batches
                                      WHERE org_id = ? AND item_id = ? AND deleted_at IS NOT NULL)",
            )
            .bind(now())
            .bind(&ctx.org_id)
            .bind(parent_id)
            .bind(&ctx.org_id)
            .bind(parent_id)
            .execute(pool)
            .await?;
            recalc_item_stock(pool, ctx, parent_id).await
        }
        "projects.timesheets" => recalc_task_hours(pool, ctx, parent_id).await,
        "projects.tasks" => recalc_project_progress(pool, ctx, parent_id).await,
        "hr.payslips" => recalc_pay_run(pool, ctx, parent_id).await,
        _ => Ok(()),
    }
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
    // BEGIN IMMEDIATE, not the default deferred BEGIN. Reading the lines first
    // and only then writing is a read-to-write upgrade, which SQLite refuses
    // with SQLITE_BUSY_SNAPSHOT without consulting the busy handler — so it
    // fails outright under concurrency rather than waiting its turn.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;

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

        // Saturating, not wrapping: values are bounded on the way in, but a
        // document with enough lines should degrade to an obviously wrong
        // large number rather than a negative one.
        subtotal = subtotal.saturating_add(gross);
        discount_total = discount_total.saturating_add(discount);
        tax_total = tax_total.saturating_add(tax);
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

    let total = subtotal.saturating_sub(discount_total).saturating_add(tax_total);
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
    // One transaction for the whole read-compute-write. Two payments landing
    // together would otherwise each read the sum before the other's row was
    // visible, and the second write would clobber the first — an invoice
    // showing one payment when two were taken. The immediate BEGIN takes the
    // write lock up front so SQLite queues the second caller rather than
    // failing it with SQLITE_BUSY_SNAPSHOT partway through.
    let mut tx = pool.begin_with("BEGIN IMMEDIATE").await?;

    let paid: i64 = sqlx::query(
        "SELECT COALESCE(SUM(amount), 0) AS paid FROM payments
         WHERE org_id = ? AND invoice_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(invoice_id)
    .fetch_one(&mut *tx)
    .await?
    .try_get("paid")
    .unwrap_or(0);

    let Some(inv) = sqlx::query("SELECT total, status, due_date FROM invoices WHERE org_id = ? AND id = ?")
        .bind(&ctx.org_id)
        .bind(invoice_id)
        .fetch_optional(&mut *tx)
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
        // Decisions, not derived state.
        "draft" | "void" => status.clone(),
        _ if total > 0 && paid >= total => "paid".to_string(),
        _ if paid > 0 => "partial".to_string(),
        _ if !due_date.is_empty() && due_date < today => "overdue".to_string(),
        // Nothing paid and not yet due. Every payment-derived state has to be
        // able to fall back out of itself, or reversing a payment would leave
        // the invoice reporting `paid` with the full amount outstanding —
        // money written off silently, and invisible to the ageing report.
        "paid" | "partial" | "overdue" => "sent".to_string(),
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
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// A bill's outstanding balance and status.
///
/// `balance_due` is readonly, so the client's value is stripped on write — and
/// nothing was filling it in, leaving every unpaid bill reporting a balance of
/// zero. Unlike an invoice there is no payments table for bills yet, so
/// `amount_paid` is entered directly and the balance derives from it.
pub async fn recalc_bill_balance(pool: &SqlitePool, ctx: &Ctx, bill_id: &str) -> AppResult<()> {
    let Some(row) = sqlx::query(
        "SELECT total, amount_paid, status, due_date FROM bills WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(bill_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(());
    };

    let total: i64 = row.try_get("total").unwrap_or(0);
    let paid: i64 = row.try_get("amount_paid").unwrap_or(0);
    let status: String = row.try_get("status").unwrap_or_else(|_| "open".into());
    let due_date: String = row.try_get("due_date").unwrap_or_default();
    let balance = total.saturating_sub(paid);

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let new_status = match status.as_str() {
        // `void` is a decision, not derived state.
        "void" => status.clone(),
        _ if total > 0 && paid >= total => "paid".to_string(),
        _ if paid > 0 => "partial".to_string(),
        _ if !due_date.is_empty() && due_date < today => "overdue".to_string(),
        "paid" | "partial" | "overdue" => "open".to_string(),
        other => other.to_string(),
    };

    sqlx::query(
        "UPDATE bills SET balance_due = ?, status = ?, updated_at = ? WHERE org_id = ? AND id = ?",
    )
    .bind(balance)
    .bind(&new_status)
    .bind(now())
    .bind(&ctx.org_id)
    .bind(bill_id)
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

/// Minutes worked, from the two clock stamps. Derived rather than typed: a
/// corrected clock-out has to move the total with it, and payroll reads this
/// column rather than re-deriving it per query.
///
/// A clock-out before the clock-in means a shift crossed midnight, so the end
/// belongs to the following day; anything beyond that is a typo, not a shift,
/// and is left at zero rather than silently paying someone for it.
async fn recalc_attendance(pool: &SqlitePool, ctx: &Ctx, id: &str) -> AppResult<()> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT clock_in, clock_out FROM attendance WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let minutes = match row {
        Some((Some(in_s), Some(out_s))) => {
            let parsed = (
                chrono::DateTime::parse_from_rfc3339(&in_s),
                chrono::DateTime::parse_from_rfc3339(&out_s),
            );
            match parsed {
                (Ok(start), Ok(end)) => {
                    let mut mins = (end - start).num_minutes();
                    if mins < 0 {
                        mins += 24 * 60;
                    }
                    if (0..=24 * 60).contains(&mins) { mins } else { 0 }
                }
                _ => 0,
            }
        }
        _ => 0,
    };

    sqlx::query("UPDATE attendance SET worked_minutes = ? WHERE org_id = ? AND id = ?")
        .bind(minutes)
        .bind(&ctx.org_id)
        .bind(id)
        .execute(pool)
        .await?;

    mark_late_against_shift(pool, ctx, id).await
}

/// A shift is what makes a clock-in mean something: without one, an arrival
/// time is just a number. When the row is filed against a shift and the stamp
/// falls more than the grace period after the shift opened, the day is marked
/// late.
///
/// Only a status still sitting on its default is touched. Absent, on leave and
/// holiday are judgements somebody made about the day, and a clock stamp has no
/// business overruling them.
const LATE_GRACE_MINUTES: i64 = 5;

async fn mark_late_against_shift(pool: &SqlitePool, ctx: &Ctx, id: &str) -> AppResult<()> {
    let row: Option<(Option<String>, Option<String>, String)> = sqlx::query_as(
        "SELECT a.clock_in, s.starts_at, a.status
           FROM attendance a
           JOIN shifts s ON s.id = a.shift_id AND s.org_id = a.org_id
          WHERE a.org_id = ? AND a.id = ?",
    )
    .bind(&ctx.org_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let Some((Some(clock_in), Some(starts_at), status)) = row else {
        return Ok(());
    };
    if status != "present" {
        return Ok(());
    }

    let (Ok(arrived), Ok(due)) = (
        chrono::DateTime::parse_from_rfc3339(&clock_in),
        chrono::DateTime::parse_from_rfc3339(&starts_at),
    ) else {
        return Ok(());
    };

    if (arrived - due).num_minutes() > LATE_GRACE_MINUTES {
        sqlx::query("UPDATE attendance SET status = 'late' WHERE org_id = ? AND id = ?")
            .bind(&ctx.org_id)
            .bind(id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// A payslip, filled in from the things already recorded elsewhere.
///
/// Net is gross less deductions, never typed. The hours are summed from the
/// attendance inside the run's own period, so the payment and the hours behind
/// it cannot describe different weeks. The label names the person and the run,
/// because a list of payslips identified only by id is unreadable.
async fn recalc_payslip(pool: &SqlitePool, ctx: &Ctx, id: &str) -> AppResult<()> {
    let row: Option<(String, String, i64, i64)> = sqlx::query_as(
        "SELECT p.pay_run_id, p.employee_id, p.gross, p.deductions
           FROM payslips p WHERE p.org_id = ? AND p.id = ?",
    )
    .bind(&ctx.org_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;

    let Some((run_id, employee_id, gross, deductions)) = row else {
        return Ok(());
    };

    let run: Option<(String, String, String)> = sqlx::query_as(
        "SELECT reference, period_start, period_end FROM pay_runs WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(&run_id)
    .fetch_optional(pool)
    .await?;
    let Some((reference, period_start, period_end)) = run else {
        return Ok(());
    };

    let name: Option<String> = scalar(
        pool,
        "SELECT full_name FROM employees WHERE org_id = ? AND id = ?",
        &ctx.org_id,
        &employee_id,
    )
    .await?;

    let minutes: i64 = sqlx::query_scalar(
        "SELECT COALESCE(SUM(worked_minutes), 0) FROM attendance
          WHERE org_id = ? AND employee_id = ? AND deleted_at IS NULL
            AND work_date >= ? AND work_date <= ?",
    )
    .bind(&ctx.org_id)
    .bind(&employee_id)
    .bind(&period_start)
    .bind(&period_end)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let label = format!("{} — {}", name.unwrap_or_else(|| "Employee".into()), reference);

    sqlx::query(
        "UPDATE payslips SET net = ?, minutes_worked = ?, slip_for = ? WHERE org_id = ? AND id = ?",
    )
    .bind(gross - deductions)
    .bind(minutes)
    .bind(&label)
    .bind(&ctx.org_id)
    .bind(id)
    .execute(pool)
    .await?;

    recalc_pay_run(pool, ctx, &run_id).await
}

/// A run's totals are the sum of its slips, so deleting or correcting one slip
/// moves the run with it rather than leaving a total nothing adds up to.
async fn recalc_pay_run(pool: &SqlitePool, ctx: &Ctx, run_id: &str) -> AppResult<()> {
    let (gross, net): (i64, i64) = sqlx::query_as(
        "SELECT COALESCE(SUM(gross), 0), COALESCE(SUM(net), 0)
           FROM payslips WHERE org_id = ? AND pay_run_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(run_id)
    .fetch_one(pool)
    .await
    .unwrap_or((0, 0));

    sqlx::query("UPDATE pay_runs SET total_gross = ?, total_net = ? WHERE org_id = ? AND id = ?")
        .bind(gross)
        .bind(net)
        .bind(&ctx.org_id)
        .bind(run_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Ringing up a sale takes the goods off the shelf.
///
/// A till sale is settled the moment it is completed, so the stock ledger has
/// to move with it rather than waiting for a delivery note that a shop never
/// writes. Movements are signed, so a sale is a negative quantity.
///
/// Guarded by `stocked_at`: completing an already-completed sale, or any later
/// edit to it, must not take the same goods off the shelf twice. Voiding a
/// completed sale puts them back, because a voided sale did not happen and a
/// ledger that still says it did will not reconcile against the shelf.
async fn settle_counter_sale(pool: &SqlitePool, ctx: &Ctx, sale_id: &str) -> AppResult<()> {
    let sale: Option<(String, Option<String>, String)> = sqlx::query_as(
        "SELECT status, stocked_at, sold_at FROM counter_sales WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(sale_id)
    .fetch_optional(pool)
    .await?;
    let Some((status, stocked_at, sold_at)) = sale else {
        return Ok(());
    };

    // Change due is arithmetic the cashier should never be doing in their head.
    sqlx::query(
        "UPDATE counter_sales SET change_given =
           CASE WHEN amount_tendered > total THEN amount_tendered - total ELSE 0 END
         WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(sale_id)
    .execute(pool)
    .await?;

    let completed = status == "completed";
    let already = stocked_at.is_some();

    if completed && !already {
        // Goods only. A service has no shelf, and an hour of labour sold four
        // times should not leave the catalogue claiming minus four of it.
        let lines: Vec<(String, i64, i64)> = sqlx::query_as(
            "SELECT l.item_id, l.quantity, i.track_batches
               FROM counter_sale_items l
               JOIN items i ON i.id = l.item_id AND i.org_id = l.org_id
              WHERE l.org_id = ? AND l.counter_sale_id = ? AND l.deleted_at IS NULL
                AND l.item_id IS NOT NULL AND i.item_type = 'goods'",
        )
        .bind(&ctx.org_id)
        .bind(sale_id)
        .fetch_all(pool)
        .await?;

        let stamp = now();
        let moved_on = sold_at.get(..10).unwrap_or("").to_string();
        let mut touched_batches: Vec<String> = Vec::new();
        for (item_id, quantity, batched) in &lines {
            // One movement per line normally; for dated stock, one per batch
            // the line is drawn from, oldest expiry first.
            let parts = if *batched != 0 {
                allocate_fefo(pool, ctx, item_id, *quantity, &moved_on).await?
            } else {
                vec![(None, *quantity)]
            };

            for (batch_id, taken) in parts {
                if taken == 0 {
                    continue;
                }
                if let Some(b) = &batch_id {
                    touched_batches.push(b.clone());
                }
                sqlx::query(
                    "INSERT INTO stock_moves
                       (id, org_id, item_id, batch_id, move_type, quantity, moved_on,
                        reference_entity, reference_id, created_at, updated_at, created_by, updated_by)
                     VALUES (?, ?, ?, ?, 'sale', ?, ?, 'sales.counter_sales', ?, ?, ?, ?, ?)",
                )
                .bind(crate::common::ids::new_id())
                .bind(&ctx.org_id)
                .bind(item_id)
                .bind(&batch_id)
                .bind(-taken)
                .bind(&moved_on)
                .bind(sale_id)
                .bind(&stamp)
                .bind(&stamp)
                .bind(&ctx.user_id)
                .bind(&ctx.user_id)
                .execute(pool)
                .await?;
            }
        }

        for batch_id in &touched_batches {
            recalc_batch_left(pool, ctx, batch_id).await?;
        }

        sqlx::query("UPDATE counter_sales SET stocked_at = ? WHERE org_id = ? AND id = ?")
            .bind(&stamp)
            .bind(&ctx.org_id)
            .bind(sale_id)
            .execute(pool)
            .await?;

        for (item_id, _, _) in &lines {
            recalc_item_stock(pool, ctx, item_id).await?;
        }
        return Ok(());
    }

    if !completed && already {
        let items: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT item_id FROM stock_moves
              WHERE org_id = ? AND reference_entity = 'sales.counter_sales'
                AND reference_id = ? AND deleted_at IS NULL",
        )
        .bind(&ctx.org_id)
        .bind(sale_id)
        .fetch_all(pool)
        .await?;

        // Captured before the reversal: afterwards the movements are gone and
        // there is nothing left to say which batches to put stock back into.
        let batches: Vec<(String,)> = sqlx::query_as(
            "SELECT DISTINCT batch_id FROM stock_moves
              WHERE org_id = ? AND reference_entity = 'sales.counter_sales'
                AND reference_id = ? AND deleted_at IS NULL AND batch_id IS NOT NULL",
        )
        .bind(&ctx.org_id)
        .bind(sale_id)
        .fetch_all(pool)
        .await?;

        let stamp = now();
        sqlx::query(
            "UPDATE stock_moves SET deleted_at = ?
              WHERE org_id = ? AND reference_entity = 'sales.counter_sales'
                AND reference_id = ? AND deleted_at IS NULL",
        )
        .bind(&stamp)
        .bind(&ctx.org_id)
        .bind(sale_id)
        .execute(pool)
        .await?;

        sqlx::query("UPDATE counter_sales SET stocked_at = NULL WHERE org_id = ? AND id = ?")
            .bind(&ctx.org_id)
            .bind(sale_id)
            .execute(pool)
            .await?;

        for (batch_id,) in &batches {
            recalc_batch_left(pool, ctx, batch_id).await?;
        }
        for (item_id,) in &items {
            recalc_item_stock(pool, ctx, item_id).await?;
        }
    }
    Ok(())
}

/// A batch and the stock ledger, kept as one fact.
///
/// The quantity typed onto a batch is a receipt, and a receipt is a movement.
/// Writing it into `stock_moves` rather than carrying it separately means the
/// item's level, the batch's remainder and the movement history are three
/// readings of one table and can never disagree. Correcting a miscounted
/// delivery moves the receipt rather than adding a second one.
async fn sync_batch(pool: &SqlitePool, ctx: &Ctx, batch_id: &str) -> AppResult<()> {
    let batch: Option<(String, i64, String, i64)> = sqlx::query_as(
        "SELECT item_id, quantity_received, received_on, unit_cost
           FROM item_batches WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(batch_id)
    .fetch_optional(pool)
    .await?;
    let Some((item_id, received, received_on, unit_cost)) = batch else {
        return Ok(());
    };

    let receipt: Option<String> = scalar(
        pool,
        "SELECT id FROM stock_moves
          WHERE org_id = ? AND batch_id = ? AND move_type = 'purchase' AND deleted_at IS NULL
          ORDER BY created_at LIMIT 1",
        &ctx.org_id,
        batch_id,
    )
    .await?;

    let stamp = now();
    match receipt {
        Some(move_id) => {
            sqlx::query(
                "UPDATE stock_moves SET quantity = ?, moved_on = ?, unit_cost = ?, updated_at = ?, updated_by = ?
                  WHERE org_id = ? AND id = ?",
            )
            .bind(received)
            .bind(&received_on)
            .bind(unit_cost)
            .bind(&stamp)
            .bind(&ctx.user_id)
            .bind(&ctx.org_id)
            .bind(&move_id)
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query(
                "INSERT INTO stock_moves
                   (id, org_id, item_id, batch_id, move_type, quantity, unit_cost, moved_on,
                    reference_entity, reference_id, created_at, updated_at, created_by, updated_by)
                 VALUES (?, ?, ?, ?, 'purchase', ?, ?, ?, 'inventory.item_batches', ?, ?, ?, ?, ?)",
            )
            .bind(crate::common::ids::new_id())
            .bind(&ctx.org_id)
            .bind(&item_id)
            .bind(batch_id)
            .bind(received)
            .bind(unit_cost)
            .bind(&received_on)
            .bind(batch_id)
            .bind(&stamp)
            .bind(&stamp)
            .bind(&ctx.user_id)
            .bind(&ctx.user_id)
            .execute(pool)
            .await?;
        }
    }

    recalc_batch_left(pool, ctx, batch_id).await?;
    recalc_item_stock(pool, ctx, &item_id).await
}

/// What a batch still holds: its receipt less everything taken out of it.
pub async fn recalc_batch_left(pool: &SqlitePool, ctx: &Ctx, batch_id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE item_batches SET quantity_left = (
             SELECT COALESCE(SUM(quantity), 0) FROM stock_moves
              WHERE org_id = ? AND batch_id = ? AND deleted_at IS NULL
         ) WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(batch_id)
    .bind(&ctx.org_id)
    .bind(batch_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Which batches a sale of `wanted` should come out of, earliest expiry first.
///
/// First-expired-first-out, and expired stock is never among the candidates:
/// selling it is the mistake batches exist to prevent. A sale larger than the
/// batched stock takes what the batches hold and leaves the rest untagged, so
/// the item level stays honest and the shortfall is visible as a batchless
/// movement rather than swallowed.
async fn allocate_fefo(
    pool: &SqlitePool,
    ctx: &Ctx,
    item_id: &str,
    wanted: i64,
    on: &str,
) -> AppResult<Vec<(Option<String>, i64)>> {
    let batches: Vec<(String, i64)> = sqlx::query_as(
        "SELECT id, quantity_left FROM item_batches
          WHERE org_id = ? AND item_id = ? AND deleted_at IS NULL AND quantity_left > 0
            AND (expiry_date IS NULL OR expiry_date >= ?)
          ORDER BY expiry_date IS NULL, expiry_date, received_on",
    )
    .bind(&ctx.org_id)
    .bind(item_id)
    .bind(on)
    .fetch_all(pool)
    .await?;

    let mut left = wanted;
    let mut out = Vec::new();
    for (batch_id, available) in batches {
        if left <= 0 {
            break;
        }
        let take = left.min(available);
        out.push((Some(batch_id), take));
        left -= take;
    }
    if left > 0 {
        out.push((None, left));
    }
    Ok(out)
}

/// Checks that need the database, run before a write lands.
///
/// `before_create` can only reshape what the client sent; a rule about the
/// rest of the table needs to look at the table. Everything here rejects with
/// a field error, so the form marks the control that is wrong rather than
/// showing a banner the reader has to map back onto a date picker themselves.
///
/// `editing` carries the row's own id on an update, so a booking does not
/// collide with itself.
pub async fn validate(
    pool: &SqlitePool,
    ctx: &Ctx,
    entity: &str,
    editing: Option<&str>,
    body: &Map<String, Value>,
) -> AppResult<()> {
    if entity == "hospitality.reservations" {
        return validate_reservation(pool, ctx, editing, body).await;
    }
    Ok(())
}

/// No room promised to two people on the same night.
///
/// This is the one rule a hotel cannot run without, and it has to hold on the
/// write rather than in a nightly report: by the time a clash is noticed on a
/// list, both guests have been told they have a room. Nights are half-open —
/// a stay leaving on the 4th does not clash with one arriving on the 4th,
/// because the room is cleaned and let again the same day.
async fn validate_reservation(
    pool: &SqlitePool,
    ctx: &Ctx,
    editing: Option<&str>,
    body: &Map<String, Value>,
) -> AppResult<()> {
    let field = |k: &str| body.get(k).and_then(|v| v.as_str()).map(|s| s.to_string());

    // On an update the client may send only what changed, so anything absent
    // is read back from the row being edited rather than assumed.
    let stored: Option<(String, String, String, String)> = match editing {
        Some(id) => {
            sqlx::query_as(
                "SELECT room_id, check_in, check_out, status FROM reservations
                  WHERE org_id = ? AND id = ?",
            )
            .bind(&ctx.org_id)
            .bind(id)
            .fetch_optional(pool)
            .await?
        }
        None => None,
    };

    let room_id = field("room_id").or_else(|| stored.as_ref().map(|s| s.0.clone()));
    let check_in = field("check_in").or_else(|| stored.as_ref().map(|s| s.1.clone()));
    let check_out = field("check_out").or_else(|| stored.as_ref().map(|s| s.2.clone()));
    let status = field("status")
        .or_else(|| stored.as_ref().map(|s| s.3.clone()))
        .unwrap_or_else(|| "booked".into());

    let (Some(room_id), Some(check_in), Some(check_out)) = (room_id, check_in, check_out) else {
        return Ok(());
    };

    if check_out <= check_in {
        return Err(AppError::Validation(vec![FieldError::new(
            "check_out",
            "A stay has to end after it starts. For a day let, use the next morning.",
        )]));
    }

    // A cancelled booking or one already departed holds nothing.
    if matches!(status.as_str(), "cancelled" | "no_show" | "checked_out") {
        return Ok(());
    }

    let room: Option<(String, String)> =
        sqlx::query_as("SELECT number, status FROM rooms WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
            .bind(&ctx.org_id)
            .bind(&room_id)
            .fetch_optional(pool)
            .await?;
    if let Some((_, room_status)) = &room {
        if room_status == "out_of_service" {
            return Err(AppError::Validation(vec![FieldError::new(
                "room_id",
                "That room is out of service. Put it back in service first, or pick another.",
            )]));
        }
    }

    let clash: Option<(String, String, String)> = sqlx::query_as(
        "SELECT guest_name, check_in, check_out FROM reservations
          WHERE org_id = ? AND room_id = ? AND deleted_at IS NULL
            AND status IN ('booked', 'checked_in')
            AND id <> ?
            AND check_in < ? AND check_out > ?
          ORDER BY check_in LIMIT 1",
    )
    .bind(&ctx.org_id)
    .bind(&room_id)
    .bind(editing.unwrap_or(""))
    .bind(&check_out)
    .bind(&check_in)
    .fetch_optional(pool)
    .await?;

    if let Some((guest, from, to)) = clash {
        let number = room.map(|(n, _)| n).unwrap_or_else(|| "that room".into());
        return Err(AppError::Validation(vec![FieldError::new(
            "room_id",
            format!("Room {number} is already {guest}’s from {from} to {to}."),
        )]));
    }

    Ok(())
}

/// Nights and total, from the dates and the rate.
///
/// The rate falls back to the room's own, so the common booking is three
/// fields: who, which room, and when.
async fn recalc_reservation(pool: &SqlitePool, ctx: &Ctx, id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE reservations SET
             nightly_rate = CASE
                 WHEN nightly_rate > 0 THEN nightly_rate
                 ELSE COALESCE((SELECT nightly_rate FROM rooms
                                 WHERE rooms.id = reservations.room_id
                                   AND rooms.org_id = reservations.org_id), 0)
             END
         WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(id)
    .execute(pool)
    .await?;

    sqlx::query(
        "UPDATE reservations SET
             nights = MAX(CAST(julianday(check_out) - julianday(check_in) AS INTEGER), 0),
             total = MAX(CAST(julianday(check_out) - julianday(check_in) AS INTEGER), 0) * nightly_rate
         WHERE org_id = ? AND id = ?",
    )
    .bind(&ctx.org_id)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Keep the composed name in step with its parts.
///
/// Done on every write rather than only on create: correcting a surname has to
/// move the record's title with it, or the list still shows the old name and
/// search still finds the record under it.
async fn recompose_name(
    pool: &SqlitePool,
    ctx: &Ctx,
    sql: &'static str,
    id: &str,
) -> AppResult<()> {
    sqlx::query(sql).bind(&ctx.org_id).bind(id).execute(pool).await?;
    Ok(())
}

const RECOMPOSE_LEAD_NAME: &str =
    "UPDATE leads SET full_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      WHERE org_id = ? AND id = ?";

const RECOMPOSE_CONTACT_NAME: &str =
    "UPDATE contacts SET full_name = TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, ''))
      WHERE org_id = ? AND id = ?";

/// Stock on hand is the sum of the movement ledger, so the number on the item
/// can always be explained by the rows behind it.
pub async fn recalc_item_stock(pool: &SqlitePool, ctx: &Ctx, item_id: &str) -> AppResult<()> {
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

pub async fn recalc_task_hours(pool: &SqlitePool, ctx: &Ctx, task_id: &str) -> AppResult<()> {
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
    recalc_project_progress(pool, ctx, &project_id).await
}

/// Progress is the share of a project's tasks that are done.
pub async fn recalc_project_progress(pool: &SqlitePool, ctx: &Ctx, project_id: &str) -> AppResult<()> {
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
