use std::sync::Arc;

use sqlx::SqlitePool;

use crate::config::Config;
use crate::engine::schema::Registry;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub config: Arc<Config>,
    pub registry: Arc<Registry>,
}
