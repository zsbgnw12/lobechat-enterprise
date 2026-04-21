# Enterprise AI Workspace / Enterprise Gateway — Implementation Plan

## Goal
Local-Docker prototype that sits between a future LobeChat-native chat UI and legacy enterprise systems (gongdan / xiaoshou / cloudcost / kb / ai_search / sandbox / doc). It enforces:

- chat never manages permissions
- no customer admin
- permissions only via backend admin
- frontend capabilities != security boundary
- every enterprise tool call routed through Enterprise Gateway
- legacy full responses filtered by `identity_map` + `data_scope`, then field-masked by `field_policies`, then audited

## Stack
- Backend: Node 20 + TypeScript + Fastify + Prisma + Postgres 16
- Frontend: Next.js 14 (App Router) + React 18, server components for admin pages
- Deploy: docker-compose (db, api, web)
- Casdoor: external (http://casdoor.ashyglacier-8207efd2.eastasia.azurecontainerapps.io). Dev mode accepts a `X-Dev-User` header that maps to a seeded enterprise_user; production-ready Casdoor OIDC stub included but not wired (acceptance is local dev mode).

## Layout
```
lobechat/
  docker-compose.yml
  .env.example
  .gitignore
  README.md
  apps/
    api/
      package.json
      tsconfig.json
      Dockerfile
      prisma/
        schema.prisma
        migrations/           # created by `prisma migrate`
        seed.ts
      src/
        server.ts
        env.ts
        auth/
          casdoor.ts
          devAuth.ts
          middleware.ts
        core/
          gateway.ts          # central tool-call executor
          capabilities.ts     # role→tool resolution
          filter.ts           # identity_map + data_scope filter
          masking.ts          # field_policies
          audit.ts
        tools/
          registry.ts
          gongdan.ts
          xiaoshou.ts
          cloudcost.ts
          kb.ts
          aiSearch.ts
          sandbox.ts
          docGenerate.ts
        routes/
          health.ts
          me.ts
          capabilities.ts
          toolsCall.ts
          admin/
            users.ts
            roles.ts
            tools.ts
            dataScopes.ts
            identityMap.ts
            audit.ts
    web/
      package.json
      tsconfig.json
      next.config.mjs
      Dockerfile
      src/app/
        layout.tsx
        page.tsx                    # login/select test user
        capabilities/page.tsx
        tools/page.tsx              # tool-call tester
        admin/
          layout.tsx                # permission_admin+super_admin only
          users/page.tsx
          tools/page.tsx
          scopes/page.tsx
          audit/page.tsx
        api/session/route.ts        # cookie: selected dev user id
      src/lib/apiClient.ts
```

## Data Model (Prisma, snake_case tables via @@map)

- **enterprise_users**: id (uuid), casdoor_sub (unique), username, display_name, email, department_id, region, metadata (jsonb), is_active, timestamps
- **enterprise_roles**: id, key (unique: super_admin|permission_admin|internal_sales|internal_ops|internal_tech|customer), name, description
- **enterprise_user_roles**: user_id, role_id, granted_by, granted_at (pk composite)
- **enterprise_tool_registry**: id, key (unique: e.g. `gongdan.get_ticket`), category, display_name, description, input_schema jsonb, is_enabled
- **enterprise_tool_permissions**: id, subject_type (role|user), subject_id, tool_id, allow (bool), constraints jsonb (optional)
- **enterprise_data_scopes**: id, subject_type, subject_id, source_system, entity_type, scope jsonb (e.g. `{ "owner_user_id": "$self" }` or `{ "region": ["CN-EAST"] }`, `{ "all": true }`)
- **enterprise_field_policies**: id, source_system, entity_type, field_path, policy (drop|mask|hash), role_keys text[] (list of role keys this policy excludes, i.e. roles that still see it)
- **enterprise_identity_map**: id, source_system, entity_type, source_entity_id, tenant_id, customer_id, owner_user_id, department_id, sales_user_id, operation_user_id, region, visibility_level, metadata jsonb; unique(source_system, entity_type, source_entity_id)
- **enterprise_audit_logs**: id, at, user_id, username, tool_key, action (call|filter|mask|deny|missing_identity_map), request jsonb, response_summary jsonb, outcome (ok|denied|error), meta jsonb

## APIs

- `GET /health` → `{status:"ok", db:"ok"}`
- `GET /api/me` → `{user, roles[], casdoor_sub, department_id, region}`
- `GET /api/capabilities` → `{tools:[{key, category, display_name, description, allowed:true}]}` (only ones the user can call)
- `POST /api/tools/call` body `{tool, params}` → executes via gateway; returns `{data, meta:{filtered_count, dropped_count, masked_fields[]}}`
- Admin (requires permission_admin or super_admin):
  - `GET/POST /api/admin/users` + `POST /api/admin/users/:id/roles`
  - `GET /api/admin/roles`, `GET/POST/DELETE /api/admin/tool-permissions`
  - `GET/POST/DELETE /api/admin/data-scopes`
  - `GET/POST /api/admin/identity-map`
  - `GET /api/admin/audit?user&tool&outcome&from&to`
- Guardrail: admin APIs check role; additionally, `POST /api/tools/call` explicitly rejects tool keys in the admin namespace (`admin.*`) so permissions cannot be changed from chat.

## Gateway flow for `POST /api/tools/call`

1. Resolve user → roles → allowed tool keys (merge role grants + user grants, deny wins).
2. If requested tool not in allowed set → audit `deny`, return 403.
3. Validate params against tool input schema (zod).
4. Tool adapter calls external service **or** returns seeded mock fallback (env `MOCK_MODE=true` by default).
5. Post-processing pipeline (always, even on mock):
   a. `filterByIdentityMap(items, source, entity, user)`:
      - For each item, look up identity_map by (source_system, entity_type, source_entity_id).
      - No mapping → drop + emit `missing_identity_map` audit entry.
      - Mapping exists → check against user's `data_scopes` for (source, entity). Any matching scope passes (`all:true`, or `owner_user_id:$self`, or attribute inclusion).
   b. `applyFieldPolicies(items, source, entity, userRoles)`:
      - For each field_policy, if user has no role in `role_keys`, apply policy to `field_path`.
      - `drop` deletes, `mask` replaces with `***`, `hash` replaces with `sha256(...).slice(0,12)`.
   c. `audit.write({tool, outcome:'ok', filtered_count, dropped_count, masked_fields})`.
6. Return trimmed data to caller.

## Tool adapters

Each exports `{ key, inputSchema, sourceSystem, entityType, run(ctx, params) → items }`.

- `gongdan.create_ticket`, `gongdan.get_own_tickets`, `gongdan.search_tickets`, `gongdan.get_ticket` → HTTP client w/ `X-Api-Key: GONGDAN_API_KEY` → mock fallback returns 5 seeded tickets with mixed owners/customers.
- `xiaoshou.search_customers`, `xiaoshou.get_customer`, `xiaoshou.get_customer_insight`, `xiaoshou.get_allocations` → `X-Api-Key: SUPER_OPS_API_KEY` against xiaoshou external API → mock fallback.
- `cloudcost.get_overview` → `/api/dashboard/overview` ; `cloudcost.get_daily_report` → `/api/service-accounts/daily-report`. Requires Casdoor Bearer — in mock we return seeded floats.
- `kb.search` → POST to `KB_AGENT_URL/api/v1/search` with `api-key` header.
- `ai_search.web` → Serper.dev or Jina; mock returns 3 synthesized hits.
- `sandbox.run` → POST Daytona; mock echoes code with `stdout: "(mock)"`.
- `doc.generate` → POST doc-creator-agent; mock returns markdown stub.

Each adapter sets `sourceSystem`/`entityType` so the gateway filter/mask can route policies.

## Seed

- 6 roles (all listed above)
- 6 users:
  - `sa` → super_admin
  - `pa` → permission_admin
  - `sales1` → internal_sales (department=sales, region=CN-EAST)
  - `ops1` → internal_ops (department=ops)
  - `tech1` → internal_tech
  - `cust1` → customer (customer_id=CUST-0001)
- tool_registry: 16 tools (7 gongdan + 4 xiaoshou + 2 cloudcost + 1 kb + 1 ai_search + 1 sandbox + 1 doc)
- tool_permissions: per-role defaults per spec
- data_scopes:
  - customer → `gongdan/ticket`: `{"customer_id":"$user.customer_id"}`, `{"owner_user_id":"$self"}`
  - internal_sales → `xiaoshou/customer`: `{"sales_user_id":"$self"}`; `cloudcost/*`: none (denied)
  - internal_ops → `gongdan/ticket`: `{"all":true}`; `cloudcost/*`: `{"all":true}`
  - internal_tech → `gongdan/ticket`: `{"owner_user_id":"$self","operation_user_id":"$self"}`
  - super_admin/permission_admin → all systems `{"all":true}` (permission_admin read-only via chat because tool perms deny most tools)
- field_policies (examples):
  - `gongdan/ticket.contactInfo` → mask, keep for internal_ops/super_admin
  - `xiaoshou/customer.current_month_consumption` → drop, keep for internal_ops/super_admin/cloud_finance-like
  - `cloudcost/*.cost` → mask for customer/internal_tech
  - `*.apiKey`, `*.api_key`, `*.secret_*` → drop for everyone except super_admin
- identity_map: pre-seed 10 gongdan tickets, 5 xiaoshou customers, 3 cloud service-accounts with realistic owner/department/region. Seed also creates a ticket WITHOUT identity_map to prove missing_identity_map path.

## Dev auth

- `apps/api/src/auth/devAuth.ts` — reads header `X-Dev-User: <username>` or cookie `dev_user`. Lookups enterprise_users.username; populates `req.user`, `req.roles`.
- Casdoor OIDC stub in `casdoor.ts` (not enabled unless `AUTH_MODE=casdoor`); validates Bearer via JWKS. Not required for acceptance.

## Frontend

- `/` login page lists seed users as buttons. Clicking sets cookie via `/api/session`.
- `/capabilities` fetches `/api/capabilities`.
- `/tools` picks a tool from capabilities, renders JSON param form (based on input_schema), POSTs `/api/tools/call`, shows result + meta.
- `/admin/*` links hidden unless role is super_admin|permission_admin. Pages call admin API.
- Customer role: admin links hidden, capability list shows only customer tools. (Security boundary is still the backend.)

## Acceptance tests (Phase 3)

Scripts under `apps/api/scripts/acceptance.sh` — hits the running compose stack via localhost:3001 and verifies:

1. `customer` calling `xiaoshou.search_customers` → 403 deny, audit row created.
2. `permission_admin` calling `gongdan.search_tickets` → 403 (no tool grant) even though they can use admin APIs.
3. `internal_sales` calling `xiaoshou.search_customers` → only customers with sales_user_id == self return; others filtered (audit records filtered_count).
4. `internal_ops` calling `gongdan.search_tickets` → seeded ticket without identity_map is absent; `missing_identity_map` audit row present.
5. `customer` calling `gongdan.get_own_tickets` → only own tickets; `contactInfo` masked.
6. `super_admin` calling `/api/admin/audit` → sees all events.
7. Sensitive fields like `apiKey`/`secret` never in any non-super_admin response (grep on full JSON output).

## Phase 4 validators

- architect (functional completeness vs spec)
- security-reviewer (secrets, SQLi, authz bypass)
- code-reviewer (quality)

## Phase 5 cleanup
Remove `.omc/state/autopilot-state.json` and siblings; leave `.omc/plans/autopilot-impl.md` + `.omc/autopilot/spec.md` as artifacts.
