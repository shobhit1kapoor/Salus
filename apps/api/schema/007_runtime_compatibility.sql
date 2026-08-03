-- Preserve profile immutability while allowing foreign-key cleanup to detach
-- append-only evidence when a profile is permanently deleted.
CREATE OR REPLACE FUNCTION reject_patient_id_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.patient_id IS NOT NULL
     AND NEW.patient_id IS NOT NULL
     AND NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    RAISE EXCEPTION 'patient_id is immutable';
  END IF;
  RETURN NEW;
END;
$$;
