-- ExpenseFlow schema (PostgreSQL 18). Money = integer paise. Timestamps = timestamptz (UTC).
CREATE TABLE IF NOT EXISTS departments (
  id    serial PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  email          text NOT NULL UNIQUE,
  role           text NOT NULL CHECK (role IN ('employee','manager','auditor','head')),
  department_id  int NOT NULL REFERENCES departments(id),
  manager_id     int REFERENCES users(id),
  password_hash  text NOT NULL,
  account_ref    text NOT NULL,
  ifsc           text NOT NULL,
  CHECK (manager_id IS NULL OR manager_id <> id)
);
CREATE INDEX IF NOT EXISTS users_manager_idx ON users(manager_id);

CREATE TABLE IF NOT EXISTS policy_rules (
  code         text PRIMARY KEY,
  description  text NOT NULL,
  value        jsonb NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('APPROVE','ROUTE','REJECT','CONFIG')),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   int REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id            serial PRIMARY KEY,
  owner_id      int NOT NULL REFERENCES users(id),
  filename      text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    int NOT NULL,
  sha256        text NOT NULL,
  storage_path  text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS receipts_sha_idx ON receipts(sha256);

CREATE TABLE IF NOT EXISTS claims (
  id              serial PRIMARY KEY,
  employee_id     int NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  status          text NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','NEEDS_CLARIFICATION','AUTO_REJECTED',
                                                 'REJECTED','SAMPLE_AUDIT','APPROVED','IN_PAYOUT','PAID')),
  current_step    text CHECK (current_step IN ('MANAGER','AUDITOR','HEAD')),
  required_steps  text[] NOT NULL DEFAULT '{}',
  total_paise     bigint NOT NULL DEFAULT 0,
  policy_outcome  text,
  auto_approved   boolean NOT NULL DEFAULT false,
  sample_audit    boolean NOT NULL DEFAULT false,
  flags           text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  submitted_at    timestamptz,
  step_entered_at timestamptz,
  decided_at      timestamptz,
  paid_at         timestamptz,
  CHECK ((status = 'PENDING_APPROVAL') = (current_step IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS claims_employee_idx ON claims(employee_id);
CREATE INDEX IF NOT EXISTS claims_status_idx ON claims(status, current_step);

CREATE TABLE IF NOT EXISTS claim_lines (
  id            serial PRIMARY KEY,
  claim_id      int NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  line_no       int NOT NULL,
  category      text NOT NULL,
  amount_paise  bigint NOT NULL CHECK (amount_paise > 0),
  expense_date  date NOT NULL,
  vendor        text NOT NULL,
  city          text,
  nights        int,
  description   text NOT NULL DEFAULT '',
  receipt_id    int REFERENCES receipts(id),
  outcome       text,
  reasons       jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS lines_claim_idx ON claim_lines(claim_id);
CREATE INDEX IF NOT EXISTS lines_dup_idx ON claim_lines(lower(vendor), amount_paise, expense_date);

CREATE TABLE IF NOT EXISTS delegations (
  id            serial PRIMARY KEY,
  delegator_id  int NOT NULL REFERENCES users(id),
  delegate_id   int NOT NULL REFERENCES users(id),
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (delegator_id <> delegate_id),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS payout_batches (
  id           serial PRIMARY KEY,
  created_by   int NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL CHECK (status IN ('CREATED','PAID')) DEFAULT 'CREATED',
  paid_at      timestamptz,
  total_paise  bigint NOT NULL,
  claim_count  int NOT NULL
);

CREATE TABLE IF NOT EXISTS payout_items (
  batch_id      int NOT NULL REFERENCES payout_batches(id),
  claim_id      int NOT NULL UNIQUE REFERENCES claims(id),   -- a claim can be paid in at most one batch
  line_no       int NOT NULL,
  amount_paise  bigint NOT NULL,
  PRIMARY KEY (batch_id, claim_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id               bigserial PRIMARY KEY,
  at               timestamptz NOT NULL DEFAULT now(),
  actor_id         int REFERENCES users(id),
  on_behalf_of_id  int REFERENCES users(id),
  entity           text NOT NULL,
  entity_id        int,
  action           text NOT NULL,
  from_status      text,
  to_status        text,
  comment          text,
  details          jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS audit_entity_idx ON audit_log(entity, entity_id);

-- Append-only audit trail: block UPDATE / DELETE / TRUNCATE.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_no_update ON audit_log;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_immutable();
