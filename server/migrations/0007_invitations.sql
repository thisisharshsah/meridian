-- Workspace invitations.
--
-- There is no mail server, so an invitation is a link the inviter copies and
-- hands over themselves. That changes the threat model rather than removing it:
-- the token is the credential, so only its SHA-256 digest is stored, exactly as
-- refresh tokens are.
CREATE TABLE invitations (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  role_id       TEXT NOT NULL REFERENCES roles(id),
  title         TEXT,
  token_digest  TEXT NOT NULL UNIQUE,
  invited_by    TEXT REFERENCES users(id),
  expires_at    TEXT NOT NULL,
  accepted_at   TEXT,
  accepted_by   TEXT REFERENCES users(id),
  revoked_at    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
-- One live invitation per address per workspace; spent and revoked ones step
-- aside so the same person can be re-invited later.
CREATE UNIQUE INDEX idx_invitations_pending
  ON invitations (org_id, lower(email))
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_invitations_org ON invitations (org_id, created_at);
