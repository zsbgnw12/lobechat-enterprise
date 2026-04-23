/**
 * [enterprise-fork] 供 ChatInput / ToolsEngine 使用的 chat-gw 工具列表 hook。
 *
 * 两条消费路径:
 * - 订阅式(React):`useChatGwTools()` - SWR dedup 30s,tools/list 变化自动更新 UI
 * - 同步式(非-React,例如 streamingExecutor):`getCachedChatGwTools()` - 读
 *   本模块的 last-known 快照。SWR 成功返回时会写该快照,确保 server-side
 *   ToolsEngine 构造时能拿到最新 chat-gw manifests。
 *
 * chat-gw 的 `tools/list` 响应已按 Casdoor 角色过滤过,LobeChat 这侧不再做
 * 任何额外过滤。
 */
import type { ToolManifest } from '@lobechat/types';
import useSWR from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';

export interface ChatGwToolMeta {
  category: string;
  description?: string;
  /** LobeChat builtin identifier, e.g. `chatgw-cloud_cost-dashboard_overview` */
  identifier: string;
  inputSchema: Record<string, any>;
  /** chat-gw 原始工具名,例如 `cloud_cost.dashboard_overview` */
  name: string;
}

/** chat-gw 工具名(带 `.`)→ LobeChat builtin identifier(只允许 [a-zA-Z0-9_-])*/
export function chatGwNameToIdentifier(name: string): string {
  return `chatgw-${name.replaceAll('.', '-')}`;
}

/** 反向:LobeChat identifier → chat-gw 原名(只替换第一个 `-`,因为分类段可能有下划线)*/
export function identifierToChatGwName(id: string): string | null {
  if (!id.startsWith('chatgw-')) return null;
  const body = id.slice(7);
  const dash = body.indexOf('-');
  if (dash === -1) return body;
  return body.slice(0, dash) + '.' + body.slice(dash + 1);
}

// ─── 模块级快照 ──────────────────────────────────────────────────────
// 非-React context(如 createAgentToolsEngine)需要同步读最新值。
let cachedTools: ChatGwToolMeta[] = [];

export function getCachedChatGwTools(): ChatGwToolMeta[] {
  return cachedTools;
}

/** 把 chat-gw 工具转成 LobeChat ToolManifest,每个工具只有一个 `execute` api */
export function chatGwToolsToManifests(tools: ChatGwToolMeta[]): ToolManifest[] {
  return tools.map<ToolManifest>((t) => ({
    api: [
      {
        description: t.description || t.name,
        name: 'execute',
        parameters: t.inputSchema || { properties: {}, type: 'object' },
      },
    ],
    author: 'chat-gw',
    identifier: t.identifier,
    meta: {
      avatar: '🛰️',
      description: t.description || `chat-gw tool: ${t.name}`,
      title: t.name,
    },
    type: 'default',
  }));
}

async function fetchChatGwTools(): Promise<ChatGwToolMeta[]> {
  try {
    const tools = await lambdaClient.chatGateway.listTools.query();
    const mapped = (tools || []).map<ChatGwToolMeta>((t) => ({
      category: t.name.split('.')[0] || 'other',
      description: t.description,
      identifier: chatGwNameToIdentifier(t.name),
      inputSchema: (t.inputSchema || {}) as Record<string, any>,
      name: t.name,
    }));
    cachedTools = mapped;
    return mapped;
  } catch {
    // 未登录 / 无 Casdoor token / chat-gw 挂了 → 空,不干扰原生工具面板
    return [];
  }
}

export const useChatGwTools = () =>
  useSWR<ChatGwToolMeta[]>('chatgw/tools-as-plugin-meta', fetchChatGwTools, {
    dedupingInterval: 30_000,
    revalidateOnFocus: false,
  });
