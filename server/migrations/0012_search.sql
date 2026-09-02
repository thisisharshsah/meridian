-- Full-text search.
--
-- `LIKE '%term%'` cannot use an index, so cross-module search was a table scan
-- per entity. This replaces it with one FTS5 index over every searchable
-- record.
--
-- The index is *contentless* (`content=''`): FTS5 stores only the terms, and
-- the row it points back to is fetched from its real table. That keeps the
-- index small, and — the reason it matters here — means the index cannot become
-- a second place where a tenant's data can be read. `org_id` is stored as an
-- UNINDEXED column so every query filters by it exactly as the repository does.
CREATE VIRTUAL TABLE search_index USING fts5(
  title,
  body,
  entity      UNINDEXED,
  record_id   UNINDEXED,
  org_id      UNINDEXED,
  content='',
  tokenize='unicode61 remove_diacritics 2'
);

-- FTS5 has no UPDATE/DELETE by column, so a contentless index needs its own
-- map from (org, entity, record) to the rowid holding it.
CREATE TABLE search_map (
  rowid_ref   INTEGER PRIMARY KEY,
  org_id      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_search_map_record ON search_map (org_id, entity, record_id);
