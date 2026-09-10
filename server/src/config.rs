use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    /// SQLite connection string, e.g. `sqlite://../data/suite.db?mode=rwc`
    pub database_url: String,
    pub bind_addr: String,
    pub jwt_secret: String,
    /// Access-token lifetime in seconds.
    pub access_ttl_secs: i64,
    /// Refresh-token lifetime in seconds.
    pub refresh_ttl_secs: i64,
    pub cors_origins: Vec<String>,
    /// Which package this installation is. The ceiling for everything: no
    /// workspace on it can be sold, shown or served a module outside it.
    pub edition: String,
}

impl Config {
    pub fn from_env() -> Self {
        let _ = dotenvy::dotenv();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://../data/suite.db?mode=rwc".to_string());

        let jwt_secret = env::var("JWT_SECRET").unwrap_or_else(|_| {
            // Dev fallback: stable so tokens survive a restart, loud so it is not shipped.
            tracing::warn!("JWT_SECRET is unset - using an insecure development secret");
            "dev-insecure-secret-change-me".to_string()
        });

        // An unknown name is refused rather than quietly treated as "full".
        // A typo in a deploy script must not be the reason a customer is
        // handed the whole suite.
        let edition = env::var("EDITION").unwrap_or_else(|_| "full".to_string());
        if crate::editions::find(&edition).is_none() {
            let known: Vec<&str> = crate::editions::EDITIONS.iter().map(|e| e.key).collect();
            panic!("EDITION=`{edition}` is not an edition. Known editions: {}", known.join(", "));
        }

        Config {
            database_url,
            bind_addr: env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:7011".to_string()),
            jwt_secret,
            access_ttl_secs: env::var("ACCESS_TTL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60 * 60),
            refresh_ttl_secs: env::var("REFRESH_TTL_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(60 * 60 * 24 * 30),
            // Empty by default. The browser reaches this API only through the
            // Next.js proxy, which is same-origin, so a CORS grant is something
            // an operator opts into rather than the default posture.
            cors_origins: env::var("CORS_ORIGINS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            edition,
        }
    }
}
