# Security and product limitations

Salus is a competitive prototype, not a production medical device or compliance certification.

- Protegrity Developer Edition credentials and official containers are required to demonstrate the production privacy path. Explicit test mode exists only inside the isolated gateway for automated synthetic tests and is not enabled by Compose.
- Data Discovery classification is not assumed to identify every form of sensitive clinical data. Salus therefore protects full canonical payloads and creates a separate minimized semantic view.
- Protegrity AI Developer Edition is an experimentation service with published fair-use limits (50 requests/second, burst 100, and 10,000 requests/user/day). Salus wraps one data key per trace, paces Salus 80, and fails closed on hosted `Forbidden` or unavailable responses; it never switches to the synthetic test provider during a real-mode run.
- Pseudonymized clinical facts can remain sensitive and must still be purpose-authorized, encrypted in transit/at rest, and excluded when unnecessary.
- Semantic Guardrails and discovery are layered with deterministic safety, schema validation, citation allowlisting, canaries, capabilities, and RLS; no single classifier is treated as infallible.
- Human review remains required for extracted medication changes, ambiguous records, and voice transcripts.
- Salus does not diagnose, prescribe, change medication, contact emergency services, or replace qualified care.
- Production use would require independent security, privacy/legal, accessibility, clinical-safety, infrastructure, incident-response, and disaster-recovery reviews.
