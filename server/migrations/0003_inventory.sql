-- Products, vendors, warehouses and stock.

CREATE TABLE vendors (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  contact_name  TEXT,
  email         TEXT,
  phone         TEXT,
  website       TEXT,
  payment_terms INTEGER NOT NULL DEFAULT 30,   -- net days
  tax_number    TEXT,
  street        TEXT,
  city          TEXT,
  country       TEXT,
  owner_id      TEXT REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_vendors_org ON vendors (org_id, deleted_at);

CREATE TABLE warehouses (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  city          TEXT,
  country       TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0,
  address       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_warehouses_org ON warehouses (org_id, deleted_at);

CREATE TABLE items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  sku           TEXT,
  item_type     TEXT NOT NULL DEFAULT 'goods',    -- goods | service
  category      TEXT,
  unit          TEXT NOT NULL DEFAULT 'unit',
  sell_price    INTEGER NOT NULL DEFAULT 0,
  cost_price    INTEGER NOT NULL DEFAULT 0,
  tax_rate      INTEGER NOT NULL DEFAULT 0,       -- scaled percent
  -- Denormalised running total, kept in step with stock_moves inside the same
  -- transaction. Reading a level should not mean summing a movement ledger.
  stock_on_hand INTEGER NOT NULL DEFAULT 0,       -- scaled quantity
  reorder_level INTEGER NOT NULL DEFAULT 0,
  vendor_id     TEXT REFERENCES vendors(id),
  is_active     INTEGER NOT NULL DEFAULT 1,
  track_inventory INTEGER NOT NULL DEFAULT 1,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_items_org ON items (org_id, deleted_at);
CREATE UNIQUE INDEX idx_items_sku ON items (org_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;

-- Append-only stock ledger. Every change to `items.stock_on_hand` writes a row
-- here, so the level can always be explained.
CREATE TABLE stock_moves (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL REFERENCES items(id),
  warehouse_id  TEXT REFERENCES warehouses(id),
  move_type     TEXT NOT NULL,        -- purchase | sale | adjustment | transfer | return
  quantity      INTEGER NOT NULL,     -- scaled; signed: negative removes stock
  unit_cost     INTEGER,
  reference_entity TEXT,
  reference_id  TEXT,
  moved_on      TEXT NOT NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_stock_moves_item ON stock_moves (org_id, item_id, moved_on);
