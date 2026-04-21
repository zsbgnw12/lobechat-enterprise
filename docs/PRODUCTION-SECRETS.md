# Production Secrets Reference

This document enumerates every environment variable that carries a secret,
its risk classification, how to generate it, and how to rotate it safely.

---

## Risk levels

| Level    | Meaning                                                          |
|----------|------------------------------------------------------------------|
| critical | Breach = data exfiltration or full service compromise            |
| high     | Breach = upstream data egress or privilege escalation possible   |
| med      | Breach = monitoring exposure or low-impact lateral access        |

---

## Secret inventory

### `POSTGRES_PASSWORD`
- **Risk:** critical
- **Purpose:** Postgres superuser password; controls full DB access for both `enterprise_gateway` and `lobechat` schemas.
- **Generate:**
  ```bash
  openssl rand -base64 32
  ```
- **Rotation:** Update `.env`, then `docker compose up -d db gateway lobechat`. DB credentials embedded in `DATABASE_URL` must be updated in sync.

---

### `KEY_VAULTS_SECRET`
- **Risk:** critical
- **Purpose:** LobeChat KDF — used to derive per-user encryption keys for stored API-key vaults.
- **Generate:**
  ```bash
  openssl rand -base64 32
  ```
- **Rotation:** Requires app restart (`docker compose up -d lobechat`). Existing encrypted vaults cannot be decrypted with the old key — users must re-enter API keys.

---

### `NEXT_AUTH_SECRET`
- **Risk:** critical
- **Purpose:** NextAuth session signing key. Compromise allows forging any user session.
- **Generate:**
  ```bash
  openssl rand -base64 32
  ```
- **Rotation:** App restart only (`docker compose up -d lobechat`). All existing sessions are immediately invalidated — users must re-login.

---

### `TOKEN_ENCRYPTION_KEY`
- **Risk:** critical
- **Purpose:** AES-256-GCM key used by the Enterprise Gateway to encrypt Casdoor M2M access tokens at rest in the database.
- **Generate:**
  ```bash
  openssl rand -base64 32   # must decode to exactly 32 bytes
  ```
- **Rotation:** App restart (`docker compose up -d gateway`). Previously stored encrypted tokens are unreadable — trigger a fresh M2M token fetch after restart.

---

### `ADMIN_CSRF_SECRET`
- **Risk:** high
- **Purpose:** HMAC secret for the admin-panel CSRF token. Compromise allows forging admin state-mutation requests.
- **Generate:**
  ```bash
  openssl rand -base64 32
  ```
- **Rotation:** App restart only (`docker compose up -d gateway`). In-flight admin sessions will get new CSRF tokens on next page load.

---

### `METRICS_TOKEN`
- **Risk:** med
- **Purpose:** Bearer token required to scrape `GET /metrics` (Prometheus endpoint). Without it the endpoint is only accessible to `super_admin` role.
- **Generate:**
  ```bash
  openssl rand -base64 24
  ```
- **Rotation:** App restart (`docker compose up -d gateway`). Update Prometheus scrape config to use new token.

---

### `AUTH_CASDOOR_SECRET`
- **Risk:** critical
- **Purpose:** Casdoor OAuth2 client secret for LobeChat SSO. Compromise allows impersonating the application in the Casdoor tenant.
- **Generate:** Issued by Casdoor — copy from the Application detail page.
- **Rotation:** Regenerate in the Casdoor admin console, then restart lobechat (`docker compose up -d lobechat`).

---

### `CLOUDCOST_M2M_CLIENT_SECRET`
- **Risk:** critical
- **Purpose:** Casdoor M2M client_credentials secret for the cloudcost adapter. Used to obtain short-lived access tokens to call the Azure Container App cost API.
- **Generate:** Issued by Casdoor M2M application — copy from the client detail page.
- **Rotation:** Regenerate in the Casdoor M2M application, then restart gateway (`docker compose up -d gateway`).

---

### `SUPER_OPS_API_KEY`
- **Risk:** high
- **Purpose:** API key for the xiaoshou (Super Ops CRM) upstream. Breach = read/write access to CRM customer data.
- **Generate:** Issued by Super Ops — obtain from the API management portal.
- **Rotation:** Re-issue from Super Ops, update `.env.pilot` (or `.env`), then restart gateway.

---

### `GONGDAN_API_KEY`
- **Risk:** high
- **Purpose:** API key for the 工单 (ticket) system upstream. Breach = read/write access to all enterprise tickets.
- **Generate:** Issued by the 工单 system admin.
- **Rotation:** Re-issue from upstream, update `.env.pilot`, restart gateway.

---

### `KB_API_KEY`
- **Risk:** high
- **Purpose:** API key for the Knowledge Base agent upstream. Breach = read access to internal KB documents.
- **Generate:** Issued by the KB system admin.
- **Rotation:** Re-issue from upstream, update `.env.pilot`, restart gateway.

---

### `AI_SEARCH_KEY`
- **Risk:** high
- **Purpose:** Serper.dev API key for the `ai_search.web` tool. Breach = billing abuse and query leakage.
- **Generate:** Obtain from [serper.dev](https://serper.dev) dashboard.
- **Rotation:** Regenerate in Serper dashboard, update `.env.pilot`, restart gateway.

---

### `SANDBOX_KEY`
- **Risk:** high
- **Purpose:** Daytona API key for the `sandbox.run` tool. Breach = ability to create/destroy remote workspaces.
- **Generate:** Issued by Daytona — copy from the API key management page.
- **Rotation:** Regenerate in Daytona dashboard, update `.env.pilot`, restart gateway.

---

### `DOC_AGENT_KEY`
- **Risk:** high
- **Purpose:** API key for the doc-creator-agent upstream (`doc.generate` tool). Breach = document generation billing abuse and content leakage.
- **Generate:** Issued by the doc-agent service operator.
- **Rotation:** Re-issue from upstream, update `.env.pilot`, restart gateway.

---

## Rotation strategy summary

| Secret                          | Restart required               | Additional steps                          |
|---------------------------------|-------------------------------|-------------------------------------------|
| `POSTGRES_PASSWORD`             | db + gateway + lobechat        | Update `DATABASE_URL` in all services     |
| `KEY_VAULTS_SECRET`             | lobechat                       | Users must re-enter API keys              |
| `NEXT_AUTH_SECRET`              | lobechat                       | All sessions invalidated                  |
| `TOKEN_ENCRYPTION_KEY`          | gateway                        | Trigger fresh M2M token fetch             |
| `ADMIN_CSRF_SECRET`             | gateway                        | —                                         |
| `METRICS_TOKEN`                 | gateway                        | Update Prometheus scrape config           |
| `AUTH_CASDOOR_SECRET`           | lobechat                       | Regenerate in Casdoor console first       |
| `CLOUDCOST_M2M_CLIENT_SECRET`   | gateway                        | Regenerate in Casdoor M2M app first       |
| `SUPER_OPS_API_KEY`             | gateway                        | Re-issue from Super Ops portal            |
| `GONGDAN_API_KEY`               | gateway                        | Re-issue from 工单 admin                  |
| `KB_API_KEY`                    | gateway                        | Re-issue from KB admin                    |
| `AI_SEARCH_KEY`                 | gateway                        | Regenerate in Serper dashboard            |
| `SANDBOX_KEY`                   | gateway                        | Regenerate in Daytona dashboard           |
| `DOC_AGENT_KEY`                 | gateway                        | Re-issue from doc-agent operator          |

---

## Pre-production deploy checklist

- [ ] All critical secrets are unique and not reused from dev/staging.
- [ ] `.env` is NOT committed to git (verify with `git status`).
- [ ] `POSTGRES_PASSWORD` is at least 24 characters of random entropy.
- [ ] `KEY_VAULTS_SECRET`, `NEXT_AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY` are each 32-byte random values.
- [ ] `AUTH_CASDOOR_SECRET` and `CLOUDCOST_M2M_CLIENT_SECRET` are freshly issued (not demo values).
- [ ] `METRICS_TOKEN` is rotated from any value used in development.
- [ ] Upstream API keys (`GONGDAN_API_KEY`, `KB_API_KEY`, `AI_SEARCH_KEY`, `SANDBOX_KEY`, `DOC_AGENT_KEY`, `SUPER_OPS_API_KEY`) are production-issued, not sandbox/trial keys.
- [ ] Secrets are stored in a secrets manager (e.g. Azure Key Vault, Vault by HashiCorp) — not plain text on disk in production.
- [ ] Access to the secrets manager is restricted to CI/CD service account and on-call engineers.
- [ ] Rotation schedule is agreed: critical secrets every 90 days; high every 180 days; med annually.
