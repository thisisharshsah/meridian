-- A session can now exist before a workspace does.
--
-- Someone who was invited signs up, signs in, and only then picks a business --
-- either by starting one or by accepting an invitation. Their refresh token
-- belongs to the person, not to a company, so org_id has to be able to hold
-- nothing. SQLite cannot relax NOT NULL in place, so the table is rebuilt.

CREATE TABLE refresh_tokens_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id        TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  token_digest  TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  created_at    TEXT NOT NULL
);

INSERT INTO refresh_tokens_new (id, user_id, org_id, token_digest, user_agent, expires_at, revoked_at, created_at)
SELECT id, user_id, org_id, token_digest, user_agent, expires_at, revoked_at, created_at FROM refresh_tokens;

DROP TABLE refresh_tokens;
ALTER TABLE refresh_tokens_new RENAME TO refresh_tokens;

CREATE INDEX idx_refresh_user ON refresh_tokens (user_id, revoked_at);
