-- Preserve every existing claim; nullable fields allow incomplete v1.1 drafts only.
ALTER TABLE users ADD COLUMN employee_number text;
UPDATE users SET employee_number=username;
ALTER TABLE users ALTER COLUMN employee_number SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_employee_number_unique UNIQUE(employee_number);
-- New accounts use the login identifier as initial employee reference, not an invented HR identity.
CREATE FUNCTION default_employee_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.employee_number IS NULL THEN NEW.employee_number=NEW.username; END IF; RETURN NEW; END $$;
CREATE TRIGGER user_employee_number BEFORE INSERT ON users FOR EACH ROW EXECUTE FUNCTION default_employee_number();
ALTER TABLE expense_lines ALTER COLUMN business_date DROP NOT NULL;
ALTER TABLE expense_lines ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN identity_key DROP NOT NULL;
ALTER TABLE invoices ALTER COLUMN amount_cents DROP NOT NULL;
ALTER TABLE invoice_lines ALTER COLUMN allocated_cents DROP NOT NULL;
CREATE TABLE employee_receiving_accounts (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES users(id),
 holder_name text NOT NULL, bank_name text NOT NULL,
 encrypted_number text NOT NULL, last_four char(4) NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','VALID','INACTIVE')),
 verified_by uuid REFERENCES users(id), verification_reason text,
 verified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((status<>'VALID') OR (verified_by IS NOT NULL AND verified_by<>owner_id AND verified_at IS NOT NULL AND length(verification_reason)>0))
);
CREATE INDEX receiving_owner_idx ON employee_receiving_accounts(owner_id);
-- No existing data are backfilled with synthetic approval or account verification.
