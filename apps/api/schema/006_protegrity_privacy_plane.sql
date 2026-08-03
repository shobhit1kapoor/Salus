CREATE TYPE profile_type AS ENUM ('self', 'dependent');
CREATE TYPE authority_status AS ENUM ('self_attested', 'caregiver_attested', 'verified');

ALTER TABLE users
  ADD COLUMN email_protected text,
  ADD COLUMN display_name_protected text,
  ADD COLUMN identity_fingerprint text;

ALTER TABLE audit_events
  ADD COLUMN previous_hash text,
  ADD COLUMN event_hash text;
CREATE INDEX audit_event_hash_idx ON audit_events(event_hash);

ALTER TABLE patients
  ADD COLUMN profile_type profile_type NOT NULL DEFAULT 'dependent',
  ADD COLUMN relationship text,
  ADD COLUMN authority_status authority_status NOT NULL DEFAULT 'caregiver_attested',
  ADD COLUMN preferred_name_protected text,
  ADD COLUMN legal_name_protected text,
  ADD COLUMN date_of_birth_protected text,
  ADD COLUMN profile_details_protected text,
  ADD COLUMN identity_fingerprint text,
  ADD COLUMN protection_version text NOT NULL DEFAULT 'protegrity-de-1';

ALTER TABLE sessions ADD COLUMN mfa_verified_at timestamptz;
ALTER TABLE patient_invitations
  ADD COLUMN email_protected text,
  ADD COLUMN email_fingerprint text;

ALTER TABLE consent_records ADD COLUMN evidence_protected text;
ALTER TABLE timeline_events ADD COLUMN summary_protected text;
ALTER TABLE medications ADD COLUMN details_protected text;
ALTER TABLE appointments ADD COLUMN details_protected text;
ALTER TABLE tasks
  ADD COLUMN title_protected text,
  ADD COLUMN follow_up_kind text NOT NULL DEFAULT 'general',
  ADD COLUMN priority text NOT NULL DEFAULT 'routine' CHECK (priority IN ('routine','important','urgent'));
ALTER TABLE documents
  ADD COLUMN original_filename_protected text,
  ADD COLUMN extracted_text_protected text,
  ADD COLUMN wrapped_object_key text,
  ADD COLUMN protection_trace_id uuid;
ALTER TABLE document_chunks ADD COLUMN canonical_protected text;
ALTER TABLE voice_events
  ADD COLUMN original_transcript_protected text,
  ADD COLUMN edited_transcript_protected text,
  ADD COLUMN wrapped_object_key text;
ALTER TABLE chat_messages
  ADD COLUMN content_protected text,
  ADD COLUMN protection_trace_id uuid,
  ADD COLUMN purpose text;

CREATE TABLE access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  grantee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_by uuid NOT NULL REFERENCES users(id),
  purposes text[] NOT NULL,
  scopes text[] NOT NULL,
  reveal_level text NOT NULL CHECK (reveal_level IN ('routine','sensitive','break_glass')),
  consent_version integer NOT NULL DEFAULT 1,
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(purposes) > 0),
  CHECK (cardinality(scopes) > 0),
  CHECK (expires_at IS NULL OR expires_at > valid_from)
);
CREATE INDEX access_grants_active_idx ON access_grants(patient_id,grantee_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE reveal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  grant_id uuid REFERENCES access_grants(id) ON DELETE SET NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  fields text[] NOT NULL,
  purpose text NOT NULL,
  reason_protected text,
  decision text NOT NULL CHECK (decision IN ('allowed','denied')),
  break_glass boolean NOT NULL DEFAULT false,
  trace_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE protection_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id uuid NOT NULL,
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  operation text NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL CHECK (status IN ('protected','blocked','revealed','failed')),
  stages jsonb NOT NULL DEFAULT '[]'::jsonb,
  entity_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider text NOT NULL DEFAULT 'protegrity',
  raw_leak_count integer NOT NULL DEFAULT 0 CHECK (raw_leak_count >= 0),
  previous_hash text,
  event_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(trace_id, operation, status)
);
CREATE INDEX protection_receipts_patient_idx ON protection_receipts(patient_id,created_at DESC);
CREATE INDEX protection_receipts_trace_idx ON protection_receipts(trace_id,created_at);

CREATE TABLE privacy_attack_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid REFERENCES patients(id) ON DELETE SET NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  scenario_id text NOT NULL,
  category text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('blocked','failed','passed')),
  boundary text NOT NULL,
  trace_id uuid NOT NULL,
  receipt_id uuid REFERENCES protection_receipts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lab_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name text NOT NULL,
  result_safe text NOT NULL,
  result_protected text NOT NULL,
  units text,
  reference_range_safe text,
  collected_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'final',
  source_document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lab_results_patient_collected_idx ON lab_results(patient_id,collected_at DESC);

CREATE TABLE fhir_exchanges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('import','export')),
  canonical_protected text NOT NULL,
  resource_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  trace_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fhir_exchanges_patient_idx ON fhir_exchanges(patient_id,created_at DESC);

CREATE OR REPLACE FUNCTION active_grant(target_patient uuid, requested_purpose text, requested_scope text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM access_grants
    WHERE patient_id=target_patient
      AND grantee_id=NULLIF(current_setting('app.user_id',true),'')::uuid
      AND revoked_at IS NULL
      AND valid_from<=now()
      AND (expires_at IS NULL OR expires_at>now())
      AND requested_purpose=ANY(purposes)
      AND requested_scope=ANY(scopes)
  )
$$;
REVOKE ALL ON FUNCTION active_grant(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION active_grant(uuid,text,text) TO salus_app;

ALTER TABLE access_grants ENABLE ROW LEVEL SECURITY; ALTER TABLE access_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY access_grant_read ON access_grants FOR SELECT USING (grantee_id=NULLIF(current_setting('app.user_id',true),'')::uuid OR can_manage_patient(patient_id));
CREATE POLICY access_grant_insert ON access_grants FOR INSERT WITH CHECK (can_manage_patient(patient_id));
CREATE POLICY access_grant_update ON access_grants FOR UPDATE USING (can_manage_patient(patient_id)) WITH CHECK (can_manage_patient(patient_id));

ALTER TABLE reveal_events ENABLE ROW LEVEL SECURITY; ALTER TABLE reveal_events FORCE ROW LEVEL SECURITY;
CREATE POLICY reveal_event_read ON reveal_events FOR SELECT USING (actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid OR is_patient_member(patient_id));
CREATE POLICY reveal_event_insert ON reveal_events FOR INSERT WITH CHECK (actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid);

ALTER TABLE protection_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE protection_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY protection_receipt_read ON protection_receipts FOR SELECT USING (actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid OR is_patient_member(patient_id));
CREATE POLICY protection_receipt_insert ON protection_receipts FOR INSERT WITH CHECK (actor_id IS NULL OR actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid);

ALTER TABLE privacy_attack_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE privacy_attack_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY privacy_attack_read ON privacy_attack_runs FOR SELECT USING (actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid OR is_patient_member(patient_id));
CREATE POLICY privacy_attack_insert ON privacy_attack_runs FOR INSERT WITH CHECK (actor_id=NULLIF(current_setting('app.user_id',true),'')::uuid);

ALTER TABLE lab_results ENABLE ROW LEVEL SECURITY; ALTER TABLE lab_results FORCE ROW LEVEL SECURITY;
CREATE POLICY lab_result_access ON lab_results FOR ALL USING (is_patient_member(patient_id)) WITH CHECK (is_patient_member(patient_id));

ALTER TABLE fhir_exchanges ENABLE ROW LEVEL SECURITY; ALTER TABLE fhir_exchanges FORCE ROW LEVEL SECURITY;
CREATE POLICY fhir_exchange_access ON fhir_exchanges FOR ALL USING (is_patient_member(patient_id)) WITH CHECK (is_patient_member(patient_id));

GRANT SELECT,INSERT,UPDATE,DELETE ON access_grants,reveal_events,protection_receipts,privacy_attack_runs,lab_results,fhir_exchanges TO salus_app;

CREATE OR REPLACE FUNCTION reject_patient_id_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    RAISE EXCEPTION 'patient_id is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['access_grants','reveal_events','protection_receipts','privacy_attack_runs','lab_results','fhir_exchanges'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF patient_id ON %I FOR EACH ROW EXECUTE FUNCTION reject_patient_id_update()', tbl || '_patient_id_immutable', tbl);
  END LOOP;
END $$;
