//! Inviting someone into a workspace.
//!
//! Without a mail server the link has to travel by hand, so these endpoints
//! deal in a token the inviter copies. The token is shown exactly once, at
//! creation; only its digest is kept, so the link cannot be recovered from the
//! database — it can only be revoked and reissued.

use axum::extract::{Path, State};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::auth::ctx::Ctx;
use crate::auth::password::{digest_token, hash_password, random_token, verify_password};
use crate::common::audit;
use crate::common::ids::new_id;
use crate::error::{AppError, AppResult, FieldError};
use crate::state::AppState;

/// Long enough to survive a weekend, short enough that a forgotten link in a
/// chat log stops working.
const INVITE_TTL_DAYS: i64 = 14;

pub fn router() -> Router<AppState> {
    Router::new()
        // Managed by an owner, inside the workspace.
        .route("/settings/invitations", get(list).post(create))
        .route("/settings/invitations/{id}", axum::routing::delete(revoke))
        // Reached by the invitee, who has no session yet.
        .route("/invitations/{token}", get(preview))
        .route("/invitations/{token}/accept", post(accept))
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

#[derive(Deserialize)]
pub struct CreateInviteBody {
    pub email: String,
    pub role_id: String,
    #[serde(default)]
    pub title: Option<String>,
}

async fn create(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<CreateInviteBody>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let email = body.email.trim().to_lowercase();
    if !email.contains('@') || email.len() < 5 {
        return Err(AppError::Validation(vec![FieldError::new(
            "email",
            "Enter a valid email address",
        )]));
    }

    let role = sqlx::query("SELECT name FROM roles WHERE org_id = ? AND id = ? AND deleted_at IS NULL")
        .bind(&ctx.org_id)
        .bind(&body.role_id)
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| AppError::not_found("Role"))?;

    // Someone already inside does not need an invitation.
    let existing = sqlx::query(
        "SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ? AND lower(u.email) = ? AND m.deleted_at IS NULL",
    )
    .bind(&ctx.org_id)
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;
    if existing.is_some() {
        return Err(AppError::Validation(vec![FieldError::new(
            "email",
            "That person is already a member of this workspace",
        )]));
    }

    let token = random_token();
    let ts = now();
    let expires = (Utc::now() + Duration::days(INVITE_TTL_DAYS))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    let id = new_id();
    let result = sqlx::query(
        "INSERT INTO invitations (id, org_id, email, role_id, title, token_digest, invited_by,
                                  expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&ctx.org_id)
    .bind(&email)
    .bind(&body.role_id)
    .bind(&body.title)
    .bind(digest_token(&token))
    .bind(&ctx.user_id)
    .bind(&expires)
    .bind(&ts)
    .bind(&ts)
    .execute(&state.pool)
    .await;

    if let Err(sqlx::Error::Database(e)) = &result {
        if e.message().contains("UNIQUE constraint failed") {
            return Err(AppError::Validation(vec![FieldError::new(
                "email",
                "There is already a pending invitation for that address",
            )]));
        }
    }
    result?;

    audit::record(
        &state.pool, &ctx, "core.invitations", &id, "create",
        Some(format!("Invited {email} as {}", role.try_get::<String, _>("name").unwrap_or_default())),
        None,
    )
    .await?;

    Ok(Json(json!({
        "id": id,
        "email": email,
        "expires_at": expires,
        // Returned once and never again: the row keeps only the digest.
        "token": token,
        "path": format!("/invite/{token}"),
    })))
}

async fn list(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let rows = sqlx::query(
        "SELECT i.id, i.email, i.title, i.expires_at, i.accepted_at, i.created_at,
                r.name AS role_name, u.name AS invited_by_name
         FROM invitations i
         LEFT JOIN roles r ON r.id = i.role_id
         LEFT JOIN users u ON u.id = i.invited_by
         WHERE i.org_id = ? AND i.revoked_at IS NULL AND i.accepted_at IS NULL
         ORDER BY i.created_at DESC",
    )
    .bind(&ctx.org_id)
    .fetch_all(&state.pool)
    .await?;

    let today = now();
    let data: Vec<Value> = rows
        .iter()
        .map(|r| {
            let expires: String = r.try_get("expires_at").unwrap_or_default();
            json!({
                "id": r.try_get::<String, _>("id").unwrap_or_default(),
                "email": r.try_get::<String, _>("email").unwrap_or_default(),
                "title": r.try_get::<Option<String>, _>("title").ok().flatten(),
                "role_name": r.try_get::<Option<String>, _>("role_name").ok().flatten(),
                "invited_by_name": r.try_get::<Option<String>, _>("invited_by_name").ok().flatten(),
                "expires_at": expires.clone(),
                "expired": expires < today,
                "created_at": r.try_get::<String, _>("created_at").unwrap_or_default(),
            })
        })
        .collect();

    Ok(Json(json!({ "data": data })))
}

async fn revoke(
    State(state): State<AppState>,
    ctx: Ctx,
    Path(id): Path<String>,
) -> AppResult<Json<Value>> {
    ctx.require_owner()?;

    let res = sqlx::query(
        "UPDATE invitations SET revoked_at = ?, updated_at = ?
         WHERE org_id = ? AND id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(now())
    .bind(now())
    .bind(&ctx.org_id)
    .bind(&id)
    .execute(&state.pool)
    .await?;

    if res.rows_affected() == 0 {
        return Err(AppError::not_found("Invitation"));
    }
    audit::record(&state.pool, &ctx, "core.invitations", &id, "delete",
        Some("Revoked an invitation".into()), None).await?;

    Ok(Json(json!({ "ok": true })))
}

/// Unauthenticated: what the invitee sees before deciding to accept.
/// It reveals the workspace name and the invited address, and nothing else.
async fn preview(
    State(state): State<AppState>,
    Path(token): Path<String>,
) -> AppResult<Json<Value>> {
    let row = load_valid(&state, &token).await?;

    Ok(Json(json!({
        "email": row.email,
        "organization": row.org_name,
        "role_name": row.role_name,
        // Tells the page whether to ask for a password or just to confirm.
        "has_account": row.user_id.is_some(),
    })))
}

struct ValidInvite {
    id: String,
    org_id: String,
    org_name: String,
    email: String,
    role_id: String,
    role_name: String,
    title: Option<String>,
    user_id: Option<String>,
}

async fn load_valid(state: &AppState, token: &str) -> AppResult<ValidInvite> {
    let row = sqlx::query(
        "SELECT i.id, i.org_id, i.email, i.role_id, i.title, i.expires_at, i.accepted_at, i.revoked_at,
                o.name AS org_name, r.name AS role_name, u.id AS user_id
         FROM invitations i
         JOIN organizations o ON o.id = i.org_id
         LEFT JOIN roles r ON r.id = i.role_id
         LEFT JOIN users u ON lower(u.email) = lower(i.email)
         WHERE i.token_digest = ?",
    )
    .bind(digest_token(token))
    .fetch_optional(&state.pool)
    .await?
    // Same answer for "no such token" and "spent token": a wrong link should
    // not report whether it was ever real.
    .ok_or_else(|| AppError::not_found("Invitation"))?;

    if row.try_get::<Option<String>, _>("accepted_at").ok().flatten().is_some() {
        return Err(AppError::conflict("This invitation has already been used"));
    }
    if row.try_get::<Option<String>, _>("revoked_at").ok().flatten().is_some() {
        return Err(AppError::not_found("Invitation"));
    }
    let expires: String = row.try_get("expires_at").unwrap_or_default();
    if expires < now() {
        return Err(AppError::conflict("This invitation has expired — ask for a new link"));
    }

    Ok(ValidInvite {
        id: row.try_get("id").unwrap_or_default(),
        org_id: row.try_get("org_id").unwrap_or_default(),
        org_name: row.try_get("org_name").unwrap_or_default(),
        email: row.try_get("email").unwrap_or_default(),
        role_id: row.try_get("role_id").unwrap_or_default(),
        role_name: row.try_get::<Option<String>, _>("role_name").ok().flatten().unwrap_or_default(),
        title: row.try_get::<Option<String>, _>("title").ok().flatten(),
        user_id: row.try_get::<Option<String>, _>("user_id").ok().flatten(),
    })
}

#[derive(Deserialize)]
pub struct AcceptBody {
    #[serde(default)]
    pub name: Option<String>,
    pub password: String,
}

/// Unauthenticated: turn a valid invitation into a membership.
///
/// If the address already has an account the password must match it — an
/// invitation lets someone into a workspace, it does not let them take over an
/// existing account.
async fn accept(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Json(body): Json<AcceptBody>,
) -> AppResult<Json<Value>> {
    let invite = load_valid(&state, &token).await?;

    let mut tx = state.pool.begin().await?;
    let ts = now();

    let user_id = match &invite.user_id {
        Some(existing) => {
            let row = sqlx::query("SELECT password_hash FROM users WHERE id = ?")
                .bind(existing)
                .fetch_one(&mut *tx)
                .await?;
            let hash: String = row.try_get("password_hash").unwrap_or_default();
            if !verify_password(&body.password, &hash) {
                return Err(AppError::Validation(vec![FieldError::new(
                    "password",
                    "That is not the password for this email address",
                )]));
            }
            existing.clone()
        }
        None => {
            if body.password.chars().count() < 8 {
                return Err(AppError::Validation(vec![FieldError::new(
                    "password",
                    "Use at least 8 characters",
                )]));
            }
            let name = body
                .name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| invite.email.split('@').next().unwrap_or("New member"));

            let id = new_id();
            sqlx::query(
                "INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&id)
            .bind(&invite.email)
            .bind(name)
            .bind(hash_password(&body.password)?)
            .bind(&ts)
            .bind(&ts)
            .execute(&mut *tx)
            .await?;
            id
        }
    };

    sqlx::query(
        "INSERT INTO memberships (id, org_id, user_id, role_id, is_owner, status, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 'active', ?, ?, ?)",
    )
    .bind(new_id())
    .bind(&invite.org_id)
    .bind(&user_id)
    .bind(&invite.role_id)
    .bind(&invite.title)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;

    sqlx::query("UPDATE invitations SET accepted_at = ?, accepted_by = ?, updated_at = ? WHERE id = ?")
        .bind(&ts)
        .bind(&user_id)
        .bind(&ts)
        .bind(&invite.id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(json!({
        "email": invite.email,
        "organization": invite.org_name,
        "role_name": invite.role_name,
    })))
}
