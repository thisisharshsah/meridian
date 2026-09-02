-- Sales and purchase documents: quotes, sales orders, invoices, purchase
-- orders, bills, and their line items.
--
-- Totals live on the document and are recomputed from the lines on every
-- write, so a list view never has to sum children to show an amount.

CREATE TABLE quotes (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  deal_id       TEXT REFERENCES deals(id),
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|accepted|declined|expired
  quote_date    TEXT NOT NULL,
  valid_until   TEXT,
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  terms         TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
-- Document numbers are unique per tenant. The partial index lets a soft-deleted
-- document release its number without colliding with live rows.
CREATE UNIQUE INDEX idx_quotes_number ON quotes (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_quotes_org ON quotes (org_id, deleted_at);
CREATE INDEX idx_quotes_account ON quotes (org_id, account_id);

CREATE TABLE quote_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  quote_id      TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_id       TEXT REFERENCES items(id),
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  tax_rate      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_quote_items_parent ON quote_items (org_id, quote_id, sort_order);

CREATE TABLE sales_orders (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  quote_id      TEXT REFERENCES quotes(id),
  status        TEXT NOT NULL DEFAULT 'open',    -- open|confirmed|fulfilled|invoiced|cancelled
  order_date    TEXT NOT NULL,
  delivery_date TEXT,
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  shipping_street TEXT,
  shipping_city TEXT,
  shipping_country TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_sales_orders_number ON sales_orders (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_sales_orders_org ON sales_orders (org_id, deleted_at);

CREATE TABLE sales_order_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sales_order_id TEXT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  item_id       TEXT REFERENCES items(id),
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  tax_rate      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_so_items_parent ON sales_order_items (org_id, sales_order_id, sort_order);

CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  subject       TEXT,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  sales_order_id TEXT REFERENCES sales_orders(id),
  project_id    TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|sent|partial|paid|overdue|void
  invoice_date  TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  amount_paid   INTEGER NOT NULL DEFAULT 0,
  balance_due   INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  terms         TEXT,
  notes         TEXT,
  sent_at       TEXT,
  paid_at       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_invoices_number ON invoices (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_invoices_org ON invoices (org_id, deleted_at);
CREATE INDEX idx_invoices_status_due ON invoices (org_id, status, due_date);
CREATE INDEX idx_invoices_account ON invoices (org_id, account_id);

CREATE TABLE invoice_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id       TEXT REFERENCES items(id),
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  tax_rate      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_invoice_items_parent ON invoice_items (org_id, invoice_id, sort_order);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  invoice_id    TEXT REFERENCES invoices(id),
  account_id    TEXT REFERENCES accounts(id),
  amount        INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  payment_date  TEXT NOT NULL,
  method        TEXT NOT NULL DEFAULT 'bank_transfer',  -- cash|card|bank_transfer|cheque|other
  reference     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_payments_number ON payments (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_payments_invoice ON payments (org_id, invoice_id);

CREATE TABLE purchase_orders (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  vendor_id     TEXT NOT NULL REFERENCES vendors(id),
  warehouse_id  TEXT REFERENCES warehouses(id),
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|issued|received|billed|cancelled
  order_date    TEXT NOT NULL,
  expected_date TEXT,
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  notes         TEXT,
  received_at   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_po_number ON purchase_orders (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_po_org ON purchase_orders (org_id, deleted_at);

CREATE TABLE purchase_order_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  purchase_order_id TEXT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  item_id       TEXT REFERENCES items(id),
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1000,
  unit_price    INTEGER NOT NULL DEFAULT 0,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  tax_rate      INTEGER NOT NULL DEFAULT 0,
  line_total    INTEGER NOT NULL DEFAULT 0,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_po_items_parent ON purchase_order_items (org_id, purchase_order_id, sort_order);

CREATE TABLE bills (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  vendor_id     TEXT NOT NULL REFERENCES vendors(id),
  purchase_order_id TEXT REFERENCES purchase_orders(id),
  status        TEXT NOT NULL DEFAULT 'open',    -- open|partial|paid|overdue|void
  bill_date     TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  subtotal      INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  amount_paid   INTEGER NOT NULL DEFAULT 0,
  balance_due   INTEGER NOT NULL DEFAULT 0,
  reference     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_bills_number ON bills (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_bills_org ON bills (org_id, deleted_at);

CREATE TABLE expenses (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',
  amount        INTEGER NOT NULL DEFAULT 0,
  tax_amount    INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  expense_date  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|submitted|approved|rejected|reimbursed
  vendor_id     TEXT REFERENCES vendors(id),
  account_id    TEXT REFERENCES accounts(id),
  project_id    TEXT,
  employee_id   TEXT,
  billable      INTEGER NOT NULL DEFAULT 0,
  reference     TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_expenses_number ON expenses (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_org ON expenses (org_id, deleted_at);
