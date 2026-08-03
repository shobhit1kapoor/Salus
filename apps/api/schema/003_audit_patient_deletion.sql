-- Preserve immutable access history after a patient exercises permanent deletion.
-- The event and resource identifier remain available for security review, while the
-- foreign-key link to the deleted patient is removed.
ALTER TABLE audit_events
  DROP CONSTRAINT audit_events_patient_id_fkey;

ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_patient_id_fkey
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL;
