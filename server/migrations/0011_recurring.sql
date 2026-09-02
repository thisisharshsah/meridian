-- Recurring billing.
--
-- A profile is a template plus a schedule. A daily sweep finds the profiles
-- that are due and queues one job each; the job renders an invoice from the
-- template and advances the profile. Generation is therefore restartable and
-- retryable like any other background work.
CREATE TABLE recurring_profiles (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  account_id    TEXT NOT NULL REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  status        TEXT NOT NULL DEFAULT 'active',   -- active | paused | ended
  frequency     TEXT NOT NULL DEFAULT 'monthly',  -- weekly|monthly|quarterly|yearly
  -- Every `interval` periods: 2 + monthly is every other month.
  every_n       INTEGER NOT NULL DEFAULT 1,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  -- The date the next invoice is *for*. The sweep compares this against today.
  next_run_date TEXT NOT NULL,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  currency      TEXT NOT NULL DEFAULT 'USD',
  -- Issue the generated invoice straight away rather than leaving a draft.
  auto_issue    INTEGER NOT NULL DEFAULT 0,
  -- Stop after this many invoices; NULL runs until end_date or forever.
  max_occurrences INTEGER,
  occurrences   INTEGER NOT NULL DEFAULT 0,
  last_invoice_id TEXT REFERENCES invoices(id),
  last_run_at   TEXT,
  subtotal      INTEGER NOT NULL DEFAULT 0,
  discount_total INTEGER NOT NULL DEFAULT 0,
  tax_total     INTEGER NOT NULL DEFAULT 0,
  total         INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_recurring_org ON recurring_profiles (org_id, deleted_at);
-- The sweep's only query.
CREATE INDEX idx_recurring_due ON recurring_profiles (status, next_run_date);

CREATE TABLE recurring_profile_items (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recurring_profile_id TEXT NOT NULL REFERENCES recurring_profiles(id) ON DELETE CASCADE,
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
CREATE INDEX idx_recurring_items_parent
  ON recurring_profile_items (org_id, recurring_profile_id, sort_order);

-- Which profile produced an invoice, so a generated document can be traced back.
ALTER TABLE invoices ADD COLUMN recurring_profile_id TEXT REFERENCES recurring_profiles(id);
CREATE INDEX idx_invoices_recurring ON invoices (org_id, recurring_profile_id);
