ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamptz;
ALTER TABLE notification_deliveries ADD COLUMN IF NOT EXISTS read_at timestamptz;

ALTER TABLE auth_tokens DROP CONSTRAINT IF EXISTS auth_tokens_kind_check;
ALTER TABLE auth_tokens ADD CONSTRAINT auth_tokens_kind_check CHECK (kind IN ('verify_email','reset_password','mfa_login'));

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS patient_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  email text NOT NULL,
  role caregiver_role NOT NULL,
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS patient_invitation_active_idx ON patient_invitations(patient_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE OR REPLACE FUNCTION accept_patient_invitation(invite_token_hash text, accepting_user uuid, accepting_email text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE invitation patient_invitations%ROWTYPE;
BEGIN
  SELECT * INTO invitation FROM patient_invitations WHERE token_hash=invite_token_hash AND lower(email)=lower(accepting_email) AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO patient_members(patient_id,user_id,role) VALUES(invitation.patient_id,accepting_user,invitation.role)
    ON CONFLICT(patient_id,user_id) DO UPDATE SET role=EXCLUDED.role,revoked_at=NULL,accepted_at=now();
  UPDATE patient_invitations SET accepted_at=now() WHERE id=invitation.id;
  RETURN invitation.patient_id;
END $$;
REVOKE ALL ON FUNCTION accept_patient_invitation(text,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_patient_invitation(text,uuid,text) TO salus_app;

CREATE TABLE IF NOT EXISTS notification_preferences (
  patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  quiet_start time,
  quiet_end time,
  in_app_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(patient_id, user_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE OR REPLACE FUNCTION is_patient_owner(target_patient uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM patient_members WHERE patient_id = target_patient AND user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND revoked_at IS NULL AND role = 'owner')
$$;
REVOKE ALL ON FUNCTION is_patient_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_patient_owner(uuid) TO salus_app;

CREATE POLICY patient_delete ON patients FOR DELETE USING (is_patient_owner(id));

ALTER TABLE patient_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE patient_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY invitation_access ON patient_invitations FOR ALL USING (can_manage_patient(patient_id)) WITH CHECK (can_manage_patient(patient_id));

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_preference_access ON notification_preferences FOR ALL
  USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND is_patient_member(patient_id))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid AND is_patient_member(patient_id));

CREATE OR REPLACE FUNCTION reject_patient_id_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.patient_id IS DISTINCT FROM OLD.patient_id THEN
    RAISE EXCEPTION 'patient_id is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['patient_members','consent_records','timeline_events','medications','appointments','tasks','documents','document_chunks','document_facts','voice_events','conversations','chat_messages','notification_deliveries','patient_invitations','notification_preferences'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_patient_id_immutable', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OF patient_id ON %I FOR EACH ROW EXECUTE FUNCTION reject_patient_id_update()', tbl || '_patient_id_immutable', tbl);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes, patient_invitations, notification_preferences, push_subscriptions TO salus_app;
