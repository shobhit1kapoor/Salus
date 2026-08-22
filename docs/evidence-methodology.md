# Evidence methodology

Privacy Proof is operational evidence, not a marketing animation. Every protected operation has a UUID trace and an append-only receipt containing stage outcomes, entity counts, guardrail processors, the Protegrity protection provider, the model provider, provider-payload status/hash/byte count, per-destination scans, durations, reveal decision, released raw-leak count, previous hash, and event hash. Original sensitive values are prohibited from evidence.

## Verification gates

- A model or embedding stage must have earlier successful discovery and protection stages.
- A persistence stage must identify the protected representation written.
- Any output/reveal trace must have guardrail and leak-check evidence.
- Every patient-specific model claim must cite a source UUID from the authorized retrieval set. Database UUIDs are replaced with ephemeral `source-N` aliases before provider egress and mapped back only after server-side allowlist validation.
- A receipt with `raw_leak_count > 0` is a failing release gate, not a warning.
- A broken previous-hash link invalidates all later evidence.

## Salus 80

`npm run salus80` requires a ready API in configured `protegrity` mode, creates an isolated synthetic protected profile, executes 40 care/safety cases and 40 privacy cases, validates the linked receipt for every privacy run, records trace IDs, generates JSON/PDF evidence, and deletes the isolated profile. A submission result is acceptable only at 80/80.

The 40 privacy cases cover Semantic Guardrails, raw output identifiers, prohibited canaries, cross-profile/purpose/scope denial, revocation classes, forged capabilities, and protection postconditions at real runtime boundaries. Cases 31-40 write protected synthetic representations to rollback-only PostgreSQL/pgvector transactions, temporary encrypted MinIO objects, removable BullMQ/Redis jobs, signed tool capabilities, document/prompt rows, payload-free Prometheus metrics, and structured metadata logs. Each target is read back or captured, inspected for exact raw identifiers/canaries, hashed, counted, and cleaned up. Attack Lab exposes the same cases in the UI and links every run to its Protection Receipt.

## Boundary inspection

For the final demo, place unique synthetic canaries in the trusted input boundary, run the relevant workflow, then inspect PostgreSQL rows, MinIO ciphertext/metadata, Redis jobs, pgvector/document chunks, signed tool arguments, payload-free telemetry, and the patient-bearing contents of the exact NVIDIA request. Search for exact raw canaries and identifiers; the expected count outside trusted input/reveal memory is zero. Store only target names, counts, sizes, outcomes, and SHA-256 artifact hashes as evidence--never the canary-bearing input itself.

The provider receipt hashes and byte-counts the complete serialized NVIDIA request while Data Discovery and prohibited-value checks inspect its patient-bearing message contents. This avoids treating non-patient configuration keys such as the provider model identifier as health data while still proving the exact request artifact that crossed the boundary.

Evidence generated before the current commit is not accepted. Reports are excluded from Git so judges can reproduce them from the submitted code.
