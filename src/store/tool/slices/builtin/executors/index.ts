/**
 * Builtin Tool Executor Registry
 *
 * Central registry for all builtin tool executors.
 * Executors are registered as class instances by identifier.
 */
import { agentBuilderExecutor } from '@lobechat/builtin-tool-agent-builder/executor';
import { agentManagementExecutor } from '@lobechat/builtin-tool-agent-management/executor';
import { calculatorExecutor } from '@lobechat/builtin-tool-calculator/executor';
import { cloudSandboxExecutor } from '@lobechat/builtin-tool-cloud-sandbox/executor';
import { credsExecutor } from '@lobechat/builtin-tool-creds/executor';
import { cronExecutor } from '@lobechat/builtin-tool-cron/executor';
import { groupAgentBuilderExecutor } from '@lobechat/builtin-tool-group-agent-builder/executor';
import { groupManagementExecutor } from '@lobechat/builtin-tool-group-management/executor';
import { gtdExecutor } from '@lobechat/builtin-tool-gtd/executor';
import { knowledgeBaseExecutor } from '@lobechat/builtin-tool-knowledge-base/executor';
import { localSystemExecutor } from '@lobechat/builtin-tool-local-system/executor';
import { memoryExecutor } from '@lobechat/builtin-tool-memory/executor';

import type { BuiltinToolContext, BuiltinToolResult, IBuiltinToolExecutor } from '../types';
import { activatorExecutor } from './lobe-activator';
import { agentDocumentsExecutor } from './lobe-agent-documents';
import { messageExecutor } from './lobe-message';
import { notebookExecutor } from './lobe-notebook';
import { pageAgentExecutor } from './lobe-page-agent';
import { skillStoreExecutor } from './lobe-skill-store';
import { skillsExecutor } from './lobe-skills';
import { topicReferenceExecutor } from './lobe-topic-reference';
import { userInteractionExecutor } from './lobe-user-interaction';
import { webBrowsing } from './lobe-web-browsing';
import { webOnboardingExecutor } from './lobe-web-onboarding';

// ==================== Import and register all executors ====================

/**
 * Registry structure: Map<identifier, executor instance>
 */
const executorRegistry = new Map<string, IBuiltinToolExecutor>();

/**
 * Get a builtin tool executor by identifier
 *
 * @param identifier - The tool identifier
 * @returns The executor instance or undefined if not found
 */
export const getExecutor = (identifier: string): IBuiltinToolExecutor | undefined => {
  return executorRegistry.get(identifier);
};

/**
 * Check if an executor exists for the given identifier and apiName
 *
 * @param identifier - The tool identifier
 * @param apiName - The API name
 * @returns Whether the executor exists and supports the API
 */
export const hasExecutor = (identifier: string, apiName: string): boolean => {
  // [enterprise-fork] chat-gw 工具不在本地 registry,但由 invokeExecutor 代理到
  // 服务端 tRPC chatGateway.callTool 执行。必须声明 hasExecutor=true 才能走到
  // pluginTypes.ts 的 tool store 分支(line 58),否则会 fall through 到
  // "No executor found" 返回空内容。
  if (identifier.startsWith('chatgw-')) return true;

  const executor = executorRegistry.get(identifier);
  return executor?.hasApi(apiName) ?? false;
};

/**
 * Get all registered identifiers
 *
 * @returns Array of registered identifiers
 */
export const getRegisteredIdentifiers = (): string[] => {
  return Array.from(executorRegistry.keys());
};

/**
 * Get all API names for a given identifier
 *
 * @param identifier - The tool identifier
 * @returns Array of API names or empty array if identifier not found
 */
export const getApiNamesForIdentifier = (identifier: string): string[] => {
  const executor = executorRegistry.get(identifier);
  return executor?.getApiNames() ?? [];
};

/**
 * Invoke a builtin tool executor
 *
 * @param identifier - The tool identifier
 * @param apiName - The API name
 * @param params - The parameters
 * @param ctx - The execution context
 * @returns The execution result
 */
export const invokeExecutor = async (
  identifier: string,
  apiName: string,
  params: any,
  ctx: BuiltinToolContext,
): Promise<BuiltinToolResult> => {
  // [enterprise-fork] chat-gw 工具(识别前缀 `chatgw-`)在客户端注册表里
  // 不注册单独 executor ——统一代理到服务端 tRPC chatGateway.callTool。
  // 服务端再调 chat-gw MCP 拿到结果,返回后这里把结果包成 BuiltinToolResult。
  if (identifier.startsWith('chatgw-')) {
    const toolName = chatGwIdentifierToName(identifier);
    try {
      const { lambdaClient } = await import('@/libs/trpc/client/lambda');
      const resp = await lambdaClient.chatGateway.callTool.mutate({
        arguments: params ?? {},
        name: toolName,
      });
      // resp.content: Array<{ type: 'text'; text?: string }>
      const text =
        resp?.content?.find((c: any) => c.type === 'text')?.text ??
        JSON.stringify(resp?.content ?? resp, null, 2);
      if (resp?.isError) {
        return {
          content: text,
          error: { message: 'chat-gw tool returned isError', type: 'ToolIsError' },
          success: false,
        };
      }
      return { content: text, success: true };
    } catch (e) {
      return {
        error: {
          message: e instanceof Error ? e.message : String(e),
          type: 'ChatGwInvokeError',
        },
        success: false,
      };
    }
  }

  const executor = executorRegistry.get(identifier);

  if (!executor) {
    return {
      error: {
        message: `Executor not found: ${identifier}`,
        type: 'ExecutorNotFound',
      },
      success: false,
    };
  }

  if (!executor.hasApi(apiName)) {
    return {
      error: {
        message: `API not found: ${identifier}/${apiName}`,
        type: 'ApiNotFound',
      },
      success: false,
    };
  }

  return executor.invoke(apiName, params, ctx);
};

/** `chatgw-cloud_cost-dashboard_overview` → `cloud_cost.dashboard_overview` */
function chatGwIdentifierToName(id: string): string {
  const body = id.slice(7);
  const dash = body.indexOf('-');
  if (dash === -1) return body;
  return body.slice(0, dash) + '.' + body.slice(dash + 1);
}

/**
 * Register builtin tool executor instances
 *
 * @param executors - Array of executor instances to register
 */
const registerExecutors = (executors: IBuiltinToolExecutor[]): void => {
  for (const executor of executors) {
    executorRegistry.set(executor.identifier, executor);
  }
};

// Register all executor instances
registerExecutors([
  agentBuilderExecutor,
  agentDocumentsExecutor,
  agentManagementExecutor,
  calculatorExecutor,
  cloudSandboxExecutor,
  credsExecutor,
  cronExecutor,
  groupAgentBuilderExecutor,
  groupManagementExecutor,
  gtdExecutor,
  knowledgeBaseExecutor,
  localSystemExecutor,
  memoryExecutor,
  messageExecutor,
  notebookExecutor,
  pageAgentExecutor,
  skillStoreExecutor,
  skillsExecutor,
  activatorExecutor,
  topicReferenceExecutor,
  userInteractionExecutor,
  webOnboardingExecutor,
  webBrowsing,
]);
