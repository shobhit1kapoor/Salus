CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS vector;

DO $$ BEGIN
  CREATE ROLE salus_app LOGIN;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TYPE caregiver_role AS ENUM ('owner', 'care_coordinator', 'caregiver', 'viewer');
CREATE TYPE document_status AS ENUM ('uploading', 'processing', 'needs_review', 'verified', 'failed', 'deleted');
CREATE TYPE task_status AS ENUM ('open', 'completed', 'skipped');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, display_name text NOT NULL, email_verified_at timestamptz,
  mfa_secret_encrypted text, created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
);
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  ip_hash text, user_agent text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('verify_email','reset_password')), token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preferred_name text NOT NULL, legal_name text,
  date_of_birth date, pronouns text, language text NOT NULL DEFAULT 'en', timezone text NOT NULL DEFAULT 'America/Chicago',
  created_by uuid NOT NULL REFERENCES users(id), archived_at timestamptz, deleted_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE patient_members (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role caregiver_role NOT NULL, accepted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, PRIMARY KEY(patient_id, user_id)
);
CREATE TABLE consent_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  consent_type text NOT NULL, status text NOT NULL, recorded_by uuid NOT NULL REFERENCES users(id), recorded_at timestamptz NOT NULL DEFAULT now(), evidence text
);
CREATE TABLE timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  version_of uuid REFERENCES timeline_events(id), occurred_at timestamptz NOT NULL, category text NOT NULL, summary text NOT NULL,
  source text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), superseded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE medications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  name text NOT NULL, normalized_name text NOT NULL, dosage text NOT NULL, route text NOT NULL, schedule text NOT NULL,
  instructions text, status text NOT NULL DEFAULT 'proposed', verified_at timestamptz, verified_by uuid REFERENCES users(id), created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL, provider_name text, location text, reason text, status text NOT NULL DEFAULT 'scheduled', created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  title text NOT NULL, assigned_to uuid REFERENCES users(id), due_at timestamptz, reminder_at timestamptz, status task_status NOT NULL DEFAULT 'open',
  completed_at timestamptz, completed_by uuid REFERENCES users(id), last_reminded_at timestamptz, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE, original_filename text NOT NULL, content_type text NOT NULL, byte_size bigint NOT NULL,
  status document_status NOT NULL DEFAULT 'uploading', uploaded_by uuid NOT NULL REFERENCES users(id), extracted_text text, failure_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE, page_number int, content text NOT NULL, embedding vector(1024), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE document_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE, source_chunk_id uuid REFERENCES document_chunks(id), field text NOT NULL, proposed_value jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed', reviewed_by uuid REFERENCES users(id), reviewed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE voice_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE, content_type text NOT NULL, status text NOT NULL DEFAULT 'processing', original_transcript text,
  edited_transcript text, confidence numeric, structured_result jsonb, retain_audio boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id), kind text NOT NULL DEFAULT 'assistant', created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(patient_id, kind)
);
CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, author_id uuid REFERENCES users(id), role text NOT NULL CHECK (role IN ('user','assistant','system')), content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb, model_version text, prompt_version text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE, task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES users(id), channel text NOT NULL, status text NOT NULL, idempotency_key text NOT NULL UNIQUE, attempted_at timestamptz NOT NULL DEFAULT now(), error text
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id), patient_id uuid REFERENCES patients(id), action text NOT NULL,
  resource_type text NOT NULL, resource_id uuid, correlation_id uuid NOT NULL DEFAULT gen_random_uuid(), metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX timeline_patient_occurred_idx ON timeline_events(patient_id, occurred_at DESC);
CREATE INDEX task_reminder_idx ON tasks(reminder_at) WHERE status = 'open';
CREATE INDEX chunks_patient_idx ON document_chunks(patient_id, document_id);
CREATE INDEX audit_patient_idx ON audit_events(patient_id, created_at DESC);

CREATE OR REPLACE FUNCTION is_patient_member(target_patient uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM patient_members WHERE patient_id = target_patient AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND revoked_at IS NULL)
$$;
REVOKE ALL ON FUNCTION is_patient_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_patient_member(uuid) TO salus_app;
CREATE OR REPLACE FUNCTION is_patient_creator(target_patient uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM patients WHERE id = target_patient AND created_by = NULLIF(current_setting('app.user_id', true), '')::uuid)
$$;
REVOKE ALL ON FUNCTION is_patient_creator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_patient_creator(uuid) TO salus_app;
CREATE OR REPLACE FUNCTION can_manage_patient(target_patient uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM patient_members WHERE patient_id = target_patient AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND revoked_at IS NULL AND role IN ('owner','care_coordinator'))
$$;
REVOKE ALL ON FUNCTION can_manage_patient(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION can_manage_patient(uuid) TO salus_app;

ALTER TABLE patients ENABLE ROW LEVEL SECURITY; ALTER TABLE patients FORCE ROW LEVEL SECURITY;
CREATE POLICY patient_read ON patients FOR SELECT USING (is_patient_member(id));
CREATE POLICY patient_write ON patients FOR UPDATE USING (is_patient_member(id)) WITH CHECK (is_patient_member(id));
CREATE POLICY patient_insert ON patients FOR INSERT WITH CHECK (created_by = NULLIF(current_setting('app.user_id', true), '')::uuid);

-- Every row containing care data is guarded by the same patient membership predicate.
ALTER TABLE patient_members ENABLE ROW LEVEL SECURITY; ALTER TABLE patient_members FORCE ROW LEVEL SECURITY;
CREATE POLICY member_read ON patient_members FOR SELECT USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR is_patient_member(patient_id));
CREATE POLICY member_creator_insert ON patient_members FOR INSERT WITH CHECK (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND role = 'owner' AND
  is_patient_creator(patient_id)
);
CREATE POLICY member_manager_insert ON patient_members FOR INSERT WITH CHECK (can_manage_patient(patient_id));
CREATE POLICY member_manage ON patient_members FOR UPDATE USING (can_manage_patient(patient_id)) WITH CHECK (can_manage_patient(patient_id));

DO $$ DECLARE tbl text; BEGIN FOREACH tbl IN ARRAY ARRAY['consent_records','timeline_events','medications','appointments','tasks','documents','document_chunks','document_facts','voice_events','conversations','chat_messages','notification_deliveries'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY; ALTER TABLE %I FORCE ROW LEVEL SECURITY;', tbl, tbl);
  EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (is_patient_member(patient_id)) WITH CHECK (is_patient_member(patient_id));', tbl || '_patient_access', tbl);
END LOOP; END $$;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_access ON audit_events FOR SELECT USING (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid OR is_patient_member(patient_id));
CREATE POLICY audit_insert ON audit_events FOR INSERT WITH CHECK (actor_id = NULLIF(current_setting('app.user_id', true), '')::uuid);

GRANT USAGE ON SCHEMA public TO salus_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO salus_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO salus_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO salus_app;
