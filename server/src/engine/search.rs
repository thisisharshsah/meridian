//! Full-text search over every searchable record.
//!
//! The index is maintained on write: creating or updating a record rewrites its
//! row, deleting one removes it. That keeps search consistent without a
//! reindex job, and the cost is a couple of small statements on a path that is
//! already writing to disk.
//!
//! Tenant scoping is the thing to be careful about. `org_id` lives in the index
//! as an UNINDEXED column and *every* query filters on it, exactly as the
//! repository does — a search index is a second copy of the data, so it is a
//! second place isolation can be got wrong.
//!
//! The FTS5 table stores the values it indexes rather than being contentless: a
//! contentless index answers MATCH but returns nothing when its columns are
//! selected, and the entity and record id have to come back out to be useful.

use serde_json::Value;
use sqlx::{Row, SqlitePool};

use crate::auth::ctx::{Action, Ctx};
use crate::engine::schema::{EntityDef, FieldKind, Registry};
use crate::error::AppResult;

/// Text worth indexing for a record: its title, plus every searchable field.
fn extract(def: &EntityDef, record: &Value) -> (String, String) {
    let title = record
        .get(def.title_field)
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();

    let mut parts: Vec<String> = Vec::new();
    for f in &def.fields {
        if !f.searchable && !matches!(f.kind, FieldKind::LongText) {
            continue;
        }
        if let Some(s) = record.get(f.name).and_then(|v| v.as_str()) {
            if !s.trim().is_empty() {
                parts.push(s.to_string());
            }
        }
    }
    // Reference labels are how people actually remember a record ("the Acme
    // invoice"), so index those too.
    if let Some(obj) = record.as_object() {
        for (k, v) in obj {
            if k.ends_with("__label") {
                if let Some(s) = v.as_str() {
                    parts.push(s.to_string());
                }
            }
        }
    }

    (title, parts.join(" "))
}

/// Insert or replace one record's entry.
pub async fn index_record(
    pool: &SqlitePool,
    def: &EntityDef,
    org_id: &str,
    record_id: &str,
    record: &Value,
) -> AppResult<()> {
    if !def.global_search {
        return Ok(());
    }
    let (title, body) = extract(def, record);
    if title.trim().is_empty() && body.trim().is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    // A contentless FTS5 table cannot be updated in place: the old row has to
    // be deleted by rowid, which is what search_map remembers.
    let existing: Option<i64> = sqlx::query(
        "SELECT rowid_ref FROM search_map WHERE org_id = ? AND entity = ? AND record_id = ?",
    )
    .bind(org_id)
    .bind(def.key)
    .bind(record_id)
    .fetch_optional(&mut *tx)
    .await?
    .and_then(|r| r.try_get("rowid_ref").ok());

    if let Some(rowid) = existing {
        sqlx::query("DELETE FROM search_index WHERE rowid = ?")
            .bind(rowid)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM search_map WHERE rowid_ref = ?")
            .bind(rowid)
            .execute(&mut *tx)
            .await?;
    }

    let res = sqlx::query(
        "INSERT INTO search_index (title, body, entity, record_id, org_id) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&title)
    .bind(&body)
    .bind(def.key)
    .bind(record_id)
    .bind(org_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO search_map (rowid_ref, org_id, entity, record_id, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))",
    )
    .bind(res.last_insert_rowid())
    .bind(org_id)
    .bind(def.key)
    .bind(record_id)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

/// Drop a record from the index. A deleted record must stop being findable.
pub async fn remove_record(
    pool: &SqlitePool,
    entity: &str,
    org_id: &str,
    record_id: &str,
) -> AppResult<()> {
    let existing: Option<i64> = sqlx::query(
        "SELECT rowid_ref FROM search_map WHERE org_id = ? AND entity = ? AND record_id = ?",
    )
    .bind(org_id)
    .bind(entity)
    .bind(record_id)
    .fetch_optional(pool)
    .await?
    .and_then(|r| r.try_get("rowid_ref").ok());

    if let Some(rowid) = existing {
        sqlx::query("DELETE FROM search_index WHERE rowid = ?")
            .bind(rowid)
            .execute(pool)
            .await?;
        sqlx::query("DELETE FROM search_map WHERE rowid_ref = ?")
            .bind(rowid)
            .execute(pool)
            .await?;
    }
    Ok(())
}

/// Turn a user's typing into an FTS5 query.
///
/// Users type words, not query syntax, and FTS5 treats `-`, `"`, `*`, `NEAR`
/// and friends as operators — an unescaped apostrophe or hyphen is a syntax
/// error, not a search. Each word is quoted, and a trailing `*` makes the last
/// one a prefix so results appear while typing.
pub fn to_match_query(term: &str) -> Option<String> {
    let words: Vec<String> = term
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(|w| w.to_lowercase())
        .collect();

    if words.is_empty() {
        return None;
    }

    let last = words.len() - 1;
    let parts: Vec<String> = words
        .iter()
        .enumerate()
        .map(|(i, w)| {
            if i == last && w.len() >= 2 {
                format!("\"{w}\"*")
            } else {
                format!("\"{w}\"")
            }
        })
        .collect();

    Some(parts.join(" AND "))
}

pub struct Hit {
    pub entity: String,
    pub record_id: String,
    pub title: String,
}

/// Search every entity the caller may view, best matches first.
pub async fn query(
    pool: &SqlitePool,
    registry: &Registry,
    ctx: &Ctx,
    term: &str,
    limit: i64,
) -> AppResult<Vec<Hit>> {
    let Some(match_query) = to_match_query(term) else {
        return Ok(Vec::new());
    };

    // Ask for more than we need: rows are dropped below for entities this role
    // cannot view, and for records deleted since they were indexed.
    let rows = sqlx::query(
        "SELECT entity, record_id, title
           FROM search_index
          WHERE search_index MATCH ?
            AND org_id = ?
          ORDER BY rank
          LIMIT ?",
    )
    .bind(&match_query)
    .bind(&ctx.org_id)
    .bind(limit * 4)
    .fetch_all(pool)
    .await?;

    let mut hits = Vec::new();
    for r in &rows {
        let entity: String = r.try_get("entity").unwrap_or_default();
        let Some(def) = registry.get(&entity) else { continue };
        if !def.global_search || !ctx.can(def.key, Action::View) {
            continue;
        }
        hits.push(Hit {
            entity,
            record_id: r.try_get("record_id").unwrap_or_default(),
            title: r.try_get("title").unwrap_or_default(),
        });
        if hits.len() as i64 >= limit {
            break;
        }
    }

    Ok(hits)
}

/// Rebuild the whole index for one organization.
///
/// Needed once, for data written before the index existed, and useful after a
/// bulk import. Returns how many records were indexed.
pub async fn reindex_org(
    pool: &SqlitePool,
    registry: &Registry,
    ctx: &Ctx,
) -> AppResult<usize> {
    sqlx::query("DELETE FROM search_map WHERE org_id = ?")
        .bind(&ctx.org_id)
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM search_index WHERE org_id = ?")
        .bind(&ctx.org_id)
        .execute(pool)
        .await?;

    let mut count = 0;

    for def in registry.entities() {
        if !def.global_search || def.read_only {
            continue;
        }
        let page = crate::engine::repo::list(
            pool,
            registry,
            def,
            ctx,
            &crate::engine::repo::ListQuery {
                page: 1,
                per_page: 500,
                search: None,
                sort: None,
                filters: Vec::new(),
            },
        )
        .await?;

        for record in &page.data {
            let Some(id) = record.get("id").and_then(|v| v.as_str()) else { continue };
            index_record(pool, def, &ctx.org_id, id, record).await?;
            count += 1;
        }
    }

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_words_become_a_prefix_query() {
        assert_eq!(to_match_query("acme").unwrap(), "\"acme\"*");
        assert_eq!(to_match_query("acme rollout").unwrap(), "\"acme\" AND \"rollout\"*");
    }

    #[test]
    fn fts_operators_in_user_input_are_neutralised() {
        // Each of these is a syntax error if passed through raw.
        for hostile in ["blue-harbor", "o'brien", "NEAR(a b)", "foo*", "\"quoted\"", "a OR b"] {
            let q = to_match_query(hostile).expect("should produce a query");
            // Every term ends up quoted, so nothing is left to parse as syntax.
            assert!(q.contains('"'), "{hostile} -> {q}");
            assert!(!q.contains("NEAR("), "{hostile} -> {q}");
        }
    }

    #[test]
    fn punctuation_only_input_searches_for_nothing() {
        assert!(to_match_query("").is_none());
        assert!(to_match_query("   ").is_none());
        assert!(to_match_query("!!! ---").is_none());
    }

    #[test]
    fn a_single_character_is_not_turned_into_a_prefix_scan() {
        // `"a"*` would match a large share of the index for one keystroke.
        assert_eq!(to_match_query("a").unwrap(), "\"a\"");
    }
}
