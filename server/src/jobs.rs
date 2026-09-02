//! The job queue and its worker.
//!
//! Scheduled work — "three days after this deal is won, chase the signature" —
//! cannot live in an in-memory timer, because a restart would lose it. So it
//! lives in a table, and a worker claims rows atomically, runs them, and either
//! marks them done or backs off and retries.
//!
//! The queue is deliberately small: one worker, polling. At the scale a
//! single-file SQLite database is appropriate for, a poll every few seconds
//! costs nothing and needs no broker.

use std::collections::HashSet;
use std::time::Duration;

use chrono::Utc;
use serde_json::{json, Value};
use sqlx::{Row, SqlitePool};

use crate::auth::ctx::Ctx;
use crate::common::ids::new_id;
use crate::error::AppResult;
use crate::state::AppState;

/// How often the worker looks for due work.
const POLL: Duration = Duration::from_secs(10);

/// A job that has been running longer than this is presumed dead — its process
/// was killed mid-run — and is returned to the queue.
const STALE_LOCK_MINS: i64 = 10;

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Queue one job. `run_at` is an RFC3339 timestamp; work due in the past runs on
/// the next poll.
pub async fn enqueue(
    pool: &SqlitePool,
    org_id: &str,
    actor_id: &str,
    kind: &str,
    payload: Value,
    run_at: String,
    dedupe_key: Option<String>,
) -> AppResult<Option<String>> {
    let id = new_id();
    let ts = now();

    let result = sqlx::query(
        "INSERT INTO jobs (id, org_id, kind, payload, actor_id, run_at, dedupe_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(org_id)
    .bind(kind)
    .bind(payload.to_string())
    .bind(actor_id)
    .bind(&run_at)
    .bind(&dedupe_key)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await;

    match result {
        Ok(_) => Ok(Some(id)),
        // A duplicate dedupe key means the work is already queued. That is the
        // point of the key, so it is a success, not an error.
        Err(sqlx::Error::Database(e)) if e.message().contains("UNIQUE constraint failed") => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn spawn(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = release_stale_locks(&state.pool).await {
                tracing::error!(error = %e, "could not release stale job locks");
            }
            match run_due(&state).await {
                Ok(0) => {}
                Ok(n) => tracing::debug!(jobs = n, "ran scheduled jobs"),
                Err(e) => tracing::error!(error = %e, "job worker failed"),
            }
            tokio::time::sleep(POLL).await;
        }
    });
}

/// Hand back any job whose worker died holding it.
async fn release_stale_locks(pool: &SqlitePool) -> AppResult<u64> {
    let cutoff = (Utc::now() - chrono::Duration::minutes(STALE_LOCK_MINS))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let res = sqlx::query(
        "UPDATE jobs SET status = 'pending', locked_at = NULL, updated_at = ?
         WHERE status = 'running' AND locked_at IS NOT NULL AND locked_at < ?",
    )
    .bind(now())
    .bind(cutoff)
    .execute(pool)
    .await?;

    Ok(res.rows_affected())
}

/// Claim and run every job that is due, up to a small batch.
pub(crate) async fn run_due(state: &AppState) -> AppResult<usize> {
    let mut ran = 0;

    // Bounded so one busy tick cannot starve the poll loop.
    for _ in 0..25 {
        let Some(job) = claim_one(&state.pool).await? else {
            break;
        };
        execute(state, &job).await;
        ran += 1;
    }

    Ok(ran)
}

pub struct Job {
    pub id: String,
    pub org_id: String,
    pub kind: String,
    pub payload: Value,
    pub actor_id: Option<String>,
    pub attempts: i64,
    pub max_attempts: i64,
}

/// Take exactly one due job.
///
/// `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING *` is atomic in
/// SQLite, so two workers cannot claim the same row even without a transaction.
async fn claim_one(pool: &SqlitePool) -> AppResult<Option<Job>> {
    let ts = now();
    let row = sqlx::query(
        "UPDATE jobs SET status = 'running', locked_at = ?, attempts = attempts + 1, updated_at = ?
         WHERE id = (
             SELECT id FROM jobs
             WHERE status = 'pending' AND run_at <= ?
             ORDER BY run_at, id
             LIMIT 1
         )
         RETURNING id, org_id, kind, payload, actor_id, attempts, max_attempts",
    )
    .bind(&ts)
    .bind(&ts)
    .bind(&ts)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| Job {
        id: r.try_get("id").unwrap_or_default(),
        org_id: r.try_get("org_id").unwrap_or_default(),
        kind: r.try_get("kind").unwrap_or_default(),
        payload: r
            .try_get::<String, _>("payload")
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(Value::Null),
        actor_id: r.try_get::<Option<String>, _>("actor_id").ok().flatten(),
        attempts: r.try_get("attempts").unwrap_or(1),
        max_attempts: r.try_get("max_attempts").unwrap_or(5),
    }))
}

async fn execute(state: &AppState, job: &Job) {
    let outcome = match job.kind.as_str() {
        "automation_action" => crate::modules::automations::run_scheduled(state, job).await,
        "recurring_invoice" => crate::modules::recurring::run_job(state, job).await,
        "webhook_delivery" => crate::modules::webhooks::run_job(state, job).await,
        other => Err(crate::error::AppError::bad_request(format!(
            "unknown job kind `{other}`"
        ))),
    };

    match outcome {
        Ok(()) => {
            let _ = sqlx::query(
                "UPDATE jobs SET status = 'done', finished_at = ?, updated_at = ?, last_error = NULL
                 WHERE id = ?",
            )
            .bind(now())
            .bind(now())
            .bind(&job.id)
            .execute(&state.pool)
            .await;
        }
        Err(e) => {
            let message = e.to_string();
            if job.attempts >= job.max_attempts {
                tracing::error!(job = %job.id, kind = %job.kind, error = %message, "job failed permanently");
                let _ = sqlx::query(
                    "UPDATE jobs SET status = 'failed', finished_at = ?, updated_at = ?, last_error = ?
                     WHERE id = ?",
                )
                .bind(now())
                .bind(now())
                .bind(&message)
                .bind(&job.id)
                .execute(&state.pool)
                .await;
            } else {
                // Exponential backoff, so a transient failure does not spin.
                let delay = backoff_secs(job.attempts);
                let next = (Utc::now() + chrono::Duration::seconds(delay))
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
                tracing::warn!(job = %job.id, attempt = job.attempts, retry_in = delay, error = %message, "job failed, retrying");
                let _ = sqlx::query(
                    "UPDATE jobs SET status = 'pending', locked_at = NULL, run_at = ?, updated_at = ?, last_error = ?
                     WHERE id = ?",
                )
                .bind(&next)
                .bind(now())
                .bind(&message)
                .bind(&job.id)
                .execute(&state.pool)
                .await;
            }
        }
    }
}

/// 30s, 1m, 2m, 4m, ... capped so a stuck job retries hourly rather than never.
pub fn backoff_secs(attempts: i64) -> i64 {
    let n = attempts.clamp(1, 12) as u32;
    (30_i64.saturating_mul(2_i64.saturating_pow(n - 1))).min(3600)
}

/// Rebuild the acting context for a job. Permissions are re-read now rather
/// than captured at enqueue time, so work scheduled by someone whose access has
/// since been revoked does not run with their old rights.
pub async fn context_for(state: &AppState, job: &Job) -> AppResult<Ctx> {
    let Some(actor) = &job.actor_id else {
        return Err(crate::error::AppError::bad_request("job has no actor"));
    };

    let row = sqlx::query(
        "SELECT u.email, u.name, m.is_owner, m.status, r.key AS role_key, r.permissions
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN roles r ON r.id = m.role_id
         WHERE m.org_id = ? AND m.user_id = ? AND m.deleted_at IS NULL",
    )
    .bind(&job.org_id)
    .bind(actor)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| crate::error::AppError::forbidden("the user who scheduled this no longer has access"))?;

    let status: String = row.try_get("status").unwrap_or_default();
    if status != "active" {
        return Err(crate::error::AppError::forbidden(
            "the user who scheduled this is no longer active",
        ));
    }

    let raw: String = row.try_get("permissions").unwrap_or_else(|_| "[]".into());
    let permissions: HashSet<String> = serde_json::from_str::<Value>(&raw)
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| a.into_iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    Ok(Ctx {
        user_id: actor.clone(),
        org_id: job.org_id.clone(),
        email: row.try_get("email").unwrap_or_default(),
        name: row.try_get("name").unwrap_or_default(),
        role_key: row.try_get("role_key").unwrap_or_default(),
        is_owner: row.try_get::<i64, _>("is_owner").unwrap_or(0) != 0,
        permissions,
    })
}

/// Queue summary for the workspace settings screen.
pub async fn summary(pool: &SqlitePool, org_id: &str) -> AppResult<Value> {
    let rows = sqlx::query(
        "SELECT status, COUNT(*) AS n FROM jobs WHERE org_id = ? GROUP BY status",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    let mut counts = serde_json::Map::new();
    for r in &rows {
        counts.insert(
            r.try_get::<String, _>("status").unwrap_or_default(),
            json!(r.try_get::<i64, _>("n").unwrap_or(0)),
        );
    }

    let upcoming = sqlx::query(
        "SELECT id, kind, run_at, attempts, last_error FROM jobs
         WHERE org_id = ? AND status = 'pending'
         ORDER BY run_at LIMIT 10",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?;

    Ok(json!({
        "counts": counts,
        "upcoming": upcoming.iter().map(|r| json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "kind": r.try_get::<String, _>("kind").unwrap_or_default(),
            "run_at": r.try_get::<String, _>("run_at").unwrap_or_default(),
            "attempts": r.try_get::<i64, _>("attempts").unwrap_or(0),
            "last_error": r.try_get::<Option<String>, _>("last_error").ok().flatten(),
        })).collect::<Vec<_>>(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO organizations (id, name, slug, currency, timezone, fiscal_year_start_month, created_at, updated_at)
             VALUES ('o1','O','o','USD','UTC',1,'t','t')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
                     VALUES ('u1','a@b.c','A','x','t','t')")
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn backoff_grows_then_caps() {
        assert_eq!(backoff_secs(1), 30);
        assert_eq!(backoff_secs(2), 60);
        assert_eq!(backoff_secs(3), 120);
        assert_eq!(backoff_secs(4), 240);
        // Never longer than an hour, and never a panic on a large attempt count.
        assert_eq!(backoff_secs(99), 3600);
        assert!(backoff_secs(i64::MAX) <= 3600);
    }

    #[tokio::test]
    async fn a_job_is_claimed_exactly_once() {
        let pool = pool().await;
        let past = "2000-01-01T00:00:00Z".to_string();
        enqueue(&pool, "o1", "u1", "automation_action", json!({}), past, None)
            .await
            .unwrap();

        assert!(claim_one(&pool).await.unwrap().is_some(), "the due job should be claimed");
        assert!(
            claim_one(&pool).await.unwrap().is_none(),
            "a claimed job must not be handed out again"
        );
    }

    #[tokio::test]
    async fn work_scheduled_for_the_future_is_not_claimed_yet() {
        let pool = pool().await;
        enqueue(&pool, "o1", "u1", "automation_action", json!({}), "2099-01-01T00:00:00Z".into(), None)
            .await
            .unwrap();
        assert!(claim_one(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn a_dedupe_key_collapses_duplicate_work() {
        let pool = pool().await;
        let past = "2000-01-01T00:00:00Z".to_string();
        let key = Some("chase:deal-1".to_string());

        let first = enqueue(&pool, "o1", "u1", "automation_action", json!({}), past.clone(), key.clone())
            .await
            .unwrap();
        let second = enqueue(&pool, "o1", "u1", "automation_action", json!({}), past.clone(), key.clone())
            .await
            .unwrap();

        assert!(first.is_some(), "the first enqueue should create a job");
        assert!(second.is_none(), "the duplicate should be dropped, not error");

        // Once the first is done the key is free again.
        sqlx::query("UPDATE jobs SET status = 'done' WHERE id = ?")
            .bind(first.unwrap())
            .execute(&pool)
            .await
            .unwrap();
        let third = enqueue(&pool, "o1", "u1", "automation_action", json!({}), past, key)
            .await
            .unwrap();
        assert!(third.is_some(), "a spent key should be reusable");
    }

    #[tokio::test]
    async fn a_dead_workers_job_is_returned_to_the_queue() {
        let pool = pool().await;
        enqueue(&pool, "o1", "u1", "automation_action", json!({}), "2000-01-01T00:00:00Z".into(), None)
            .await
            .unwrap();
        claim_one(&pool).await.unwrap().expect("claimed");

        // Nothing to release yet: the lock is fresh.
        assert_eq!(release_stale_locks(&pool).await.unwrap(), 0);

        sqlx::query("UPDATE jobs SET locked_at = '2000-01-01T00:00:00Z'")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(release_stale_locks(&pool).await.unwrap(), 1);
        assert!(claim_one(&pool).await.unwrap().is_some(), "it should be claimable again");
    }
}
