//! Workspace settings: the organization itself, its roles, and who holds them.
//!
//! These do not go through the entity engine. Organizations and memberships are
//! the things the engine's tenancy rules are *made of*, so they get explicit
//! handlers with explicit ownership checks rather than generic CRUD.

use axum::extract::State;
use axum::routing::{get, patch};
use axum::{Json, Router};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::auth::ctx::Ctx;
use crate::common::audit;
use crate::error::{AppError, AppResult, FieldError};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/settings/organization", get(get_org).patch(update_org))
        .route("/settings/roles", get(list_roles).post(create_role))
        .route("/settings/roles/{id}", patch(update_role).delete(delete_role))
        .route("/settings/permissions", get(permission_catalog))
        .route("/settings/members", get(list_members))
        .route("/settings/members/{id}", patch(update_member))
        .route("/settings/jobs", get(job_queue))
        .route("/settings/reindex", axum::routing::post(reindex))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

async fn get_org(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    let row = sqlx::query(
        "SELECT id, name, slug, currency, country, timezone, fiscal_year_start_month, created_at
         FROM organizations WHERE id = ?",
    )
    .bind(&ctx.org_id)
    .fetch_one(&state.pool)
    .await?;

    let counts = sqlx::query(
        "SELECT
           (SELECT COUNT(*) FROM memberships WHERE org_id = ? AND deleted_at IS NULL) AS members,
           (SELECT COUNT(*) FROM roles WHERE org_id = ? AND deleted_at IS NULL) AS roles",
    )
    .bind(&ctx.org_id)
    .bind(&ctx.org_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(json!({
        "id": row.try_get::<String, _>("id").unwrap_or_default(),
        "name": row.try_get::<String, _>("name").unwrap_or_default(),
        "slug": row.try_get::<String, _>("slug").unwrap_or_default(),
        "currency": row.try_get::<String, _>("currency").unwrap_or_default(),
        "country": row.try_get::<Option<String>, _>("country").ok().flatten(),
        "timezone": row.try_get::<String, _>("timezone").unwrap_or_default(),
        "fiscal_year_start_month": row.try_get::<i64, _>("fiscal_year_start_month").unwrap_or(1),
        "created_at": row.try_get::<String, _>("created_at").unwrap_or_default(),
        "member_count": counts.try_get::<i64, _>("members").unwrap_or(0),
        "role_count": counts.try_get::<i64, _>("roles").unwrap_or(0),
        "can_edit": ctx.is_owner,
    })))
}

#[derive(Deserialize)]
pub struct UpdateOrgBody {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub fiscal_year_start_month: Option<i64>,
}

async fn update_org(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<UpdateOrgBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let mut errors = Vec::new();
    if let Some(name) = &body.name {
        if name.trim().is_empty() {
            errors.push(FieldError::new("name", "Organization name is required"));
        }
    }
    if let Some(c) = &body.currency {
        if c.len() != 3 || !c.chars().all(|ch| ch.is_ascii_alphabetic()) {
            errors.push(FieldError::new("currency", "Use a three-letter currency code"));
        }
    }
    if let Some(m) = body.fiscal_year_start_month {
        if !(1..=12).contains(&m) {
            errors.push(FieldError::new("fiscal_year_start_month", "Pick a month between 1 and 12"));
        }
    }
    if !errors.is_empty() {
        return Err(AppError::Validation(errors));
    }

    // COALESCE keeps every field the caller did not mention.
    sqlx::query(
        "UPDATE organizations SET
           name = COALESCE(?, name),
           currency = COALESCE(?, currency),
           country = COALESCE(?, country),
           timezone = COALESCE(?, timezone),
           fiscal_year_start_month = COALESCE(?, fiscal_year_start_month),
           updated_at = ?
         WHERE id = ?",
    )
    .bind(body.name.as_ref().map(|s| s.trim()))
    .bind(body.currency.as_ref().map(|s| s.to_uppercase()))
    .bind(&body.country)
    .bind(&body.timezone)
    .bind(body.fiscal_year_start_month)
    .bind(now())
    .bind(&ctx.org_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.organization", &ctx.org_id, "update",
        Some("Updated workspace settings".into()), None).await?;

    get_org(State(state), ctx).await
}

/// Roles with the permissions they grant and how many people hold each.
async fn list_roles(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    let rows = sqlx::query(
        "SELECT r.id, r.key, r.name, r.description, r.permissions, r.is_system,
                (SELECT COUNT(*) FROM memberships m
                  WHERE m.role_id = r.id AND m.deleted_at IS NULL) AS member_count
         FROM roles r
         WHERE r.org_id = ? AND r.deleted_at IS NULL
         ORDER BY r.name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            let raw: String = r.try_get("permissions").unwrap_or_else(|_| "[]".into());
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "key": r.try_get::<String, _>("key").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "description": r.try_get::<Option<String>, _>("description").ok().flatten(),
                "permissions": serde_json::from_str::<Value>(&raw).unwrap_or(json!([])),
                "is_system": r.try_get::<i64, _>("is_system").unwrap_or(0) != 0,
                "member_count": r.try_get::<i64, _>("member_count").unwrap_or(0),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn list_members(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    let rows = sqlx::query(
        "SELECT m.id AS membership_id, m.is_owner, m.status, m.title, m.created_at,
                u.id AS user_id, u.name, u.email, u.last_login_at,
                r.id AS role_id, r.name AS role_name, r.key AS role_key
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN roles r ON r.id = m.role_id
         WHERE m.org_id = ? AND m.deleted_at IS NULL
         ORDER BY m.is_owner DESC, u.name",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "membership_id": r.try_get::<String, _>("membership_id").unwrap_or_default(),
                "user_id": r.try_get::<String, _>("user_id").unwrap_or_default(),
                "name": r.try_get::<String, _>("name").unwrap_or_default(),
                "email": r.try_get::<String, _>("email").unwrap_or_default(),
                "title": r.try_get::<Option<String>, _>("title").ok().flatten(),
                "status": r.try_get::<String, _>("status").unwrap_or_default(),
                "is_owner": r.try_get::<i64, _>("is_owner").unwrap_or(0) != 0,
                "role_id": r.try_get::<Option<String>, _>("role_id").ok().flatten(),
                "role_name": r.try_get::<Option<String>, _>("role_name").ok().flatten(),
                "role_key": r.try_get::<Option<String>, _>("role_key").ok().flatten(),
                "last_login_at": r.try_get::<Option<String>, _>("last_login_at").ok().flatten(),
                "joined_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data, "can_manage": ctx.is_owner })))
}

/// Everything a role could possibly be granted, derived from the registry.
///
/// The permission grammar is `*`, `<module>.*`, `<module>.*.<action>`,
/// `<entity>.*` and `<entity>.<action>`. Rather than document that and hope,
/// the API hands the browser the exact set of valid grants, so the editor
/// cannot offer one the checker would ignore.
async fn permission_catalog(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let modules: Vec<Value> = state
        .registry
        .modules()
        .iter()
        .filter_map(|m| {
            let entities: Vec<Value> = state
                .registry
                .entities_in(m.key)
                .into_iter()
                .filter(|e| !e.embedded && !e.read_only)
                .map(|e| {
                    json!({
                        "key": e.key,
                        "label": e.label_plural,
                        "icon": e.icon,
                        "grants": {
                            "view": format!("{}.view", e.key),
                            "create": format!("{}.create", e.key),
                            "edit": format!("{}.edit", e.key),
                            "delete": format!("{}.delete", e.key),
                            "all": format!("{}.*", e.key),
                        },
                    })
                })
                .collect();
            if entities.is_empty() {
                return None;
            }
            Some(json!({
                "key": m.key,
                "label": m.label,
                "icon": m.icon,
                "entities": entities,
                "grants": {
                    "all": format!("{}.*", m.key),
                    "view": format!("{}.*.view", m.key),
                },
            }))
        })
        .collect();

    Ok(Json(json!({
        "modules": modules,
        "actions": ["view", "create", "edit", "delete"],
        "everything": "*",
    })))
}

/// Reject a grant that names nothing. An unmatched permission is silently
/// ignored at request time, which is how a role ends up quietly granting less
/// than the screen says it does.
fn validate_permissions(state: &AppState, permissions: &[String]) -> AppResult<Vec<String>> {
    let mut errors = Vec::new();
    let mut clean: Vec<String> = Vec::new();

    for grant in permissions {
        let grant = grant.trim();
        if grant.is_empty() {
            continue;
        }
        if grant == "*" {
            clean.push(grant.to_string());
            continue;
        }

        // Strip a trailing action or wildcard to find what is being named.
        let target = grant
            .strip_suffix(".view")
            .or_else(|| grant.strip_suffix(".create"))
            .or_else(|| grant.strip_suffix(".edit"))
            .or_else(|| grant.strip_suffix(".delete"))
            .unwrap_or(grant);
        let target = target.strip_suffix(".*").unwrap_or(target);

        let known = state.registry.get(target).is_some()
            || state.registry.modules().iter().any(|m| m.key == target);

        if known {
            clean.push(grant.to_string());
        } else {
            errors.push(FieldError::new(
                "permissions",
                format!("`{grant}` does not name a module or record type"),
            ));
        }
    }

    if !errors.is_empty() {
        return Err(AppError::Validation(errors));
    }

    clean.sort();
    clean.dedup();
    Ok(clean)
}

#[derive(Deserialize)]
pub struct RoleBody {
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub permissions: Vec<String>,
}

fn role_key_from(name: &str) -> String {
    let key: String = name
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let key = key.trim_matches('_').to_string();
    if key.is_empty() {
        "role".to_string()
    } else {
        key.chars().take(40).collect()
    }
}

async fn create_role(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<RoleBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    if body.name.trim().is_empty() {
        return Err(AppError::Validation(vec![FieldError::new("name", "Give the role a name")]));
    }
    if body.permissions.is_empty() {
        return Err(AppError::Validation(vec![FieldError::new(
            "permissions",
            "A role with no permissions cannot reach anything",
        )]));
    }
    let permissions = validate_permissions(&state, &body.permissions)?;

    // Keys are unique per org; add a suffix rather than refusing a duplicate name.
    let base = role_key_from(&body.name);
    let mut key = base.clone();
    for n in 1..50 {
        let taken = sqlx::query("SELECT 1 FROM roles WHERE org_id = ? AND key = ?")
            .bind(&ctx.org_id)
            .bind(&key)
            .fetch_optional(&state.pool)
            .await?;
        if taken.is_none() {
            break;
        }
        key = format!("{base}_{n}");
    }

    let id = crate::common::ids::new_id();
    let ts = now();
    sqlx::query(
        "INSERT INTO roles (id, org_id, key, name, description, permissions, is_system, created_at, updated_at, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(&key)
    .bind(body.name.trim())
    .bind(&body.description)
    .bind(serde_json::to_string(&permissions).unwrap_or_else(|_| "[]".into()))
    .bind(&ts)
    .bind(&ts)
    .bind(&ctx.user_id)
    .bind(&ctx.user_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.roles", &id, "create",
        Some(format!("Created role \"{}\"", body.name.trim())), None).await?;

    list_roles(State(state), ctx).await
}

async fn update_role(
    State(state): State<AppState>,
    ctx: Ctx,
    axum::extract::Path(id): axum::extract::Path<String>,
    Json(body): Json<RoleBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let existing = sqlx::query("SELECT is_system, name FROM roles WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Role"))?;

    // The built-in roles are what a workspace falls back to; editing them in
    // place would change the meaning of a role people already hold. Clone instead.
    if existing.try_get::<i64, _>("is_system").unwrap_or(0) != 0 {
        return Err(AppError::bad_request(
            "Built-in roles cannot be edited. Duplicate it and change the copy.",
        ));
    }

    if body.permissions.is_empty() {
        return Err(AppError::Validation(vec![FieldError::new(
            "permissions",
            "A role with no permissions cannot reach anything",
        )]));
    }
    let permissions = validate_permissions(&state, &body.permissions)?;

    sqlx::query(
        "UPDATE roles SET name = ?, description = ?, permissions = ?, updated_at = ?, updated_by = ?
         WHERE org_id = ? AND id = ?",
    )
    .bind(body.name.trim())
    .bind(&body.description)
    .bind(serde_json::to_string(&permissions).unwrap_or_else(|_| "[]".into()))
    .bind(now())
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.roles", &id, "update",
        Some(format!("Updated role \"{}\"", body.name.trim())), None).await?;

    list_roles(State(state), ctx).await
}

async fn delete_role(
    State(state): State<AppState>,
    ctx: Ctx,
    axum::extract::Path(id): axum::extract::Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let role = sqlx::query(
        "SELECT r.is_system, r.name,
                (SELECT COUNT(*) FROM memberships m WHERE m.role_id = r.id AND m.deleted_at IS NULL) AS members
         FROM roles r WHERE r.org_id = ? AND r.id = ? AND r.deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Role"))?;

    if role.try_get::<i64, _>("is_system").unwrap_or(0) != 0 {
        return Err(AppError::bad_request("Built-in roles cannot be deleted"));
    }

    // Deleting a role out from under someone would leave them with no
    // permissions and no explanation.
    let members: i64 = role.try_get("members").unwrap_or(0);
    if members > 0 {
        return Err(AppError::conflict(format!(
            "{members} member{} still hold{} this role. Move them to another role first.",
            if members == 1 { "" } else { "s" },
            if members == 1 { "s" } else { "" }
        )));
    }

    sqlx::query("UPDATE roles SET deleted_at = ?, updated_at = ? WHERE org_id = ? AND id = ?")
        .bind(now())
        .bind(now())
        .bind(&ctx.org_id)
        .bind(&id)
        .execute(&state.pool)
        .await?;

    audit::record(&state.pool, &ctx, "core.roles", &id, "delete",
        Some("Deleted a role".into()), None).await?;

    list_roles(State(state), ctx).await
}

/// Rebuild the search index for this workspace.
///
/// The index is maintained on write, so this is only needed for records that
/// predate it — an existing database, or a bulk import that bypassed the API.
async fn reindex(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    let count = crate::engine::search::reindex_org(&state.pool, &state.registry, &ctx).await?;
    Ok(Json(json!({ "indexed": count })))
}

/// What the background queue is holding, for the automation screen.
async fn job_queue(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;
    Ok(Json(crate::jobs::summary(&state.pool, &ctx.org_id).await?))
}

#[derive(Deserialize)]
pub struct UpdateMemberBody {
    #[serde(default)]
    pub role_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

async fn update_member(
    State(state): State<AppState>,
    ctx: Ctx,
    axum::extract::Path(membership_id): axum::extract::Path<String>,
    Json(body): Json<UpdateMemberBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let member = sqlx::query(
        "SELECT user_id, is_owner FROM memberships WHERE org_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&membership_id)
    .fetch_optional(&state.pool)
    .await?
    .ok_or_else(|| AppError::not_found("Member"))?;

    let is_owner = member.try_get::<i64, _>("is_owner").unwrap_or(0) != 0;
    // An owner who suspends themselves locks the workspace's last key inside it.
    if is_owner && body.status.as_deref().is_some_and(|s| s != "active") {
        return Err(AppError::bad_request("An owner cannot be suspended"));
    }

    if let Some(status) = &body.status {
        if !["active", "invited", "suspended"].contains(&status.as_str()) {
            return Err(AppError::Validation(vec![FieldError::new(
                "status",
                "Status must be active, invited or suspended",
            )]));
        }
    }

    if let Some(role_id) = &body.role_id {
        let ok = sqlx::query("SELECT 1 FROM roles WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
            .bind(&ctx.org_id)
            .bind(role_id)
            .fetch_optional(&state.pool)
            .await?;
        if ok.is_none() {
            return Err(AppError::not_found("Role"));
        }
    }

    sqlx::query(
        "UPDATE memberships SET
           role_id = COALESCE(?, role_id),
           status = COALESCE(?, status),
           title = COALESCE(?, title),
           updated_at = ?, updated_by = ?
         WHERE org_id = ? AND id = ?",
    )
    .bind(&body.role_id)
    .bind(&body.status)
    .bind(&body.title)
    .bind(now())
    .bind(&ctx.user_id)
    .bind(&ctx.org_id)
    .bind(&membership_id)
    .execute(&state.pool)
    .await?;

    audit::record(&state.pool, &ctx, "core.members", &membership_id, "update",
        Some("Updated a member's access".into()), None).await?;

    list_members(State(state), ctx).await
}
