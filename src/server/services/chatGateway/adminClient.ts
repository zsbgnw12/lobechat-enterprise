/**
 * [enterprise-fork] chat-gw Admin API (§9) HTTP client.
 *
 * 区别于 `mcpClient.ts`(JSON-RPC over `/mcp`),这里走传统 REST:
 *   - `GET/POST/PATCH/DELETE /admin/tools[/{name}]`
 *   - `GET/PUT/DELETE /admin/tool-role-grants`
 *   - `GET /admin/audit`(keyset cursor 分页)
 *
 * 认证:同一个 Casdoor Bearer JWT,chat-gw 侧额外要求 `cloud_admin` 角色;
 * 非 admin → 403,我们统一抛 `AdminForbiddenError` 给上层翻译成 tRPC
 * FORBIDDEN。其它非 2xx → `AdminHttpError`。
 */

export class AdminForbiddenError extends Error {
  constructor(msg = 'chat-gw admin 接口要求 cloud_admin 角色') {
    super(msg);
    this.name = 'AdminForbiddenError';
  }
}

export class AdminHttpError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(`chat-gw admin HTTP ${status}: ${message}`);
    this.name = 'AdminHttpError';
    this.status = status;
    this.body = body;
  }
}

const baseUrl = () => {
  const u = process.env.CHAT_GW_URL;
  if (!u) throw new Error('CHAT_GW_URL env 未配置');
  return u.replace(/\/+$/, '');
};

async function adminFetch<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T | null> {
  const resp = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (resp.status === 403) throw new AdminForbiddenError();
  if (resp.status === 204) return null;

  const text = await resp.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!resp.ok) {
    const msg =
      (parsed as { detail?: string; message?: string })?.detail ??
      (parsed as { detail?: string; message?: string })?.message ??
      resp.statusText;
    throw new AdminHttpError(resp.status, String(msg), parsed);
  }
  return parsed as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  return (
    '?' +
    entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
  );
}

// ─── Tools ──────────────────────────────────────────────────────────

export type ToolDispatcher = 'http_adapter' | 'mcp_proxy' | 'daytona_sandbox';
export type ToolAuthMode = 'service_key' | 'user_passthrough';

export interface AdminTool {
  auth_header: string | null;
  auth_mode: ToolAuthMode;
  auth_prefix: string | null;
  category: string | null;
  config: Record<string, any>;
  created_at: string;
  description: string | null;
  dispatcher: ToolDispatcher;
  display_name: string | null;
  enabled: boolean;
  input_schema: Record<string, any> | null;
  name: string;
  output_schema: Record<string, any> | null;
  secret_env_name: string | null;
  updated_at: string;
  version: number;
}

export interface AdminToolUpsertInput {
  auth_header?: string | null;
  auth_mode: ToolAuthMode;
  auth_prefix?: string | null;
  category?: string | null;
  config: Record<string, any>;
  description?: string | null;
  dispatcher: ToolDispatcher;
  display_name?: string | null;
  enabled?: boolean;
  input_schema?: Record<string, any> | null;
  name: string;
  output_schema?: Record<string, any> | null;
  secret_env_name?: string | null;
}

export interface AdminToolPatchInput {
  auth_header?: string | null;
  auth_mode?: ToolAuthMode;
  auth_prefix?: string | null;
  category?: string | null;
  config?: Record<string, any>;
  description?: string | null;
  dispatcher?: ToolDispatcher;
  display_name?: string | null;
  enabled?: boolean;
  input_schema?: Record<string, any> | null;
  output_schema?: Record<string, any> | null;
  secret_env_name?: string | null;
}

export async function listAdminTools(
  token: string,
  opts: { includeDisabled?: boolean } = {},
): Promise<AdminTool[]> {
  const r = await adminFetch<{ tools: AdminTool[] }>(
    token,
    `/admin/tools${qs({ include_disabled: opts.includeDisabled ?? true })}`,
  );
  return r?.tools ?? [];
}

export async function upsertAdminTool(
  token: string,
  input: AdminToolUpsertInput,
): Promise<AdminTool> {
  const r = await adminFetch<AdminTool>(token, '/admin/tools', {
    body: JSON.stringify(input),
    method: 'POST',
  });
  if (!r) throw new AdminHttpError(500, 'empty response from POST /admin/tools');
  return r;
}

export async function patchAdminTool(
  token: string,
  name: string,
  patch: AdminToolPatchInput,
): Promise<AdminTool> {
  const r = await adminFetch<AdminTool>(token, `/admin/tools/${encodeURIComponent(name)}`, {
    body: JSON.stringify(patch),
    method: 'PATCH',
  });
  if (!r) throw new AdminHttpError(500, `empty response from PATCH /admin/tools/${name}`);
  return r;
}

export async function deleteAdminTool(token: string, name: string, hard = false): Promise<void> {
  await adminFetch<void>(token, `/admin/tools/${encodeURIComponent(name)}${qs({ hard })}`, {
    method: 'DELETE',
  });
}

// ─── Tool-role grants ───────────────────────────────────────────────

export type CloudRole = 'cloud_admin' | 'cloud_ops' | 'cloud_finance' | 'cloud_viewer';

export interface ToolRoleGrant {
  role: CloudRole;
  tool_name: string;
}

export async function listGrants(
  token: string,
  filter: { role?: CloudRole; toolName?: string } = {},
): Promise<ToolRoleGrant[]> {
  const r = await adminFetch<{ grants: ToolRoleGrant[] }>(
    token,
    `/admin/tool-role-grants${qs({ role: filter.role, tool_name: filter.toolName })}`,
  );
  return r?.grants ?? [];
}

export async function setGrant(
  token: string,
  input: { granted: boolean; role: CloudRole; toolName: string },
): Promise<ToolRoleGrant & { granted: boolean }> {
  const r = await adminFetch<ToolRoleGrant & { granted: boolean }>(
    token,
    '/admin/tool-role-grants',
    {
      body: JSON.stringify({ granted: input.granted, role: input.role, tool_name: input.toolName }),
      method: 'PUT',
    },
  );
  if (!r) throw new AdminHttpError(500, 'empty response from PUT /admin/tool-role-grants');
  return r;
}

// ─── Audit ──────────────────────────────────────────────────────────

export type AuditOutcome = 'ok' | 'allowed' | 'denied' | 'error';

export interface AuditItem {
  arguments: Record<string, any> | null;
  at: string;
  deny_reason: string | null;
  error_code: number | null;
  error_kind: string | null;
  error_message: string | null;
  latency_ms: number | null;
  outcome: AuditOutcome;
  roles: string[];
  sensitive_fields_hit: string[];
  tool_id: number | null;
  tool_name: string | null;
  trace_id: string;
  user_email: string | null;
  user_id: string;
}

export interface AuditQuery {
  cursor?: string;
  from?: string;
  limit?: number;
  outcome?: AuditOutcome;
  to?: string;
  toolName?: string;
  traceId?: string;
  userId?: string;
}

export interface AuditPage {
  items: AuditItem[];
  next_cursor: string | null;
}

export async function queryAudit(token: string, q: AuditQuery = {}): Promise<AuditPage> {
  const r = await adminFetch<AuditPage>(
    token,
    `/admin/audit${qs({
      cursor: q.cursor,
      from: q.from,
      limit: q.limit ?? 50,
      outcome: q.outcome,
      to: q.to,
      tool_name: q.toolName,
      trace_id: q.traceId,
      user_id: q.userId,
    })}`,
  );
  return r ?? { items: [], next_cursor: null };
}
