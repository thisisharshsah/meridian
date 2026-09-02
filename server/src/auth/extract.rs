use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use serde_json::Value;
use sqlx::Row;

use crate::auth::ctx::Ctx;
use crate::auth::jwt::verify_access_token;
use crate::error::AppError;
use crate::state::AppState;

/// Axum extractor that turns a bearer token into a fully-resolved `Ctx`.
///
/// Permissions are read from the database on each request rather than baked
/// into the token, so revoking a role takes effect immediately instead of when
/// the token happens to expire.
impl FromRequestParts<AppState> for Ctx {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?;

        let claims = verify_access_token(&state.config.jwt_secret, token)?;

        let row = sqlx::query(
            "SELECT m.is_owner, m.status, r.key AS role_key, r.permissions
             FROM memberships m
             JOIN roles r ON r.id = m.role_id
             WHERE m.org_id = ? AND m.user_id = ? AND m.deleted_at IS NULL",
        )
        .bind(&claims.org)
        .bind(&claims.sub)
        .fetch_optional(&state.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;

        let status: String = row.try_get("status").unwrap_or_default();
        if status != "active" {
            return Err(AppError::forbidden("This account is not active in this organization"));
        }

        let raw: String = row.try_get("permissions").unwrap_or_else(|_| "[]".into());
        let permissions = serde_json::from_str::<Value>(&raw)
            .ok()
            .and_then(|v| v.as_array().cloned())
            .map(|arr| {
                arr.into_iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Ctx {
            user_id: claims.sub,
            org_id: claims.org,
            email: claims.email,
            name: claims.name,
            role_key: row.try_get("role_key").unwrap_or_default(),
            is_owner: row.try_get::<i64, _>("is_owner").unwrap_or(0) != 0,
            permissions,
        })
    }
}
