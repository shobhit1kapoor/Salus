# Protegrity Developer Edition feedback

Protegrity Developer Edition made it possible to treat privacy as an executable boundary instead of a masking feature added after the AI workflow. Data Discovery, reversible protection, and Semantic Guardrails map well to distinct stages in a realistic healthcare pipeline, and the local-service model made those boundaries visible in Salus's architecture and evidence UI.

What worked especially well was separating discovery, protection, and semantic policy into independently verifiable stages. That helped Salus fail closed and produce a Protection Receipt showing which boundary ran, what entity types were found, and whether a protected payload passed its destination scan—without logging the sensitive values themselves.

The main friction was understanding which credentials and endpoints belonged to hosted Playground services versus local Developer Edition services, and how authentication should be formatted for each. Clearer end-to-end reference projects showing discovery, protect/unprotect, healthcare Semantic Guardrails, container health checks, retry semantics, and recommended production logging defaults in one version-pinned stack would shorten integration time considerably. More explicit documentation of classifier coverage and safe patterns for protecting entire canonical payloads, not only detected identifiers, would also help healthcare developers avoid treating “no entity detected” as “not sensitive.”

Developer-experience improvements we would value:

- one canonical Docker Compose example covering Data Discovery, protection, unprotection, and Semantic Guardrails;
- a machine-readable capability/version endpoint for every local service;
- documented test fixtures and outage simulations for fail-closed integration tests;
- clearer guidance on raw JWT versus `Bearer` authentication by endpoint;
- a receipt or trace schema that applications can adopt for privacy evidence dashboards;
- more examples for purpose-based selective reveal and pseudonymized RAG.

Overall, Developer Edition encouraged a stronger design: Protegrity became the control plane for what data may cross each AI boundary, while Salus supplied healthcare authorization, minimization, clinical safety, and evidence around it.

