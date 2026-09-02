-- Identity, tenancy and the cross-cutting tables every module leans on.
--
-- Conventions used by every table in this schema:
--   id          TEXT  UUIDv7, time-ordered so it doubles as a stable sort key
--   org_id      TEXT  the tenant. Present on every business table, always indexed.
--   created_at  TEXT  RFC3339 UTC. SQLite has no timestamp type; ISO-8601 text
--                     sorts and compares correctly, and ports to Postgres.
--   deleted_at  TEXT  soft delete. Every read path filters `deleted_at IS NULL`.
--   money       INTEGER minor units (cents). Never a float.

CREATE TABLE organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  currency      TEXT NOT NULL DEFAULT 'USD',
  country       TEXT,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  fiscal_year_start_month INTEGER NOT NULL DEFAULT 1,
  logo_url      TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

-- A person. Users are global; membership binds them to an organization, so the
-- same login can belong to several tenants.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  phone         TEXT,
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
-- Case-insensitive uniqueness: `Ann@x.com` and `ann@x.com` are one account.
CREATE UNIQUE INDEX idx_users_email ON users (lower(email));

CREATE TABLE roles (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  -- JSON array of permission strings: ["*"] or ["crm.*", "books.invoices.view"]
  permissions   TEXT NOT NULL DEFAULT '[]',
  is_system     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_roles_org_key ON roles (org_id, key);

CREATE TABLE memberships (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id       TEXT NOT NULL REFERENCES roles(id),
  is_owner      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | invited | suspended
  title         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_memberships_org_user ON memberships (org_id, user_id);
CREATE INDEX idx_memberships_user ON memberships (user_id);

-- Refresh tokens are stored as SHA-256 digests: a dump of this table does not
-- hand an attacker live sessions.
CREATE TABLE refresh_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_digest  TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_refresh_user ON refresh_tokens (user_id, revoked_at);

-- Append-only history of every write, for the record timeline and for audit.
CREATE TABLE audit_log (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       TEXT,
  entity        TEXT NOT NULL,     -- entity key, e.g. `crm.deals`
  record_id     TEXT NOT NULL,
  action        TEXT NOT NULL,     -- create | update | delete | login | convert | ...
  summary       TEXT,
  changes       TEXT,              -- JSON: {field: {from, to}}
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_audit_record ON audit_log (org_id, entity, record_id, created_at);
CREATE INDEX idx_audit_org_time ON audit_log (org_id, created_at);

-- Per-tenant document numbering (INV-0001, SO-0042). `next_value` is bumped
-- inside the same transaction as the insert, so two concurrent invoices cannot
-- take the same number.
CREATE TABLE number_sequences (
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,     -- `books.invoices`
  prefix        TEXT NOT NULL DEFAULT '',
  padding       INTEGER NOT NULL DEFAULT 5,
  next_value    INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (org_id, key)
);
