/**
 * [enterprise-fork] chat-gw MCP JSON-RPC 客户端。
 *
 * 薄封装:
 *   - 拿一个 bearer token(调用方传入,来自 tokenStore)
 *   - POST 到 `${CHAT_GW_URL}/mcp`
 *   - 自动把 JSON-RPC 的 error 转成 JS Error,把 result 直接返回
 *
 * 上层看不到 JSON-RPC 细节,只关心"我调了哪个 MCP method,得到什么"。
 */

export interface McpErrorPayload {
  code: number;
  data?: { kind?: string; [k: string]: any };
  message: string;
}

export class McpCallError extends Error {
  code: number;
  data?: McpErrorPayload['data'];

  constructor(e: McpErrorPayload) {
    super(`[MCP ${e.code}] ${e.message}`);
    this.name = 'McpCallError';
    this.code = e.code;
    this.data = e.data;
  }
}

const baseUrl = () => {
  const u = process.env.CHAT_GW_URL;
  if (!u) throw new Error('CHAT_GW_URL env 未配置');
  return u.replace(/\/+$/, '');
};

let idCounter = 0;
const nextId = () => ++idCounter;

export async function mcpCall<T = unknown>(
  token: string,
  method: string,
  params?: Record<string, any>,
): Promise<T> {
  const body = {
    id: nextId(),
    jsonrpc: '2.0' as const,
    method,
    params: params ?? {},
  };
  const resp = await fetch(`${baseUrl()}/mcp`, {
    body: JSON.stringify(body),
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  if (!resp.ok) {
    // chat-gw 应该总返 200+JSON-RPC error,非 200 是 gateway/网络层问题
    const text = await resp.text().catch(() => '');
    throw new Error(`chat-gw http ${resp.status}: ${text.slice(0, 200)}`);
  }
  const payload = (await resp.json()) as { error?: McpErrorPayload; result?: T };
  if (payload.error) throw new McpCallError(payload.error);
  return payload.result as T;
}

// ─── 便捷封装 ────────────────────────────────────────────────

export interface McpToolDefinition {
  description?: string;
  inputSchema: Record<string, any>;
  name: string;
}

export async function listTools(token: string): Promise<McpToolDefinition[]> {
  const r = await mcpCall<{ tools: McpToolDefinition[] }>(token, 'tools/list');
  return r.tools || [];
}

export interface McpCallResult {
  content: Array<{ text?: string; type: string }>;
  isError?: boolean;
}

export async function callTool(
  token: string,
  name: string,
  args: Record<string, any>,
): Promise<McpCallResult> {
  return mcpCall<McpCallResult>(token, 'tools/call', { arguments: args, name });
}

export interface McpInitializeResult {
  capabilities: Record<string, any>;
  protocolVersion: string;
  serverInfo: { name: string; version: string };
}

export async function initialize(token: string): Promise<McpInitializeResult> {
  return mcpCall<McpInitializeResult>(token, 'initialize', {
    protocolVersion: '2024-11-05',
  });
}

// ─── 匿名端点 ───────────────────────────────────────────────

export interface ReadyzResponse {
  checks: {
    jwks: string;
    postgres: string;
    production_env?: Array<{ detail: string; name: string; ok: boolean }>;
    redis: string;
    tools: { issues: any[]; ok: number; total: number };
  };
  status: 'ready' | 'not_ready';
}

export async function fetchReadyz(): Promise<ReadyzResponse> {
  const resp = await fetch(`${baseUrl()}/readyz`, { method: 'GET' });
  if (!resp.ok) throw new Error(`readyz http ${resp.status}`);
  return (await resp.json()) as ReadyzResponse;
}
