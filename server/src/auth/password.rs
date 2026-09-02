use argon2::{Argon2, PasswordHasher, PasswordVerifier};
use rand::Rng;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

pub fn hash_password(plain: &str) -> AppResult<String> {
    // argon2 0.6 draws its own 16-byte salt and returns a PHC string that
    // carries the algorithm, parameters and salt alongside the digest.
    Argon2::default()
        .hash_password(plain.as_bytes())
        .map(|h| h.to_string())
        .map_err(|e| AppError::Other(anyhow::anyhow!("password hashing failed: {e}")))
}

pub fn verify_password(plain: &str, hashed: &str) -> bool {
    Argon2::default().verify_password(plain.as_bytes(), hashed).is_ok()
}

/// Opaque, high-entropy token: refresh tokens, invite links, API keys.
pub fn random_token() -> String {
    let mut raw = [0u8; 32];
    rand::rng().fill_bytes(&mut raw);
    hex(&raw)
}

/// Refresh tokens are stored hashed, so a database leak is not a session leak.
/// The token already carries 256 bits of entropy, so it needs pre-image
/// resistance rather than the stretching a password would need.
pub fn digest_token(token: &str) -> String {
    let mut h = Sha256::new();
    h.update(token.as_bytes());
    hex(&h.finalize())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes.iter().fold(String::with_capacity(bytes.len() * 2), |mut acc, b| {
        let _ = write!(acc, "{b:02x}");
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_then_verify_roundtrips() {
        let h = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &h));
        assert!(!verify_password("wrong password", &h));
    }

    #[test]
    fn tokens_are_unique_and_digest_stably() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert_eq!(digest_token(&a), digest_token(&a));
        assert_ne!(digest_token(&a), digest_token(&b));
    }
}
