# Operations

## Health and monitoring

- `/health/live` confirms the API process is running.
- `/health/ready` confirms database access and reports whether chat and speech providers are configured.
- Fastify emits JSON logs with credentials, cookies, passwords, and tokens redacted.
- BullMQ retains failed jobs. Document and voice records expose durable `failed` states rather than false success.

Docker Compose includes Prometheus and scrapes the API's `/metrics` endpoint, which exposes bounded-route HTTP counters, latency histograms, and Node.js process metrics. Production deployments should retain those metrics, forward structured API/worker logs to a monitored log system, and alert on readiness failures, queue age, repeated delivery failures, database/storage capacity, and elevated authentication denials.

## Backup and restore

1. Take encrypted PostgreSQL physical backups plus tested point-in-time recovery archives.
2. Enable versioning and lifecycle-controlled replication for the private object bucket.
3. Back up Redis only for queue recovery; PostgreSQL remains the care-record source of truth.
4. Quarterly, restore database and objects into an isolated environment, verify checksums and patient/object relationships, run authorization tests, then destroy the isolated copy securely.

## Incident response

1. Contain affected credentials, sessions, routes, or worker consumers without deleting evidence.
2. Preserve correlation IDs, immutable audit history, provider request metadata, delivery records, and infrastructure logs.
3. Determine patient/user scope using database evidence, not model output.
4. Notify the designated privacy/security owner and follow applicable contractual and legal timelines.
5. Patch, rotate credentials, validate cross-patient isolation, restore service, and document corrective actions.

## Upgrades and rollback

Apply versioned schema changes with the administrative database identity before starting the restricted API identity. Back up before schema changes. Deploy API and worker images built from the same commit. Roll back application images only when the applied schema remains compatible; otherwise use a tested forward fix.

## Delivery credentials

Use a reviewed notification relay and generic message bodies. Generate an environment-specific VAPID public/private key pair and expose only the public key through the authenticated push-configuration endpoint; keep the private key in the secret manager. Invalid or expired browser subscriptions are revoked after provider responses `404` or `410`. Raw audio never goes to hosted speech services; use an approved local transcription adapter or explicit manual review.
