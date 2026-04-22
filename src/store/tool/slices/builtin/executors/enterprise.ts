/**
 * Client-side EnterpriseExecutor
 *
 * 企业工具（identifier 前缀 `enterprise-`）的 client-side wrapper。
 * 因为模型 function_call 的执行入口是浏览器 `invokeBuiltinTool`，而真实
 * 的 Gateway 调用必须在服务端（需要拿企业身份的 X-Dev-User / Casdoor
 * Bearer token），所以这里只做一层 fetch 转发：
 *
 *   模型 function_call
 *     → client.invokeBuiltinTool('enterprise-xxx', 'execute', args)
 *     → EnterpriseExecutor.invoke
 *     → POST /api/enterprise/tool-execute { identifier, apiName, params }
 *     → (server) executeEnterpriseTool → Gateway
 *     → BuiltinToolResult 原路返
 *
 * ## 为什么 18 个 identifier 各注册一个 executor 实例
 * LobeChat 的 executorRegistry 是 Map<identifier, executor>，按 identifier
 * 精确查找。但所有 enterprise 工具的 `invoke` 逻辑相同——只是把 identifier
 * 转发出去——所以共享同一个 class，构造时传入 identifier。
 */
import { ENTERPRISE_TOOL_API_NAME, ENTERPRISE_TOOL_IDENTIFIERS } from '@/const/enterpriseTools';

import type { BuiltinToolContext, BuiltinToolResult, IBuiltinToolExecutor } from '../types';

class EnterpriseExecutor implements IBuiltinToolExecutor {
  constructor(public readonly identifier: string) {}

  hasApi(apiName: string): boolean {
    return apiName === ENTERPRISE_TOOL_API_NAME;
  }

  getApiNames(): string[] {
    return [ENTERPRISE_TOOL_API_NAME];
  }

  invoke = async (
    apiName: string,
    params: any,
    _ctx: BuiltinToolContext,
  ): Promise<BuiltinToolResult> => {
    if (!this.hasApi(apiName)) {
      return {
        error: {
          message: `Unknown API for enterprise tool: ${apiName}`,
          type: 'ApiNotFound',
        },
        success: false,
      };
    }

    try {
      const resp = await fetch('/api/enterprise/tool-execute', {
        body: JSON.stringify({
          apiName,
          identifier: this.identifier,
          params,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      // `executeEnterpriseTool` 服务端永不抛，总是返 { success, content, error? }
      // 格式，所以即便 status 不是 200（例如 401/503）也按 body.success 处理。
      const body = (await resp.json().catch(() => null)) as {
        content?: string;
        error?: unknown;
        state?: unknown;
        success?: boolean;
      } | null;
      if (!body) {
        return {
          content: `企业工具网关返回无效 JSON（HTTP ${resp.status}）`,
          error: { code: 'INVALID_RESPONSE', message: 'non-JSON response' },
          success: false,
        };
      }
      return {
        content: body.content ?? '',
        error: body.error as any,
        state: body.state as any,
        success: !!body.success,
      };
    } catch (err) {
      return {
        content: err instanceof Error ? err.message : String(err),
        error: {
          body: err,
          message: err instanceof Error ? err.message : String(err),
          type: 'NetworkError',
        },
        success: false,
      };
    }
  };
}

/** 为 18 个企业工具各实例化一个 executor */
export const enterpriseExecutors: IBuiltinToolExecutor[] = ENTERPRISE_TOOL_IDENTIFIERS.map(
  (id) => new EnterpriseExecutor(id),
);
