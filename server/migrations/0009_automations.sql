-- User-defined automation rules.
--
-- The engine already knows every entity, field and permission, so a rule only
-- has to say: on this entity, when this happens, if these conditions hold, do
-- these things. Conditions and actions are JSON because their shape varies by
-- field kind; everything they can name is validated against the registry before
-- a rule is stored, so a rule can never reference a field that does not exist.
CREATE TABLE automations (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  entity        TEXT NOT NULL,           -- registry key, e.g. `crm.deals`
  trigger       TEXT NOT NULL,           -- on_create | on_update | on_create_or_update
  conditions    TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  actions       TEXT NOT NULL DEFAULT '[]',
  is_active     INTEGER NOT NULL DEFAULT 1,
  run_count     INTEGER NOT NULL DEFAULT 0,
  last_run_at   TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_automations_lookup
  ON automations (org_id, entity, is_active, deleted_at);
