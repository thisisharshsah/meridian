//! Outbound webhooks.
//!
//! When a record changes, every active webhook subscribed to that event gets a
//! signed POST — delivered through the job queue, so a slow endpoint cannot
//! slow down a save and a failed delivery retries with backoff.
//!
//! Two things are load-bearing:
//!
//! *Signing.* Each request carries `X-Meridian-Signature: sha256=<hmac>` over
//! the exact body, plus a timestamp, so a receiver can verify the payload came
//! from this workspace and is not a replay.
//!
//! *Where it may point.* A webhook URL is an outbound request the server makes
//! on a user's say-so, which is a server-side request forgery primitive: a URL
//! of `http://169.254.169.254/…` would have the server read a cloud metadata
//! endpoint and post it onward. Private and loopback addresses are refused
//! unless the operator opts in, because this is also self-hosted software where
//! posting to a LAN service is a legitimate thing to want.

use std::time::Duration;

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::Utc;
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::Sha256;
use sqlx::{Row, SqlitePool};

use crate::auth::ctx::Ctx;
use crate::common::audit;
use crate::common::ids::new_id;
use crate::error::{AppError, AppResult, FieldError};
use crate::state::AppState;

/// A receiver that has not answered in this long is treated as failed. Kept
/// short: a webhook is a notification, not a conversation.
const TIMEOUT: Duration = Duration::from_secs(10);

/// After this many consecutive failures the webhook is switched off, so a
/// permanently dead endpoint stops generating work forever.
const FAILURE_LIMIT: i64 = 15;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/webhooks", get(list).post(create))
        .route("/settings/webhooks/{id}", axum::routing::patch(update).delete(destroy))
        .route("/settings/webhooks/{id}/deliveries", get(deliveries))
        .route("/settings/webhooks/{id}/test", axum::routing::post(send_test))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ------------------------------------------------------------- validation ---

/// Reject URLs that would point the server at itself or its network.
///
/// Hostname-based, so it is a guard rather than a guarantee — a name that
/// resolves to a private address at request time still gets through. Closing
/// that properly means resolving first and pinning the socket to the resolved
/// address, which is worth doing before this is exposed to untrusted tenants.
fn check_url(url: &str, allow_private: bool) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "That is not a valid URL".to_string())?;

    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("A webhook URL must be http or https".to_string());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "That URL has no host".to_string())?
        .to_lowercase();

    if allow_private {
        return Ok(());
    }

    let private = host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".internal")
        || host == "0.0.0.0"
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || host == "[::1]"
        || (host.starts_with("172.")
            && host
                .split('.')
                .nth(1)
                .and_then(|o| o.parse::<u8>().ok())
                .is_some_and(|o| (16..=31).contains(&o)));

    if private {
        return Err(
            "That address is on a private network. Set WEBHOOKS_ALLOW_PRIVATE=1 to permit it."
                .to_string(),
        );
    }

    Ok(())
}

fn allow_private() -> bool {
    std::env::var("WEBHOOKS_ALLOW_PRIVATE")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Does `subscription` cover `event`?
/// `crm.deals.create` matches itself, `crm.deals.*` and `crm.*`.
pub fn event_matches(subscription: &str, event: &str) -> bool {
    if subscription == "*" || subscription == event {
        return true;
    }
    if let Some(prefix) = subscription.strip_suffix(".*") {
        return event == prefix || event.starts_with(&format!("{prefix}."));
    }
    false
}

// --------------------------------------------------------------- dispatch ---

/// Queue a delivery for every webhook subscribed to this event.
///
/// Errors are logged, never propagated: an integration must not be able to fail
/// the write that triggered it.
pub async fn dispatch(state: &AppState, ctx: &Ctx, event: &str, record_id: &str, payload: &Value) {
    let rows = match sqlx::query(
        "SELECT id, events FROM webhooks
         WHERE org_id = ? AND is_active = 1 AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "could not load webhooks");
            return;
        }
    };

    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let raw: String = row.try_get("events").unwrap_or_else(|_| "[]".into());
        let events: Vec<String> = serde_json::from_str(&raw).unwrap_or_default();

        if !events.iter().any(|e| event_matches(e, event)) {
            continue;
        }

        let delivery_id = new_id();
        let ts = now();
        if let Err(e) = sqlx::query(
            "INSERT INTO webhook_deliveries (id, org_id, webhook_id, event, record_id, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        )
        .bind(&delivery_id)
        .bind(&ctx.org_id)
        .bind(&id)
        .bind(event)
        .bind(record_id)
        .bind(&ts)
        .bind(&ts)
        .execute(&state.pool)
        .await
        {
            tracing::error!(error = %e, "could not record a webhook delivery");
            continue;
        }

        let body = json!({
            "event": event,
            "record_id": record_id,
            "organization_id": ctx.org_id,
            "occurred_at": ts,
            "actor": { "id": ctx.user_id, "name": ctx.name },
            "data": payload,
        });

        if let Err(e) = crate::jobs::enqueue(
            &state.pool,
            &ctx.org_id,
            &ctx.user_id,
            "webhook_delivery",
            json!({ "delivery_id": delivery_id, "webhook_id": id, "body": body }),
            now(),
            None,
        )
        .await
        {
            tracing::error!(error = %e, "could not queue a webhook delivery");
        }
    }
}

/// Compute the signature a receiver should check.
pub fn sign(secret: &str, timestamp: &str, body: &str) -> String {
    // The timestamp is inside the signed material, so a captured request cannot
    // be replayed later with a fresh timestamp.
    let mut mac = <Hmac<Sha256>>::new_from_slice(secret.as_bytes())
        .expect("HMAC accepts a key of any length");
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body.as_bytes());
    let bytes = mac.finalize().into_bytes();
    use std::fmt::Write;
    bytes.iter().fold(String::new(), |mut acc, b| {
        let _ = write!(acc, "{b:02x}");
        acc
    })
}

/// Run one queued delivery.
pub async fn run_job(state: &AppState, job: &crate::jobs::Job) -> AppResult<()> {
    let delivery_id = job.payload["delivery_id"].as_str().unwrap_or_default().to_string();
    let webhook_id = job.payload["webhook_id"].as_str().unwrap_or_default().to_string();
    let body = job.payload["body"].clone();

    let hook = sqlx::query(
        "SELECT url, secret, is_active FROM webhooks
         WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&job.org_id)
    .bind(&webhook_id)
    .fetch_optional(&state.pool)
    .await?;

    // A webhook deleted or switched off between queueing and delivery simply
    // does not fire. Not an error.
    let Some(hook) = hook else { return Ok(()) };
    if hook.try_get::<i64, _>("is_active").unwrap_or(0) == 0 {
        return Ok(());
    }

    let url: String = hook.try_get("url").unwrap_or_default();
    let secret: String = hook.try_get("secret").unwrap_or_default();

    // Re-check on the way out: a URL that was fine when saved may have been
    // edited, and the setting may have changed.
    if let Err(reason) = check_url(&url, allow_private()) {
        record_failure(&state.pool, &job.org_id, &webhook_id, &delivery_id, None, &reason).await;
        return Err(AppError::bad_request(reason));
    }

    let payload = serde_json::to_string(&body).unwrap_or_else(|_| "{}".into());
    let timestamp = Utc::now().timestamp().to_string();
    let signature = sign(&secret, &timestamp, &payload);

    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        // A receiver that redirects could redirect inward.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| AppError::Other(anyhow::anyhow!("http client: {e}")))?;

    let started = std::time::Instant::now();
    let response = client
        .post(&url)
        .header("content-type", "application/json")
        .header("user-agent", "Meridian-Webhook/1.0")
        .header("x-meridian-event", body["event"].as_str().unwrap_or_default())
        .header("x-meridian-timestamp", &timestamp)
        .header("x-meridian-signature", format!("sha256={signature}"))
        .header("x-meridian-delivery", &delivery_id)
        .body(payload)
        .send()
        .await;

    let elapsed = started.elapsed().as_millis() as i64;

    match response {
        Ok(res) if res.status().is_success() => {
            let code = res.status().as_u16() as i64;
            sqlx::query(
                "UPDATE webhook_deliveries
                    SET status = 'delivered', response_code = ?, duration_ms = ?,
                        attempts = attempts + 1, error = NULL, updated_at = ?
                  WHERE id = ?",
            )
            .bind(code)
            .bind(elapsed)
            .bind(now())
            .bind(&delivery_id)
            .execute(&state.pool)
            .await?;

            sqlx::query(
                "UPDATE webhooks
                    SET last_status = ?, last_delivered_at = ?, last_error = NULL,
                        failure_streak = 0, delivered_count = delivered_count + 1, updated_at = ?
                  WHERE id = ?",
            )
            .bind(code)
            .bind(now())
            .bind(now())
            .bind(&webhook_id)
            .execute(&state.pool)
            .await?;

            Ok(())
        }
        Ok(res) => {
            let code = res.status().as_u16() as i64;
            let reason = format!("Endpoint answered {code}");
            record_failure(&state.pool, &job.org_id, &webhook_id, &delivery_id, Some(code), &reason).await;
            Err(AppError::bad_request(reason))
        }
        Err(e) => {
            let reason = if e.is_timeout() {
                "Endpoint did not answer in time".to_string()
            } else {
                format!("Could not reach the endpoint: {e}")
            };
            record_failure(&state.pool, &job.org_id, &webhook_id, &delivery_id, None, &reason).await;
            Err(AppError::bad_request(reason))
        }
    }
}

async fn record_failure(
    pool: &SqlitePool,
    org_id: &str,
    webhook_id: &str,
    delivery_id: &str,
    code: Option<i64>,
    reason: &str,
) {
    let _ = sqlx::query(
        "UPDATE webhook_deliveries
            SET status = 'failed', response_code = ?, error = ?, attempts = attempts + 1, updated_at = ?
          WHERE id = ?",
    )
    .bind(code)
    .bind(reason)
    .bind(now())
    .bind(delivery_id)
    .execute(pool)
    .await;

    let _ = sqlx::query(
        "UPDATE webhooks
            SET last_status = ?, last_error = ?, failure_streak = failure_streak + 1, updated_at = ?
          WHERE org_id = ? AND id = ?",
    )
    .bind(code)
    .bind(reason)
    .bind(now())
    .bind(org_id)
    .bind(webhook_id)
    .execute(pool)
    .await;

    // An endpoint that has never worked should stop being retried forever.
    let _ = sqlx::query(
        "UPDATE webhooks SET is_active = 0,
                last_error = 'Disabled automatically after repeated failures'
          WHERE org_id = ? AND id = ? AND failure_streak >= ?",
    )
    .bind(org_id)
    .bind(webhook_id)
    .bind(FAILURE_LIMIT)
    .execute(pool)
    .await;
}

// -------------------------------------------------------------------- CRUD ---

#[derive(Deserialize)]
pub struct WebhookBody {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default = "yes")]
    pub is_active: bool,
}

fn yes() -> bool {
    true
}

fn validate(state: &AppState, body: &WebhookBody) -> AppResult<()> {
    let mut errors = Vec::new();

    if body.name.trim().is_empty() {
        errors.push(FieldError::new("name", "Give this webhook a name"));
    }
    if let Err(reason) = check_url(&body.url, allow_private()) {
        errors.push(FieldError::new("url", reason));
    }
    if body.events.is_empty() {
        errors.push(FieldError::new("events", "Choose at least one event"));
    }

    // An event naming an entity that does not exist would never fire.
    for event in &body.events {
        if event == "*" {
            continue;
        }
        let target = event
            .strip_suffix(".create")
            .or_else(|| event.strip_suffix(".update"))
            .or_else(|| event.strip_suffix(".delete"))
            .unwrap_or(event);
        let target = target.strip_suffix(".*").unwrap_or(target);

        if state.registry.get(target).is_none() {
            errors.push(FieldError::new(
                "events",
                format!("`{event}` does not name a record type"),
            ));
        }
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(errors))
    }
}

fn row_to_json(r: &sqlx::sqlite::SqliteRow) -> Value {
    let events: String = r.try_get("events").unwrap_or_else(|_| "[]".into());
    json!({
        "id": r.try_get::<String, _>("id").unwrap_or_default(),
        "name": r.try_get::<String, _>("name").unwrap_or_default(),
        "url": r.try_get::<String, _>("url").unwrap_or_default(),
        "events": serde_json::from_str::<Value>(&events).unwrap_or(json!([])),
        "is_active": r.try_get::<i64, _>("is_active").unwrap_or(0) != 0,
        "last_status": r.try_get::<Option<i64>, _>("last_status").ok().flatten(),
        "last_error": r.try_get::<Option<String>, _>("last_error").ok().flatten(),
        "last_delivered_at": r.try_get::<Option<String>, _>("last_delivered_at").ok().flatten(),
        "failure_streak": r.try_get::<i64, _>("failure_streak").unwrap_or(0),
        "delivered_count": r.try_get::<i64, _>("delivered_count").unwrap_or(0),
        // The secret is never returned after creation.
    })
}

async fn list(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let rows = sqlx::query(
        "SELECT * FROM webhooks WHERE org_id = ? AND deleted_at IS NULL ORDER BY name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    // Which events can be subscribed to, straight from the registry.
    let events: Vec<Value> = state
        .registry
        .entities()
        .filter(|e| !e.embedded && !e.read_only)
        .map(|e| {
            json!({
                "entity": e.key,
                "label": e.label_plural,
                "icon": e.icon,
                "events": [
                    format!("{}.create", e.key),
                    format!("{}.update", e.key),
                    format!("{}.delete", e.key),
                ],
                "all": format!("{}.*", e.key),
            })
        })
        .collect();

    Ok(Json(json!({
        "data": rows.iter().map(row_to_json).collect::<Vec<_>>(),
        "available_events": events,
        "allow_private": allow_private(),
    })))
}

async fn create(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<WebhookBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    validate(&state, &body)?;

    let id = new_id();
    let secret = crate::auth::password::random_token();
    let ts = now();

    sqlx::query(
        "INSERT INTO webhooks (id, org_id, name, url, secret, events, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(body.name.trim())
    .bind(body.url.trim())
    .bind(&secret)
    .bind(serde_json::to_string(&body.events).unwrap_or_else(|_| "[]".into()))
    .bind(i64::from(body.is_active))
    .bind(&ts)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.webhooks", &id, "create",
        Some(format!("Created webhook \"{}\"", body.name.trim())), None).await?;

    Ok(Json(json!({
        "id": id,
        "name": body.name.trim(),
        "url": body.url.trim(),
        // Shown once. The receiver needs it to verify signatures, and it is not
        // returned by any later read.
        "secret": secret,
    })))
}

async fn update(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let existing = sqlx::query("SELECT * FROM webhooks WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Webhook"))?;

    // Re-enabling a webhook clears the failure streak that switched it off.
    let toggling_only = body.as_object().map(|o| o.len() == 1).unwrap_or(false)
        && body.get("is_active").is_some();

    if toggling_only {
        let active = body["is_active"].as_bool().unwrap_or(true);
        sqlx::query(
            "UPDATE webhooks SET is_active = ?, failure_streak = CASE WHEN ? THEN 0 ELSE failure_streak END,
                    last_error = CASE WHEN ? THEN NULL ELSE last_error END, updated_at = ?
              WHERE org_id = ? AND id = ?",
        )
        .bind(i64::from(active))
        .bind(active)
        .bind(active)
        .bind(now())
        .bind(&ctx.org_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
        return list(State(state), ctx).await;
    }

    let merged = WebhookBody {
        name: body.get("name").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| existing.try_get("name").unwrap_or_default()),
        url: body.get("url").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| existing.try_get("url").unwrap_or_default()),
        events: body.get("events").and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_else(|| {
                serde_json::from_str(&existing.try_get::<String, _>("events").unwrap_or_default())
                    .unwrap_or_default()
            }),
        is_active: body.get("is_active").and_then(|v| v.as_bool())
            .unwrap_or_else(|| existing.try_get::<i64, _>("is_active").unwrap_or(1) != 0),
    };
    validate(&state, &merged)?;

    sqlx::query(
        "UPDATE webhooks SET name = ?, url = ?, events = ?, is_active = ?, failure_streak = 0,
                last_error = NULL, updated_at = ?, updated_by = ?
          WHERE org_id = ? AND id = ?",
    )
    .bind(merged.name.trim())
    .bind(merged.url.trim())
    .bind(serde_json::to_string(&merged.events).unwrap_or_else(|_| "[]".into()))
    .bind(i64::from(merged.is_active))
    .bind(now())
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    list(State(state), ctx).await
}

async fn destroy(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let res = sqlx::query("UPDATE webhooks SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(now())
        .bind(now())
        .bind(&ctx.org_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("Webhook"));
    }
    audit::record(&state.pool, &ctx, "core.webhooks", &id, "delete",
        Some("Deleted a webhook".into()), None).await?;
    Ok(Json(json!({ "ok": true })))
}

async fn deliveries(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let rows = sqlx::query(
        "SELECT id, event, record_id, status, response_code, error, attempts, duration_ms, created_at
           FROM webhook_deliveries
          WHERE org_id = ? AND webhook_id = ?
          ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(json!({
        "data": rows.iter().map(|r| json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "event": r.try_get::<String, _>("event").unwrap_or_default(),
            "record_id": r.try_get::<Option<String>, _>("record_id").ok().flatten(),
            "status": r.try_get::<String, _>("status").unwrap_or_default(),
            "response_code": r.try_get::<Option<i64>, _>("response_code").ok().flatten(),
            "error": r.try_get::<Option<String>, _>("error").ok().flatten(),
            "attempts": r.try_get::<i64, _>("attempts").unwrap_or(0),
            "duration_ms": r.try_get::<Option<i64>, _>("duration_ms").ok().flatten(),
            "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
        })).collect::<Vec<_>>(),
    })))
}

/// Send a sample payload, so an endpoint can be checked before it matters.
async fn send_test(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let exists = sqlx::query("SELECT 1 FROM webhooks WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?;
    if exists.is_none() {
        return Err(AppError::not_found("Webhook"));
    }

    let delivery_id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO webhook_deliveries (id, org_id, webhook_id, event, status, created_at, updated_at)
         VALUES (?, ?, ?, 'test.ping', 'pending', ?, ?)",
    )
    .bind(&delivery_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .bind(&ts)
    .bind(&ts)
    .execute(&state.pool)
    .await?;

    crate::jobs::enqueue(
        &state.pool,
        &ctx.org_id,
        &ctx.user_id,
        "webhook_delivery",
        json!({
            "delivery_id": delivery_id,
            "webhook_id": id,
            "body": {
                "event": "test.ping",
                "organization_id": ctx.org_id,
                "occurred_at": ts,
                "data": { "message": "This is a test delivery from Meridian." }
            }
        }),
        now(),
        None,
    )
    .await?;

    Ok(Json(json!({ "queued": true, "delivery_id": delivery_id })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subscriptions_match_their_own_events_and_wildcards() {
        assert!(event_matches("crm.deals.create", "crm.deals.create"));
        assert!(event_matches("crm.deals.*", "crm.deals.create"));
        assert!(event_matches("crm.*", "crm.deals.create"));
        assert!(event_matches("*", "anything.at.all"));

        assert!(!event_matches("crm.deals.create", "crm.deals.update"));
        assert!(!event_matches("crm.deals.*", "crm.leads.create"));
        assert!(!event_matches("books.*", "crm.deals.create"));
        // A prefix must end at a dot: `crm.deal.*` is not `crm.deals.create`.
        assert!(!event_matches("crm.deal.*", "crm.deals.create"));
    }

    #[test]
    fn private_and_loopback_addresses_are_refused_by_default() {
        for url in [
            "http://localhost:8080/hook",
            "http://127.0.0.1/hook",
            "http://10.0.0.5/hook",
            "http://192.168.1.10/hook",
            "http://172.16.0.1/hook",
            "http://172.31.255.1/hook",
            // The cloud metadata endpoint: the reason this guard exists.
            "http://169.254.169.254/latest/meta-data/",
            "http://api.internal/hook",
        ] {
            assert!(check_url(url, false).is_err(), "{url} should be refused");
            assert!(check_url(url, true).is_ok(), "{url} should be allowed when opted in");
        }
    }

    #[test]
    fn public_addresses_and_only_http_schemes_are_accepted() {
        assert!(check_url("https://example.com/hook", false).is_ok());
        assert!(check_url("http://example.com:9000/hook", false).is_ok());
        // 172.32 is outside the private range.
        assert!(check_url("http://172.32.0.1/hook", false).is_ok());

        for bad in ["file:///etc/passwd", "ftp://example.com", "gopher://x", "not a url"] {
            assert!(check_url(bad, true).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn the_signature_covers_the_timestamp_and_the_exact_body() {
        let a = sign("secret", "1700000000", r#"{"event":"x"}"#);
        assert_eq!(a.len(), 64, "hex-encoded SHA-256");

        // Deterministic for the same inputs...
        assert_eq!(a, sign("secret", "1700000000", r#"{"event":"x"}"#));
        // ...and different for every part that is signed.
        assert_ne!(a, sign("other", "1700000000", r#"{"event":"x"}"#));
        assert_ne!(a, sign("secret", "1700000001", r#"{"event":"x"}"#), "replay protection");
        assert_ne!(a, sign("secret", "1700000000", r#"{"event":"y"}"#));
    }

    #[test]
    fn a_body_cannot_be_shifted_into_the_timestamp() {
        // Without a separator, ("12", "3body") and ("123", "body") would sign
        // identically, letting a receiver be fooled about the timestamp.
        assert_ne!(sign("k", "12", "3body"), sign("k", "123", "body"));
    }
}
