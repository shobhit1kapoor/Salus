# Evidence methodology

Privacy Proof is operational evidence, not a marketing animation. Every protected operation has a UUID trace and an append-only receipt containing stage outcomes, entity counts, guardrail processors, provider identity, durations, reveal decision, raw-leak count, previous hash, and event hash. Original sensitive values are prohibited from evidence.

## Verification gates

- A model or embedding stage must have earlier successful discovery and protection stages.
- A persistence stage must identify the protected representation written.
- Any output/reveal trace must have guardrail and leak-check evidence.
- Every patient-specific model claim must cite a source UUID from the authorized retrieval set.
- A receipt with `raw_leak_count > 0` is a failing release gate, not a warning.
- A broken previous-hash link invalidates all later evidence.

## Salus 80

`npm run salus80` creates an isolated synthetic protected profile, executes 40 care/safety cases and 40 privacy cases, records trace IDs, generates JSON/PDF evidence, and deletes the isolated profile. A submission result is acceptable only at 80/80.

The 40 privacy cases cover Semantic Guardrails, raw output identifiers, prohibited canaries, cross-profile/purpose/scope denial, revocation classes, and protection postconditions for storage/vector/queue/tool/log-shaped payloads. Attack Lab exposes the same cases in the UI and links every run to its Protection Receipt.

## Boundary inspection

For the final demo, place unique synthetic canaries in the input boundary, run the relevant workflow, then inspect PostgreSQL dumps, MinIO object bytes/metadata, Redis jobs, captured NVIDIA request bodies, and structured application logs. Search for exact raw canaries and identifiers; the expected count outside trusted input/reveal memory is zero. Store only scan timestamps, target names, counts, and hashes as evidence—never the canary-bearing input itself.

Evidence generated before the current commit is not accepted. Reports are excluded from Git so judges can reproduce them from the submitted code.
