mod auth;
mod common;
mod config;
mod db;
mod engine;
mod error;
mod jobs;
mod maintenance;
mod modules;
mod seed;
mod state;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use axum::http::HeaderValue;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::json;
use tower_http::compression::CompressionLayer;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "suite_server=debug,tower_http=info,sqlx=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer().compact().with_target(false))
        .init();

    let config = config::Config::from_env();

    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    tracing::info!(db = %config.database_url, "database ready");

    let registry = modules::registry();
    registry
        .validate()
        .map_err(|e| anyhow::anyhow!("entity registry is inconsistent: {e}"))?;
    tracing::info!(
        entities = registry.entities().count(),
        modules = registry.modules().len(),
        "registry loaded"
    );

    let addr = config.bind_addr.clone();
    let state = AppState {
        pool,
        config: Arc::new(config),
        registry: Arc::new(registry),
    };

    // `suite-server seed` fills a demo workspace and exits.
    if std::env::args().nth(1).as_deref() == Some("seed") {
        seed::run(&state).await?;
        return Ok(());
    }

    // Run the sweep once at boot, then on a timer: invoices go past due while
    // nobody is looking at them.
    match maintenance::sweep_overdue(&state.pool).await {
        Ok(n) if n > 0 => tracing::info!(invoices = n, "marked invoices overdue at startup"),
        Ok(_) => {}
        Err(e) => tracing::error!(error = %e, "startup overdue sweep failed"),
    }
    match modules::recurring::sweep_due(&state.pool).await {
        Ok(n) if n > 0 => tracing::info!(profiles = n, "queued recurring invoices at startup"),
        Ok(_) => {}
        Err(e) => tracing::error!(error = %e, "startup recurring sweep failed"),
    }
    maintenance::spawn(state.pool.clone());
    jobs::spawn(state.clone());

    let app = api_router(state);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

pub(crate) fn api_router(state: AppState) -> Router {
    // Honour the allowlist rather than inverting it. The previous form built an
    // `allow_origin(Any)` layer on the *non-empty* branch, so configuring
    // CORS_ORIGINS to lock the API down did the exact opposite.
    let origins: Vec<HeaderValue> = state
        .config
        .cors_origins
        .iter()
        .filter_map(|o| o.parse::<HeaderValue>().ok())
        .collect();

    let cors = if origins.is_empty() {
        // Nothing configured: the browser reaches this API only through the
        // Next.js proxy, which is same-origin, so no CORS grant is needed.
        CorsLayer::new()
    } else {
        CorsLayer::new()
            .allow_methods(Any)
            .allow_headers(Any)
            .allow_origin(origins)
    };

    let api = Router::new()
        .route("/health", get(health))
        .nest("/auth", auth::routes::router())
        .merge(engine::routes::router())
        .merge(modules::actions::router())
        .merge(modules::settings::router())
        .merge(modules::invitations::router())
        .merge(modules::automations::router())
        .merge(modules::recurring::router())
        .merge(modules::reports::router())
        .merge(modules::webhooks::router())
        .merge(modules::approvals::router())
        .with_state(state);

    Router::new()
        .nest("/api", api)
        .layer(CompressionLayer::new())
        // Generous enough for a long note or a big line-item payload, small
        // enough that a runaway client cannot exhaust memory.
        .layer(RequestBodyLimitLayer::new(4 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "suite-server" }))
}
