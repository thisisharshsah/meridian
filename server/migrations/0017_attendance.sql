-- Attendance and shifts.
--
-- timesheets already exist under projects, but they answer a different
-- question: how many hours went to a task, for billing. These answer whether
-- someone was at work, which payroll and rota need and billing never asks.

CREATE TABLE shifts (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id   TEXT NOT NULL REFERENCES employees(id),
  shift_date    TEXT NOT NULL,
  starts_at     TEXT NOT NULL,
  ends_at       TEXT NOT NULL,
  role_note     TEXT,
  status        TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled|published|cancelled
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  created_by    TEXT,
  updated_by    TEXT,
  deleted_at    TEXT
);

CREATE INDEX idx_shifts_org ON shifts (org_id, deleted_at);
CREATE INDEX idx_shifts_employee ON shifts (org_id, employee_id, shift_date);
CREATE INDEX idx_shifts_date ON shifts (org_id, shift_date, status);

CREATE TABLE attendance (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  shift_id       TEXT REFERENCES shifts(id),
  work_date      TEXT NOT NULL,
  clock_in       TEXT,
  clock_out      TEXT,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'present',   -- present|late|absent|on_leave|holiday
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_by     TEXT,
  deleted_at     TEXT
);

CREATE INDEX idx_attendance_org ON attendance (org_id, deleted_at);
CREATE INDEX idx_attendance_employee ON attendance (org_id, employee_id, work_date);

-- One attendance row per person per day. Without this a double clock-in makes
-- a second row and the day is counted twice in every total downstream.
CREATE UNIQUE INDEX idx_attendance_one_per_day
  ON attendance (org_id, employee_id, work_date)
  WHERE deleted_at IS NULL;
