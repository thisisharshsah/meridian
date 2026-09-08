-- Payroll: a run over a period, and one payslip per person in it.
--
-- annual_salary on the employee is a fact about their contract. These are the
-- records of money actually paid, which is a different thing and the one an
-- auditor asks for.

CREATE TABLE pay_runs (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  reference    TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end   TEXT NOT NULL,
  pay_date     TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',   -- draft|approved|paid
  total_gross  INTEGER NOT NULL DEFAULT 0,
  total_net    INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  created_by   TEXT,
  updated_by   TEXT,
  deleted_at   TEXT
);

CREATE INDEX idx_payruns_org ON pay_runs (org_id, deleted_at);
CREATE INDEX idx_payruns_period ON pay_runs (org_id, period_start, period_end);

CREATE TABLE payslips (
  id             TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pay_run_id     TEXT NOT NULL REFERENCES pay_runs(id),
  employee_id    TEXT NOT NULL REFERENCES employees(id),
  slip_for       TEXT,
  gross          INTEGER NOT NULL DEFAULT 0,
  deductions     INTEGER NOT NULL DEFAULT 0,
  net            INTEGER NOT NULL DEFAULT 0,
  minutes_worked INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  created_by     TEXT,
  updated_by     TEXT,
  deleted_at     TEXT
);

CREATE INDEX idx_payslips_org ON payslips (org_id, deleted_at);
CREATE INDEX idx_payslips_run ON payslips (org_id, pay_run_id);
CREATE INDEX idx_payslips_employee ON payslips (org_id, employee_id);

-- Paying the same person twice in one run is always a mistake.
CREATE UNIQUE INDEX idx_payslips_one_per_run
  ON payslips (org_id, pay_run_id, employee_id)
  WHERE deleted_at IS NULL;
