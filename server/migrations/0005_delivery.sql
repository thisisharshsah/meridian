-- Projects, people, support and hiring.

CREATE TABLE projects (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  account_id    TEXT REFERENCES accounts(id),
  status        TEXT NOT NULL DEFAULT 'active',  -- planning|active|on_hold|completed|cancelled
  billing_type  TEXT NOT NULL DEFAULT 'fixed',   -- fixed | hourly | non_billable
  budget        INTEGER,
  hourly_rate   INTEGER,
  start_date    TEXT,
  end_date      TEXT,
  progress      INTEGER NOT NULL DEFAULT 0,      -- scaled percent
  owner_id      TEXT REFERENCES users(id),
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_projects_org ON projects (org_id, deleted_at);
CREATE INDEX idx_projects_account ON projects (org_id, account_id);

CREATE TABLE milestones (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open',    -- open | completed
  due_date      TEXT,
  owner_id      TEXT REFERENCES users(id),
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_milestones_project ON milestones (org_id, project_id);

CREATE TABLE project_tasks (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id  TEXT REFERENCES milestones(id),
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'todo',    -- todo|in_progress|review|done|blocked
  priority      TEXT NOT NULL DEFAULT 'normal',
  assignee_id   TEXT REFERENCES users(id),
  start_date    TEXT,
  due_date      TEXT,
  estimated_hours INTEGER,                       -- scaled quantity
  logged_hours  INTEGER NOT NULL DEFAULT 0,      -- kept in step with timesheets
  sort_order    INTEGER NOT NULL DEFAULT 0,
  description   TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_ptasks_project ON project_tasks (org_id, project_id, status);
CREATE INDEX idx_ptasks_assignee ON project_tasks (org_id, assignee_id, due_date);

CREATE TABLE timesheets (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  task_id       TEXT REFERENCES project_tasks(id),
  user_id       TEXT NOT NULL REFERENCES users(id),
  work_date     TEXT NOT NULL,
  hours         INTEGER NOT NULL DEFAULT 0,      -- scaled quantity
  billable      INTEGER NOT NULL DEFAULT 1,
  billed        INTEGER NOT NULL DEFAULT 0,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_timesheets_project ON timesheets (org_id, project_id, work_date);
CREATE INDEX idx_timesheets_user ON timesheets (org_id, user_id, work_date);

CREATE TABLE departments (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  code          TEXT,
  head_id       TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_departments_org ON departments (org_id, deleted_at);

CREATE TABLE employees (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_code TEXT,
  full_name     TEXT NOT NULL,
  work_email    TEXT,
  personal_email TEXT,
  phone         TEXT,
  user_id       TEXT REFERENCES users(id),
  department_id TEXT REFERENCES departments(id),
  designation   TEXT,
  manager_id    TEXT REFERENCES employees(id),
  employment_type TEXT NOT NULL DEFAULT 'full_time',  -- full_time|part_time|contract|intern
  status        TEXT NOT NULL DEFAULT 'active',       -- active|on_leave|notice|exited
  date_of_joining TEXT,
  date_of_birth TEXT,
  annual_salary INTEGER,
  location      TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_employees_org ON employees (org_id, deleted_at);
CREATE UNIQUE INDEX idx_employees_code ON employees (org_id, employee_code)
  WHERE employee_code IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE leave_requests (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  leave_type    TEXT NOT NULL DEFAULT 'annual',  -- annual|sick|unpaid|parental|comp_off
  status        TEXT NOT NULL DEFAULT 'pending', -- pending|approved|rejected|cancelled
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  days          INTEGER NOT NULL DEFAULT 1000,   -- scaled: half days are 500
  reason        TEXT,
  approver_id   TEXT REFERENCES users(id),
  decided_at    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_leave_employee ON leave_requests (org_id, employee_id, start_date);
CREATE INDEX idx_leave_status ON leave_requests (org_id, status);

CREATE TABLE tickets (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  subject       TEXT NOT NULL,
  account_id    TEXT REFERENCES accounts(id),
  contact_id    TEXT REFERENCES contacts(id),
  status        TEXT NOT NULL DEFAULT 'open',    -- open|in_progress|on_hold|resolved|closed
  priority      TEXT NOT NULL DEFAULT 'normal',  -- low|normal|high|urgent
  channel       TEXT NOT NULL DEFAULT 'email',   -- email|phone|web|chat
  category      TEXT,
  assignee_id   TEXT REFERENCES users(id),
  due_at        TEXT,
  first_response_at TEXT,
  resolved_at   TEXT,
  satisfaction  TEXT,                            -- good | neutral | bad
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_tickets_number ON tickets (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_tickets_org ON tickets (org_id, deleted_at);
CREATE INDEX idx_tickets_status ON tickets (org_id, status, priority);

CREATE TABLE ticket_comments (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  is_public     INTEGER NOT NULL DEFAULT 1,      -- private notes stay off the portal
  author_id     TEXT REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_ticket_comments_parent ON ticket_comments (org_id, ticket_id, created_at);

CREATE TABLE kb_articles (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  category      TEXT,
  status        TEXT NOT NULL DEFAULT 'draft',   -- draft|published|archived
  body          TEXT,
  views         INTEGER NOT NULL DEFAULT 0,
  helpful_count INTEGER NOT NULL DEFAULT 0,
  author_id     TEXT REFERENCES users(id),
  published_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_kb_org ON kb_articles (org_id, deleted_at);

CREATE TABLE job_openings (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  department_id TEXT REFERENCES departments(id),
  status        TEXT NOT NULL DEFAULT 'open',    -- draft|open|on_hold|filled|closed
  employment_type TEXT NOT NULL DEFAULT 'full_time',
  location      TEXT,
  openings      INTEGER NOT NULL DEFAULT 1,
  salary_min    INTEGER,
  salary_max    INTEGER,
  hiring_manager_id TEXT REFERENCES users(id),
  target_date   TEXT,
  description   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE INDEX idx_jobs_org ON job_openings (org_id, deleted_at);

CREATE TABLE candidates (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  number        TEXT NOT NULL,
  full_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  job_opening_id TEXT REFERENCES job_openings(id),
  stage         TEXT NOT NULL DEFAULT 'applied', -- applied|screening|interview|offer|hired|rejected
  source        TEXT,
  current_company TEXT,
  experience_years INTEGER,
  expected_salary INTEGER,
  rating        INTEGER,
  owner_id      TEXT REFERENCES users(id),
  resume_url    TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);
CREATE UNIQUE INDEX idx_candidates_number ON candidates (org_id, number) WHERE deleted_at IS NULL;
CREATE INDEX idx_candidates_job ON candidates (org_id, job_opening_id, stage);
