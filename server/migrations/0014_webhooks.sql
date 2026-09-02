-- Outbound webhooks.
--
-- Delivery rides the existing job queue rather than blocking a request: a slow
-- or unreachable endpoint must never make someone's save slow or fail, and a
-- failed delivery should retry with backoff like any other background work.
CREATE TABLE webhooks (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  url           TEXT NOT NULL,
  -- Shared secret for the HMAC-SHA256 signature. Shown once at creation.
  secret        TEXT NOT NULL,
  -- JSON array of `entity.action`, e.g. ["crm.deals.create","books.invoices.*"]
  events        TEXT NOT NULL DEFAULT '[]',
  is_active     INTEGER NOT NULL DEFAULT 1,
  -- Rolling health, so a broken endpoint is visible without reading deliveries.
  last_status   INTEGER,
  last_error    TEXT,
  last_delivered_at TEXT,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_webhooks_org ON webhooks (org_id, is_active, deleted_at);

-- A log of what was sent and what came back, for debugging an integration.
CREATE TABLE webhook_deliveries (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  webhook_id    TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event         TEXT NOT NULL,
  record_id     TEXT,
  status        TEXT NOT NULL,          -- pending | delivered | failed
  response_code INTEGER,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_deliveries_webhook ON webhook_deliveries (org_id, webhook_id, created_at);
