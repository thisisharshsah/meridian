-- Make the search index readable.
--
-- 0012 declared the FTS5 table `content=''` (contentless), which stores terms
-- only: a MATCH finds the row, but SELECTing its columns returns nothing. The
-- entity and record id have to come back out of the index to be useful, so this
-- rebuilds it as an ordinary FTS5 table that stores the values it indexes.
--
-- `search_map` stays: FTS5 gives no index on UNINDEXED columns, so deleting a
-- record's row still needs its rowid looked up rather than scanned for.
DROP TABLE IF EXISTS search_index;

CREATE VIRTUAL TABLE search_index USING fts5(
  title,
  body,
  entity      UNINDEXED,
  record_id   UNINDEXED,
  org_id      UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);

-- Everything indexed under the old table is gone with it; the map goes too, so
-- the next write or an explicit reindex rebuilds from the real tables.
DELETE FROM search_map;
