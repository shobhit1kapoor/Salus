# Salus — Privacy-First Health AI

*Secure health intelligence for patients and caregivers*

Salus is a new patient-first healthcare product built around Protegrity as its first data boundary. Raw patient identifiers and unprotected sensitive values never reach the model, vectors, agent tools, logs, queues, or persistent storage. The AI receives only protected, pseudonymized, purpose-authorized, minimum-necessary clinical context.

CarePilot was used only as a reference foundation for proven healthcare concepts. Salus has its own product model, privacy architecture, user experience, contracts, and evidence system.

## Why Protegrity is central

Every sensitive operation must pass through the isolated Privacy Gateway before Salus can store data or call an AI provider:

1. Authenticate the actor and resolve the active Health Profile, purpose, grant, scope, and consent.
2. Discover identifiers with Protegrity Data Discovery.
3. Create a reversible AES-GCM envelope with a per-trace data key wrapped by Protegrity, plus a separately minimized AI-safe semantic view.
4. run Protegrity healthcare Semantic Guardrails on protected input.
5. persist only protected canonical data and pseudonymized semantic views.
6. retrieve through signed, profile- and purpose-scoped capabilities.
7. send minimum-necessary protected context through provider-neutral NVIDIA adapters.
8. validate schema and citation allowlists, then run output guardrails, discovery, and canary checks.
9. reveal only explicitly authorized fields; emit a hash-chained Protection Receipt.

If discovery, protection, or Semantic Guardrails are unavailable, the operation fails closed before persistence, embedding, or model access. API, worker, web, and provider adapters have no Protegrity credentials and no unprotect capability.

## Product experience

- Health Profiles for **My health** and **Someone I care for**, with relationship and authority attestation.
- Today, protected Timeline, medication and lab intelligence, source-linked Follow-ups, Records, Ask Salus, Sharing, and Privacy Proof.
- purpose-based caregiver grants for daily care, medication support, appointment preparation, records administration, and emergency support.
- controlled reveal with recent MFA, `no-store` responses, immediate revocation, and audited break-glass policy.
- Privacy Proof showing entity counts, protection methods, guardrail decisions, provider payload status, reveal decisions, leak checks, latency, and hash-chain evidence.
- Attack Lab with 40 runnable adversarial cases spanning injection, output leakage, cross-purpose access, revocation, canary exfiltration, and raw-persistence attempts.

## Runtime

- Next.js patient and caregiver experience
- Fastify authorization and healthcare APIs
- isolated Python Privacy Gateway with pinned Protegrity SDK
- Protegrity Data Discovery and Semantic Guardrails containers
- PostgreSQL/pgvector with row-level security
- Redis/BullMQ, encrypted MinIO objects, ClamAV, and Prometheus
- provider-neutral chat and embedding interfaces, initially backed by NVIDIA

## Start the complete stack

Requirements: Docker Desktop with Compose, Node.js 22+, Protegrity Developer Edition credentials, and an NVIDIA API key.

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Add `DEV_EDITION_EMAIL`, `DEV_EDITION_PASSWORD`, and `DEV_EDITION_API_KEY` from Protegrity Developer Edition.
3. Run `docker compose up --build`.
4. Confirm `http://localhost:8080/health` reports `mode: protegrity` and `protegrityConfigured: true`.
5. Run `docker compose exec api npm run seed -w @salus/api`. Synthetic seed data uses the same Protegrity path as product data.
6. Open `http://localhost:3000`.

The API readiness check returns `503` until the Protegrity boundary is healthy and configured. There is no unprotected fallback.

## Verification

```text
npm install
npm run lint
npm test
npm run build
npm audit --omit=dev
npm run salus80
```

Salus 80 contains 40 care, grounding, clinical-safety, provenance, authorization, accessibility, and provider-outage scenarios plus 40 Protegrity and privacy-attack scenarios. Reports are generated locally under `packages/testing/reports/` and are never committed as pre-generated evidence.

## Judge guide

- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [Data-flow inventory](docs/data-flow-inventory.md)
- [Evidence methodology](docs/evidence-methodology.md)
- [Demo script](docs/demo-script.md)
- [Security limitations](docs/limitations.md)
- [Operations](docs/operations.md)

Salus uses synthetic data for development and demonstration. It makes no HIPAA, certification, clinical-validation, or production-readiness claim.
