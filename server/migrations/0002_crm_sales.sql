-- CRM and Sales.
--
-- Money columns are INTEGER minor units, quantities are scaled by 1_000 and
-- percentages by 10_000, matching `common::money`. Every table carries the
-- org_id / audit / soft-delete columns the generic repository expects.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  account_type  TEXT,           -- customer | prospect | vendor | partner | competitor
  industry      TEXT,
  website       TEXT,
  phone         TEXT,
  email         TEXT,
  employees     INTEGER,
  annual_revenue INTEGER,
  owner_id      TEXT REFERENCES users(id),
  billing_street TEXT,
  billing_city  TEXT,
  billing_state TEXT,
  billing_postal_code TEXT,
  billing_country TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_accounts_org ON accounts (org_id, deleted_at);
CREATE INDEX idx_accounts_owner ON accounts (org_id, owner_id);
CREATE INDEX idx_accounts_name ON accounts (org_id, name);

CREATE TABLE contacts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name    TEXT,
  last_name     TEXT NOT NULL,
  full_name     TEXT NOT NULL,          -- denormalised for search and titles
  account_id    TEXT REFERENCES accounts(id),
  title         TEXT,
  department    TEXT,
  email         TEXT,
  phone         TEXT,
  mobile        TEXT,
  lead_source   TEXT,
  owner_id      TEXT REFERENCES users(id),
  mailing_street TEXT,
  mailing_city  TEXT,
  mailing_country TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_contacts_org ON contacts (org_id, deleted_at);
CREATE INDEX idx_contacts_account ON contacts (org_id, account_id);
CREATE INDEX idx_contacts_email ON contacts (org_id, email);

-- Conversion is a state on the lead, not a delete: Zoho keeps converted leads
-- addressable, and so do we, so the funnel maths stays honest.
CREATE TABLE leads (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  first_name    TEXT,
  last_name     TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT,
  email         TEXT,
  phone         TEXT,
  mobile        TEXT,
  website       TEXT,
  status        TEXT NOT NULL DEFAULT 'new',   -- new|contacted|qualified|unqualified|converted
  lead_source   TEXT,
  industry      TEXT,
  rating        TEXT,                           -- hot | warm | cold
  score         INTEGER NOT NULL DEFAULT 0,
  annual_revenue INTEGER,
  employees     INTEGER,
  owner_id      TEXT REFERENCES users(id),
  street        TEXT,
  city          TEXT,
  country       TEXT,
  description   TEXT,
  converted_at        TEXT,
  converted_contact_id TEXT REFERENCES contacts(id),
  converted_account_id TEXT REFERENCES accounts(id),
  converted_deal_id    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_leads_org ON leads (org_id, deleted_at);
CREATE INDEX idx_leads_status ON leads (org_id, status);
CREATE INDEX idx_leads_owner ON leads (org_id, owner_id);

CREATE TABLE deals (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  stage         TEXT NOT NULL DEFAULT 'qualification',
  amount        INTEGER NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'USD',
  -- Probability is kept on the row rather than derived, so historical deals
  -- keep the odds they were actually forecast at.
  probability   INTEGER NOT NULL DEFAULT 100000,   -- scaled percent (10% = 100000)
  expected_revenue INTEGER NOT NULL DEFAULT 0,     -- amount * probability, recomputed on write
  closing_date  TEXT,
  deal_type     TEXT,                              -- new_business | existing_business | renewal
  lead_source   TEXT,
  campaign_id   TEXT,
  owner_id      TEXT REFERENCES users(id),
  next_step     TEXT,
  description   TEXT,
  closed_at     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_deals_org ON deals (org_id, deleted_at);
CREATE INDEX idx_deals_stage ON deals (org_id, stage);
CREATE INDEX idx_deals_account ON deals (org_id, account_id);
CREATE INDEX idx_deals_closing ON deals (org_id, closing_date);

-- Tasks, calls and meetings share one table: they differ by `kind`, and every
-- screen that shows "what happened with this customer" wants them interleaved.
CREATE TABLE activities (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'task',   -- task | call | meeting | note
  subject       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',   -- open | in_progress | completed | cancelled
  priority      TEXT NOT NULL DEFAULT 'normal', -- low | normal | high
  due_date      TEXT,
  start_at      TEXT,
  duration_mins INTEGER,
  owner_id      TEXT REFERENCES users(id),
  -- Polymorphic parent, mirroring Zoho's What/Who link.
  related_entity TEXT,
  related_id     TEXT,
  contact_id    TEXT REFERENCES contacts(id),
  account_id    TEXT REFERENCES accounts(id),
  deal_id       TEXT REFERENCES deals(id),
  outcome       TEXT,
  description   TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_activities_org ON activities (org_id, deleted_at);
CREATE INDEX idx_activities_related ON activities (org_id, related_entity, related_id);
CREATE INDEX idx_activities_owner_due ON activities (org_id, owner_id, due_date);

CREATE TABLE campaigns (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  campaign_type TEXT,          -- email | webinar | event | ads | content | referral
  status        TEXT NOT NULL DEFAULT 'planning',
  start_date    TEXT,
  end_date      TEXT,
  budget        INTEGER,
  actual_cost   INTEGER,
  expected_revenue INTEGER,
  target_size   INTEGER,
  responses     INTEGER NOT NULL DEFAULT 0,
  owner_id      TEXT REFERENCES users(id),
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_campaigns_org ON campaigns (org_id, deleted_at);
