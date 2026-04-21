# Enterprise Gateway — LobeChat Plugin Manifest

This directory holds **two** flavours of a [LobeChat plugin manifest](https://lobehub.com/docs/usage/plugins/development):

1. **Static** `manifest.json` — a hard-coded four-tool view. Good as a fallback / first
   look, but does **not** reflect the caller's real gateway capabilities.
2. **Dynamic** (recommended) — served by the gateway at
   `GET http://gateway:3001/api/lobechat/manifest`. The `api[]` list is computed
   from `/api/capabilities` for the caller (identity via `X-Dev-User` or future
   Casdoor session), so different users see different tools.

Both flavours funnel tool calls to
`POST http://gateway:3001/api/lobechat/tool-gateway` which preserves the gateway's
RBAC / identity-map / data-scope / field-masking / audit pipeline.

## Dynamic manifest details

- `api[i].name` uses `__` as the separator because LobeChat's plugin spec rejects
  dots in `name` (e.g. `kb__search`, `gongdan__search_tickets`). The gateway
  translates this back to its real tool key.
- Calls go to `POST /api/lobechat/tool-gateway` with body
  `{"name":"kb__search","arguments":{...}}` (OpenAI-plugin shape) or the simpler
  `{"tool":"kb.search","params":{...}}`. Both are accepted.
- A 403 response means the caller is not authorized for that tool; agents should
  not retry.

## What it exposes

All four entries call `POST http://gateway:3001/api/tools/call` with a `{ tool, params }` body:

| Manifest `name`            | Gateway `tool` key              |
| -------------------------- | ------------------------------- |
| `kb_search`                | `kb.search`                     |
| `ai_search_web`            | `ai_search.web`                 |
| `gongdan_create_ticket`    | `gongdan.create_ticket`         |
| `xiaoshou_search_customers`| `xiaoshou.search_customers`     |

> This is a minimum-viable bridge. The Gateway enforces RBAC, identity-map, data-scope, and field-masking — this manifest does *not* relax any of that. A real plugin build will also need to translate the manifest `name` → gateway `tool` key, inject the caller's identity header (`X-Dev-User` in dev, Casdoor JWT in prod), and stream results back to LobeChat's tool-call channel. Today the gateway URL is reachable only from inside the compose network.

## How to register it in LobeChat

1. Start the stack: `docker compose up -d`.
2. Open http://localhost:3010 and sign in.
3. Settings → Plugins → Custom Plugin → Install from URL.
4. Paste one of:
   - **Dynamic (recommended)**: `http://gateway:3001/api/lobechat/manifest`
     — served per-user, so the tool list always matches the caller's real
     grants. LobeChat must send `X-Dev-User: <username>` on the manifest
     fetch (configure via the plugin's custom-headers field) or be behind a
     gateway-side proxy that injects the Casdoor identity.
   - **Static**: paste the contents of `manifest.json`.
5. Enable the plugin for an agent.

### Server-mode auto-registration

LobeChat's server-mode stores installed plugins in its own DB. We do **not**
seed a row there from this repo because the LobeChat server-mode schema is
owned by the `lobehub/lobe-chat-database` image (we pull it as a released
container and do not control its migrations). Registration is manual (step 4
above). If/when we self-host the LobeChat server image we can add a seed
migration that pre-registers `http://gateway:3001/api/lobechat/manifest` for
all users.

## Known limitations

- No auth header is injected yet — the gateway is running in `AUTH_MODE=dev`, so calls without `X-Dev-User` get 401. Replace this with a server-side proxy that adds the authenticated user's identity before forwarding.
- Only 4 tools out of the full gateway catalog (`/api/capabilities`) are mirrored here. Extend `manifest.json` as needed.
- The `url` uses the internal Docker hostname `gateway`. If LobeChat fetches the plugin from outside the compose network, change it to `http://localhost:3001` and adjust CORS (`GATEWAY_CORS_ORIGINS`).
