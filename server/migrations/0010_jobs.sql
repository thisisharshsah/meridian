-- Durable background work.
--
-- Anything that has to happen *later* rather than *now* goes here rather than
-- into an in-memory timer: a process restart must not lose a scheduled action.
-- The table is the queue, claimed with an atomic UPDATE ... RETURNING so two
-- workers can never take the same row.
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,          -- automation_action
  payload       TEXT NOT NULL,          -- JSON, shape depends on `kind`
  -- Who the work runs as. Scheduled work still has to respect tenancy, so it
  -- carries the actor forward rather than running as nobody.
  actor_id      TEXT REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|done|failed|cancelled
  run_at        TEXT NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 5,
  locked_at     TEXT,
  finished_at   TEXT,
  last_error    TEXT,
  -- Optional idempotency handle: enqueueing the same key twice is a no-op
  -- while the first is still outstanding.
  dedupe_key    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- The worker's only query: due, pending, oldest first.
CREATE INDEX idx_jobs_due ON jobs (status, run_at);
-- `idx_jobs_org` is taken: 0005 uses it for job_openings, and SQLite
-- index names are global to the database.
CREATE INDEX idx_job_queue_org ON jobs (org_id, created_at);
CREATE UNIQUE INDEX idx_jobs_dedupe
  ON jobs (org_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running');
