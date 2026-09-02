-- Approval chains.
--
-- A rule says: on this entity, when a record matches these conditions, someone
-- holding this role has to approve it. Approving or rejecting writes a decision
-- back onto the record — which is what makes it an approval rather than a note.
CREATE TABLE approval_rules (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  entity        TEXT NOT NULL,
  conditions    TEXT NOT NULL DEFAULT '{"match":"all","rules":[]}',
  -- Who may decide: anyone holding this role, or one named person.
  approver_role_id TEXT REFERENCES roles(id),
  approver_user_id TEXT REFERENCES users(id),
  -- The field a decision writes to, and what it writes.
  decision_field   TEXT NOT NULL,
  approved_value   TEXT NOT NULL,
  rejected_value   TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_approval_rules_lookup
  ON approval_rules (org_id, entity, is_active, deleted_at);

CREATE TABLE approval_requests (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id       TEXT NOT NULL REFERENCES approval_rules(id) ON DELETE CASCADE,
  entity        TEXT NOT NULL,
  record_id     TEXT NOT NULL,
  record_title  TEXT,
  summary       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|approved|rejected|cancelled
  requested_by  TEXT REFERENCES users(id),
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT,
  comment       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
-- One outstanding request per record per rule: re-saving a record that already
-- awaits a decision must not queue a second one.
CREATE UNIQUE INDEX idx_approval_pending
  ON approval_requests (org_id, rule_id, record_id)
  WHERE status = 'pending';
CREATE INDEX idx_approval_queue ON approval_requests (org_id, status, created_at);
