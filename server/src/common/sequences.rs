use sqlx::{Row, SqliteConnection};

use crate::error::AppResult;

/// Allocate the next document number for `key` within an organization.
///
/// Must be called inside the same transaction as the insert that uses the
/// number. The `UPDATE ... SET next_value = next_value + 1` takes a write lock
/// on the row, so two concurrent invoices serialise instead of colliding, and
/// a rollback returns the number to the pool.
pub async fn next_number(
    tx: &mut SqliteConnection,
    org_id: &str,
    key: &str,
    default_prefix: &str,
) -> AppResult<String> {
    sqlx::query(
        "INSERT INTO number_sequences (org_id, key, prefix, padding, next_value)
         VALUES (?, ?, ?, 5, 1)
         ON CONFLICT (org_id, key) DO NOTHING",
    )
    .bind(org_id)
    .bind(key)
    .bind(default_prefix)
    .execute(&mut *tx)
    .await?;

    let row = sqlx::query(
        "UPDATE number_sequences SET next_value = next_value + 1
         WHERE org_id = ? AND key = ?
         RETURNING prefix, padding, next_value - 1 AS allocated",
    )
    .bind(org_id)
    .bind(key)
    .fetch_one(&mut *tx)
    .await?;

    let prefix: String = row.try_get("prefix").unwrap_or_default();
    let padding: i64 = row.try_get("padding").unwrap_or(5);
    let allocated: i64 = row.try_get("allocated").unwrap_or(1);

    Ok(format!(
        "{prefix}{:0width$}",
        allocated,
        width = padding.clamp(1, 12) as usize
    ))
}
