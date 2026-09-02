use chrono::Utc;
use serde_json::{Map, Value};
use sqlx::{Executor, Sqlite};

use crate::auth::ctx::Ctx;
use crate::common::ids::new_id;
use crate::error::AppResult;

/// Record one write to the append-only audit log. Takes any executor so it can
/// join the caller's transaction - an audit row that survives a rolled-back
/// write would be a lie.
pub async fn record<'e, E>(
    exec: E,
    ctx: &Ctx,
    entity: &str,
    record_id: &str,
    action: &str,
    summary: Option<String>,
    changes: Option<Value>,
) -> AppResult<()>
where
    E: Executor<'e, Database = Sqlite>,
{
    sqlx::query(
        "INSERT INTO audit_log (id, org_id, user_id, entity, record_id, action, summary, changes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(new_id())
    .bind(&ctx.org_id)
    .bind(&ctx.user_id)
    .bind(entity)
    .bind(record_id)
    .bind(action)
    .bind(summary)
    .bind(changes.map(|c| c.to_string()))
    .bind(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
    .execute(exec)
    .await?;
    Ok(())
}

/// Field-level diff between the record as it was and as it now is, skipping
/// bookkeeping columns nobody wants to read in a timeline.
pub fn diff(before: &Value, after: &Value) -> Option<Value> {
    let (Some(b), Some(a)) = (before.as_object(), after.as_object()) else {
        return None;
    };
    const SKIP: [&str; 5] = ["updated_at", "updated_by", "created_at", "created_by", "id"];

    let mut changes = Map::new();
    for (k, av) in a {
        if SKIP.contains(&k.as_str()) || k.ends_with("__label") {
            continue;
        }
        let bv = b.get(k).unwrap_or(&Value::Null);
        if bv != av {
            let mut entry = Map::new();
            entry.insert("from".into(), bv.clone());
            entry.insert("to".into(), av.clone());
            changes.insert(k.clone(), Value::Object(entry));
        }
    }
    if changes.is_empty() {
        None
    } else {
        Some(Value::Object(changes))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn diff_reports_only_real_changes() {
        let before = json!({"name": "Acme", "stage": "new", "updated_at": "t1"});
        let after = json!({"name": "Acme", "stage": "won", "updated_at": "t2"});
        let d = diff(&before, &after).unwrap();
        assert_eq!(d["stage"]["from"], json!("new"));
        assert_eq!(d["stage"]["to"], json!("won"));
        assert!(d.get("name").is_none());
        assert!(d.get("updated_at").is_none(), "bookkeeping columns are noise");
    }

    #[test]
    fn identical_records_produce_no_entry() {
        let v = json!({"name": "Acme"});
        assert!(diff(&v, &v).is_none());
    }
}
