# 12-minute judge demonstration

1. **Architecture (1 minute):** show that only the Privacy Gateway has Protegrity credentials/unprotect and explain the three representations.
2. **Protected profile and record ingestion (2 minutes):** create “Someone I care for,” upload a synthetic discharge record, and open its Protection Receipt. Show encrypted MinIO bytes and AI-safe chunks.
3. **Realistic AI (2 minutes):** ask a medication/follow-up question. Show purpose-authorized sources, pseudonymized provider payload, citation allowlist, output checks, and receipt.
4. **Medication/follow-up intelligence (1.5 minutes):** show an unverified dosage change and a source-linked overdue follow-up without diagnosis or treatment change.
5. **Caregiver sharing (1.5 minutes):** grant medication support only, demonstrate denied records access, then revoke and show immediate denial.
6. **Controlled reveal (1 minute):** attempt direct identifier reveal, complete MFA step-up, reveal with `no-store`, then show the reveal audit event.
7. **Attack Lab (1.5 minutes):** run document injection, output-canary, and `SALUS-PA-40` mixed-destination attacks; show the actual PostgreSQL/MinIO/Redis/tool/telemetry scan cards and open the linked receipt.
8. **Privacy Proof (1.5 minutes):** distinguish Protegrity as the protection provider from NVIDIA as the model provider; show prompt protection, exact provider-payload hash/size, destination scan results, zero released leaks, and the hash chain. Finish with a reproducible Salus 80 report.

Use synthetic data only. Do not claim HIPAA compliance, certification, clinical validation, or production readiness.
