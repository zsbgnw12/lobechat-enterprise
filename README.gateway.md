# Enterprise Gateway (Prototype)

Local-docker prototype of an Enterprise AI Workspace gateway. Sits between a future chat UI and legacy enterprise systems (gongdan / xiaoshou / cloudcost / kb / ai_search / sandbox / doc), enforcing centralized permissions, identity mapping, data-scope filtering, field masking, and audit logging.

## Quick Start

```bash
cp .env.example .env
docker compose build
docker compose up -d
# wait for api healthcheck
bash apps/api/scripts/acceptance.sh
```

- Web: http://localhost:3000
- API: http://localhost:3001 (health: `/health`)
- Postgres: localhost:5432

Default `MOCK_MODE=true` so no external services are required.

## Stack
- Node 20 + TypeScript + Fastify + Prisma + Postgres 16
- Next.js 14 (App Router) + React 18
- docker-compose (db / api / web)

## Migration strategy
The api container entrypoint runs `prisma db push --accept-data-loss` (simpler than migrate for a prototype), then seeds the database if empty, then starts the server. Choice documented: `db push` avoids fragile migration-file churn during early development.

## Dev auth
Pass header `X-Dev-User: <username>` or cookie `dev_user=<username>`. Seed users:
- `sa` (super_admin), `pa` (permission_admin), `sales1` (internal_sales), `ops1` (internal_ops), `tech1` (internal_tech), `cust1` (customer)

Casdoor JWKS stub is present in `apps/api/src/auth/casdoor.ts`; not enabled unless `AUTH_MODE=casdoor`.

## Acceptance
See `apps/api/scripts/acceptance.sh`. Exit 0 on pass.

## Teardown
```bash
docker compose down -v
```
