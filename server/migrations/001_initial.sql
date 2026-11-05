CREATE TABLE company (
 id integer PRIMARY KEY CHECK(id=1), name text NOT NULL DEFAULT '', taxpayer_id text NOT NULL DEFAULT '',
 policy jsonb NOT NULL DEFAULT '{"standards":{"version":1,"updatedAt":"2026-11-05T00:00:00.000Z","rows":[]},"releaseOnClose":false,"expenseTypes":["住宿费","办公用品","交通费","业务招待费"]}',
 policy_version integer NOT NULL DEFAULT 1 CHECK(policy_version>0), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO company(id) VALUES(1);
CREATE TABLE departments(id uuid PRIMARY KEY, name text NOT NULL UNIQUE CHECK(length(name) BETWEEN 1 AND 80));
CREATE TABLE users (
 id uuid PRIMARY KEY, username text NOT NULL UNIQUE CHECK(username=lower(username)), name text NOT NULL,
 password_hash text NOT NULL, roles text[] NOT NULL CHECK(cardinality(roles)>0 AND roles <@ ARRAY['EMPLOYEE','MANAGER','FINANCE','ADMIN']::text[]),
 department_id uuid REFERENCES departments(id), manager_id uuid REFERENCES users(id), grade text NOT NULL DEFAULT '普通员工' CHECK(grade IN ('普通员工','部门经理','高级管理人员')),
 active boolean NOT NULL DEFAULT true, must_change_password boolean NOT NULL DEFAULT true, auth_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(manager_id IS DISTINCT FROM id)
);
CREATE TABLE sessions(sid varchar PRIMARY KEY, sess json NOT NULL, expire timestamp NOT NULL);
CREATE INDEX sessions_expire_idx ON sessions(expire);
CREATE SEQUENCE claim_number_seq;
CREATE TABLE claims (
 id uuid PRIMARY KEY, number text NOT NULL UNIQUE, owner_id uuid NOT NULL REFERENCES users(id), department_id uuid REFERENCES departments(id),
 manager_id uuid REFERENCES users(id), status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','MANAGER_PENDING','FINANCE_PENDING','RETURNED','REJECTED','CANCELLED','AWAITING_PAYMENT','PAID')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), total_cents bigint NOT NULL DEFAULT 0 CHECK(total_cents BETWEEN 0 AND 1000000000000), currency text NOT NULL CHECK(currency='CNY'),
 description text NOT NULL, payload jsonb NOT NULL, audit_results jsonb, policy_snapshot jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), submitted_at timestamptz,
 legacy_import_id uuid, legacy_source_id text, UNIQUE(legacy_import_id,legacy_source_id)
);
CREATE INDEX claim_owner_idx ON claims(owner_id,status); CREATE INDEX claim_manager_idx ON claims(manager_id,status);
CREATE TABLE expense_lines (
 id uuid PRIMARY KEY, claim_id uuid NOT NULL REFERENCES claims(id), expense_type text NOT NULL, business_date date NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 1000000000000), description text NOT NULL, UNIQUE(id,claim_id)
);
CREATE TABLE invoices (
 id uuid PRIMARY KEY, claim_id uuid NOT NULL REFERENCES claims(id), identity_key text NOT NULL,
 number text NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 1000000000000), metadata jsonb NOT NULL,
 UNIQUE(claim_id,identity_key), UNIQUE(id,claim_id)
);
CREATE TABLE invoice_lines (
 claim_id uuid NOT NULL, line_id uuid NOT NULL, invoice_id uuid NOT NULL, allocated_cents bigint NOT NULL CHECK(allocated_cents>0),
 PRIMARY KEY(line_id,invoice_id), FOREIGN KEY(line_id,claim_id) REFERENCES expense_lines(id,claim_id), FOREIGN KEY(invoice_id,claim_id) REFERENCES invoices(id,claim_id)
);
CREATE TABLE invoice_occupancy (
 identity_key text PRIMARY KEY, claim_id uuid NOT NULL REFERENCES claims(id), occupied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE attachments (
 id uuid PRIMARY KEY, claim_id uuid NOT NULL REFERENCES claims(id), line_id uuid, revision integer NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('INVOICE','OTHER','PAYMENT_PROOF')), original_name text NOT NULL, media_type text NOT NULL,
 size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=10485760), sha256 char(64) NOT NULL, uploaded_by uuid NOT NULL REFERENCES users(id),
 uploaded_at timestamptz NOT NULL DEFAULT now(), detached_at timestamptz,
 FOREIGN KEY(line_id,claim_id) REFERENCES expense_lines(id,claim_id)
);
CREATE TABLE claim_versions (
 claim_id uuid NOT NULL REFERENCES claims(id), revision integer NOT NULL, payload jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(claim_id,revision)
);
CREATE TABLE operations (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, claim_id uuid REFERENCES claims(id), revision integer,
 actor_id uuid NOT NULL REFERENCES users(id), role text NOT NULL, action text NOT NULL, reason text NOT NULL,
 before_value jsonb, after_value jsonb, at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payments (
 id uuid PRIMARY KEY, claim_id uuid NOT NULL UNIQUE REFERENCES claims(id), amount_cents bigint NOT NULL CHECK(amount_cents>0), payment_date date NOT NULL,
 method text NOT NULL, reference text NOT NULL UNIQUE, actor_id uuid NOT NULL REFERENCES users(id), note text NOT NULL,
 voucher_id uuid REFERENCES attachments(id), at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payment_corrections (
 id uuid PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id), actor_id uuid NOT NULL REFERENCES users(id),
 corrected_date date NOT NULL, corrected_method text NOT NULL, corrected_reference text NOT NULL UNIQUE, reason text NOT NULL,
 at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legacy_imports(id uuid PRIMARY KEY, sha256 char(64) NOT NULL UNIQUE, uploaded_by uuid NOT NULL REFERENCES users(id), original_name text NOT NULL, preview jsonb NOT NULL, committed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE claims ADD FOREIGN KEY(legacy_import_id) REFERENCES legacy_imports(id);
CREATE FUNCTION forbid_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable audit record'; END$$;
CREATE TRIGGER immutable_operations BEFORE UPDATE OR DELETE ON operations FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER immutable_versions BEFORE UPDATE OR DELETE ON claim_versions FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER immutable_payments BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
CREATE TRIGGER immutable_corrections BEFORE UPDATE OR DELETE ON payment_corrections FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
