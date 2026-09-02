//! Recurring billing: profiles that generate invoices on a schedule.
//!
//! The scheduling itself is deliberately dull. A daily sweep asks "which
//! profiles are due?" and queues one job per profile; the job renders the
//! invoice and advances the profile's `next_run_date`. Nothing keeps state in
//! memory, so a restart mid-run loses at most one retry.

use axum::extract::{Path, State};
use axum::routing::post;
use axum::{Json, Router};
use chrono::{Datelike, Duration, NaiveDate, Utc};
use serde_json::{json, Map, Value};
use sqlx::{Row, SqlitePool};

use crate::auth::ctx::{Action, Ctx};
use crate::common::audit;
use crate::engine::repo;
use crate::error::{AppError, AppResult};
use crate::modules::hooks;
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new().route("/actions/books.recurring/{id}/generate", post(generate_now))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn today() -> NaiveDate {
    Utc::now().date_naive()
}

/// The date of the `occurrence`-th billing period, counted from the schedule's
/// start.
///
/// Deliberately computed from `start` rather than from the previous invoice.
/// Month arithmetic has to clamp — the 31st does not exist in April — but
/// clamping the *previous* date and then advancing from it loses the anchor for
/// good: 31 Jan would bill 30 Apr, then 30 Jul, then 30 Oct, drifting a day
/// earlier the first time it meets a short month. Anchoring to the start date
/// keeps 31 Jan → 30 Apr → 31 Jul, which is what a customer expects and what
/// other billing systems do.
pub fn occurrence_date(start: NaiveDate, frequency: &str, every_n: i64, occurrence: i64) -> NaiveDate {
    let n = every_n.clamp(1, 60);
    let k = occurrence.max(0);
    match frequency {
        "weekly" => start + Duration::weeks(n * k),
        "quarterly" => add_months(start, n * 3 * k),
        "yearly" => add_months(start, n * 12 * k),
        // `monthly` and anything unrecognised.
        _ => add_months(start, n * k),
    }
}

fn add_months(from: NaiveDate, months: i64) -> NaiveDate {
    let total = from.year() as i64 * 12 + (from.month0() as i64) + months;
    let year = (total.div_euclid(12)) as i32;
    let month0 = total.rem_euclid(12) as u32;
    let month = month0 + 1;
    let last = last_day_of_month(year, month);
    NaiveDate::from_ymd_opt(year, month, from.day().min(last))
        .unwrap_or(from)
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let (y, m) = if month == 12 { (year + 1, 1) } else { (year, month + 1) };
    NaiveDate::from_ymd_opt(y, m, 1)
        .and_then(|d| d.pred_opt())
        .map(|d| d.day())
        .unwrap_or(28)
}

/// Queue a generation job for every profile that has come due.
///
/// Called daily. The dedupe key is the profile plus the date it is billing for,
/// so running the sweep twice in one day cannot double-bill.
pub async fn sweep_due(pool: &SqlitePool) -> AppResult<u64> {
    let today_s = today().to_string();

    let rows = sqlx::query(
        "SELECT id, org_id, next_run_date, created_by, owner_id
         FROM recurring_profiles
         WHERE status = 'active'
           AND deleted_at IS NULL
           AND next_run_date <= ?
           AND (end_date IS NULL OR end_date >= next_run_date)
           AND (max_occurrences IS NULL OR occurrences < max_occurrences)",
    )
    .bind(&today_s)
    .fetch_all(pool)
    .await?;

    let mut queued = 0;
    for r in &rows {
        let id: String = r.try_get("id").unwrap_or_default();
        let org_id: String = r.try_get("org_id").unwrap_or_default();
        let due: String = r.try_get("next_run_date").unwrap_or_default();
        // Run as the profile's owner, falling back to whoever created it.
        let actor: String = r
            .try_get::<Option<String>, _>("owner_id")
            .ok()
            .flatten()
            .or_else(|| r.try_get::<Option<String>, _>("created_by").ok().flatten())
            .unwrap_or_default();

        if actor.is_empty() {
            tracing::warn!(profile = %id, "recurring profile has nobody to run as; skipping");
            continue;
        }

        let enqueued = crate::jobs::enqueue(
            pool,
            &org_id,
            &actor,
            "recurring_invoice",
            json!({ "profile_id": id, "billing_date": due }),
            now(),
            Some(format!("recurring:{id}:{due}")),
        )
        .await?;

        if enqueued.is_some() {
            queued += 1;
        }
    }

    Ok(queued)
}

/// Queue one profile if it is due. Called when a profile is created or edited,
/// so a schedule that is already due bills now rather than at the next sweep.
pub async fn sweep_one(pool: &SqlitePool, org_id: &str, profile_id: &str) -> AppResult<()> {
    let today_s = today().to_string();
    let row = sqlx::query(
        "SELECT next_run_date, created_by, owner_id
         FROM recurring_profiles
         WHERE org_id = ? AND id = ? AND status = 'active' AND deleted_at IS NULL
           AND next_run_date <= ?
           AND (end_date IS NULL OR end_date >= next_run_date)
           AND (max_occurrences IS NULL OR occurrences < max_occurrences)",
    )
    .bind(org_id)
    .bind(profile_id)
    .bind(&today_s)
    .fetch_optional(pool)
    .await?;

    let Some(r) = row else { return Ok(()) };
    let due: String = r.try_get("next_run_date").unwrap_or_default();
    let actor: String = r
        .try_get::<Option<String>, _>("owner_id")
        .ok()
        .flatten()
        .or_else(|| r.try_get::<Option<String>, _>("created_by").ok().flatten())
        .unwrap_or_default();
    if actor.is_empty() {
        return Ok(());
    }

    crate::jobs::enqueue(
        pool,
        org_id,
        &actor,
        "recurring_invoice",
        json!({ "profile_id": profile_id, "billing_date": due }),
        now(),
        Some(format!("recurring:{profile_id}:{due}")),
    )
    .await?;
    Ok(())
}

/// Render one invoice from a profile and advance its schedule.
pub async fn run_job(state: &AppState, job: &crate::jobs::Job) -> AppResult<()> {
    let ctx = crate::jobs::context_for(state, job).await?;
    let profile_id = job.payload["profile_id"].as_str().unwrap_or_default();
    let billing_date = job.payload["billing_date"].as_str().unwrap_or_default().to_string();

    generate(state, &ctx, profile_id, &billing_date).await.map(|_| ())
}

/// The shared body of scheduled generation and the "generate now" button.
async fn generate(
    state: &AppState,
    ctx: &Ctx,
    profile_id: &str,
    billing_date: &str,
) -> AppResult<String> {
    let profile = sqlx::query(
        "SELECT name, account_id, contact_id, status, frequency, every_n, currency,
                payment_terms_days, auto_issue, next_run_date, start_date, end_date,
                max_occurrences, occurrences, owner_id, notes
         FROM recurring_profiles
         WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(profile_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Recurring profile"))?;

    let status: String = profile.try_get("status").unwrap_or_default();
    if status != "active" {
        // Not an error: a profile paused between queueing and running simply
        // does not bill.
        tracing::debug!(profile = %profile_id, %status, "recurring profile is not active; skipping");
        return Ok(String::new());
    }

    // The same billing date must never produce two invoices, even if the job
    // is retried after a partial failure.
    let already = sqlx::query(
        "SELECT id FROM invoices
         WHERE org_id = ? AND recurring_profile_id = ? AND invoice_date = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(profile_id)
    .bind(billing_date)
    .fetch_optional(&state.pool)
    .await?;
    if let Some(row) = already {
        // The invoice for this date exists, so a previous attempt got at least
        // that far before being interrupted. Finish the job rather than
        // returning early: leaving `next_run_date` where it is would make the
        // profile re-bill this same date forever and never move on.
        let invoice_id: String = row.try_get("id").unwrap_or_default();
        advance_schedule(state, ctx, profile_id, billing_date, &invoice_id, &profile).await?;
        return Ok(invoice_id);
    }

    let text = |c: &str| profile.try_get::<Option<String>, _>(c).ok().flatten();
    let terms: i64 = profile.try_get("payment_terms_days").unwrap_or(30);
    let due = NaiveDate::parse_from_str(billing_date, "%Y-%m-%d")
        .unwrap_or_else(|_| today())
        + Duration::days(terms.clamp(0, 365));

    let invoice_def = state
        .registry
        .get("books.invoices")
        .ok_or_else(|| AppError::not_found("Entity `books.invoices`"))?;

    let mut body: Map<String, Value> = Map::new();
    body.insert("account_id".into(), json!(text("account_id")));
    if let Some(c) = text("contact_id") {
        body.insert("contact_id".into(), json!(c));
    }
    body.insert("subject".into(), json!(text("name").unwrap_or_else(|| "Recurring charge".into())));
    body.insert("status".into(), json!("draft"));
    body.insert("invoice_date".into(), json!(billing_date));
    body.insert("due_date".into(), json!(due.to_string()));
    body.insert("currency".into(), json!(text("currency").unwrap_or_else(|| "USD".into())));
    if let Some(o) = text("owner_id") {
        body.insert("owner_id".into(), json!(o));
    }
    if let Some(n) = text("notes") {
        body.insert("notes".into(), json!(n));
    }
    body.insert("terms".into(), json!(format!("Net {terms}.")));

    // Number allocation and insert share a transaction, as everywhere else.
    let mut tx = state.pool.begin().await?;
    hooks::assign_number(&mut tx, ctx, "books.invoices", &mut body).await?;
    let invoice_id = repo::create_on(&mut *tx, invoice_def, ctx, &body).await?;

    sqlx::query("UPDATE invoices SET recurring_profile_id = ? WHERE org_id = ? AND id = ?")
        .bind(profile_id)
        .bind(&ctx.org_id)
        .bind(&invoice_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    // Copy the template lines.
    let lines = sqlx::query(
        "SELECT item_id, description, quantity, unit_price, discount_percent, tax_rate, sort_order
         FROM recurring_profile_items
         WHERE org_id = ? AND recurring_profile_id = ? AND deleted_at IS NULL
         ORDER BY sort_order, id",
    )
    .bind(&ctx.org_id)
    .bind(profile_id)
    .fetch_all(&state.pool)
    .await?;

    let item_def = state
        .registry
        .get("books.invoice_items")
        .ok_or_else(|| AppError::not_found("Entity `books.invoice_items`"))?;

    for (i, l) in lines.iter().enumerate() {
        let mut line: Map<String, Value> = Map::new();
        line.insert("invoice_id".into(), json!(invoice_id));
        if let Some(item) = l.try_get::<Option<String>, _>("item_id").ok().flatten() {
            line.insert("item_id".into(), json!(item));
        }
        line.insert(
            "description".into(),
            json!(l.try_get::<Option<String>, _>("description").ok().flatten().unwrap_or_default()),
        );
        line.insert("quantity".into(), scaled(l.try_get("quantity").unwrap_or(0), 1000));
        line.insert("unit_price".into(), minor(l.try_get("unit_price").unwrap_or(0)));
        line.insert("discount_percent".into(), scaled(l.try_get("discount_percent").unwrap_or(0), 10_000));
        line.insert("tax_rate".into(), scaled(l.try_get("tax_rate").unwrap_or(0), 10_000));
        line.insert("sort_order".into(), json!(i as i64));
        repo::create_on(&state.pool, item_def, ctx, &line).await?;
    }

    hooks::retotal_document(&state.pool, ctx, "books.invoices", &invoice_id).await?;

    // Issue it, if the profile says so and there is something to charge.
    let auto_issue = profile.try_get::<i64, _>("auto_issue").unwrap_or(0) != 0;
    if auto_issue {
        let total: i64 = sqlx::query("SELECT total FROM invoices WHERE org_id = ? AND id = ?")
            .bind(&ctx.org_id)
            .bind(&invoice_id)
            .fetch_one(&state.pool)
            .await?
            .try_get("total")
            .unwrap_or(0);
        if total > 0 {
            sqlx::query(
                "UPDATE invoices SET status = 'sent', sent_at = ?, updated_at = ? WHERE org_id = ? AND id = ?",
            )
            .bind(now())
            .bind(now())
            .bind(&ctx.org_id)
            .bind(&invoice_id)
            .execute(&state.pool)
            .await?;
            hooks::recalc_invoice_balance(&state.pool, ctx, &invoice_id).await?;
        }
    }

    advance_schedule(state, ctx, profile_id, billing_date, &invoice_id, &profile).await?;

    Ok(invoice_id)
}

/// Move a profile on to its next period after an invoice has been written.
///
/// Split out so the retry path can reach it too: a job interrupted after the
/// invoice committed but before this ran would otherwise find the invoice
/// already there on its next attempt, return early, and leave `next_run_date`
/// pinned to a date that can never produce another invoice — the profile stops
/// billing silently and forever.
async fn advance_schedule(
    state: &AppState,
    ctx: &Ctx,
    profile_id: &str,
    billing_date: &str,
    invoice_id: &str,
    profile: &sqlx::sqlite::SqliteRow,
) -> AppResult<()> {
    let text = |c: &str| profile.try_get::<Option<String>, _>(c).ok().flatten();

    // The next date is the n-th occurrence from the schedule's start, not an
    // offset from the invoice just written, so a late sweep cannot shift the
    // schedule and a clamped month cannot drift it.
    let frequency: String = profile.try_get("frequency").unwrap_or_else(|_| "monthly".into());
    let every_n: i64 = profile.try_get("every_n").unwrap_or(1);
    let occurrences: i64 = profile.try_get::<i64, _>("occurrences").unwrap_or(0) + 1;
    let start = text("start_date")
        .and_then(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| {
            NaiveDate::parse_from_str(billing_date, "%Y-%m-%d").unwrap_or_else(|_| today())
        });

    // Anchoring to the start date is right, but an edited start date can put
    // the n-th occurrence behind the date just billed, which would either
    // re-bill the same period or skip several. Never move the schedule
    // backwards past what has already been invoiced.
    let billed = NaiveDate::parse_from_str(billing_date, "%Y-%m-%d").unwrap_or_else(|_| today());
    let mut next = occurrence_date(start, &frequency, every_n, occurrences);
    if next <= billed {
        let mut k = occurrences;
        while next <= billed && k < occurrences + 1200 {
            k += 1;
            next = occurrence_date(start, &frequency, every_n, k);
        }
    }

    let max: Option<i64> = profile.try_get::<Option<i64>, _>("max_occurrences").ok().flatten();
    let end: Option<String> = text("end_date");

    let finished = max.is_some_and(|m| occurrences >= m)
        || end.as_ref().is_some_and(|e| next.to_string() > *e);

    sqlx::query(
        "UPDATE recurring_profiles
            SET next_run_date = ?, occurrences = ?, last_invoice_id = ?, last_run_at = ?,
                status = ?, updated_at = ?
          WHERE org_id = ? AND id = ?",
    )
    .bind(next.to_string())
    .bind(occurrences)
    .bind(invoice_id)
    .bind(now())
    .bind(if finished { "ended" } else { "active" })
    .bind(now())
    .bind(&ctx.org_id)
    .bind(profile_id)
    .execute(&state.pool)
    .await?;

    audit::record(
        &state.pool,
        ctx,
        "books.recurring",
        profile_id,
        "generate",
        Some(format!("Generated an invoice for {billing_date}")),
        None,
    )
    .await?;

    // A profile whose start date is in the past owes an invoice for every
    // period since. Queue the next one rather than looping here, so catching up
    // happens one job at a time and stays bounded by end_date / max_occurrences.
    if !finished {
        sweep_one(&state.pool, &ctx.org_id, profile_id).await?;
    }

    Ok(())
}

fn minor(v: i64) -> Value {
    Value::String(format!("{}.{:02}", v / 100, (v % 100).abs()))
}

fn scaled(value: i64, scale: i64) -> Value {
    let digits = (scale as f64).log10().round() as usize;
    Value::String(format!(
        "{}.{:0width$}",
        value / scale,
        (value % scale).abs(),
        width = digits
    ))
}

/// Bill a profile immediately, without waiting for its schedule.
async fn generate_now(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require("books.recurring", Action::Edit)?;
    ctx.require("books.invoices", Action::Create)?;

    let due: String = sqlx::query(
        "SELECT next_run_date FROM recurring_profiles WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Recurring profile"))?
    .try_get("next_run_date")
    .unwrap_or_else(|_| today().to_string());

    let invoice_id = generate(&state, &ctx, &id, &due).await?;
    if invoice_id.is_empty() {
        return Err(AppError::conflict("This profile is not active"));
    }

    Ok(Json(json!({ "invoice_id": invoice_id, "billing_date": due })))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn monthly_counts_from_the_start_date() {
        let start = d("2026-01-15");
        assert_eq!(occurrence_date(start, "monthly", 1, 0), d("2026-01-15"));
        assert_eq!(occurrence_date(start, "monthly", 1, 1), d("2026-02-15"));
        assert_eq!(occurrence_date(start, "monthly", 1, 11), d("2026-12-15"));
        // Across a year boundary.
        assert_eq!(occurrence_date(start, "monthly", 1, 12), d("2027-01-15"));
    }

    #[test]
    fn month_ends_clamp_rather_than_overflow() {
        let start = d("2026-01-31");
        assert_eq!(occurrence_date(start, "monthly", 1, 1), d("2026-02-28"));
        assert_eq!(occurrence_date(start, "monthly", 1, 3), d("2026-04-30"));
        // 2028 is a leap year.
        assert_eq!(occurrence_date(d("2028-01-31"), "monthly", 1, 1), d("2028-02-29"));
    }

    #[test]
    fn a_clamped_month_does_not_drift_the_schedule() {
        // This is the bug that anchoring prevents: billing the 31st must go
        // 31 Jan -> 28 Feb -> 31 Mar, not 31 Jan -> 28 Feb -> 28 Mar.
        let start = d("2026-01-31");
        assert_eq!(occurrence_date(start, "monthly", 1, 1), d("2026-02-28"));
        assert_eq!(occurrence_date(start, "monthly", 1, 2), d("2026-03-31"));
        assert_eq!(occurrence_date(start, "monthly", 1, 4), d("2026-05-31"));

        // Same for quarters: Jan 31 -> Apr 30 -> Jul 31, not Jul 30.
        assert_eq!(occurrence_date(start, "quarterly", 1, 1), d("2026-04-30"));
        assert_eq!(occurrence_date(start, "quarterly", 1, 2), d("2026-07-31"));
    }

    #[test]
    fn other_frequencies() {
        assert_eq!(occurrence_date(d("2026-01-05"), "weekly", 1, 1), d("2026-01-12"));
        assert_eq!(occurrence_date(d("2026-01-05"), "weekly", 2, 1), d("2026-01-19"));
        // 2028 is a leap year; 2029 is not, so the 29th clamps to the 28th.
        assert_eq!(occurrence_date(d("2028-02-29"), "yearly", 1, 1), d("2029-02-28"));
    }

    #[test]
    fn every_n_multiplies_the_period() {
        let start = d("2026-01-15");
        assert_eq!(occurrence_date(start, "monthly", 2, 1), d("2026-03-15"));
        assert_eq!(occurrence_date(start, "monthly", 6, 1), d("2026-07-15"));
    }

    #[test]
    fn an_unknown_frequency_falls_back_to_monthly_rather_than_stalling() {
        // A stalled schedule would re-bill the same date forever.
        assert_eq!(occurrence_date(d("2026-01-15"), "nonsense", 1, 1), d("2026-02-15"));
    }

    #[test]
    fn every_n_is_clamped_so_a_bad_value_cannot_stall_the_schedule() {
        let start = d("2026-01-15");
        assert!(occurrence_date(start, "monthly", 0, 1) > start);
        assert!(occurrence_date(start, "monthly", -5, 1) > start);
    }

    #[test]
    fn scaled_values_render_as_decimals() {
        assert_eq!(minor(123_456), json!("1234.56"));
        assert_eq!(scaled(2_500, 1000), json!("2.500"));
        assert_eq!(scaled(185_000, 10_000), json!("18.5000"));
    }
}
