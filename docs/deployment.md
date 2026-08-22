# Production deployment

Salus ships a single-server production profile for a Linux host with Docker Compose. Only Caddy publishes ports. PostgreSQL, Redis, MinIO, ClamAV, Prometheus, the API, and the worker remain private to the Docker network. Caddy obtains and renews TLS certificates automatically.

This challenge build uses synthetic data and makes no healthcare-compliance certification claim.

## Prerequisites

- A Linux server with Docker Engine and Docker Compose v2
- A domain with an A/AAAA record pointing to the server
- Inbound TCP 80 and TCP/UDP 443 allowed by the firewall
- Production NVIDIA, SMTP, and web-push credentials
- An off-server encrypted backup destination

## Configure

1. Copy `.env.production.example` to `.env.production`. The real file is ignored by Git.
2. Replace every placeholder. Do not reuse development credentials.
3. Generate independent secrets. On Linux, suitable commands include:

   ```sh
   openssl rand -hex 32       # POSTGRES_PASSWORD, SESSION_SECRET, S3_SECRET_KEY
   openssl rand -base64 32    # OBJECT_ENCRYPTION_KEY
   npx web-push generate-vapid-keys
   ```

4. Keep secure cookies enabled and configure the exact HTTPS web origin. Salus has no passwordless demonstration-login route.
5. Validate the resolved configuration without starting containers:

   ```sh
   docker compose --env-file .env.production -f docker-compose.production.yml config --quiet
   ```

## Deploy

```sh
docker compose --env-file .env.production -f docker-compose.production.yml pull
docker compose --env-file .env.production -f docker-compose.production.yml build --pull
docker compose --env-file .env.production -f docker-compose.production.yml up -d
docker compose --env-file .env.production -f docker-compose.production.yml ps
curl --fail https://YOUR_DOMAIN/health/ready
```

The readiness response must report `status: ready`, `aiConfigured: true`, `privacy.mode: protegrity`, and `privacy.protegrityConfigured: true`. Voice questions use Salus's private transcript-review workflow and do not require a hosted speech provider. Register the first real account through the web UI and verify its email through the configured SMTP provider. Do not seed challenge reviewer credentials into a public deployment.

## Update and rollback

Before every update, capture an encrypted PostgreSQL backup and an object-storage snapshot. Build API and worker from the same commit. Versioned schema changes run before the API starts. Roll back application images only when the applied schema remains compatible; otherwise deploy a tested forward fix.

## Backups and monitoring

- Send encrypted PostgreSQL backups and MinIO object snapshots off the server.
- Alert on `/health/ready`, queue failures, storage capacity, repeated authentication denials, and certificate renewal failures.
- Keep Prometheus private; forward metrics through an authenticated monitoring agent or tunnel.
- Perform and document a restore test before accepting real caregiving data.
