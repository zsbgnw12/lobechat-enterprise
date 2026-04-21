# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo actually is

This is **not** a plain LobeChat checkout. It is the **Enterprise AI Workspace** prototype:

- **Upstream LobeChat source** (de-branded) as the chat UI — see `README.lobechat.md` for the original upstream README.
- **`gateway/`** — a self-built **Enterprise Gateway** (Fastify + Prisma + Postgres + Redis + BullMQ). This is where permissions/identity/data-scope/field-masking/audit live. See `README.gateway.md`.
- **`docker-compose.yml`** — orchestrates the whole stack (db, redis, gateway, lobechat).

It is a **local-only prototype**: not deployed, not pushed to cloud. All secrets live in local `.env` (gitignored).

`README.md` is the authoritative diff against upstream LobeChat (new files, modified files, branding replacements). Read it before making changes that might collide with upstream.

## Architecture at a glance

```
Browser :3010 ── LobeChat (Next.js) ──tool-bridge──▶ Gateway :3001 (Fastify)
                        │                                   │
                        ▼                                   ▼
                    Postgres (pgvector, pg16)         Redis (cache + BullMQ)
                        │                                   │
                    two logical DBs:                   8 upstream adapters:
                    lobechat + enterprise_gateway     gongdan, xiaoshou, cloudcost,
                                                      kb, ai_search (Serper),
                                                      sandbox (Daytona), doc agent
```

Request flow through gateway (`gateway/src/core/gateway.ts` is the entry pipeline):
1. **auth** — dev header `X-Dev-User` OR Casdoor JWKS Bearer OR M2M client_credentials
2. **capabilities** — deny-wins RBAC from `enterprise_*` tables (cached in Redis, key `cap:v1:*`)
3. **identity_map** — rewrite user → upstream identifier per tool
4. **data_scope DSL** — whitelist + `$in` / `$contains` / `$regex` filters
5. **tool adapter** — HTTP call to upstream (`gateway/src/tools/*`)
6. **field_policies** — drop / mask / hash (supports wildcards)
7. **audit** — BullMQ async, sync fallback; exposed at `/metrics`

Gateway layout:
- `gateway/src/routes/admin/*` — admin API + `ui.ts` (6-page HTML admin UI with CSRF, mounted at `/admin`)
- `gateway/src/routes/lobechatPlugin.ts` — dynamic LobeChat plugin manifest + tool bridge
- `gateway/src/routes/metrics.ts` — Prometheus `/metrics` (super_admin or `Bearer METRICS_TOKEN`)
- `gateway/src/core/` — `gateway | filter | masking | audit | capabilities | cache | auditQueue | metrics | rateLimiter | scopeDsl`
- `gateway/src/auth/` — `devAuth | casdoor | casdoorM2M | middleware`
- `gateway/prisma/schema.prisma` — 9 enterprise tables; `seed.ts` provides the dev users below

## Common commands

### Full stack (Docker, the normal way to run this repo)

```bash
cp .env.example .env                              # if missing
docker compose build --build-arg USE_CN_MIRROR=true   # first build ~20 min
docker compose up -d

curl -sf http://localhost:3001/health             # gateway health
curl -sI http://localhost:3010/                   # lobechat (200 or 307)
bash gateway/scripts/acceptance.sh                # 43 automated checks
bash gateway/scripts/pilot-all.sh                 # 8 real upstream pilots
```

Admin UI: `http://localhost:3001/admin` (dev login with usernames below).

### Dev users (seeded — dev mode passes `X-Dev-User: <name>`)

| user | role | tools visible |
|---|---|---|
| `sa` | super_admin | all |
| `pa` | permission_admin | admin UI only |
| `sales1` | internal_sales | xiaoshou×4 + kb + ai_search + doc |
| `ops1` | internal_ops | gongdan×7 + cloudcost×3 + kb + ai_search + doc |
| `tech1` | internal_tech | gongdan.{get_own_tickets,search_tickets,get_ticket,update_ticket} + kb + ai_search + sandbox |
| `cust1` | customer | kb + ai_search + sandbox + doc + gongdan.{create_ticket,get_own_tickets} |

### Gateway (inside `gateway/`)

```bash
cd gateway
bun install                     # or npm/pnpm
bun run dev                     # ts-node src/server.ts (listens :3001)
bun run build && bun run start  # compile + node dist/server.js
bun run prisma:generate
bun run prisma:push             # schema → db (accept-data-loss)
bun run seed                    # seed enterprise_gateway DB
```

### LobeChat (upstream) dev

Standard upstream scripts still work (`bun run dev:spa`, `bun run dev`, `bunx vitest run ...`). See the legacy guidance section below. In practice **this repo runs LobeChat through docker-compose** — you usually don't start it standalone.

### Troubleshooting

```bash
docker compose ps -a
docker logs lobechat-gateway-1 --tail 50
docker logs lobechat-lobechat-1 --tail 50
docker exec lobechat-db-1 psql -U eg -d enterprise_gateway -c "\dt enterprise_*"
docker exec lobechat-redis-1 redis-cli keys 'cap:v1:*'
bash gateway/scripts/acceptance.sh | grep FAIL
```

`docker compose down` keeps volumes; `docker compose down -v` wipes `pgdata` (usually don't).

## Things that trip people up

- **Two logical DBs in one Postgres**: `enterprise_gateway` and `lobechat`. Created by `db-init/01-create-dbs.sql` on first container start. If you `docker compose down -v`, re-seed the gateway after reboot (`bun run seed` inside gateway container).
- **`pg_search` / BM25 is disabled**. Migrations `packages/database/migrations/0090_enable_pg_search.sql` and `0093_add_bm25_indexes_with_icu.sql` are intentionally empty — the `pgvector/pgvector:pg16` image doesn't ship `pg_search.control`. Don't re-enable them without swapping to a paradedb image + data migration.
- **Don't re-brand upstream files casually**: `README.md` lists the 242 locale files / 760 replacements plus branding constants. i18n **keys were not renamed**, only values — check there before grepping for "LobeHub".
- **Secrets**: `.env*` are gitignored. Generate prod secrets with `openssl rand -base64 32` for `KEY_VAULTS_SECRET`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`, `ADMIN_CSRF_SECRET`, `METRICS_TOKEN`. See `docs/PRODUCTION-SECRETS.md`.
- **Casdoor** requires the user to create the Application manually (`docs/CASDOOR-SETUP.md`) for end-to-end SSO; dev header auth works without it.

## External upstream / integration docs

- `AI-BRAIN-API.md`, `EXTERNAL_SERVICES.md`, `SUPER_OPS_API.md`, `工单接口.md` — four upstream-system specs provided by the user. Consult these before touching any `gateway/src/tools/*` adapter.
- `docs/DELIVERY.md` — delivery checklist + test report.
- `.omc/plans/autopilot-impl.md`, `.omc/autopilot/spec.md` — original implementation plan.

---

## Upstream LobeChat conventions (still apply when editing LobeChat code)

Tech stack: Next.js 16 + React 19 + TS · SPA via `react-router-dom` · `@lobehub/ui` + antd · antd-style (prefer `createStaticStyles` with `cssVar.*`, fall back to `createStyles` + `token` only when runtime needed — see `.cursor/docs/createStaticStyles_migration_guide.md`) · react-i18next · zustand · SWR · tRPC · Drizzle ORM · Vitest.

LobeChat layout:
- `apps/desktop/` — Electron app
- `packages/` — shared `@lobechat/*` (database, agent-runtime, ...)
- `src/app/` — Next.js App Router (backend API, auth pages)
- `src/routes/` — **thin** SPA page segments; only import from `@/features/*`
- `src/features/` — domain UI + hooks
- `src/spa/` — SPA entries (`entry.web.tsx`, `entry.mobile.tsx`, `entry.desktop.tsx`) + `router/`
- `src/store/`, `src/services/`, `src/server/`, `e2e/`

When adding an SPA route, keep route files thin and put logic under `src/features/<Domain>/`. **Register desktop routes in both** `src/spa/router/desktopRouter.config.tsx` **and** `desktopRouter.config.desktop.tsx` — mismatch causes blank screens. See `.agents/skills/spa-routes/SKILL.md`.

Testing:
```bash
bunx vitest run --silent='passed-only' '[file]'          # never run `bun run test` — ~10 min
cd packages/database && bunx vitest run --silent='passed-only' '[file]'
bun run type-check
```
Prefer `vi.spyOn` over `vi.mock`. After 2 failed fix attempts, stop and ask.

i18n: add keys to `src/locales/default/<namespace>.ts`; for preview translate `locales/zh-CN/` + `locales/en-US/`; don't run `pnpm i18n` (CI handles it).

Git: `canary` = dev branch, `main` = release (cherry-picks from canary). Branch new work off `canary`, PR into `canary`. Rebase on pull. Gitmoji commit prefix. Branch name `<type>/<feature-name>`.

Package tooling: `pnpm` for deps, `bun` for scripts, `bunx` for npm executables.
