-- Batches, for anything sold with a date on it.
--
-- A pharmacy does not hold "40 boxes of amoxicillin"; it holds 12 from one
-- batch that runs out in March and 28 from another that runs out next year,
-- and the March ones must go first. The same shape covers a grocer's dairy
-- cabinet and a workshop's sealants, so this sits in inventory rather than in
-- a pharmacy module.
--
-- Stock movements stay the single ledger. A batch is a bucket that movements
-- are tagged with, so what is left in a batch and what is left of an item are
-- the same arithmetic read two ways, and cannot drift apart.

CREATE TABLE item_batches (
  id                TEXT PRIMARY KEY,
  org_id            TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES items(id),
  batch_no          TEXT NOT NULL,
  expiry_date       TEXT,
  received_on       TEXT NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_left     INTEGER NOT NULL DEFAULT 0,
  unit_cost         INTEGER NOT NULL DEFAULT 0,
  vendor_id         TEXT REFERENCES vendors(id),
  warehouse_id      TEXT REFERENCES warehouses(id),
  notes             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  created_by        TEXT,
  updated_by        TEXT,
  deleted_at        TEXT
);

-- Oldest-first is the only order this table is ever read in, so it is indexed
-- that way rather than by insertion.
CREATE INDEX idx_item_batches_fefo ON item_batches (org_id, item_id, expiry_date);
CREATE INDEX idx_item_batches_expiry ON item_batches (org_id, expiry_date, deleted_at);

-- One batch number per item. Two deliveries under the same number are the
-- same batch and belong on one row, or the count is wrong twice over.
CREATE UNIQUE INDEX idx_item_batches_no
  ON item_batches (org_id, item_id, batch_no) WHERE deleted_at IS NULL;

ALTER TABLE stock_moves ADD COLUMN batch_id TEXT REFERENCES item_batches(id);
CREATE INDEX idx_stock_moves_batch ON stock_moves (org_id, batch_id);

-- Off by default: most items have no date on them, and asking a plumber for a
-- batch number on a length of pipe is how a product stops being used.
ALTER TABLE items ADD COLUMN track_batches INTEGER NOT NULL DEFAULT 0;
