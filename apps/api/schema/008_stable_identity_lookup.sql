-- Authentication and account uniqueness use a stable one-way fingerprint, not a
-- replaceable AI-safe pseudonym representation.
CREATE UNIQUE INDEX IF NOT EXISTS users_active_identity_fingerprint_uq
  ON users(identity_fingerprint)
  WHERE identity_fingerprint IS NOT NULL AND deleted_at IS NULL;
