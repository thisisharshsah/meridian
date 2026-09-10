mod auth;
mod common;
mod config;
mod db;
mod engine;
mod error;
mod jobs;
mod maintenance;
mod modules;
mod editions;
mod seed;
mod state;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use axum::extract::State;
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

    // The edition is applied before validation, not after: pruning a module
    // is meant to leave a consistent registry, and validate() is what proves
    // it did.
    let edition = editions::find(&config.edition).expect("config rejects an unknown edition");
    let mut registry = modules::registry();
    registry.retain_edition(edition);
    registry
        .validate()
        .map_err(|e| anyhow::anyhow!("entity registry is inconsistent: {e}"))?;
    tracing::info!(
        edition = edition.key,
        product = edition.name,
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

    // Selling a package is an operator's job, not an owner's, so it is done
    // from the machine rather than from a screen inside the product. An owner
    // who could grant their own licence would not have one.
    match std::env::args().nth(1).as_deref() {
        Some("editions") => return editions_command(&state).await,
        Some("licence") | Some("license") => {
            let args: Vec<String> = std::env::args().skip(2).collect();
            return licence_command(&state, &args).await;
        }
        _ => {}
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

/// Unauthenticated on purpose, so a health check needs no credentials. It
/// says which package is being served because that is the one fact an
/// operator most often needs and most easily gets wrong — the file having
/// been edited since the last restart.
async fn health(State(state): State<AppState>) -> Json<serde_json::Value> {
    let edition = editions::find(&state.config.edition);
    Json(json!({
        "status": "ok",
        "service": "suite-server",
        "edition": state.config.edition,
        // The name this installation is sold under. Unauthenticated because
        // the sign-in page needs it, and it gives nothing away: a customer
        // knows which product they bought.
        "product": edition.map(|e| e.name),
    }))
}

/// What this installation carries, and what each workspace on it was sold.
async fn editions_command(state: &AppState) -> anyhow::Result<()> {
    let mine = editions::find(&state.config.edition).expect("config rejects an unknown edition");
    println!("\nThis installation is {} ({})", mine.name, mine.key);
    println!("  {}", mine.description);
    let carried = state.registry.modules().iter().map(|m| m.label).collect::<Vec<_>>().join(", ");
    println!("  carries: {carried}\n");

    println!("Packages this installation can sell:");
    for e in editions::EDITIONS {
        if e.fits_within(mine) {
            println!("  {:<10} {:<22} {}", e.key, e.name, e.description);
        }
    }

    let rows = sqlx::query("SELECT name, slug, edition FROM organizations WHERE deleted_at IS NULL ORDER BY name")
        .fetch_all(&state.pool)
        .await?;
    if !rows.is_empty() {
        println!("\nWorkspaces:");
        for r in &rows {
            use sqlx::Row;
            let name: String = r.try_get("name").unwrap_or_default();
            let slug: String = r.try_get("slug").unwrap_or_default();
            let sold: Option<String> = r.try_get("edition").unwrap_or(None);
            let label = match sold.as_deref().and_then(editions::find) {
                // A licence sold on a wider installation than this one is not
                // honoured -- the build is the ceiling -- so say so rather
                // than print a package this machine cannot serve.
                Some(e) if !e.fits_within(mine) => {
                    format!("{} ({}) — NOT SERVED, this build is {}", e.name, e.key, mine.name)
                }
                Some(e) => format!("{} ({})", e.name, e.key),
                // Nothing recorded means the whole installation, which is
                // already the ceiling.
                None => format!("{} — this installation", mine.name),
            };
            println!("  {slug:<24} {label}   [{name}]");
        }
    }
    println!();
    Ok(())
}

/// `suite-server licence <workspace-slug> <edition|clear>`
async fn licence_command(state: &AppState, args: &[String]) -> anyhow::Result<()> {
    let mine = editions::find(&state.config.edition).expect("config rejects an unknown edition");
    let (Some(slug), Some(wanted)) = (args.first(), args.get(1)) else {
        anyhow::bail!("usage: suite-server licence <workspace-slug> <edition|clear>");
    };

    let org: Option<(String, String)> =
        sqlx::query_as("SELECT id, name FROM organizations WHERE slug = ? AND deleted_at IS NULL")
            .bind(slug)
            .fetch_optional(&state.pool)
            .await?;
    let Some((org_id, name)) = org else {
        anyhow::bail!("no workspace with the slug `{slug}`. `suite-server editions` lists them.");
    };

    let value = if wanted == "clear" {
        None
    } else {
        let Some(e) = editions::find(wanted) else {
            anyhow::bail!("`{wanted}` is not an edition. `suite-server editions` lists them.");
        };
        // Refused rather than clamped: an operator asking to sell rooms on an
        // installation with no rooms in it has made a mistake worth hearing
        // about, not one worth silently correcting.
        if !e.fits_within(mine) {
            anyhow::bail!(
                "this installation is {} and does not carry everything {} needs",
                mine.name,
                e.name
            );
        }
        Some(e.key)
    };

    sqlx::query("UPDATE organizations SET edition = ?, updated_at = ? WHERE id = ?")
        .bind(value)
        .bind(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
        .bind(&org_id)
        .execute(&state.pool)
        .await?;

    // Sections already switched on that the new package does not include are
    // dropped, or the workspace keeps showing a menu it no longer has.
    if let Some(key) = value {
        let e = editions::find(key).expect("checked above");
        let rows: Vec<(String,)> = sqlx::query_as("SELECT module_key FROM org_modules WHERE org_id = ?")
            .bind(&org_id)
            .fetch_all(&state.pool)
            .await?;
        for (module,) in rows.iter().filter(|(m,)| !e.carries(m)) {
            sqlx::query("DELETE FROM org_modules WHERE org_id = ? AND module_key = ?")
                .bind(&org_id)
                .bind(module)
                .execute(&state.pool)
                .await?;
            println!("  dropped `{module}`, which {} does not include", e.name);
        }
    }

    match value {
        Some(key) => println!("{name} is now on {}", editions::find(key).unwrap().name),
        None => println!("{name} is back to whatever this installation is ({})", mine.name),
    }
    Ok(())
}
