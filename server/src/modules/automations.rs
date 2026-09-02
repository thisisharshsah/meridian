//! The automation engine: user-defined rules over any entity.
//!
//! A rule reads "on `crm.deals`, when a record is updated, if Stage changed to
//! Closed won, then set Probability to 100 and create a task to send the
//! paperwork". Because the registry already describes every entity and field,
//! the rule builder needs no per-module code and a rule cannot name a field
//! that does not exist — that is checked when the rule is saved, not when it
//! fires.
//!
//! Rules run once, on the write that triggered them. Field updates they make do
//! *not* re-trigger automations. That rules out loops entirely, at the cost of
//! chaining — a predictable trade, and the one worth making first.

use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sqlx::Row;

use crate::auth::ctx::{Action, Ctx};
use crate::common::audit;
use crate::common::ids::new_id;
use crate::engine::schema::{EntityDef, FieldKind};
use crate::engine::value::{bind_one, to_bind, Bind};
use crate::error::{AppError, AppResult, FieldError};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/automations", get(list).post(create))
        .route(
            "/settings/automations/{id}",
            get(show).patch(update).delete(destroy),
        )
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

// ----------------------------------------------------------------- shapes ---

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Trigger {
    OnCreate,
    OnUpdate,
}

fn trigger_matches(stored: &str, fired: Trigger) -> bool {
    match stored {
        "on_create" => fired == Trigger::OnCreate,
        "on_update" => fired == Trigger::OnUpdate,
        "on_create_or_update" => true,
        _ => false,
    }
}

/// One condition. `changed` and `changed_to` only mean anything on an update,
/// where there is a previous value to compare against.
#[derive(Debug, Deserialize)]
pub struct Rule {
    pub field: String,
    pub op: String,
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Deserialize)]
pub struct Conditions {
    #[serde(default = "default_match")]
    pub r#match: String,
    #[serde(default)]
    pub rules: Vec<Rule>,
}

fn default_match() -> String {
    "all".to_string()
}

pub const OPS: &[&str] = &[
    "eq", "ne", "gt", "gte", "lt", "lte", "contains", "is_empty", "is_not_empty", "changed",
    "changed_to",
];

const ACTION_TYPES: &[&str] = &["set_field", "create_task"];

// ------------------------------------------------------------- evaluation ---

/// Compare two JSON values numerically when both look like numbers, and as
/// lowercased text otherwise. Scaled integers (money, percent) compare
/// correctly because both sides are in the same scale.
fn compare(a: &Value, b: &Value) -> Option<std::cmp::Ordering> {
    if let (Some(x), Some(y)) = (as_number(a), as_number(b)) {
        return x.partial_cmp(&y);
    }
    let (x, y) = (as_text(a), as_text(b));
    Some(x.cmp(&y))
}

fn as_number(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        Value::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        _ => None,
    }
}

fn as_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.to_lowercase(),
        Value::Null => String::new(),
        other => other.to_string().to_lowercase(),
    }
}

fn is_empty(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::String(s) => s.trim().is_empty(),
        Value::Array(a) => a.is_empty(),
        _ => false,
    }
}

/// A rule's condition set, against the record as it now is and (on an update)
/// as it was.
pub fn evaluate(conditions: &Conditions, after: &Value, before: Option<&Value>) -> bool {
    if conditions.rules.is_empty() {
        return true;
    }
    let any = conditions.r#match == "any";
    let mut matched_any = false;

    for rule in &conditions.rules {
        let current = after.get(&rule.field).cloned().unwrap_or(Value::Null);
        let previous = before.and_then(|b| b.get(&rule.field)).cloned();

        let ok = match rule.op.as_str() {
            "eq" => compare(&current, &rule.value) == Some(std::cmp::Ordering::Equal),
            "ne" => compare(&current, &rule.value) != Some(std::cmp::Ordering::Equal),
            "gt" => compare(&current, &rule.value) == Some(std::cmp::Ordering::Greater),
            "gte" => matches!(
                compare(&current, &rule.value),
                Some(std::cmp::Ordering::Greater) | Some(std::cmp::Ordering::Equal)
            ),
            "lt" => compare(&current, &rule.value) == Some(std::cmp::Ordering::Less),
            "lte" => matches!(
                compare(&current, &rule.value),
                Some(std::cmp::Ordering::Less) | Some(std::cmp::Ordering::Equal)
            ),
            "contains" => as_text(&current).contains(&as_text(&rule.value)),
            "is_empty" => is_empty(&current),
            "is_not_empty" => !is_empty(&current),
            // On a create there is no previous value, so nothing "changed".
            "changed" => previous.as_ref().is_some_and(|p| p != &current),
            "changed_to" => {
                previous.as_ref().is_some_and(|p| p != &current)
                    && compare(&current, &rule.value) == Some(std::cmp::Ordering::Equal)
            }
            _ => false,
        };

        if any && ok {
            matched_any = true;
            break;
        }
        if !any && !ok {
            return false;
        }
    }

    if any {
        matched_any
    } else {
        true
    }
}

/// Replace `{{field}}` with the record's value, so a task subject can carry the
/// record it is about. Unknown fields collapse to nothing rather than leaking
/// the placeholder into user-visible text.
fn render(template: &str, record: &Value) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;

    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                let key = after[..end].trim();
                let value = record
                    .get(key)
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Null => String::new(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default();
                out.push_str(&value);
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

// ---------------------------------------------------------------- running ---

#[derive(Debug, Deserialize, serde::Serialize)]
pub struct ActionSpec {
    pub r#type: String,
    #[serde(default)]
    pub field: Option<String>,
    #[serde(default)]
    pub value: Value,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub due_in_days: Option<i64>,
    #[serde(default)]
    pub assign_to: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    /// Run this action later instead of now. The rule's conditions are checked
    /// again when it comes due, so a deal that stopped being won is not chased.
    #[serde(default)]
    pub delay_days: Option<i64>,
}

/// Run every active rule for `entity` against one record.
///
/// Failures are recorded on the rule and logged, never propagated: a broken
/// automation must not be able to fail the user's save.
pub async fn run(
    state: &AppState,
    ctx: &Ctx,
    entity: &str,
    record_id: &str,
    fired: Trigger,
    before: Option<&Value>,
    after: &Value,
) {
    let rows = match sqlx::query(
        "SELECT id, name, trigger, conditions, actions FROM automations
         WHERE org_id = ? AND entity = ? AND is_active = 1 AND deleted_at IS NULL
         ORDER BY created_at",
    )
    .bind(&ctx.org_id)
    .bind(entity)
    .fetch_all(&state.pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!(error = %e, "could not load automations");
            return;
        }
    };

    for row in rows {
        let id: String = row.try_get("id").unwrap_or_default();
        let name: String = row.try_get("name").unwrap_or_default();
        let stored_trigger: String = row.try_get("trigger").unwrap_or_default();
        if !trigger_matches(&stored_trigger, fired) {
            continue;
        }

        let raw_conditions: String = row.try_get("conditions").unwrap_or_else(|_| "{}".into());
        let conditions: Conditions = serde_json::from_str(&raw_conditions).unwrap_or(Conditions {
            r#match: "all".into(),
            rules: vec![],
        });
        if !evaluate(&conditions, after, before) {
            continue;
        }

        let raw_actions: String = row.try_get("actions").unwrap_or_else(|_| "[]".into());
        let actions: Vec<ActionSpec> = serde_json::from_str(&raw_actions).unwrap_or_default();

        // Anything with a delay becomes a job; the rest runs now.
        let (later, now_actions): (Vec<&ActionSpec>, Vec<&ActionSpec>) =
            actions.iter().partition(|a| a.delay_days.unwrap_or(0) > 0);

        for action in &later {
            let days = action.delay_days.unwrap_or(0).clamp(1, 3650);
            let run_at = (Utc::now() + Duration::days(days))
                .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
            // One outstanding job per (rule, record, action) - re-saving a
            // record should not stack up duplicate follow-ups.
            let dedupe = Some(format!("auto:{id}:{record_id}:{}", action.r#type));
            if let Err(e) = crate::jobs::enqueue(
                &state.pool,
                &ctx.org_id,
                &ctx.user_id,
                "automation_action",
                json!({
                    "automation_id": id,
                    "entity": entity,
                    "record_id": record_id,
                    "action": action,
                }),
                run_at,
                dedupe,
            )
            .await
            {
                tracing::warn!(automation = %name, error = %e, "could not schedule an action");
            }
        }

        let owned: Vec<ActionSpec> = now_actions
            .into_iter()
            .map(|a| serde_json::from_value(serde_json::to_value(a).unwrap_or(Value::Null)).unwrap_or(ActionSpec {
                r#type: a.r#type.clone(), field: a.field.clone(), value: a.value.clone(),
                subject: a.subject.clone(), due_in_days: a.due_in_days, assign_to: a.assign_to.clone(),
                priority: a.priority.clone(), delay_days: None,
            }))
            .collect();

        match apply(state, ctx, entity, record_id, after, &owned).await {
            Ok(applied) => {
                let applied = applied + later.len();
                let _ = sqlx::query(
                    "UPDATE automations SET run_count = run_count + 1, last_run_at = ?, last_error = NULL
                     WHERE id = ?",
                )
                .bind(now())
                .bind(&id)
                .execute(&state.pool)
                .await;

                let _ = audit::record(
                    &state.pool,
                    ctx,
                    entity,
                    record_id,
                    "automation",
                    Some(format!("Automation \"{name}\" ran ({applied} action(s))")),
                    None,
                )
                .await;
            }
            Err(e) => {
                // The rule is at fault, not the user's write.
                tracing::warn!(automation = %name, error = %e, "automation failed");
                let _ = sqlx::query(
                    "UPDATE automations SET last_run_at = ?, last_error = ? WHERE id = ?",
                )
                .bind(now())
                .bind(e.to_string())
                .bind(&id)
                .execute(&state.pool)
                .await;
            }
        }
    }
}

async fn apply(
    state: &AppState,
    ctx: &Ctx,
    entity: &str,
    record_id: &str,
    record: &Value,
    actions: &[ActionSpec],
) -> AppResult<usize> {
    let def = state
        .registry
        .get(entity)
        .ok_or_else(|| AppError::not_found(format!("Entity `{entity}`")))?;

    let mut applied = 0usize;
    let mut updates: Vec<(&'static str, Bind)> = Vec::new();

    for action in actions {
        match action.r#type.as_str() {
            "set_field" => {
                let Some(name) = action.field.as_deref() else { continue };
                let Some(field) = def.field(name) else {
                    return Err(AppError::bad_request(format!("Unknown field `{name}`")));
                };
                if field.readonly {
                    return Err(AppError::bad_request(format!(
                        "`{name}` is computed by the server and cannot be set by a rule"
                    )));
                }
                let rendered = match &action.value {
                    Value::String(s) => Value::String(render(s, record)),
                    other => other.clone(),
                };
                let bind = to_bind(field, &rendered)
                    .map_err(|e| AppError::bad_request(format!("{}: {}", e.field, e.message)))?;
                updates.push((field.name, bind));
                applied += 1;
            }

            "create_task" => {
                let subject = action
                    .subject
                    .as_deref()
                    .map(|s| render(s, record))
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("Follow up on {}", title_of(def, record)));

                let due = action
                    .due_in_days
                    .map(|d| (Utc::now() + Duration::days(d.clamp(0, 3650))).format("%Y-%m-%d").to_string());

                // `owner` follows the record; `actor` is whoever made the change.
                let owner = match action.assign_to.as_deref() {
                    Some("actor") => Some(ctx.user_id.clone()),
                    Some("owner") | None => record
                        .get("owner_id")
                        .or_else(|| record.get("assignee_id"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string),
                    Some(explicit) => Some(explicit.to_string()),
                };

                create_activity(state, ctx, entity, record_id, record, &subject, due, owner, action.priority.as_deref()).await?;
                applied += 1;
            }

            other => return Err(AppError::bad_request(format!("Unknown action `{other}`"))),
        }
    }

    if !updates.is_empty() {
        write_fields(state, ctx, def, record_id, &updates).await?;
    }

    Ok(applied)
}

fn title_of(def: &EntityDef, record: &Value) -> String {
    record
        .get(def.title_field)
        .and_then(|v| v.as_str())
        .unwrap_or(def.label)
        .to_string()
}

/// Apply a rule's field updates directly.
///
/// Deliberately not routed back through the engine's update path: that would
/// re-fire automations and open the door to a rule triggering itself. Derived
/// values are recomputed afterwards so totals stay consistent.
async fn write_fields(
    state: &AppState,
    ctx: &Ctx,
    def: &EntityDef,
    record_id: &str,
    updates: &[(&'static str, Bind)],
) -> AppResult<()> {
    let sets: Vec<String> = updates
        .iter()
        .map(|(name, _)| format!("\"{name}\" = ?"))
        .collect();

    let sql = format!(
        "UPDATE \"{}\" SET {}, updated_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
        def.table,
        sets.join(", ")
    );

    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql));
    for (_, bind) in updates {
        q = bind_one(q, bind);
    }
    q.bind(now())
        .bind(&ctx.org_id)
        .bind(record_id)
        .execute(&state.pool)
        .await?;

    crate::modules::hooks::after_write(&state.pool, ctx, def.key, record_id).await?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn create_activity(
    state: &AppState,
    ctx: &Ctx,
    entity: &str,
    record_id: &str,
    record: &Value,
    subject: &str,
    due: Option<String>,
    owner: Option<String>,
    priority: Option<&str>,
) -> AppResult<()> {
    let ts = now();
    // Link the task to whichever CRM parents the source record already names,
    // so it lands on those timelines too.
    let contact = record.get("contact_id").and_then(|v| v.as_str());
    let account = record.get("account_id").and_then(|v| v.as_str());
    let deal = if entity == "crm.deals" {
        Some(record_id)
    } else {
        record.get("deal_id").and_then(|v| v.as_str())
    };

    sqlx::query(
        "INSERT INTO activities (id, org_id, kind, subject, status, priority, due_date, owner_id,
                                 related_entity, related_id, contact_id, account_id, deal_id,
                                 description, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, 'task', ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new_id())
    .bind(&ctx.org_id)
    .bind(subject)
    .bind(priority.unwrap_or("normal"))
    .bind(due)
    .bind(owner)
    .bind(entity)
    .bind(record_id)
    .bind(contact)
    .bind(account)
    .bind(deal)
    .bind("Created automatically by a workflow rule.")
    .bind(&ts)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await?;

    Ok(())
}

/// Run one scheduled action, when its job comes due.
///
/// The rule's conditions are re-checked against the record as it is *now*, not
/// as it was when the action was queued. "Three days after a deal is won, chase
/// the signature" should not chase a deal that has since been lost.
pub async fn run_scheduled(state: &AppState, job: &crate::jobs::Job) -> AppResult<()> {
    let ctx = crate::jobs::context_for(state, job).await?;

    let automation_id = job.payload["automation_id"].as_str().unwrap_or_default();
    let entity = job.payload["entity"].as_str().unwrap_or_default();
    let record_id = job.payload["record_id"].as_str().unwrap_or_default();

    let action: ActionSpec = serde_json::from_value(job.payload["action"].clone())
        .map_err(|e| AppError::bad_request(format!("malformed scheduled action: {e}")))?;

    let Some(def) = state.registry.get(entity) else {
        return Err(AppError::not_found(format!("Entity `{entity}`")));
    };

    // A rule that has been switched off or deleted must not keep acting.
    let rule = sqlx::query(
        "SELECT name, conditions, is_active FROM automations
         WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(automation_id)
    .fetch_optional(&state.pool)
    .await?;

    let Some(rule) = rule else {
        tracing::debug!(automation = %automation_id, "scheduled action skipped: rule was deleted");
        return Ok(());
    };
    if rule.try_get::<i64, _>("is_active").unwrap_or(0) == 0 {
        tracing::debug!(automation = %automation_id, "scheduled action skipped: rule is off");
        return Ok(());
    }

    // The record may have been deleted in the meantime; that is not a failure.
    let record = match crate::engine::repo::get(&state.pool, &state.registry, def, &ctx, record_id).await {
        Ok(r) => r,
        Err(AppError::NotFound(_)) => {
            tracing::debug!(record = %record_id, "scheduled action skipped: record is gone");
            return Ok(());
        }
        Err(e) => return Err(e),
    };

    let raw: String = rule.try_get("conditions").unwrap_or_else(|_| "{}".into());
    let conditions: Conditions = serde_json::from_str(&raw).unwrap_or(Conditions {
        r#match: "all".into(),
        rules: vec![],
    });

    // No `before` here: a delayed action asks "does this still hold", so the
    // change-based operators cannot apply and are treated as unmet.
    if !evaluate(&conditions, &record, None) {
        tracing::debug!(record = %record_id, "scheduled action skipped: conditions no longer hold");
        return Ok(());
    }

    let mut immediate = action;
    immediate.delay_days = None;
    apply(state, &ctx, entity, record_id, &record, &[immediate]).await?;

    let name: String = rule.try_get("name").unwrap_or_default();
    let _ = audit::record(
        &state.pool,
        &ctx,
        entity,
        record_id,
        "automation",
        Some(format!("Scheduled action from \"{name}\" ran")),
        None,
    )
    .await;

    Ok(())
}

// -------------------------------------------------------------------- CRUD ---

#[derive(Deserialize)]
pub struct AutomationBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub entity: String,
    pub trigger: String,
    #[serde(default)]
    pub conditions: Value,
    #[serde(default)]
    pub actions: Value,
    #[serde(default = "yes")]
    pub is_active: bool,
}

fn yes() -> bool {
    true
}

/// Reject a rule that names anything the registry does not have, at save time.
/// A rule that silently never matches is worse than one that will not save.
fn validate(state: &AppState, body: &AutomationBody) -> AppResult<()> {
    let mut errors = Vec::new();

    if body.name.trim().is_empty() {
        errors.push(FieldError::new("name", "Give this rule a name"));
    }
    if !["on_create", "on_update", "on_create_or_update"].contains(&body.trigger.as_str()) {
        errors.push(FieldError::new("trigger", "Choose when this rule should run"));
    }

    let Some(def) = state.registry.get(&body.entity) else {
        errors.push(FieldError::new("entity", "Choose a record type"));
        return Err(AppError::Validation(errors));
    };

    if let Ok(conditions) = serde_json::from_value::<Conditions>(body.conditions.clone()) {
        for (i, rule) in conditions.rules.iter().enumerate() {
            let Some(field) = def.field(&rule.field) else {
                errors.push(FieldError::new(
                    format!("conditions.{i}.field"),
                    format!("`{}` is not a field on {}", rule.field, def.label),
                ));
                continue;
            };
            if !OPS.contains(&rule.op.as_str()) {
                errors.push(FieldError::new(
                    format!("conditions.{i}.op"),
                    format!("`{}` is not a comparison", rule.op),
                ));
            }
            // A select condition comparing against a value outside the list can
            // never be true; say so now.
            if let FieldKind::Select { options } = &field.kind {
                if matches!(rule.op.as_str(), "eq" | "ne" | "changed_to") {
                    if let Some(v) = rule.value.as_str() {
                        if !options.iter().any(|o| o.value == v) {
                            errors.push(FieldError::new(
                                format!("conditions.{i}.value"),
                                format!("`{v}` is not one of {}'s options", field.label),
                            ));
                        }
                    }
                }
            }
        }
    } else {
        errors.push(FieldError::new("conditions", "Conditions are malformed"));
    }

    match serde_json::from_value::<Vec<ActionSpec>>(body.actions.clone()) {
        Ok(actions) => {
            if actions.is_empty() {
                errors.push(FieldError::new("actions", "Add at least one action"));
            }
            for (i, action) in actions.iter().enumerate() {
                if !ACTION_TYPES.contains(&action.r#type.as_str()) {
                    errors.push(FieldError::new(
                        format!("actions.{i}.type"),
                        format!("`{}` is not an action", action.r#type),
                    ));
                    continue;
                }
                if let Some(d) = action.delay_days {
                    if !(0..=3650).contains(&d) {
                        errors.push(FieldError::new(
                            format!("actions.{i}.delay_days"),
                            "Delay must be between 0 and 3650 days",
                        ));
                    }
                }
                if action.r#type == "set_field" {
                    match action.field.as_deref().and_then(|n| def.field(n)) {
                        None => errors.push(FieldError::new(
                            format!("actions.{i}.field"),
                            "Choose a field to set",
                        )),
                        Some(f) if f.readonly => errors.push(FieldError::new(
                            format!("actions.{i}.field"),
                            format!("{} is computed by the server", f.label),
                        )),
                        Some(f) => {
                            if let Err(e) = to_bind(f, &action.value) {
                                errors.push(FieldError::new(
                                    format!("actions.{i}.value"),
                                    e.message,
                                ));
                            }
                        }
                    }
                }
            }
        }
        Err(_) => errors.push(FieldError::new("actions", "Actions are malformed")),
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(errors))
    }
}

fn row_to_json(r: &sqlx::sqlite::SqliteRow) -> Value {
    let conditions: String = r.try_get("conditions").unwrap_or_else(|_| "{}".into());
    let actions: String = r.try_get("actions").unwrap_or_else(|_| "[]".into());
    json!({
        "id": r.try_get::<String, _>("id").unwrap_or_default(),
        "name": r.try_get::<String, _>("name").unwrap_or_default(),
        "description": r.try_get::<Option<String>, _>("description").ok().flatten(),
        "entity": r.try_get::<String, _>("entity").unwrap_or_default(),
        "trigger": r.try_get::<String, _>("trigger").unwrap_or_default(),
        "conditions": serde_json::from_str::<Value>(&conditions).unwrap_or(json!({})),
        "actions": serde_json::from_str::<Value>(&actions).unwrap_or(json!([])),
        "is_active": r.try_get::<i64, _>("is_active").unwrap_or(0) != 0,
        "run_count": r.try_get::<i64, _>("run_count").unwrap_or(0),
        "last_run_at": r.try_get::<Option<String>, _>("last_run_at").ok().flatten(),
        "last_error": r.try_get::<Option<String>, _>("last_error").ok().flatten(),
        "updated_at": r.try_get::<String, _>("updated_at").unwrap_or_default(),
    })
}

async fn list(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let rows = sqlx::query(
        "SELECT * FROM automations WHERE org_id = ? AND deleted_at IS NULL ORDER BY entity, name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    // The builder needs to know what it may offer, and that is the registry's
    // answer rather than a hardcoded list in the browser.
    let entities: Vec<Value> = state
        .registry
        .entities()
        .filter(|e| !e.embedded && !e.read_only && ctx.can(e.key, Action::View))
        .map(|e| json!({ "key": e.key, "label": e.label, "label_plural": e.label_plural, "icon": e.icon }))
        .collect();

    Ok(Json(json!({
        "data": rows.iter().map(row_to_json).collect::<Vec<_>>(),
        "entities": entities,
    })))
}

async fn show(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let row = sqlx::query("SELECT * FROM automations WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Automation"))?;
    Ok(Json(row_to_json(&row)))
}

async fn create(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<AutomationBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    validate(&state, &body)?;

    let id = new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO automations (id, org_id, name, description, entity, trigger, conditions,
                                  actions, is_active, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(body.name.trim())
    .bind(&body.description)
    .bind(&body.entity)
    .bind(&body.trigger)
    .bind(body.conditions.to_string())
    .bind(body.actions.to_string())
    .bind(i64::from(body.is_active))
    .bind(&ts)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.automations", &id, "create",
        Some(format!("Created automation \"{}\"", body.name.trim())), None).await?;

    show(State(state), ctx, Path(id)).await
}

#[derive(Deserialize)]
pub struct PatchBody {
    #[serde(default)]
    pub is_active: Option<bool>,
    #[serde(flatten)]
    pub rest: Map<String, Value>,
}

async fn update(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
    Json(body): Json<Value>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let existing = sqlx::query("SELECT * FROM automations WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Automation"))?;

    // Toggling active is the common case and needs no revalidation.
    if let (Some(active), 1) = (body.get("is_active").and_then(|v| v.as_bool()), body.as_object().map(|o| o.len()).unwrap_or(0)) {
        sqlx::query("UPDATE automations SET is_active = ?, updated_at = ?, updated_by = ? WHERE org_id = ? AND id = ?")
            .bind(i64::from(active))
            .bind(now())
            .bind(&ctx.user_id)
            .bind(&ctx.org_id)
            .bind(&id)
            .execute(&state.pool)
            .await?;
        return show(State(state), ctx, Path(id)).await;
    }

    // A full edit is revalidated against the registry like a create.
    let merged = AutomationBody {
        name: body.get("name").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| existing.try_get("name").unwrap_or_default()),
        description: body.get("description").and_then(|v| v.as_str()).map(str::to_string),
        entity: body.get("entity").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| existing.try_get("entity").unwrap_or_default()),
        trigger: body.get("trigger").and_then(|v| v.as_str()).map(str::to_string)
            .unwrap_or_else(|| existing.try_get("trigger").unwrap_or_default()),
        conditions: body.get("conditions").cloned().unwrap_or_else(|| {
            serde_json::from_str(&existing.try_get::<String, _>("conditions").unwrap_or_default())
                .unwrap_or(json!({}))
        }),
        actions: body.get("actions").cloned().unwrap_or_else(|| {
            serde_json::from_str(&existing.try_get::<String, _>("actions").unwrap_or_default())
                .unwrap_or(json!([]))
        }),
        is_active: body.get("is_active").and_then(|v| v.as_bool())
            .unwrap_or_else(|| existing.try_get::<i64, _>("is_active").unwrap_or(1) != 0),
    };
    validate(&state, &merged)?;

    sqlx::query(
        "UPDATE automations SET name = ?, description = ?, entity = ?, trigger = ?,
                conditions = ?, actions = ?, is_active = ?, updated_at = ?, updated_by = ?,
                last_error = NULL
         WHERE org_id = ? AND id = ?",
    )
    .bind(merged.name.trim())
    .bind(&merged.description)
    .bind(&merged.entity)
    .bind(&merged.trigger)
    .bind(merged.conditions.to_string())
    .bind(merged.actions.to_string())
    .bind(i64::from(merged.is_active))
    .bind(now())
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    show(State(state), ctx, Path(id)).await
}

async fn destroy(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let res = sqlx::query("UPDATE automations SET deleted_at = ? WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(now())
        .bind(&ctx.org_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::not_found("Automation"));
    }
    audit::record(&state.pool, &ctx, "core.automations", &id, "delete",
        Some("Deleted an automation".into()), None).await?;
    Ok(Json(json!({ "ok": true })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn conditions(v: Value) -> Conditions {
        serde_json::from_value(v).unwrap()
    }

    #[test]
    fn all_requires_every_rule_and_any_requires_one() {
        let after = json!({ "stage": "closed_won", "amount": 50_000 });

        let all = conditions(json!({
            "match": "all",
            "rules": [{"field":"stage","op":"eq","value":"closed_won"},
                      {"field":"amount","op":"gte","value":10_000}]
        }));
        assert!(evaluate(&all, &after, None));

        let all_fails = conditions(json!({
            "match": "all",
            "rules": [{"field":"stage","op":"eq","value":"closed_won"},
                      {"field":"amount","op":"gte","value":90_000}]
        }));
        assert!(!evaluate(&all_fails, &after, None));

        let any = conditions(json!({
            "match": "any",
            "rules": [{"field":"stage","op":"eq","value":"nope"},
                      {"field":"amount","op":"gte","value":10_000}]
        }));
        assert!(evaluate(&any, &after, None));
    }

    #[test]
    fn changed_needs_a_previous_value() {
        let before = json!({ "stage": "proposal" });
        let after = json!({ "stage": "closed_won" });
        let c = conditions(json!({"rules":[{"field":"stage","op":"changed"}]}));

        assert!(evaluate(&c, &after, Some(&before)));
        // On a create there is nothing to have changed from.
        assert!(!evaluate(&c, &after, None));
        // And an update that left the field alone has not changed it.
        assert!(!evaluate(&c, &after, Some(&after)));
    }

    #[test]
    fn changed_to_matches_only_the_transition() {
        let c = conditions(json!({"rules":[{"field":"stage","op":"changed_to","value":"closed_won"}]}));
        let won = json!({ "stage": "closed_won" });
        let lost = json!({ "stage": "closed_lost" });
        let proposal = json!({ "stage": "proposal" });

        assert!(evaluate(&c, &won, Some(&proposal)));
        assert!(!evaluate(&c, &lost, Some(&proposal)), "a different destination");
        assert!(!evaluate(&c, &won, Some(&won)), "already there, so no transition");
    }

    #[test]
    fn empty_conditions_always_match() {
        assert!(evaluate(&conditions(json!({"rules":[]})), &json!({}), None));
    }

    #[test]
    fn numbers_compare_numerically_not_as_text() {
        let after = json!({ "amount": 9_000_000 });
        let c = conditions(json!({"rules":[{"field":"amount","op":"gt","value":"100000"}]}));
        // As text, "9000000" < "100000" would be wrong.
        assert!(evaluate(&c, &after, None));
    }

    #[test]
    fn emptiness_covers_null_and_blank() {
        let c = conditions(json!({"rules":[{"field":"owner_id","op":"is_empty"}]}));
        assert!(evaluate(&c, &json!({"owner_id": null}), None));
        assert!(evaluate(&c, &json!({"owner_id": "   "}), None));
        assert!(!evaluate(&c, &json!({"owner_id": "u1"}), None));
    }

    #[test]
    fn templates_substitute_record_fields() {
        let record = json!({ "name": "Acme rollout", "amount": 5000 });
        assert_eq!(render("Follow up on {{name}}", &record), "Follow up on Acme rollout");
        assert_eq!(render("{{name}} is {{amount}}", &record), "Acme rollout is 5000");
        // An unknown field disappears rather than leaking the placeholder.
        assert_eq!(render("Hi {{nope}} there", &record), "Hi  there");
        assert_eq!(render("No placeholders", &record), "No placeholders");
        assert_eq!(render("Unclosed {{name", &record), "Unclosed {{name");
    }

    #[test]
    fn triggers_gate_on_what_actually_happened() {
        assert!(trigger_matches("on_create", Trigger::OnCreate));
        assert!(!trigger_matches("on_create", Trigger::OnUpdate));
        assert!(trigger_matches("on_update", Trigger::OnUpdate));
        assert!(trigger_matches("on_create_or_update", Trigger::OnCreate));
        assert!(trigger_matches("on_create_or_update", Trigger::OnUpdate));
        assert!(!trigger_matches("nonsense", Trigger::OnCreate));
    }
}
