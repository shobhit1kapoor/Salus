# Threat model

Salus assumes web clients, uploaded documents, caregiver text, model output, retrieved chunks, and agent/tool arguments are untrusted. The Privacy Gateway and its private connection to Protegrity are the trusted protection boundary.

| Threat | Primary control | Evidence |
|---|---|---|
| raw identifier reaches storage | discovery, protection, rescan postcondition, fail closed | receipt stages; boundary canary scan |
| raw identifier reaches vectors/model | embed only AI-safe view; protect/rescan complete model prompt; alias database source IDs | provider stage, exact payload hash/size, and patient-bearing content scan |
| prompt/document injection | healthcare Semantic Guardrails plus deterministic safety controls | guardrail outcome and Attack Lab trace |
| model/tool output exposes data | PII guardrail, discovery, canary, schema and citation validation | output stages and raw leak count |
| cross-profile retrieval | purpose grant, scoped capability, RLS | denied authorization receipt |
| stale/revoked caregiver access | grant validity checked before every retrieval/tool call | grant and audit history |
| direct-identifier overexposure | explicit field reveal, stated purpose, recent MFA, no-store | reveal event and receipt |
| emergency privilege abuse | reason, break-glass grant, prominent audit, owner notification | break-glass audit trail |
| malicious upload | allowlist, byte limits, in-memory ClamAV, protected extraction | document receipt |
| object-store compromise | per-object AES-GCM; Protegrity-wrapped object key | ciphertext-only object inspection |
| queue/log/telemetry exposure | protected payloads; metadata-only logs; generic notifications | Redis and structured-log canary scans |
| receipt tampering | append-only RLS plus previous/event SHA-256 chain | chain verification |
| Protegrity outage or misconfiguration | readiness gate; no credentials outside gateway; no bypass mode | outage tests and `503` behavior |

Out of scope for the hackathon prototype: compromised host kernel, browser extension theft after an authorized reveal, malicious Protegrity service administrator, and clinical validation of generated guidance. These require production organizational and infrastructure controls beyond the demonstration stack.
