use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

use crate::auth::ctx::Ctx;
use crate::auth::jwt::issue_access_token;
use crate::auth::password::{
    digest_token, hash_password_async, random_token, verify_password_async,
};
use crate::auth::roles::DEFAULT_ROLES;
use crate::common::ids::new_id;
use crate::error::{AppError, AppResult, FieldError};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/register", post(register))
        .route("/login", post(login))
        .route("/refresh", post(refresh))
        .route("/logout", post(logout))
        .route("/me", get(me))
        .route("/workspaces", post(create_workspace))
        .route("/switch", post(switch_workspace))
}

#[derive(Deserialize)]
pub struct RegisterBody {
    pub name: String,
    pub email: String,
    pub password: String,
    pub organization: String,
    #[serde(default)]
    pub currency: Option<String>,
}

#[derive(Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: i64,
    pub refresh_expires_in: i64,
    pub user: serde_json::Value,
    pub organization: serde_json::Value,
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn slugify(s: &str) -> String {
    let slug: String = s
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    let mut out = String::new();
    let mut last_dash = false;
    for c in slug.chars() {
        if c == '-' {
            if !last_dash {
                out.push(c);
            }
            last_dash = true;
        } else {
            out.push(c);
            last_dash = false;
        }
    }
    if out.is_empty() {
        "org".to_string()
    } else {
        out.chars().take(48).collect()
    }
}

fn validate_registration(b: &RegisterBody) -> AppResult<()> {
    let mut errors = Vec::new();
    if b.name.trim().is_empty() {
        errors.push(FieldError::new("name", "Your name is required"));
    }
    if !b.email.contains('@') || b.email.trim().len() < 5 {
        errors.push(FieldError::new("email", "Enter a valid email address"));
    }
    if b.password.chars().count() < 8 {
        errors.push(FieldError::new("password", "Use at least 8 characters"));
    }
    if b.password.chars().count() > 200 {
        errors.push(FieldError::new("password", "Password is too long"));
    }
    if b.organization.trim().is_empty() {
        errors.push(FieldError::new("organization", "Organization name is required"));
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation(errors))
    }
}

/// Create an organization and its first user. The new user is the owner, so
/// they bypass permission checks and can never be locked out.
async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterBody>,
) -> AppResult<Json<AuthResponse>> {
    validate_registration(&body)?;

    let email = body.email.trim().to_lowercase();
    let existing = sqlx::query("SELECT id FROM users WHERE lower(email) = ?")
        .bind(&email)
        .fetch_optional(&state.pool)
        .await?;
    if existing.is_some() {
        return Err(AppError::Validation(vec![FieldError::new(
            "email",
            "An account with this email already exists",
        )]));
    }

    let mut tx = state.pool.begin().await?;
    let ts = now();

    let user_id = new_id();
    let currency = body.currency.clone().unwrap_or_else(|| "USD".into());

    sqlx::query(
        "INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&user_id)
    .bind(&email)
    .bind(body.name.trim())
    .bind(hash_password_async(body.password.clone()).await?)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;

    let org_id = provision_organization(&mut tx, &user_id, body.organization.trim(), &currency, &ts).await?;

    tx.commit().await?;

    issue_session(&state, &user_id, &org_id, &email, body.name.trim(), None).await.map(Json)
}

#[derive(Deserialize)]
pub struct LoginBody {
    pub email: String,
    pub password: String,
    #[serde(default)]
    pub organization_id: Option<String>,
}

async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginBody>,
) -> AppResult<Json<AuthResponse>> {
    let email = body.email.trim().to_lowercase();

    let user = sqlx::query(
        "SELECT id, name, email, password_hash FROM users
         WHERE lower(email) = ? AND deleted_at IS NULL",
    )
    .bind(&email)
    .fetch_optional(&state.pool)
    .await?;

    // Same error whether the email is unknown or the password is wrong, so the
    // endpoint cannot be used to enumerate accounts.
    let invalid = || AppError::Validation(vec![FieldError::new("password", "Incorrect email or password")]);

    let Some(user) = user else {
        // Still spend the hashing time, so a missing account is not detectably faster.
        let _ = verify_password_async(body.password.clone(), "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG".to_string()).await;
        return Err(invalid());
    };

    let hash: String = user.try_get("password_hash").unwrap_or_default();
    if !verify_password_async(body.password.clone(), hash).await {
        return Err(invalid());
    }

    let user_id: String = user.try_get("id").unwrap_or_default();
    let name: String = user.try_get("name").unwrap_or_default();

    let org_id = match &body.organization_id {
        Some(id) => {
            let ok = sqlx::query(
                "SELECT 1 FROM memberships WHERE user_id = ? AND org_id = ? AND status = 'active' AND deleted_at IS NULL",
            )
            .bind(&user_id)
            .bind(id)
            .fetch_optional(&state.pool)
            .await?;
            if ok.is_none() {
                return Err(AppError::forbidden("You do not have access to that organization"));
            }
            id.clone()
        }
        None => sqlx::query(
            "SELECT org_id FROM memberships
             WHERE user_id = ? AND status = 'active' AND deleted_at IS NULL
             ORDER BY created_at LIMIT 1",
        )
        .bind(&user_id)
        .fetch_optional(&state.pool)
        .await?
        .map(|r| r.try_get::<String, _>("org_id").unwrap_or_default())
        .ok_or_else(|| AppError::forbidden("This account does not belong to an organization"))?,
    };

    sqlx::query("UPDATE users SET last_login_at = ? WHERE id = ?")
        .bind(now())
        .bind(&user_id)
        .execute(&state.pool)
        .await?;

    issue_session(&state, &user_id, &org_id, &email, &name, None).await.map(Json)
}

#[derive(Deserialize)]
pub struct RefreshBody {
    pub refresh_token: String,
}

/// Refresh tokens rotate: spending one revokes it and mints a replacement, so a
/// stolen token stops working as soon as the real client uses theirs.
async fn refresh(
    State(state): State<AppState>,
    Json(body): Json<RefreshBody>,
) -> AppResult<Json<AuthResponse>> {
    let digest = digest_token(&body.refresh_token);

    let row = sqlx::query(
        "SELECT t.id, t.user_id, t.org_id, t.expires_at, t.revoked_at, u.email, u.name
         FROM refresh_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_digest = ?",
    )
    .bind(&digest)
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::Unauthorized)?;

    let expires_at: String = row.try_get("expires_at").unwrap_or_default();
    if expires_at < now() {
        return Err(AppError::Unauthorized);
    }

    // Claim the token in one statement and check that we were the one who
    // claimed it. Reading `revoked_at` and then revoking in a second statement
    // lets two concurrent requests both pass the read and both mint a session,
    // which is exactly the replay that rotation exists to prevent.
    let token_id: String = row.try_get("id").unwrap_or_default();
    let claimed = sqlx::query(
        "UPDATE refresh_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .bind(now())
    .bind(&token_id)
    .execute(&state.pool)
    .await?;

    if claimed.rows_affected() == 0 {
        return Err(AppError::Unauthorized);
    }

    let user_id: String = row.try_get("user_id").unwrap_or_default();
    let org_id: String = row.try_get("org_id").unwrap_or_default();
    let email: String = row.try_get("email").unwrap_or_default();
    let name: String = row.try_get("name").unwrap_or_default();

    issue_session(&state, &user_id, &org_id, &email, &name, None).await.map(Json)
}

async fn logout(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<serde_json::Value>> {
    sqlx::query("UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
        .bind(now())
        .bind(&ctx.user_id)
        .execute(&state.pool)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// Everything the app shell needs on boot: who you are, which organization you
/// are in, what you may do, and which other organizations you can switch to.
async fn me(State(state): State<AppState>, ctx: Ctx) -> AppResult<Json<serde_json::Value>> {
    let org = sqlx::query("SELECT id, name, slug, currency, timezone FROM organizations WHERE id = ?")
        .bind(&ctx.org_id)
        .fetch_one(&state.pool)
        .await?;

    let user = sqlx::query("SELECT id, name, email, avatar_url FROM users WHERE id = ?")
        .bind(&ctx.user_id)
        .fetch_one(&state.pool)
        .await?;

    let orgs = sqlx::query(
        "SELECT o.id, o.name, o.slug FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = ? AND m.status = 'active' AND m.deleted_at IS NULL
         ORDER BY o.name",
    )
    .bind(&ctx.user_id)
    .fetch_all(&state.pool)
    .await?;

    let mut permissions: Vec<&String> = ctx.permissions.iter().collect();
    permissions.sort();

    Ok(Json(json!({
        "user": {
            "id": user.try_get::<String, _>("id").unwrap_or_default(),
            "name": user.try_get::<String, _>("name").unwrap_or_default(),
            "email": user.try_get::<String, _>("email").unwrap_or_default(),
            "avatar_url": user.try_get::<Option<String>, _>("avatar_url").ok().flatten(),
        },
        "organization": {
            "id": org.try_get::<String, _>("id").unwrap_or_default(),
            "name": org.try_get::<String, _>("name").unwrap_or_default(),
            "slug": org.try_get::<String, _>("slug").unwrap_or_default(),
            "currency": org.try_get::<String, _>("currency").unwrap_or_else(|_| "USD".into()),
            "timezone": org.try_get::<String, _>("timezone").unwrap_or_else(|_| "UTC".into()),
        },
        "organizations": orgs.iter().map(|r| json!({
            "id": r.try_get::<String, _>("id").unwrap_or_default(),
            "name": r.try_get::<String, _>("name").unwrap_or_default(),
            "slug": r.try_get::<String, _>("slug").unwrap_or_default(),
        })).collect::<Vec<_>>(),
        "role": ctx.role_key,
        "is_owner": ctx.is_owner,
        "permissions": permissions,
    })))
}

/// Everything a workspace needs to exist: the organisation row, its own copy of
/// the default roles, an owner membership for the creator, and the document
/// numbering sequences.
///
/// Extracted from signup because creating your second business is the same act
/// as creating your first -- the only difference is that the person already has
/// an account. Keeping one implementation means a new role or sequence added to
/// signup cannot quietly go missing from every workspace created afterwards.
async fn provision_organization(
    tx: &mut sqlx::SqliteConnection,
    user_id: &str,
    name: &str,
    currency: &str,
    ts: &str,
) -> AppResult<String> {
    let org_id = new_id();

    // Slugs are unique per install, so add a short suffix on collision rather
    // than failing over a name someone else already used.
    let base_slug = slugify(name);
    let mut slug = base_slug.clone();
    for n in 1..50 {
        let taken = sqlx::query("SELECT 1 FROM organizations WHERE slug = ?")
            .bind(&slug)
            .fetch_optional(&mut *tx)
            .await?;
        if taken.is_none() {
            break;
        }
        slug = format!("{base_slug}-{n}");
    }

    sqlx::query(
        "INSERT INTO organizations (id, name, slug, currency, timezone, fiscal_year_start_month, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'UTC', 1, ?, ?)",
    )
    .bind(&org_id)
    .bind(name)
    .bind(&slug)
    .bind(currency)
    .bind(ts)
    .bind(ts)
    .execute(&mut *tx)
    .await?;

    let mut admin_role_id = String::new();
    for seed in DEFAULT_ROLES {
        let id = new_id();
        if seed.key == "admin" {
            admin_role_id = id.clone();
        }
        sqlx::query(
            "INSERT INTO roles (id, org_id, key, name, description, permissions, is_system, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)",
        )
        .bind(&id)
        .bind(&org_id)
        .bind(seed.key)
        .bind(seed.name)
        .bind(seed.description)
        .bind(serde_json::to_string(seed.permissions).unwrap_or_else(|_| "[]".into()))
        .bind(ts)
        .bind(ts)
        .execute(&mut *tx)
        .await?;
    }

    sqlx::query(
        "INSERT INTO memberships (id, org_id, user_id, role_id, is_owner, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 'active', ?, ?)",
    )
    .bind(new_id())
    .bind(&org_id)
    .bind(user_id)
    .bind(&admin_role_id)
    .bind(ts)
    .bind(ts)
    .execute(&mut *tx)
    .await?;

    for (key, prefix) in crate::modules::SEQUENCE_SEEDS {
        sqlx::query(
            "INSERT INTO number_sequences (org_id, key, prefix, padding, next_value)
             VALUES (?, ?, ?, 5, 1) ON CONFLICT (org_id, key) DO NOTHING",
        )
        .bind(&org_id)
        .bind(*key)
        .bind(*prefix)
        .execute(&mut *tx)
        .await?;
    }

    Ok(org_id)
}

#[derive(Deserialize)]
pub struct NewWorkspaceBody {
    pub organization: String,
    #[serde(default)]
    pub currency: Option<String>,
}

/// Start another business under the same login. The caller becomes its owner,
/// and the session returned is already scoped to it, so the client lands inside
/// the new workspace rather than being told to sign in again.
async fn create_workspace(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<NewWorkspaceBody>,
) -> AppResult<Json<AuthResponse>> {
    if body.organization.trim().is_empty() {
        return Err(AppError::Validation(vec![FieldError::new(
            "organization",
            "Give the business a name",
        )]));
    }

    let ts = now();
    let currency = body.currency.unwrap_or_else(|| "USD".into());
    let mut tx = state.pool.begin().await?;
    let org_id =
        provision_organization(&mut tx, &ctx.user_id, body.organization.trim(), &currency, &ts).await?;
    tx.commit().await?;

    issue_session(&state, &ctx.user_id, &org_id, &ctx.email, &ctx.name, None).await.map(Json)
}

#[derive(Deserialize)]
pub struct SwitchBody {
    pub organization_id: String,
}

/// Move the session to another workspace this person belongs to.
///
/// The organisation is part of the access token, so switching means issuing a
/// new one rather than flipping a preference: a token minted for one business
/// can never read another's data, which is the property the whole tenancy model
/// rests on. Membership is re-checked here rather than trusted from the client.
async fn switch_workspace(
    State(state): State<AppState>,
    ctx: Ctx,
    Json(body): Json<SwitchBody>,
) -> AppResult<Json<AuthResponse>> {
    let member = sqlx::query(
        "SELECT 1 FROM memberships
          WHERE user_id = ? AND org_id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(&ctx.user_id)
    .bind(&body.organization_id)
    .fetch_optional(&state.pool)
    .await?;
    if member.is_none() {
        return Err(AppError::forbidden("You do not belong to that workspace"));
    }

    issue_session(&state, &ctx.user_id, &body.organization_id, &ctx.email, &ctx.name, None)
        .await
        .map(Json)
}

async fn issue_session(
    state: &AppState,
    user_id: &str,
    org_id: &str,
    email: &str,
    name: &str,
    user_agent: Option<String>,
) -> AppResult<AuthResponse> {
    let access = issue_access_token(
        &state.config.jwt_secret,
        user_id,
        org_id,
        email,
        name,
        state.config.access_ttl_secs,
    )?;

    let refresh_token = random_token();
    let expires_at = (Utc::now() + Duration::seconds(state.config.refresh_ttl_secs))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);

    sqlx::query(
        "INSERT INTO refresh_tokens (id, user_id, org_id, token_digest, user_agent, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new_id())
    .bind(user_id)
    .bind(org_id)
    .bind(digest_token(&refresh_token))
    .bind(user_agent)
    .bind(&expires_at)
    .bind(now())
    .execute(&state.pool)
    .await?;

    let org = sqlx::query("SELECT id, name, slug, currency FROM organizations WHERE id = ?")
        .bind(org_id)
        .fetch_one(&state.pool)
        .await?;

    Ok(AuthResponse {
        access_token: access,
        refresh_token,
        expires_in: state.config.access_ttl_secs,
        refresh_expires_in: state.config.refresh_ttl_secs,
        user: json!({ "id": user_id, "name": name, "email": email }),
        organization: json!({
            "id": org.try_get::<String, _>("id").unwrap_or_default(),
            "name": org.try_get::<String, _>("name").unwrap_or_default(),
            "slug": org.try_get::<String, _>("slug").unwrap_or_default(),
            "currency": org.try_get::<String, _>("currency").unwrap_or_else(|_| "USD".into()),
        }),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_produces_url_safe_names() {
        assert_eq!(slugify("Acme Corp."), "acme-corp");
        assert_eq!(slugify("  ---  "), "org");
        assert_eq!(slugify("Björk & Co"), "bj-rk-co");
    }

    #[test]
    fn registration_rejects_weak_input() {
        let bad = RegisterBody {
            name: " ".into(),
            email: "nope".into(),
            password: "short".into(),
            organization: "".into(),
            currency: None,
        };
        let Err(AppError::Validation(errs)) = validate_registration(&bad) else {
            panic!("expected validation failure");
        };
        assert_eq!(errs.len(), 4);
    }
}
