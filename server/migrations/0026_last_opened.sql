-- Which business to open for someone who belongs to several.
--
-- Signing in used to answer "none of them, pick one", which put a whole screen
-- between a person and their work every single morning. The answer worth
-- giving is the one they were in last, so the membership records when it was
-- last opened. NULL means never opened since this column existed, and the
-- query falls back to when the membership was created.
--
-- It lives on the membership rather than on the user so that losing access to
-- a business cannot leave a stale pointer behind: the row that remembers is
-- the row that grants.
ALTER TABLE memberships ADD COLUMN last_opened_at TEXT;

CREATE INDEX idx_memberships_user_opened ON memberships (user_id, last_opened_at);
