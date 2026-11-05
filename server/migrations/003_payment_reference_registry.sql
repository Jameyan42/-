CREATE TABLE payment_references(reference text PRIMARY KEY, payment_id uuid NOT NULL REFERENCES payments(id), created_at timestamptz NOT NULL DEFAULT now());
INSERT INTO payment_references(reference,payment_id) SELECT reference,id FROM payments;
INSERT INTO payment_references(reference,payment_id) SELECT corrected_reference,payment_id FROM payment_corrections;
CREATE TRIGGER immutable_payment_references BEFORE UPDATE OR DELETE ON payment_references FOR EACH ROW EXECUTE FUNCTION forbid_audit_mutation();
