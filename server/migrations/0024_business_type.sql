-- What kind of business this is, and which parts of the suite it uses.
--
-- Every workspace has been shown all eleven modules since the beginning, so a
-- plumber has been carrying a Rooms menu and a hotel a Hiring pipeline. That
-- is not a small annoyance: the sidebar is the map of the product, and a map
-- of places you will never go is how software starts to feel like it was
-- built for somebody else.
--
-- Visibility only. Nothing here is a permission and nothing becomes
-- unreachable: a hidden module's records still answer on their own URLs, so
-- turning one off can never strand data or break a link somebody saved.

ALTER TABLE organizations ADD COLUMN business_type TEXT NOT NULL DEFAULT 'general';

CREATE TABLE org_modules (
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, module_key)
);

-- An organization with no rows here has never chosen, and sees everything.
-- That is what every existing workspace is, and it is the right default for
-- one that skips the question: showing too much is recoverable, hiding
-- something a business needs on its first day is not.
