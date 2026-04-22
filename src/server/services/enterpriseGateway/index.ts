/**
 * Enterprise Gateway Tool Bridge
 *
 * 当模型在聊天里发起 tool_call，identifier 以 `enterprise.` 前缀开头时，
 * LobeChat server 侧把请求转发到企业 Gateway（`gateway/`），再把结果
 * 格式化成 LobeChat 的 `ToolExecutionResult` 形态返给上层。
 *
 * 数据流：
 *   聊天 → 模型 function_call(name="enterprise.kb.search", args={...})
 *        → BuiltinToolsExecutor.execute 识别前缀
 *        → 调 `executeEnterpriseTool(userId, toolKey, args)`（本服务）
 *        → 从 DB 查 email → local-part = username (即 Gateway user)
 *        → POST http://gateway:3001/api/lobechat/tool-gateway
 *              headers: { X-Dev-User: <username> }
 *              body:    { tool: "kb.search", params: {...} }
 *        → 把 `{ data, meta }` 转成 `{ content, success }`
 *
 * ## 为什么走 HTTP（不是直连 DB）
 * - Gateway 七步流水（capability/identity_map/data_scope/field_policies/audit）
 *   都在 HTTP handler 里，绕开去直查 DB 会丢这些策略；
 * - LobeChat 和 Gateway 将来可能分部署（Azure Container Apps），HTTP 边界
 *   天然支持；
 * - 生产接 Casdoor 后，只需把 `X-Dev-User` 换成 `Authorization: Bearer <token>`，
 *   这个 service 的结构不用动。
 *
 * ## 身份桥
 * - 当前：`<email local-part>@whatever` → Gateway username
 *   例：sa@enterprise.local → sa → super_admin
 * - 将来：Casdoor SSO 的 access_token 透传
 *
 * ## 错误映射（Gateway HTTP status → 给模型的说明）
 *   403 → "用户没有调用 xxx 的权限，请不要重试"
 *   429 → "调用过快，稍后重试"
 *   5xx → "企业 Gateway 暂时不可用"
 *   网络异常 / 超时 → 同 5xx
 */
import { type LobeChatDatabase } from '@lobechat/database';
import debug from 'debug';

import { identifierToToolKey, isEnterpriseIdentifier } from '@/const/enterpriseTools';

import { type ToolExecutionResult } from '../toolExecution/types';
import { buildGatewayHeaders } from './forwardAuth';

const log = debug('lobe-server:enterprise-gateway');

/** 执行单次企业工具调用的超时（给 Gateway 的上游链路留足时间） */
const ENTERPRISE_TOOL_TIMEOUT_MS = 30_000;

export { isEnterpriseIdentifier };

/**
 * Gateway 返回的响应结构（见 gateway/src/core/gateway.ts）。
 */
interface GatewayResponse {
  data: unknown;
  meta?: {
    audit_ok?: boolean;
    dropped_count?: number;
    filtered_count?: number;
    masked_fields?: string[];
    missing_identity_map_count?: number;
  };
}

const buildMetaNote = (meta?: GatewayResponse['meta']): string => {
  if (!meta) return '';
  const parts: string[] = [];
  if (typeof meta.dropped_count === 'number' && meta.dropped_count > 0) {
    parts.push(`因权限已过滤 ${meta.dropped_count} 条无权查看的记录`);
  }
  if (typeof meta.missing_identity_map_count === 'number' && meta.missing_identity_map_count > 0) {
    parts.push(`${meta.missing_identity_map_count} 条记录因身份映射缺失未返回`);
  }
  if (meta.masked_fields && meta.masked_fields.length > 0) {
    parts.push(`字段 [${meta.masked_fields.join(', ')}] 已脱敏`);
  }
  if (parts.length === 0) return '';
  // 给模型读，放在结果后面做一条系统性注释——模型会据此对用户给出正确解释
  return `\n\n---\n**合规提示**：${parts.join('；')}。`;
};

const stringifyData = (data: unknown): string => {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
};

export interface EnterpriseToolInvokeParams {
  /** 工具参数（已 parse 过的 object） */
  args: Record<string, unknown>;
  /** LobeChat 完整 identifier，如 `enterprise.kb.search` */
  identifier: string;
  serverDB: LobeChatDatabase;
  /** LobeChat 当前会话的用户 id（Better Auth session.user.id） */
  userId: string;
}

/**
 * 执行一次企业 Gateway 工具调用，返回给 LobeChat 工具执行层的标准结果。
 * 本函数**永不抛出**——所有错误都转成 `{ success:false, error, content }`，
 * 避免 agent loop 崩溃。
 */
export async function executeEnterpriseTool(
  params: EnterpriseToolInvokeParams,
): Promise<ToolExecutionResult> {
  const { identifier, args, userId, serverDB } = params;
  const toolKey = identifierToToolKey(identifier);
  if (!toolKey) {
    return {
      content: `非法的企业工具 identifier: ${identifier}`,
      error: { code: 'BAD_IDENTIFIER', message: 'not an enterprise identifier' },
      success: false,
    };
  }

  // 1. 通过 forwardAuth 统一获取 Gateway headers（Casdoor Bearer 优先 / X-Dev-User fallback）
  const authHeaders = await buildGatewayHeaders(serverDB, userId, {
    'Content-Type': 'application/json',
  });
  if (!authHeaders) {
    log('no enterprise identity for user %s, refusing', userId);
    return {
      content: '未识别到企业身份（当前账号邮箱未映射到企业用户），无法调用企业工具。',
      error: { code: 'NO_ENTERPRISE_IDENTITY', message: 'user not mapped to enterprise' },
      success: false,
    };
  }

  // 2. 发请求
  const gatewayUrl = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3001';
  const url = `${gatewayUrl}/api/lobechat/tool-gateway`;
  log('→ %s tool=%s args=%o', url, toolKey, args);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ENTERPRISE_TOOL_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      body: JSON.stringify({ tool: toolKey, params: args }),
      headers: authHeaders as Record<string, string>,
      method: 'POST',
      signal: ctrl.signal,
    });
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    log('fetch failed: %s', msg);
    return {
      content: `企业 Gateway 暂时不可用（${msg}），请稍后重试。`,
      error: { code: 'GATEWAY_UNREACHABLE', message: msg },
      success: false,
    };
  }
  clearTimeout(timer);

  // 3. 按状态码分流
  const status = resp.status;
  const bodyText = await resp.text().catch(() => '');

  if (status === 403) {
    return {
      content: `没有调用 ${toolKey} 的权限。请联系管理员授权后重试——不要重复调用。`,
      error: { code: 'FORBIDDEN', detail: bodyText, message: 'no permission' },
      success: false,
    };
  }
  if (status === 429) {
    return {
      content: `调用 ${toolKey} 的频率过高，请稍后再试。`,
      error: { code: 'RATE_LIMITED', detail: bodyText, message: 'rate limited' },
      success: false,
    };
  }
  if (status >= 500 || !resp.ok) {
    log('upstream %d body=%s', status, bodyText.slice(0, 200));
    return {
      content: `企业 Gateway 返回异常（HTTP ${status}），请稍后重试。`,
      error: { code: 'UPSTREAM_ERROR', detail: bodyText, message: `HTTP ${status}` },
      success: false,
    };
  }

  // 4. 正常响应
  let parsed: GatewayResponse;
  try {
    parsed = JSON.parse(bodyText) as GatewayResponse;
  } catch {
    return {
      content: bodyText || '企业 Gateway 返回空数据。',
      error: { code: 'INVALID_RESPONSE', message: 'gateway returned non-JSON' },
      success: false,
    };
  }

  const content = stringifyData(parsed.data) + buildMetaNote(parsed.meta);
  log('← ok tool=%s bytes=%d', toolKey, content.length);
  return {
    content,
    state: parsed.meta as Record<string, unknown> | undefined,
    success: true,
  };
}
