//! Periodic derivations.
//!
//! Invoice status is recomputed whenever an invoice or its payments are
//! written — which never happens to an invoice that is simply sitting there
//! going past due. Something has to notice the passage of time, so this sweep
//! does, for every tenant at once.

use std::time::Duration;

use chrono::Utc;
use sqlx::SqlitePool;

/// How often the sweep runs while the server is up. Due dates are whole days,
/// so this is about being right within the hour, not the second.
const INTERVAL: Duration = Duration::from_secs(30 * 60);

pub fn spawn(pool: SqlitePool) {
    tokio::spawn(async move {
        loop {
            match sweep_overdue(&pool).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(invoices = n, "marked invoices overdue"),
                Err(e) => tracing::error!(error = %e, "overdue sweep failed"),
            }
            // Recurring billing is queued from here rather than run here: the
            // sweep only decides *what* is due, the job queue does the work.
            match crate::modules::recurring::sweep_due(&pool).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(profiles = n, "queued recurring invoices"),
                Err(e) => tracing::error!(error = %e, "recurring sweep failed"),
            }
            tokio::time::sleep(INTERVAL).await;
        }
    });
}

/// Move issued invoices past their due date to `overdue`.
///
/// Only `sent` moves. A partly-paid invoice keeps `partial`, because that says
/// more than `overdue` does, and `draft`/`void`/`paid` are decisions rather
/// than derived state.
pub async fn sweep_overdue(pool: &SqlitePool) -> anyhow::Result<u64> {
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let now = Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let res = sqlx::query(
        "UPDATE invoices SET status = 'overdue', updated_at = ?
         WHERE status = 'sent'
           AND deleted_at IS NULL
           AND due_date < ?
           AND balance_due > 0",
    )
    .bind(&now)
    .bind(&today)
    .execute(pool)
    .await?;

    Ok(res.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        pool
    }

    async fn insert_invoice(pool: &SqlitePool, id: &str, status: &str, due: &str, balance: i64) {
        sqlx::query("INSERT INTO organizations (id, name, slug, currency, timezone, fiscal_year_start_month, created_at, updated_at)
                     VALUES ('o1','O','o','USD','UTC',1,'t','t') ON CONFLICT DO NOTHING")
            .execute(pool).await.unwrap();
        sqlx::query(
            "INSERT INTO accounts (id, org_id, name, created_at, updated_at) VALUES ('a1','o1','A','t','t')
             ON CONFLICT DO NOTHING",
        ).execute(pool).await.unwrap();
        sqlx::query(
            "INSERT INTO invoices (id, org_id, number, account_id, status, invoice_date, due_date,
                                   total, balance_due, created_at, updated_at)
             VALUES (?, 'o1', ?, 'a1', ?, '2026-01-01', ?, ?, ?, 't', 't')",
        )
        .bind(id).bind(id).bind(status).bind(due).bind(balance).bind(balance)
        .execute(pool).await.unwrap();
    }

    async fn status_of(pool: &SqlitePool, id: &str) -> String {
        use sqlx::Row;
        sqlx::query("SELECT status FROM invoices WHERE id = ?")
            .bind(id).fetch_one(pool).await.unwrap().try_get("status").unwrap()
    }

    #[tokio::test]
    async fn sweep_only_touches_issued_invoices_past_due() {
        let pool = pool().await;
        insert_invoice(&pool, "past-sent", "sent", "2020-01-01", 5000).await;
        insert_invoice(&pool, "future-sent", "sent", "2099-01-01", 5000).await;
        insert_invoice(&pool, "past-draft", "draft", "2020-01-01", 5000).await;
        insert_invoice(&pool, "past-partial", "partial", "2020-01-01", 5000).await;
        insert_invoice(&pool, "past-paid", "paid", "2020-01-01", 0).await;
        insert_invoice(&pool, "past-void", "void", "2020-01-01", 5000).await;
        insert_invoice(&pool, "past-settled", "sent", "2020-01-01", 0).await;

        let n = sweep_overdue(&pool).await.unwrap();
        assert_eq!(n, 1, "exactly one invoice qualifies");

        assert_eq!(status_of(&pool, "past-sent").await, "overdue");
        assert_eq!(status_of(&pool, "future-sent").await, "sent");
        assert_eq!(status_of(&pool, "past-draft").await, "draft", "a draft is not overdue");
        assert_eq!(status_of(&pool, "past-partial").await, "partial", "partial says more than overdue");
        assert_eq!(status_of(&pool, "past-paid").await, "paid");
        assert_eq!(status_of(&pool, "past-void").await, "void");
        assert_eq!(status_of(&pool, "past-settled").await, "sent", "nothing owed, nothing overdue");
    }

    #[tokio::test]
    async fn sweep_is_idempotent() {
        let pool = pool().await;
        insert_invoice(&pool, "past-sent", "sent", "2020-01-01", 5000).await;
        assert_eq!(sweep_overdue(&pool).await.unwrap(), 1);
        assert_eq!(sweep_overdue(&pool).await.unwrap(), 0, "a second pass changes nothing");
    }
}
