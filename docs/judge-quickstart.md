# Judge quickstart

This path demonstrates the four judging dimensions in under five minutes with reproducible, non-secret evidence.

## 1. Verify the real boundary

Run:

```text
npm run demo:preflight
```

The command fails unless the application is reachable, the API reports configured `protegrity` mode, Protegrity discovers and protects a synthetic identifier, the protected result passes egress validation with zero matches, the reviewer workspace is seeded, all 40 Attack Lab scenarios are registered, and an NVIDIA credential is configured. It never prints credentials or the protected envelope.

## 2. Demonstrate realistic protected AI

Open `http://localhost:3000`, enter the synthetic reviewer workspace, select **My health**, and ask: "What medications are currently verified, and which follow-ups are due?"

Open the resulting trace in **Privacy Proof**. Verify:

- input discovery, protection, input guardrail, authorized retrieval, complete-prompt protection, model, output guardrail, and leak-check stages;
- protection provider `protegrity` and model provider `nvidia` are shown separately;
- provider payload status is `protected`, the SHA-256 hash has 64 characters, and a byte count is present;
- the `nvidia_payload` destination scan has zero raw and canary matches;
- every patient-specific claim uses a server-allowlisted source citation.

## 3. Demonstrate real destination inspection

Open **Attack Lab** and run `SALUS-PA-40`. The test creates protected synthetic representations at five real boundaries: rollback-only PostgreSQL, temporary encrypted MinIO, removable BullMQ/Redis, a signed short-lived agent capability, and payload-free Prometheus telemetry. It reads or captures each representation, checks exact raw identifiers and prohibited canaries, records only hashes/counts/sizes, and cleans up the probe.

Open the linked receipt. Every destination card must show `passed`, zero raw matches, and zero canary matches. A failed destination makes the scenario and Salus 80 fail.

## 4. Reproduce the acceptance result

Run:

```text
npm run salus80
```

Salus creates an isolated synthetic protected profile, executes 40 care/safety and 40 adversarial privacy scenarios, validates the Protection Receipt for every privacy run, generates local JSON/PDF evidence, and deletes the isolated profile. Only 80/80 is accepted.

Use synthetic data only. Salus makes no HIPAA, certification, clinical-validation, or production-readiness claim.
