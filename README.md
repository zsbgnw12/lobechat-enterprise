# Enterprise AI Workspace

A local Docker stack that combines:

- **LobeChat** (server-mode, with Postgres persistence) as the chat UI.
- **Enterprise Gateway** (`gateway/`, Fastify + Prisma) — permission / identity_map / data_scope / field-masking / audit layer between the chat UI and legacy enterprise systems (工单, 销售 CRM, cloud cost, KB, AI search, sandbox, doc agent).
- **Postgres 16 (pgvector)** shared by both (separate logical DBs: `enterprise_gateway` + `lobechat`).
- **Redis 7** — policy cache + BullMQ async audit queue + rate-limit store.

Production features implemented:
- Casdoor OIDC (dev mode + JWKS Bearer verification), role mapping w/ DB fallback
- 16 enterprise tools, identity-aware LobeChat plugin manifest
- Admin UI at `/admin/*` (users / tools / scopes / identity-map / audit) with CSRF
- Rate-limit (global 300/min, tool-call 60/min, admin-mutate 30/min)
- Async audit via BullMQ (sync fallback if Redis down)
- Prometheus `/metrics` (super_admin role OR `Bearer METRICS_TOKEN`)
- AES-256-GCM encryption of Casdoor M2M tokens at rest
- Per-tool mock override (`GONGDAN_MOCK`, `KB_MOCK`, …) for real-upstream pilots

The upstream LobeChat README is preserved at [`README.lobechat.md`](./README.lobechat.md).
The original gateway-only README is at [`README.gateway.md`](./README.gateway.md).

## Layout

```
docker-compose.yml            ← new unified stack (db + gateway + lobechat)
docker-compose.gateway.yml    ← OLD, gateway-only; kept as reference
.env.example                  ← unified environment template
db-init/                      ← Postgres init SQL (creates both logical DBs)
gateway/                      ← Fastify Enterprise Gateway (unchanged)
lobechat-plugin-manifest/     ← LobeChat plugin manifest bridging to the gateway
apps/ packages/ src/ ...      ← upstream LobeChat monorepo (unchanged)
```

## Ports

| Service   | Host              | Container |
| --------- | ----------------- | --------- |
| LobeChat  | `localhost:3010`  | `3210`    |
| Gateway   | `localhost:3001`  | `3001`    |
| Postgres  | `localhost:5432`  | `5432`    |

## Quick start

```bash
cp .env.example .env
# Generate secrets
echo "KEY_VAULTS_SECRET=$(openssl rand -base64 32)" >> .env
echo "NEXT_AUTH_SECRET=$(openssl rand -base64 32)" >> .env
# Fill in Casdoor client id/secret once you have them (see below)

docker compose build
docker compose up -d
# Gateway acceptance (expects 12 PASS)
bash gateway/scripts/acceptance.sh
```

Check:

- `curl -sf http://localhost:3001/health` → `{"status":"ok","db":"ok"}`
- `curl -I http://localhost:3010/` → HTTP/1.1 200

## Casdoor setup (you do this yourself)

LobeChat's server-mode image uses NextAuth's Casdoor provider. You must:

1. Log into the Casdoor tenant at `AUTH_CASDOOR_ISSUER` (default: `http://casdoor.ashyglacier-8207efd2.eastasia.azurecontainerapps.io`).
2. Create an **Application** (or reuse one) with:
   - Redirect URIs: `http://localhost:3010/api/auth/callback/casdoor`
   - Grant types: Authorization Code, Refresh Token
   - Scope: `openid profile email`
3. Copy the app's **Client ID** into `AUTH_CASDOOR_ID` and the **Client Secret** into `AUTH_CASDOOR_SECRET` in your `.env`.
4. `docker compose up -d lobechat` to restart with the new values.

Without these, LobeChat starts but SSO login will fail.

## Service details

### `db` — Postgres 16 with pgvector
- Image: `pgvector/pgvector:pg16` (LobeChat server-mode requires the `vector` extension for RAG embeddings).
- Volume: `pgdata`.
- `db-init/01-create-dbs.sql` runs once on first init and creates the `lobechat` database (the `enterprise_gateway` DB is created directly by `POSTGRES_DB`).

### `gateway` — Enterprise Gateway
- Built from `./gateway/Dockerfile`.
- Entrypoint runs `prisma db push` (dev) then seeds, then starts Fastify on `:3001`.
- Defaults: `MOCK_MODE=true`, `AUTH_MODE=dev`. Send `X-Dev-User: sa` (or `sales1`, `ops1`, `cust1`, etc.) to test.
- Contract: `GET /api/capabilities`, `POST /api/tools/call`, admin routes under `/api/admin/*`.
- Acceptance script: `gateway/scripts/acceptance.sh` (34 tests).
- Pilot scripts (real upstream): see table below.

### `lobechat` — LobeChat server-mode
- Image: `lobehub/lobe-chat-database:latest`.
- Persists conversations, files, vector embeddings into Postgres (`lobechat` DB).
- Casdoor SSO enabled via `NEXT_AUTH_SSO_PROVIDERS=casdoor`.
- Reads `GATEWAY_INTERNAL_URL=http://gateway:3001` for any future server-side tool-bridge code.

### Tool bridge
`lobechat-plugin-manifest/manifest.json` describes 4 representative gateway tools (`kb.search`, `ai_search.web`, `gongdan.create_ticket`, `xiaoshou.search_customers`) as a LobeChat custom plugin. See [`lobechat-plugin-manifest/README.md`](./lobechat-plugin-manifest/README.md). This is intentionally minimum-viable; it does not yet inject the caller's identity into the forwarded request.

## Pilot scripts (real upstream verification)

Each pilot spins up an ephemeral gateway container against `.env.pilot` and
calls the tool against the live upstream. All require `ENVFILE=$ROOT/.env.pilot`.
Run all at once with `bash gateway/scripts/pilot-all.sh` (supports `PILOT_SKIP=name1,name2`).

| Script                         | Purpose                                                          | Env required                                          |
|--------------------------------|------------------------------------------------------------------|-------------------------------------------------------|
| `pilot-gongdan.sh`             | Calls `gongdan.search_tickets` with `GONGDAN_MOCK=false`         | `GONGDAN_API_KEY`, `GONGDAN_API_URL`                  |
| `pilot-kb.sh`                  | Calls `kb.search`; verifies Redis cache hit on 2nd call          | `KB_API_KEY`, `KB_AGENT_URL`                          |
| `pilot-xiaoshou.sh`            | Calls `xiaoshou.search_customers`; clean-skips if no key set     | `SUPER_OPS_API_KEY`, `SUPER_OPS_API_URL`              |
| `pilot-cloudcost.sh`           | Calls `cloudcost.get_overview` via Casdoor M2M token             | `CLOUDCOST_M2M_CLIENT_ID`, `CLOUDCOST_M2M_CLIENT_SECRET` |
| `pilot-casdoor.sh`             | Exercises JWKS Bearer middleware with an inline mock IdP         | running `lobechat-gateway-1` container                |
| `pilot-ai-search.sh`           | Calls `ai_search.web` against Serper.dev; checks `provider=serper` | `AI_SEARCH_KEY`                                    |
| `pilot-sandbox.sh`             | Calls `sandbox.run` via Daytona; accepts unsupported response    | `SANDBOX_KEY`, `SANDBOX_API_URL`                      |
| `pilot-doc.sh`                 | Calls `doc.generate`; checks `download_url` or inline markdown   | `DOC_AGENT_KEY`, `DOC_AGENT_URL`                      |

## Quick verification

```bash
# Full acceptance suite (34 tests — requires gateway stack running)
bash gateway/scripts/acceptance.sh

# All 8 pilot scripts with summary table
bash gateway/scripts/pilot-all.sh
```

For secret generation and rotation guidance see [`docs/PRODUCTION-SECRETS.md`](./docs/PRODUCTION-SECRETS.md).
For the full delivery report and test results see [`docs/DELIVERY.md`](./docs/DELIVERY.md).

## Teardown

```bash
docker compose down          # keep data
docker compose down -v       # wipe the pgdata volume too
```

## Known gaps

See the report in the task output and `.omc/plans/autopilot-impl.md`. Not covered:
- Phase-5 source-level LobeChat UI trim (FEATURE_FLAGS layer is done; patches to upstream `src/` are skipped for safety).
- Deep in-chat tool-registration from LobeChat plugin pipeline (dynamic manifest endpoint exists; DB-side plugin pre-registration requires changes to `lobehub/lobe-chat-database` schema we do not own).
- Azure Key Vault integration (env-file for now).
- cloudcost / xiaoshou real upstream (adapters + pilots ready; **user must provide** `SUPER_OPS_API_KEY`, `CLOUDCOST_M2M_CLIENT_ID/_SECRET`).
- Full Casdoor SSO (provider wired; **user must create** Casdoor app + fill `AUTH_CASDOOR_ID/_SECRET`).

Prometheus metric samples:
```
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3001/metrics | grep gateway_tool_call_total
```
