-- Over-the-counter sales: the till.
--
-- The invoice chain assumes a named customer who is billed and pays later. A
-- shop takes cash from someone whose name it never learns, a hundred times a
-- day, and the stock leaves the shelf as it happens. Same document shape as an
-- invoice so the totalling machinery is shared, but the customer is optional
-- and the sale is settled at the moment it is rung up.

CREATE TABLE counter_sales (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number         TEXT NOT NULL,
  account_id     TEXT REFERENCES accounts(id),
  sold_at        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',    -- open|completed|voided
  payment_method TEXT NOT NULL DEFAULT 'cash',    -- cash|card|transfer|other
  currency       TEXT NOT NULL DEFAULT 'USD',
  subtotal       INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total      INTEGER NOT NULL DEFAULT 0,
  total          INTEGER NOT NULL DEFAULT 0,
  amount_tendered INTEGER NOT NULL DEFAULT 0,
  change_given   INTEGER NOT NULL DEFAULT 0,
  served_by      TEXT REFERENCES users(id),
  notes          TEXT,
  stocked_at     TEXT,                            -- when stock was taken off the shelf
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_by     TEXT,
  deleted_at     TEXT
);

CREATE INDEX idx_counter_sales_org ON counter_sales (org_id, deleted_at);
CREATE INDEX idx_counter_sales_day ON counter_sales (org_id, sold_at, status);

CREATE TABLE counter_sale_items (
  id               TEXT PRIMARY KEY,
  org_id           TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  counter_sale_id  TEXT NOT NULL REFERENCES counter_sales(id) ON DELETE CASCADE,
  item_id          TEXT REFERENCES items(id),
  description      TEXT NOT NULL,
  quantity         INTEGER NOT NULL DEFAULT 1000,
  unit_price       INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  tax_rate         INTEGER NOT NULL DEFAULT 0,
  line_total       INTEGER NOT NULL DEFAULT 0,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  created_by       TEXT,
  updated_by       TEXT,
  deleted_at       TEXT
);

CREATE INDEX idx_counter_sale_items_sale ON counter_sale_items (org_id, counter_sale_id, sort_order);
