ALTER TABLE document_facts
  ADD COLUMN IF NOT EXISTS materialized_resource_type text,
  ADD COLUMN IF NOT EXISTS materialized_resource_id uuid;

ALTER TABLE timeline_events
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fact_id uuid REFERENCES document_facts(id) ON DELETE SET NULL;

ALTER TABLE medications
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fact_id uuid REFERENCES document_facts(id) ON DELETE SET NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fact_id uuid REFERENCES document_facts(id) ON DELETE SET NULL;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fact_id uuid REFERENCES document_facts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS timeline_source_fact_idx ON timeline_events(source_fact_id) WHERE source_fact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS medication_source_fact_idx ON medications(source_fact_id) WHERE source_fact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS appointment_source_fact_idx ON appointments(source_fact_id) WHERE source_fact_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS task_source_fact_idx ON tasks(source_fact_id) WHERE source_fact_id IS NOT NULL;
