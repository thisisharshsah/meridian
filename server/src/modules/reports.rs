//! Reports.
//!
//! Each report is a named query returning `{columns, rows, totals}`, so the
//! browser renders every one of them with a single table component and needs no
//! per-report code. Columns carry a type, which is how a money column formats
//! as money without the frontend hardcoding which key is money.
//!
//! These are hand-written SQL rather than generic aggregates because the
//! interesting reports are the ones the generic `/stats` endpoint cannot
//! express: ageing buckets, two measures side by side, joins across modules.

use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::auth::ctx::{Action, Ctx};
use crate::error::{AppError, AppResult};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/reports", get(catalog))
        .route("/reports/{key}", get(run))
}

/// Column types the frontend knows how to format.
const TEXT: &str = "text";
const MONEY: &str = "money";
const INT: &str = "int";
const PERCENT: &str = "percent";
const QUANTITY: &str = "quantity";

struct ReportDef {
    key: &'static str,
    name: &'static str,
    description: &'static str,
    module: &'static str,
    icon: &'static str,
    /// Entity whose view permission gates this report.
    requires: &'static str,
}

const REPORTS: &[ReportDef] = &[
    ReportDef {
        key: "ar_aging",
        name: "Receivables ageing",
        description: "What each customer owes, bucketed by how late it is.",
        module: "books",
        icon: "Receipt",
        requires: "books.invoices",
    },
    ReportDef {
        key: "revenue_by_month",
        name: "Revenue by month",
        description: "Invoiced against collected, month by month.",
        module: "books",
        icon: "Banknote",
        requires: "books.invoices",
    },
    ReportDef {
        key: "top_customers",
        name: "Top customers",
        description: "Billed and collected per customer, largest first.",
        module: "books",
        icon: "Building2",
        requires: "books.invoices",
    },
    ReportDef {
        key: "expenses_by_category",
        name: "Expenses by category",
        description: "Where the money went, and how much is still unapproved.",
        module: "books",
        icon: "CreditCard",
        requires: "books.expenses",
    },
    ReportDef {
        key: "sales_by_owner",
        name: "Sales by owner",
        description: "Won, open and weighted pipeline for each person.",
        module: "crm",
        icon: "Users",
        requires: "crm.deals",
    },
    ReportDef {
        key: "pipeline_by_stage",
        name: "Pipeline by stage",
        description: "Open deals, their value, and the weighted forecast.",
        module: "crm",
        icon: "Target",
        requires: "crm.deals",
    },
    ReportDef {
        key: "lead_conversion",
        name: "Lead conversion",
        description: "How leads from each source ended up.",
        module: "crm",
        icon: "UserPlus",
        requires: "crm.leads",
    },
    ReportDef {
        key: "project_time",
        name: "Project time",
        description: "Hours logged per project, billable against not.",
        module: "projects",
        icon: "Clock",
        requires: "projects.timesheets",
    },
    ReportDef {
        key: "stock_on_hand",
        name: "Stock on hand",
        description: "Inventory value, and what has fallen below its reorder point.",
        module: "inventory",
        icon: "Package",
        requires: "inventory.items",
    },
    ReportDef {
        key: "ticket_load",
        name: "Support load",
        description: "Open tickets by assignee and priority.",
        module: "desk",
        icon: "LifeBuoy",
        requires: "desk.tickets",
    },
];

async fn catalog(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    let data: Vec<Value> = REPORTS
        .iter()
        .filter(|r| ctx.can(r.requires, Action::View))
        .map(|r| {
            let module = state.registry.modules().iter().find(|m| m.key == r.module);
            json!({
                "key": r.key,
                "name": r.name,
                "description": r.description,
                "module": r.module,
                "module_label": module.map(|m| m.label).unwrap_or(r.module),
                "icon": r.icon,
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

#[derive(Deserialize, Default)]
pub struct ReportParams {
    /// Inclusive ISO dates. Reports that have no natural date column ignore them.
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
}

fn col(key: &str, label: &str, kind: &str) -> Value {
    json!({ "key": key, "label": label, "type": kind })
}

/// Read every column of a row into JSON, using the report's own column types.
fn row_to_json(row: &SqliteRow, columns: &[Value]) -> Value {
    let mut out = Map::new();
    for c in columns {
        let key = c["key"].as_str().unwrap_or_default();
        let kind = c["type"].as_str().unwrap_or(TEXT);
        let value = match kind {
            MONEY | INT | PERCENT | QUANTITY => row
                .try_get::<Option<i64>, _>(key)
                .ok()
                .flatten()
                .map(|v| Value::Number(v.into()))
                // AVG and some SUMs come back REAL; fall back rather than nulling.
                .or_else(|| {
                    row.try_get::<Option<f64>, _>(key)
                        .ok()
                        .flatten()
                        .map(|v| Value::Number((v.round() as i64).into()))
                })
                .unwrap_or(Value::Number(0.into())),
            _ => row
                .try_get::<Option<String>, _>(key)
                .ok()
                .flatten()
                .map(Value::String)
                .unwrap_or(Value::Null),
        };
        out.insert(key.to_string(), value);
    }
    Value::Object(out)
}

/// Sum the numeric columns of a result set, for the totals row.
fn total_numeric(rows: &[Value], columns: &[Value]) -> Value {
    let mut totals = Map::new();
    for c in columns {
        let key = c["key"].as_str().unwrap_or_default();
        let kind = c["type"].as_str().unwrap_or(TEXT);
        if !matches!(kind, MONEY | INT | QUANTITY) {
            continue;
        }
        // `sum()` panics on overflow in a debug build and wraps in release.
        // The inputs are tenant data, so neither is an acceptable failure mode
        // for a read-only report.
        let sum: i64 = rows
            .iter()
            .filter_map(|r| r.get(key).and_then(|v| v.as_i64()))
            .fold(0i64, |acc, v| acc.saturating_add(v));
        totals.insert(key.to_string(), Value::Number(sum.into()));
    }
    Value::Object(totals)
}

async fn run(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(key): Path<String>,
    Query(params): Query<ReportParams>,
) -> AppResult<Json<Value>> {
    let def = REPORTS
        .iter()
        .find(|r| r.key == key)
        .ok_or_else(|| AppError::not_found(format!("Report `{key}`")))?;
    ctx.require(def.requires, Action::View)?;

    // Default window: the last twelve months, which is what every one of these
    // reports is asked about first.
    let to = params.to.clone().unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let from = params.from.clone().unwrap_or_else(|| {
        (Utc::now() - Duration::days(365)).format("%Y-%m-%d").to_string()
    });

    let (columns, rows) = match def.key {
        "ar_aging" => ar_aging(&state, &ctx).await?,
        "revenue_by_month" => revenue_by_month(&state, &ctx, &from, &to).await?,
        "top_customers" => top_customers(&state, &ctx, &from, &to).await?,
        "expenses_by_category" => expenses_by_category(&state, &ctx, &from, &to).await?,
        "sales_by_owner" => sales_by_owner(&state, &ctx).await?,
        "pipeline_by_stage" => pipeline_by_stage(&state, &ctx).await?,
        "lead_conversion" => lead_conversion(&state, &ctx).await?,
        "project_time" => project_time(&state, &ctx, &from, &to).await?,
        "stock_on_hand" => stock_on_hand(&state, &ctx).await?,
        "ticket_load" => ticket_load(&state, &ctx).await?,
        other => return Err(AppError::not_found(format!("Report `{other}`"))),
    };

    let totals = total_numeric(&rows, &columns);

    Ok(Json(json!({
        "key": def.key,
        "name": def.name,
        "description": def.description,
        "columns": columns,
        "rows": rows,
        "totals": totals,
        "from": from,
        "to": to,
        "generated_at": Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    })))
}

// ------------------------------------------------------------------ books ---

/// Outstanding balances bucketed by age.
///
/// Ageing is measured against the due date, not the invoice date — an invoice
/// on 60-day terms is not overdue at 30 days, and reporting it as such would
/// misstate collections.
async fn ar_aging(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("customer", "Customer", TEXT),
        col("current", "Not yet due", MONEY),
        col("d1_30", "1–30 days", MONEY),
        col("d31_60", "31–60 days", MONEY),
        col("d61_90", "61–90 days", MONEY),
        col("d90_plus", "90+ days", MONEY),
        col("total", "Total owed", MONEY),
        col("invoices", "Invoices", INT),
    ];

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let rows = sqlx::query(
        "SELECT a.name AS customer,
                SUM(CASE WHEN i.due_date >= ?1 THEN i.balance_due ELSE 0 END) AS current,
                SUM(CASE WHEN julianday(?1) - julianday(i.due_date) BETWEEN 1 AND 30 THEN i.balance_due ELSE 0 END) AS d1_30,
                SUM(CASE WHEN julianday(?1) - julianday(i.due_date) BETWEEN 31 AND 60 THEN i.balance_due ELSE 0 END) AS d31_60,
                SUM(CASE WHEN julianday(?1) - julianday(i.due_date) BETWEEN 61 AND 90 THEN i.balance_due ELSE 0 END) AS d61_90,
                SUM(CASE WHEN julianday(?1) - julianday(i.due_date) > 90 THEN i.balance_due ELSE 0 END) AS d90_plus,
                SUM(i.balance_due) AS total,
                COUNT(*) AS invoices
           FROM invoices i
           JOIN accounts a ON a.id = i.account_id AND a.org_id = i.org_id
          WHERE i.org_id = ?2
            AND i.deleted_at IS NULL
            AND i.status NOT IN ('paid', 'void', 'draft')
            AND i.balance_due > 0
          GROUP BY a.id, a.name
          ORDER BY total DESC",
    )
    .bind(&today)
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn revenue_by_month(
    state: &AppState,
    ctx: &Ctx,
    from: &str,
    to: &str,
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("month", "Month", TEXT),
        col("invoiced", "Invoiced", MONEY),
        col("collected", "Collected", MONEY),
        col("outstanding", "Outstanding", MONEY),
        col("invoices", "Invoices", INT),
    ];

    let rows = sqlx::query(
        "SELECT substr(invoice_date, 1, 7) AS month,
                SUM(total) AS invoiced,
                SUM(amount_paid) AS collected,
                SUM(balance_due) AS outstanding,
                COUNT(*) AS invoices
           FROM invoices
          WHERE org_id = ? AND deleted_at IS NULL AND status <> 'void'
            AND invoice_date BETWEEN ? AND ?
          GROUP BY month
          ORDER BY month DESC",
    )
    .bind(&ctx.org_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn top_customers(
    state: &AppState,
    ctx: &Ctx,
    from: &str,
    to: &str,
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("customer", "Customer", TEXT),
        col("invoiced", "Invoiced", MONEY),
        col("collected", "Collected", MONEY),
        col("outstanding", "Outstanding", MONEY),
        col("invoices", "Invoices", INT),
    ];

    let rows = sqlx::query(
        "SELECT a.name AS customer,
                SUM(i.total) AS invoiced,
                SUM(i.amount_paid) AS collected,
                SUM(i.balance_due) AS outstanding,
                COUNT(*) AS invoices
           FROM invoices i
           JOIN accounts a ON a.id = i.account_id AND a.org_id = i.org_id
          WHERE i.org_id = ? AND i.deleted_at IS NULL AND i.status <> 'void'
            AND i.invoice_date BETWEEN ? AND ?
          GROUP BY a.id, a.name
          ORDER BY invoiced DESC
          LIMIT 50",
    )
    .bind(&ctx.org_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn expenses_by_category(
    state: &AppState,
    ctx: &Ctx,
    from: &str,
    to: &str,
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("category", "Category", TEXT),
        col("approved", "Approved", MONEY),
        col("pending", "Awaiting approval", MONEY),
        col("total", "Total", MONEY),
        col("claims", "Claims", INT),
    ];

    let rows = sqlx::query(
        "SELECT category,
                SUM(CASE WHEN status IN ('approved', 'reimbursed') THEN amount + tax_amount ELSE 0 END) AS approved,
                SUM(CASE WHEN status IN ('draft', 'submitted') THEN amount + tax_amount ELSE 0 END) AS pending,
                SUM(CASE WHEN status <> 'rejected' THEN amount + tax_amount ELSE 0 END) AS total,
                COUNT(*) AS claims
           FROM expenses
          WHERE org_id = ? AND deleted_at IS NULL
            AND expense_date BETWEEN ? AND ?
          GROUP BY category
          ORDER BY total DESC",
    )
    .bind(&ctx.org_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

// -------------------------------------------------------------------- crm ---

async fn sales_by_owner(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("owner", "Owner", TEXT),
        col("won", "Won", MONEY),
        col("open_value", "Open pipeline", MONEY),
        col("weighted", "Weighted forecast", MONEY),
        col("lost", "Lost", MONEY),
        col("deals", "Deals", INT),
    ];

    let rows = sqlx::query(
        "SELECT COALESCE(u.name, 'Unassigned') AS owner,
                SUM(CASE WHEN d.stage = 'closed_won' THEN d.amount ELSE 0 END) AS won,
                SUM(CASE WHEN d.stage NOT LIKE 'closed_%' THEN d.amount ELSE 0 END) AS open_value,
                SUM(CASE WHEN d.stage NOT LIKE 'closed_%' THEN d.expected_revenue ELSE 0 END) AS weighted,
                SUM(CASE WHEN d.stage = 'closed_lost' THEN d.amount ELSE 0 END) AS lost,
                COUNT(*) AS deals
           FROM deals d
           LEFT JOIN memberships m ON m.user_id = d.owner_id AND m.org_id = d.org_id AND m.deleted_at IS NULL
           LEFT JOIN users u ON u.id = m.user_id
          WHERE d.org_id = ? AND d.deleted_at IS NULL
          GROUP BY d.owner_id, u.name
          ORDER BY won DESC, open_value DESC",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn pipeline_by_stage(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("stage", "Stage", TEXT),
        col("value", "Value", MONEY),
        col("weighted", "Weighted", MONEY),
        col("deals", "Deals", INT),
        col("avg_deal", "Average deal", MONEY),
    ];

    let rows = sqlx::query(
        "SELECT stage,
                SUM(amount) AS value,
                SUM(expected_revenue) AS weighted,
                COUNT(*) AS deals,
                CAST(AVG(amount) AS INTEGER) AS avg_deal
           FROM deals
          WHERE org_id = ? AND deleted_at IS NULL AND stage NOT LIKE 'closed_%'
          GROUP BY stage
          ORDER BY value DESC",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn lead_conversion(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("source", "Source", TEXT),
        col("leads", "Leads", INT),
        col("qualified", "Qualified", INT),
        col("converted", "Converted", INT),
        col("conversion_rate", "Conversion", PERCENT),
    ];

    let rows = sqlx::query(
        "SELECT COALESCE(lead_source, 'Unknown') AS source,
                COUNT(*) AS leads,
                SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified,
                SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END) AS converted,
                -- Percent is scaled by 10_000, matching every other percent in
                -- the system, so the frontend formats it the same way.
                CAST(
                  (SUM(CASE WHEN converted_at IS NOT NULL THEN 1.0 ELSE 0.0 END) * 1000000.0)
                  / NULLIF(COUNT(*), 0)
                AS INTEGER) AS conversion_rate
           FROM leads
          WHERE org_id = ? AND deleted_at IS NULL
          GROUP BY lead_source
          ORDER BY leads DESC",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

// --------------------------------------------------------------- delivery ---

async fn project_time(
    state: &AppState,
    ctx: &Ctx,
    from: &str,
    to: &str,
) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("project", "Project", TEXT),
        col("customer", "Customer", TEXT),
        col("billable_hours", "Billable hours", QUANTITY),
        col("nonbillable_hours", "Non-billable", QUANTITY),
        col("total_hours", "Total hours", QUANTITY),
        col("entries", "Entries", INT),
    ];

    let rows = sqlx::query(
        "SELECT p.name AS project,
                COALESCE(a.name, '—') AS customer,
                SUM(CASE WHEN t.billable = 1 THEN t.hours ELSE 0 END) AS billable_hours,
                SUM(CASE WHEN t.billable = 0 THEN t.hours ELSE 0 END) AS nonbillable_hours,
                SUM(t.hours) AS total_hours,
                COUNT(*) AS entries
           FROM timesheets t
           JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
           LEFT JOIN accounts a ON a.id = p.account_id AND a.org_id = p.org_id
          WHERE t.org_id = ? AND t.deleted_at IS NULL
            AND t.work_date BETWEEN ? AND ?
          GROUP BY p.id, p.name, a.name
          ORDER BY total_hours DESC",
    )
    .bind(&ctx.org_id)
    .bind(from)
    .bind(to)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn stock_on_hand(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("item", "Item", TEXT),
        col("sku", "SKU", TEXT),
        col("on_hand", "On hand", QUANTITY),
        col("reorder_level", "Reorder at", QUANTITY),
        col("stock_value", "Value at cost", MONEY),
        col("status", "Status", TEXT),
    ];

    let rows = sqlx::query(
        "SELECT name AS item,
                COALESCE(sku, '—') AS sku,
                stock_on_hand AS on_hand,
                reorder_level,
                -- Quantity is scaled by 1000, so divide it back out before
                -- multiplying by a price in minor units.
                CAST((stock_on_hand * cost_price) / 1000 AS INTEGER) AS stock_value,
                CASE
                  WHEN stock_on_hand <= 0 THEN 'Out of stock'
                  WHEN reorder_level > 0 AND stock_on_hand <= reorder_level THEN 'Reorder'
                  ELSE 'OK'
                END AS status
           FROM items
          WHERE org_id = ? AND deleted_at IS NULL AND track_inventory = 1
          ORDER BY
            CASE
              WHEN stock_on_hand <= 0 THEN 0
              WHEN reorder_level > 0 AND stock_on_hand <= reorder_level THEN 1
              ELSE 2
            END,
            name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

async fn ticket_load(state: &AppState, ctx: &Ctx) -> AppResult<(Vec<Value>, Vec<Value>)> {
    let columns = vec![
        col("assignee", "Assignee", TEXT),
        col("urgent", "Urgent", INT),
        col("high", "High", INT),
        col("normal", "Normal / low", INT),
        col("open_total", "Open", INT),
        col("resolved", "Resolved", INT),
    ];

    let rows = sqlx::query(
        "SELECT COALESCE(u.name, 'Unassigned') AS assignee,
                SUM(CASE WHEN t.status NOT IN ('resolved','closed') AND t.priority = 'urgent' THEN 1 ELSE 0 END) AS urgent,
                SUM(CASE WHEN t.status NOT IN ('resolved','closed') AND t.priority = 'high' THEN 1 ELSE 0 END) AS high,
                SUM(CASE WHEN t.status NOT IN ('resolved','closed') AND t.priority IN ('normal','low') THEN 1 ELSE 0 END) AS normal,
                SUM(CASE WHEN t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS open_total,
                SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved
           FROM tickets t
           LEFT JOIN memberships m ON m.user_id = t.assignee_id AND m.org_id = t.org_id AND m.deleted_at IS NULL
           LEFT JOIN users u ON u.id = m.user_id
          WHERE t.org_id = ? AND t.deleted_at IS NULL
          GROUP BY t.assignee_id, u.name
          ORDER BY open_total DESC",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    Ok((columns.clone(), rows.iter().map(|r| row_to_json(r, &columns)).collect()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_report_is_gated_by_an_entity_that_exists() {
        let registry = crate::modules::registry();
        for r in REPORTS {
            assert!(
                registry.get(r.requires).is_some(),
                "report `{}` is gated on `{}`, which is not an entity",
                r.key,
                r.requires
            );
            assert!(
                registry.modules().iter().any(|m| m.key == r.module),
                "report `{}` claims module `{}`, which does not exist",
                r.key,
                r.module
            );
        }
    }

    #[test]
    fn report_keys_are_unique() {
        let mut seen = std::collections::HashSet::new();
        for r in REPORTS {
            assert!(seen.insert(r.key), "duplicate report key `{}`", r.key);
        }
    }

    #[test]
    fn totals_sum_only_the_numeric_columns() {
        let columns = vec![
            col("customer", "Customer", TEXT),
            col("owed", "Owed", MONEY),
            col("count", "Count", INT),
        ];
        let rows = vec![
            json!({ "customer": "A", "owed": 1000, "count": 2 }),
            json!({ "customer": "B", "owed": 2500, "count": 3 }),
        ];
        let totals = total_numeric(&rows, &columns);
        assert_eq!(totals["owed"], json!(3500));
        assert_eq!(totals["count"], json!(5));
        assert!(totals.get("customer").is_none(), "text columns have no total");
    }
}
