# Security and privacy model

Salus makes no HIPAA, SOC 2, HITRUST, FDA, or clinical-validation claim.

## Implemented controls

- Argon2id passwords, opaque 256-bit session tokens stored only as SHA-256 hashes, HTTP-only cookies, email verification, reset-token expiry, TOTP MFA with one-use recovery codes, active-session revocation, origin checks, rate limits, and generic login/reset errors.
- PostgreSQL row-level security on every patient-owned table. Separate security-definer predicates expose only boolean membership/management decisions and use a fixed search path.
- Fixed patient roles. Only owners and coordinators manage access; permanent deletion requires the owner and exact-name confirmation; medication verification requires owner/coordinator confirmation.
- Private object storage, application-layer AES-256-GCM encryption, patient-prefixed keys, normalized filenames, content-type and size allowlists, ClamAV scanning, and no public bucket access.
- Deterministic emergency, diagnosis, medication-change, prompt-injection, cross-patient, unsupported-protocol, and current-measurement checks run before the model. The system never claims that emergency services were contacted.
- Uploaded text is explicitly delimited as untrusted. Models receive no secrets or authorization tools. AI citations must match source UUIDs from the authorized retrieval set.
- CSP, frame denial, MIME sniffing prevention, referrer restrictions, restricted browser permissions, log redaction, request correlation IDs, and audit events.

## Production requirements

- Terminate TLS at a trusted reverse proxy and set production origins/domains exactly.
- Set `COOKIE_SECURE=true` for every HTTPS deployment; the example uses `false` only for localhost HTTP.
- Use independently generated database, session, object-storage, SMTP, VAPID, and NVIDIA secrets from a secret manager.
- Use managed encrypted volumes/object storage, private service networks, off-site encrypted backups, centralized logs, alerting, and key rotation.
- Complete an external penetration test, privacy/legal review, dependency/license review, disaster-recovery exercise, and clinical-safety review before accepting real health information.
- Treat `.env.example`, reviewer credentials, synthetic documents, and Salus 80 inputs as non-production material.

## Security reporting

Do not include patient information in a security report. Record the affected endpoint, correlation ID, time, and reproduction using synthetic data, then follow the incident process in `docs/operations.md`.
