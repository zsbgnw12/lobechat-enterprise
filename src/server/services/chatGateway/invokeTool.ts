/**
 * [enterprise-fork] 把 LobeChat 聊天里 model function_call
 *   (identifier 前缀 `chatgw-` → 原名 `cloud_cost.dashboard_overview` 这种)
 * 转发到 chat-gw MCP 的 tools/call。
 *
 * 调用者是 `BuiltinToolsExecutor`,已经拿到 userId + serverDB。我们:
 *   1. 去 Better Auth accounts 表拿 Casdoor access_token(过期自动 refresh)
 *   2. 调 chat-gw `tools/call`
 *   3. 返回统一的 ToolExecutionResult 格式
 *
 * chat-gw 返回 `content: [{ type:"text", text: "<json>" }]`,我们把 text
 * 字段抽出来塞到 ToolExecutionResult.content。chat-gw 的 -32001/-32602/-32603
 * 错误转成 success:false + error.code。
 */
import type { LobeChatDatabase } from '@/database/type';

import type { ToolExecutionResult } from '../toolExecution/types';
import { callTool, McpCallError } from './mcpClient';
import { GatewayAuthRequiredError, getCasdoorAccessToken } from './tokenStore';

export interface InvokeChatGwArgs {
  args: Record<string, any>;
  identifier: string;
  serverDB: LobeChatDatabase;
  userId: string;
}

/** `chatgw-cloud_cost-dashboard_overview` → `cloud_cost.dashboard_overview` */
function identifierToChatGwName(id: string): string {
  // Strip leading 'chatgw-' prefix, then convert FIRST '-' to '.'
  // (chat-gw names format is always <category>.<action>, one dot)
  const body = id.slice(7); // 'cloud_cost-dashboard_overview'
  const dash = body.indexOf('-');
  if (dash === -1) return body;
  return body.slice(0, dash) + '.' + body.slice(dash + 1);
}

export async function executeChatGwTool(input: InvokeChatGwArgs): Promise<ToolExecutionResult> {
  const toolName = identifierToChatGwName(input.identifier);
  try {
    const token = await getCasdoorAccessToken(input.serverDB, input.userId);
    const r = await callTool(token, toolName, input.args);
    const text =
      r.content?.find((c: any) => c.type === 'text')?.text ?? JSON.stringify(r.content, null, 2);
    if (r.isError) {
      return {
        content: text,
        error: { code: 'TOOL_IS_ERROR', message: '工具上游返回 isError' },
        success: false,
      };
    }
    return { content: text, success: true };
  } catch (e) {
    if (e instanceof GatewayAuthRequiredError) {
      return {
        content: e.message,
        error: { code: 'CASDOOR_AUTH_REQUIRED', message: e.message },
        success: false,
      };
    }
    if (e instanceof McpCallError) {
      const kind = e.data?.kind;
      return {
        content: `${e.message}${kind ? ` (${kind})` : ''}`,
        error: { code: String(e.code), kind, message: e.message } as any,
        success: false,
      };
    }
    return {
      content: e instanceof Error ? e.message : String(e),
      error: {
        body: e,
        message: e instanceof Error ? e.message : String(e),
        type: 'NetworkError',
      },
      success: false,
    };
  }
}
