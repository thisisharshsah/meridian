use chrono::Utc;
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    /// user id
    pub sub: String,
    /// organization (tenant) id
    pub org: String,
    pub email: String,
    pub name: String,
    pub iat: i64,
    pub exp: i64,
}

pub fn issue_access_token(
    secret: &str,
    user_id: &str,
    org_id: &str,
    email: &str,
    name: &str,
    ttl_secs: i64,
) -> AppResult<String> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: user_id.to_string(),
        org: org_id.to_string(),
        email: email.to_string(),
        name: name.to_string(),
        iat: now,
        exp: now + ttl_secs,
    };
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret.as_bytes()))
        .map_err(|e| AppError::Other(anyhow::anyhow!("token encoding failed: {e}")))
}

pub fn verify_access_token(secret: &str, token: &str) -> AppResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    // jsonwebtoken defaults to 60s of leeway; keep a little for clock skew but
    // not enough for an expired session to stay usable for a minute.
    validation.leeway = 5;
    decode::<Claims>(token, &DecodingKey::from_secret(secret.as_bytes()), &validation)
        .map(|d| d.claims)
        .map_err(|_| AppError::Unauthorized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn issued_tokens_verify() {
        let t = issue_access_token("s3cret", "u1", "o1", "a@b.c", "Ann", 60).unwrap();
        let c = verify_access_token("s3cret", &t).unwrap();
        assert_eq!(c.sub, "u1");
        assert_eq!(c.org, "o1");
    }

    #[test]
    fn wrong_secret_is_rejected() {
        let t = issue_access_token("s3cret", "u1", "o1", "a@b.c", "Ann", 60).unwrap();
        assert!(verify_access_token("other", &t).is_err());
    }

    #[test]
    fn expired_tokens_are_rejected() {
        let t = issue_access_token("s3cret", "u1", "o1", "a@b.c", "Ann", -120).unwrap();
        assert!(verify_access_token("s3cret", &t).is_err());
    }
}
