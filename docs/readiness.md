# Current readiness

## Verified in this workspace

- API, worker, contracts, security, and Salus 80 TypeScript builds pass.
- Next.js production build passes for all patient-first and privacy routes.
- 47 unit tests pass across API/security and web behavior.
- Python Privacy Gateway compiles successfully.
- Docker Compose configuration validates with the supplied environment template.
- `npm audit --omit=dev` reports no vulnerabilities.
- CarePilot branding and pre-generated challenge reports are excluded.
- The complete Docker Compose stack is running locally with healthy API, web, PostgreSQL, ClamAV, Mailpit, and Privacy Gateway services.
- Real-mode Privacy Gateway readiness passes for Protegrity Data Discovery 2.0, Developer Edition protect/unprotect policy access, healthcare Semantic Guardrails, and output PII processing.
- A live NVIDIA request returned a source-grounded answer with allowlisted citations; its protection receipt recorded zero raw leaks.
- Salus 80 passed **80/80** against the live stack. The JSON and PDF evidence are in `packages/testing/reports/` and the isolated profile was permanently removed.
- Post-run exposure inspection found zero configured raw-value canary matches in the PostgreSQL data dump, structured Docker logs, or the two Redis keys inspected. MinIO contained zero objects for this run.
- Purpose and scope checks now gate dashboard sections, timelines, medications, follow-ups, documents, assistant history, voice review, consent, sharing, and profile administration before protected data is read or processed.
- Controlled profile and original-document reveal require a stated purpose, a reason, recent MFA, `no-store` delivery, and a hash-chained protection receipt.
- The Privacy Proof trace explorer, Attack Lab trace linking, purpose-based caregiver grant controls, medication/lab intelligence, follow-up actions, and protected FHIR portability flows are implemented and production-built.
- Authenticated desktop and mobile browser QA passed with keyboard focus, responsive navigation, reduced-motion behavior, and no browser console errors; details are recorded in `design-qa.md`.

## Local build status

The local product and acceptance scope is complete. The Docker Compose stack is healthy and the final source tree passes lint, unit tests, production builds, dependency audit, Compose validation, and Salus 80.

## Submission-only work

- Deploy the unchanged Compose stack to the secured demonstration VM selected for the event.
- Record the demo and complete the organizer's submission form.

No remaining item is claimed complete until its reproducible evidence exists.
