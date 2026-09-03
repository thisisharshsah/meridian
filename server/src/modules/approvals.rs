//! Approval chains.
//!
//! A rule says: on this entity, when a record matches these conditions, someone
//! holding this role has to decide. The decision writes back onto the record —
//! an expense claim over a threshold sits at `submitted` until a Finance user
//! approves it, at which point its status becomes `approved`.
//!
//! Conditions reuse the automation engine's evaluator, so the two features
//! agree about what "amount is at least 1000" means, and a condition validated
//! for one is valid for the other.

use axum::extract::{Path, Query, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::auth::ctx::{Action, Ctx};
use crate::common::audit;
use crate::common::ids::new_id;
use crate::engine::value::{bind_one, to_bind};
use crate::error::{AppError, AppResult, FieldError};
use crate::modules::automations::{evaluate, normalise_conditions, Conditions, OPS};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/approvals", get(queue))
        .route("/approvals/{id}/decide", post(decide))
        .route("/settings/approval-rules", get(list_rules).post(create_rule))
        .route(
            "/settings/approval-rules/{id}",
            axum::routing::patch(update_rule).delete(delete_rule),
        )
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Only called after `validate` has confirmed the entity exists.
fn def_for<'a>(state: &'a AppState, entity: &str) -> &'a crate::engine::schema::EntityDef {
    state
        .registry
        .get(entity)
        .expect("validate() rejects an unknown entity before this point")
}

// ---------------------------------------------------------------- raising ---

/// Raise approval requests for any rule this record now matches.
///
/// Called from the write path. Failures are logged rather than propagated: a
/// misconfigured approval rule must not be able to fail someone's save.
pub async fn evaluate_record(
    state: &AppState,
    ctx: &Ctx,
    entity: &str,
    record_id: &str,
    record: &Value,
    before: Option<&Value>,
) {
    let rows = match sqlx::query(
        "SELECT id, name, conditions FROM approval_rules
         WHERE org_id = ? AND entity = ? AND is_active = 1 AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(entity)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "could not load approval rules");
            return;
        }
    };

    for row in rows {
        let rule_id: String = row.try_get("id").unwrap_or_default();
        let name: String = row.try_get("name").unwrap_or_default();
        let raw: String = row.try_get("conditions").unwrap_or_else(|_| "{}".into());
        let conditions: Conditions = serde_json::from_str(&raw).unwrap_or(Conditions {
            r#match: "all".into(),
            rules: vec![],
        });

        if !evaluate(&conditions, record, before) {
            continue;
        }

        let title = record
            .get("name")
            .or_else(|| record.get("full_name"))
            .or_else(|| record.get("subject"))
            .or_else(|| record.get("description"))
            .or_else(|| record.get("number"))
            .and_then(|v| v.as_str())
            .unwrap_or("Untitled")
            .to_string();

        // The partial unique index makes a second pending request for the same
        // record a no-op rather than a duplicate in someone's queue.
        let result = sqlx::query(
            "INSERT INTO approval_requests
                (id, org_id, rule_id, entity, record_id, record_title, summary, status,
                 requested_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
        )
        .bind(new_id())
        .bind(&ctx.org_id)
        .bind(&rule_id)
        .bind(entity)
        .bind(record_id)
        .bind(&title)
        .bind(format!("Needs approval under \"{name}\""))
        .bind(&ctx.user_id)
        .bind(now())
        .bind(now())
        .execute(&state.pool)
        .await;

        match result {
            Ok(_) => {
                let _ = audit::record(
                    &state.pool,
                    ctx,
                    entity,
                    record_id,
                    "approval_requested",
                    Some(format!("Sent for approval under \"{name}\"")),
                    None,
                )
                .await;
            }
            Err(sqlx::Error::Database(e)) if e.message().contains("UNIQUE constraint failed") => {
                // Already awaiting a decision. Nothing to do.
            }
            Err(e) => tracing::error!(error = %e, "could not raise an approval request"),
        }
    }
}

// ------------------------------------------------------------------ queue ---

#[derive(Deserialize, Default)]
pub struct QueueParams {
    /// `pending` (default), `decided`, or `mine` for requests you raised.
    #[serde(default)]
    pub scope: Option<String>,
}

/// What this user can decide, plus what they have asked for.
///
/// A request is decidable if its rule names your role, names you personally, or
/// names nobody — and an owner can always unblock their own workspace.
async fn queue(
    State(state): State<AppState>,
    ctx: Ctx,
    Query(params): Query<QueueParams>,
) -> AppResult<Json<Value>> {
    let scope = params.scope.as_deref().unwrap_or("pending");

    let role_id: Option<String> = sqlx::query(
        "SELECT role_id FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.user_id)
    .fetch_optional(&state.pool)
    .await?
    .and_then(|r| r.try_get("role_id").ok());

    let sql = match scope {
        "mine" => {
            "SELECT r.*, ar.name AS rule_name, u.name AS requested_by_name, d.name AS decided_by_name
               FROM approval_requests r
               JOIN approval_rules ar ON ar.id = r.rule_id
               LEFT JOIN users u ON u.id = r.requested_by
               LEFT JOIN users d ON d.id = r.decided_by
              WHERE r.org_id = ?1 AND r.requested_by = ?2
              ORDER BY r.created_at DESC LIMIT 100"
        }
        "decided" => {
            "SELECT r.*, ar.name AS rule_name, u.name AS requested_by_name, d.name AS decided_by_name
               FROM approval_requests r
               JOIN approval_rules ar ON ar.id = r.rule_id
               LEFT JOIN users u ON u.id = r.requested_by
               LEFT JOIN users d ON d.id = r.decided_by
              WHERE r.org_id = ?1 AND r.status <> 'pending'
                AND (?4 = 1 OR ar.approver_user_id = ?2 OR ar.approver_role_id = ?3
                     OR (ar.approver_user_id IS NULL AND ar.approver_role_id IS NULL))
              ORDER BY r.decided_at DESC LIMIT 100"
        }
        _ => {
            "SELECT r.*, ar.name AS rule_name, u.name AS requested_by_name, d.name AS decided_by_name
               FROM approval_requests r
               JOIN approval_rules ar ON ar.id = r.rule_id
               LEFT JOIN users u ON u.id = r.requested_by
               LEFT JOIN users d ON d.id = r.decided_by
              WHERE r.org_id = ?1 AND r.status = 'pending'
                AND (?4 = 1 OR ar.approver_user_id = ?2 OR ar.approver_role_id = ?3
                     OR (ar.approver_user_id IS NULL AND ar.approver_role_id IS NULL))
              ORDER BY r.created_at LIMIT 100"
        }
    };

    let rows = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
        .bind(&ctx.org_id)
        .bind(&ctx.user_id)
        .bind(&role_id)
        .bind(i64::from(ctx.is_owner))
        .fetch_all(&state.pool)
        .await?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "rule_name": r.try_get::<Option<String>, _>("rule_name").ok().flatten(),
                "entity": r.try_get::<String, _>("entity").unwrap_or_default(),
                "record_id": r.try_get::<String, _>("record_id").unwrap_or_default(),
                "record_title": r.try_get::<Option<String>, _>("record_title").ok().flatten(),
                "summary": r.try_get::<Option<String>, _>("summary").ok().flatten(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "requested_by_name": r.try_get::<Option<String>, _>("requested_by_name").ok().flatten(),
                "decided_by_name": r.try_get::<Option<String>, _>("decided_by_name").ok().flatten(),
                "decided_at": r.try_get::<Option<String>, _>("decided_at").ok().flatten(),
                "comment": r.try_get::<Option<String>, _>("comment").ok().flatten(),
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data, "scope": scope })))
}

#[derive(Deserialize)]
pub struct DecisionBody {
    /// `approve` or `reject`.
    pub decision: String,
    #[serde(default)]
    pub comment: Option<String>,
}

/// Decide one request, writing the outcome onto the record.
async fn decide(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<DecisionBody>,
) -> AppResult<Json<Value>> {
    let approve = match body.decision.as_str() {
        "approve" => true,
        "reject" => false,
        _ => return Err(AppError::bad_request("Decision must be approve or reject")),
    };

    let row = sqlx::query(
        "SELECT r.status, r.entity, r.record_id, r.requested_by, r.rule_id,
                ar.name AS rule_name, ar.approver_role_id, ar.approver_user_id,
                ar.decision_field, ar.approved_value, ar.rejected_value
           FROM approval_requests r
           JOIN approval_rules ar ON ar.id = r.rule_id
          WHERE r.org_id = ? AND r.id = ?",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Approval request"))?;

    let status: String = row.try_get("status").unwrap_or_default();
    if status != "pending" {
        return Err(AppError::conflict(format!("This request was already {status}")));
    }

    // May this person decide?
    let approver_user: Option<String> = row.try_get("approver_user_id").ok().flatten();
    let approver_role: Option<String> = row.try_get("approver_role_id").ok().flatten();

    let my_role: Option<String> = sqlx::query(
        "SELECT role_id FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.user_id)
    .fetch_optional(&state.pool)
    .await?
    .and_then(|r| r.try_get("role_id").ok());

    let allowed = ctx.is_owner
        || approver_user.as_deref() == Some(ctx.user_id.as_str())
        || (approver_role.is_some() && approver_role == my_role)
        || (approver_user.is_none() && approver_role.is_none());

    if !allowed {
        return Err(AppError::forbidden("This approval is not yours to decide"));
    }

    // Being the approver says who may decide; it does not by itself grant the
    // right to write the record. A rule naming no approver is decidable by any
    // active member, so without this a support user could set an expense to
    // `approved` on a module they cannot otherwise touch.
    let entity_for_check: String = row.try_get("entity").unwrap_or_default();
    ctx.require(&entity_for_check, Action::Edit)?;

    let entity: String = row.try_get("entity").unwrap_or_default();
    let record_id: String = row.try_get("record_id").unwrap_or_default();
    let field: String = row.try_get("decision_field").unwrap_or_default();
    let value: String = if approve {
        row.try_get("approved_value").unwrap_or_default()
    } else {
        row.try_get("rejected_value").unwrap_or_default()
    };

    let def = state
        .registry
        .get(&entity)
        .ok_or_else(|| AppError::not_found(format!("Entity `{entity}`")))?;
    let field_def = def
        .field(&field)
        .ok_or_else(|| AppError::bad_request(format!("`{field}` is not a field on {}", def.label)))?;

    let bind = to_bind(field_def, &Value::String(value.clone()))
        .map_err(|e| AppError::bad_request(format!("{}: {}", e.field, e.message)))?;

    let mut tx = state.pool.begin().await?;

    // Write the decision onto the record directly. Going back through the
    // engine's update path would re-evaluate approval rules and raise a fresh
    // request for the record that was just decided.
    let sql = format!(
        "UPDATE \"{}\" SET \"{}\" = ?, updated_at = ?, updated_by = ? WHERE org_id = ? AND id = ?",
        def.table, field_def.name
    );
    let q = sqlx::query(sqlx::AssertSqlSafe(sql));
    bind_one(q, &bind)
        .bind(now())
        .bind(&ctx.user_id)
        .bind(&ctx.org_id)
        .bind(&record_id)
        .execute(&mut *tx)
        .await?;

    // `status = 'pending'` in the predicate, not only in the read above: two
    // people clicking at once would otherwise both succeed, and the record
    // would take whichever decision landed second.
    let decided = sqlx::query(
        "UPDATE approval_requests
            SET status = ?, decided_by = ?, decided_at = ?, comment = ?, updated_at = ?
          WHERE org_id = ? AND id = ? AND status = 'pending'",
    )
    .bind(if approve { "approved" } else { "rejected" })
    .bind(&ctx.user_id)
    .bind(now())
    .bind(&body.comment)
    .bind(now())
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;

    if decided.rows_affected() == 0 {
        // Someone else got there first; the field write rolls back with the tx.
        return Err(AppError::conflict("This request was already decided"));
    }

    tx.commit().await?;

    // Derived values may depend on the field just written.
    crate::modules::hooks::after_write(&state.pool, &ctx, def.key, &record_id).await?;

    let rule_name: String = row.try_get("rule_name").unwrap_or_default();
    audit::record(
        &state.pool,
        &ctx,
        &entity,
        &record_id,
        if approve { "approved" } else { "rejected" },
        Some(format!(
            "{} under \"{rule_name}\"{}",
            if approve { "Approved" } else { "Rejected" },
            body.comment
                .as_deref()
                .filter(|c| !c.trim().is_empty())
                .map(|c| format!(": {c}"))
                .unwrap_or_default()
        )),
        None,
    )
    .await?;

    Ok(Json(json!({
        "status": if approve { "approved" } else { "rejected" },
        "entity": entity,
        "record_id": record_id,
        "field": field,
        "value": value,
    })))
}

// ------------------------------------------------------------------ rules ---

#[derive(Deserialize)]
pub struct RuleBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub entity: String,
    #[serde(default)]
    pub conditions: Value,
    pub decision_field: String,
    pub approved_value: String,
    pub rejected_value: String,
    #[serde(default)]
    pub approver_role_id: Option<String>,
    #[serde(default)]
    pub approver_user_id: Option<String>,
    #[serde(default = "yes")]
    pub is_active: bool,
}

fn yes() -> bool {
    true
}

fn validate(state: &AppState, body: &RuleBody) -> AppResult<()> {
    let mut errors = Vec::new();

    if body.name.trim().is_empty() {
        errors.push(FieldError::new("name", "Give this rule a name"));
    }

    let Some(def) = state.registry.get(&body.entity) else {
        errors.push(FieldError::new("entity", "Choose a record type"));
        return Err(AppError::Validation(errors));
    };

    // The decision has to land somewhere real and writable.
    match def.field(&body.decision_field) {
        None => errors.push(FieldError::new(
            "decision_field",
            format!("`{}` is not a field on {}", body.decision_field, def.label),
        )),
        Some(f) if f.readonly => errors.push(FieldError::new(
            "decision_field",
            format!("{} is computed by the server", f.label),
        )),
        Some(f) => {
            // Both outcomes must be values the field can actually hold, or the
            // decision would fail at the moment somebody clicks approve.
            for (key, value) in [
                ("approved_value", &body.approved_value),
                ("rejected_value", &body.rejected_value),
            ] {
                if let Err(e) = to_bind(f, &Value::String(value.clone())) {
                    errors.push(FieldError::new(key, e.message));
                }
            }
            if body.approved_value == body.rejected_value {
                errors.push(FieldError::new(
                    "rejected_value",
                    "Approving and rejecting must not write the same value",
                ));
            }
        }
    }

    if let Ok(conditions) = serde_json::from_value::<Conditions>(body.conditions.clone()) {
        for (i, rule) in conditions.rules.iter().enumerate() {
            if def.field(&rule.field).is_none() {
                errors.push(FieldError::new(
                    format!("conditions.{i}.field"),
                    format!("`{}` is not a field on {}", rule.field, def.label),
                ));
            }
            if !OPS.contains(&rule.op.as_str()) {
                errors.push(FieldError::new(
                    format!("conditions.{i}.op"),
                    format!("`{}` is not a comparison", rule.op),
                ));
            }
            // Scaled kinds must be coercible, or the threshold means something
            // other than what was typed. See automations::normalise_conditions.
            if !matches!(rule.op.as_str(), "is_empty" | "is_not_empty" | "changed") {
                if let Some(f) = def.field(&rule.field) {
                    if let Err(e) = to_bind(f, &rule.value) {
                        errors.push(FieldError::new(format!("conditions.{i}.value"), e.message));
                    }
                }
            }
        }
    } else {
        errors.push(FieldError::new("conditions", "Conditions are malformed"));
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(errors))
    }
}

fn rule_to_json(r: &sqlx::sqlite::SqliteRow) -> Value {
    let conditions: String = r.try_get("conditions").unwrap_or_else(|_| "{}".into());
    json!({
        "id": r.try_get::<String, _>("id").unwrap_or_default(),
        "name": r.try_get::<String, _>("name").unwrap_or_default(),
        "description": r.try_get::<Option<String>, _>("description").ok().flatten(),
        "entity": r.try_get::<String, _>("entity").unwrap_or_default(),
        "conditions": serde_json::from_str::<Value>(&conditions).unwrap_or(json!({})),
        "decision_field": r.try_get::<String, _>("decision_field").unwrap_or_default(),
        "approved_value": r.try_get::<String, _>("approved_value").unwrap_or_default(),
        "rejected_value": r.try_get::<String, _>("rejected_value").unwrap_or_default(),
        "approver_role_id": r.try_get::<Option<String>, _>("approver_role_id").ok().flatten(),
        "approver_user_id": r.try_get::<Option<String>, _>("approver_user_id").ok().flatten(),
        "approver_role_name": r.try_get::<Option<String>, _>("approver_role_name").ok().flatten(),
        "is_active": r.try_get::<i64, _>("is_active").unwrap_or(0) != 0,
        "pending_count": r.try_get::<i64, _>("pending_count").unwrap_or(0),
    })
}

async fn list_rules(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let rows = sqlx::query(
        "SELECT ar.*, r.name AS approver_role_name,
                (SELECT COUNT(*) FROM approval_requests q
                  WHERE q.rule_id = ar.id AND q.status = 'pending') AS pending_count
           FROM approval_rules ar
           LEFT JOIN roles r ON r.id = ar.approver_role_id
          WHERE ar.org_id = ? AND ar.deleted_at IS NULL
          ORDER BY ar.entity, ar.name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    let entities: Vec<Value> = state
        .registry
        .entities()
        .filter(|e| !e.embedded && !e.read_only && ctx.can(e.key, Action::View))
        .map(|e| {
            json!({
                "key": e.key,
                "label": e.label_plural,
                "icon": e.icon,
                // Only select fields make sense as a decision target: an
                // approval writes one of two known states.
                "decision_fields": e.fields.iter().filter(|f| {
                    !f.readonly && matches!(f.kind, crate::engine::schema::FieldKind::Select { .. })
                }).map(|f| json!({ "name": f.name, "label": f.label, "kind": f.kind })).collect::<Vec<_>>(),
            })
        })
        .collect();

    Ok(Json(json!({
        "data": rows.iter().map(rule_to_json).collect::<Vec<_>>(),
        "entities": entities,
    })))
}

async fn create_rule(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<RuleBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    validate(&state, &body)?;

    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO approval_rules
            (id, org_id, name, description, entity, conditions, approver_role_id, approver_user_id,
             decision_field, approved_value, rejected_value, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(body.name.trim())
    .bind(&body.description)
    .bind(&body.entity)
    .bind(normalise_conditions(def_for(&state, &body.entity), &body.conditions).to_string())
    .bind(&body.approver_role_id)
    .bind(&body.approver_user_id)
    .bind(&body.decision_field)
    .bind(&body.approved_value)
    .bind(&body.rejected_value)
    .bind(i64::from(body.is_active))
    .bind(&ts)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.approval_rules", &id, "create",
        Some(format!("Created approval rule \"{}\"", body.name.trim())), None).await?;

    list_rules(State(state), ctx).await
}

async fn update_rule(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let existing = sqlx::query("SELECT * FROM approval_rules WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Approval rule"))?;

    if let (Some(active), 1) = (
        body.get("is_active").and_then(|v| v.as_bool()),
        body.as_object().map(|o| o.len()).unwrap_or(0),
    ) {
        sqlx::query("UPDATE approval_rules SET is_active = ?, updated_at = ? WHERE org_id = ? AND id = ?")
            .bind(i64::from(active))
            .bind(now())
            .bind(&ctx.org_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
        return list_rules(State(state), ctx).await;
    }

    let str_of = |key: &str, fallback: &str| -> String {
        body.get(key)
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| existing.try_get(fallback).unwrap_or_default())
    };

    let merged = RuleBody {
        name: str_of("name", "name"),
        description: body.get("description").and_then(|v| v.as_str()).map(str::to_string),
        entity: str_of("entity", "entity"),
        conditions: body.get("conditions").cloned().unwrap_or_else(|| {
            serde_json::from_str(&existing.try_get::<String, _>("conditions").unwrap_or_default())
                .unwrap_or(json!({}))
        }),
        decision_field: str_of("decision_field", "decision_field"),
        approved_value: str_of("approved_value", "approved_value"),
        rejected_value: str_of("rejected_value", "rejected_value"),
        approver_role_id: body.get("approver_role_id").and_then(|v| v.as_str()).map(str::to_string)
            .or_else(|| existing.try_get("approver_role_id").ok().flatten()),
        approver_user_id: body.get("approver_user_id").and_then(|v| v.as_str()).map(str::to_string)
            .or_else(|| existing.try_get("approver_user_id").ok().flatten()),
        is_active: body.get("is_active").and_then(|v| v.as_bool())
            .unwrap_or_else(|| existing.try_get::<i64, _>("is_active").unwrap_or(1) != 0),
    };
    validate(&state, &merged)?;

    sqlx::query(
        "UPDATE approval_rules SET name = ?, description = ?, entity = ?, conditions = ?,
                approver_role_id = ?, approver_user_id = ?, decision_field = ?,
                approved_value = ?, rejected_value = ?, is_active = ?, updated_at = ?, updated_by = ?
          WHERE org_id = ? AND id = ?",
    )
    .bind(merged.name.trim())
    .bind(&merged.description)
    .bind(&merged.entity)
    .bind(normalise_conditions(def_for(&state, &merged.entity), &merged.conditions).to_string())
    .bind(&merged.approver_role_id)
    .bind(&merged.approver_user_id)
    .bind(&merged.decision_field)
    .bind(&merged.approved_value)
    .bind(&merged.rejected_value)
    .bind(i64::from(merged.is_active))
    .bind(now())
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    list_rules(State(state), ctx).await
}

async fn delete_rule(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    // Requests already raised are cancelled with the rule, so nothing is left
    // waiting on a decision nobody can make any more.
    let mut tx = state.pool.begin().await?;
    let res = sqlx::query("UPDATE approval_rules SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(now())
        .bind(now())
        .bind(&ctx.org_id)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("Approval rule"));
    }
    sqlx::query(
        "UPDATE approval_requests SET status = 'cancelled', updated_at = ?
          WHERE org_id = ? AND rule_id = ? AND status = 'pending'",
    )
    .bind(now())
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    audit::record(&state.pool, &ctx, "core.approval_rules", &id, "delete",
        Some("Deleted an approval rule".into()), None).await?;

    list_rules(State(state), ctx).await
}
