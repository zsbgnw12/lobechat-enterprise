/**
 * 企业工具前端清单（17 件套）
 *
 * 同时导出两层数据：
 *   1. `ENTERPRISE_TOOLS`           — LobeToolMeta[]（前端工具面板图标列表）
 *   2. `ENTERPRISE_TOOL_MANIFESTS`  — LobeToolManifest[]（runtime function schema）
 *
 * ## Identifier 命名
 * LobeChat 生成 OpenAI function_name = `${identifier}____${apiName}`，
 * 而 OpenAI 字符集仅允许 `[a-zA-Z0-9_-]{1,64}`，**不允许点号**。所以本地
 * identifier 用短横线 `-` 分隔，例如：
 *   `enterprise-gongdan-search_tickets`
 *
 * 去前缀 + 把"第一个短横线"还原为 `.` 即得 Gateway 真实 toolKey：
 *   `enterprise-gongdan-search_tickets` → `gongdan.search_tickets`
 *   `enterprise-ai_search-web`          → `ai_search.web`
 *
 * 约束：Gateway 的工具 key 必须是 `<system>.<action>` 单点结构（17 个工具
 * 都满足），action 里的下划线保持原样不会被还原为点号。
 *
 * ## ApiName
 * 每个 manifest 的 api[] 只有一个 api：`name = 'execute'`。后端执行时用
 * `identifier` 定位 Gateway tool key，apiName 是 'execute' 的占位用于走通
 * LobeChat tool-call 协议。
 *
 * @see gateway/prisma/seed.ts TOOL_INPUT_SCHEMAS
 * @see src/server/services/enterpriseGateway/index.ts
 */
import type { LobeToolManifest } from '@lobechat/context-engine';
import type { LobeToolMeta } from '@lobechat/types';

export const ENTERPRISE_TOOL_AUTHOR = 'Enterprise AI';
export const ENTERPRISE_TOOL_API_NAME = 'execute';
export const ENTERPRISE_TOOL_PREFIX = 'enterprise-';

// ─── 静态注册表：toolKey → (display, description, avatar, group, parameters) ──
// toolKey 和 gateway 对齐（点号结构），用于 identifier 推导和后端 toolKey 还原。
interface Definition {
  avatar: string;
  description: string;
  group: string;
  parameters: Record<string, any>;
  title: string;
}

const T: Record<string, Definition> = {
  'gongdan.create_ticket': {
    avatar: '🎫',
    description: '提交新工单（标题必填，描述、客户可选）',
    group: '工单',
    parameters: {
      additionalProperties: false,
      properties: {
        customer_id: { type: 'string' },
        description: { type: 'string' },
        title: { type: 'string' },
      },
      required: ['title'],
      type: 'object',
    },
    title: '创建工单',
  },
  'gongdan.get_own_tickets': {
    avatar: '📋',
    description: '查看当前用户自己的工单列表',
    group: '工单',
    parameters: { additionalProperties: true, properties: {}, type: 'object' },
    title: '我的工单',
  },
  'gongdan.search_tickets': {
    avatar: '🔍',
    description: '按状态 / 关键词 / 客户分页搜索工单',
    group: '工单',
    parameters: {
      additionalProperties: true,
      properties: {
        customer_id: { type: 'string' },
        owner_user_id: { type: 'string' },
        page: { minimum: 1, type: 'integer' },
        page_size: { maximum: 500, minimum: 1, type: 'integer' },
        q: { type: 'string' },
        status: { type: 'string' },
      },
      type: 'object',
    },
    title: '搜索工单',
  },
  'gongdan.get_ticket': {
    avatar: '📄',
    description: '通过 ID 查看单个工单完整信息',
    group: '工单',
    parameters: {
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    title: '工单详情',
  },
  'gongdan.update_ticket': {
    avatar: '✏️',
    description: '修改工单状态（open → in_progress / resolved 等）',
    group: '工单',
    parameters: {
      additionalProperties: false,
      properties: { status: { type: 'string' }, ticketId: { type: 'string' } },
      required: ['ticketId', 'status'],
      type: 'object',
    },
    title: '更新工单状态',
  },
  'gongdan.assign_ticket': {
    avatar: '👤',
    description: '指派工程师处理工单',
    group: '工单',
    parameters: {
      additionalProperties: false,
      properties: { engineerId: { type: 'string' }, ticketId: { type: 'string' } },
      required: ['ticketId', 'engineerId'],
      type: 'object',
    },
    title: '分派工单',
  },
  'gongdan.close_ticket': {
    avatar: '✅',
    description: '客户确认工单完成',
    group: '工单',
    parameters: {
      additionalProperties: false,
      properties: { ticketId: { type: 'string' } },
      required: ['ticketId'],
      type: 'object',
    },
    title: '关闭工单',
  },

  'xiaoshou.search_customers': {
    avatar: '🏢',
    description: '分页查询客户列表',
    group: '销售',
    parameters: {
      additionalProperties: false,
      properties: {
        page: { minimum: 1, type: 'integer' },
        page_size: { maximum: 500, minimum: 1, type: 'integer' },
      },
      type: 'object',
    },
    title: '搜索客户',
  },
  'xiaoshou.get_customer': {
    avatar: '👥',
    description: '按 ID 查单个客户（区域、消费、归属销售）',
    group: '销售',
    parameters: {
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    title: '客户详情',
  },
  'xiaoshou.get_customer_insight': {
    avatar: '📊',
    description: '续约概率、风险等级、AI 分析',
    group: '销售',
    parameters: {
      additionalProperties: false,
      properties: { id: { type: 'string' } },
      required: ['id'],
      type: 'object',
    },
    title: '客户洞察',
  },
  'xiaoshou.get_allocations': {
    avatar: '🔁',
    description: '客户归属变更日志',
    group: '销售',
    parameters: { additionalProperties: true, properties: {}, type: 'object' },
    title: '客户分配',
  },

  'cloudcost.get_overview': {
    avatar: '☁️',
    description: '按月查看服务账号总览',
    group: '云成本',
    parameters: {
      additionalProperties: true,
      properties: { month: { description: 'YYYY-MM，默认当月', type: 'string' } },
      type: 'object',
    },
    title: '云成本概览',
  },
  'cloudcost.get_daily_report': {
    avatar: '📅',
    description: '按日期范围查看成本日报',
    group: '云成本',
    parameters: {
      additionalProperties: true,
      properties: {
        date: { type: 'string' },
        service_account_id: { type: 'string' },
      },
      type: 'object',
    },
    title: '云成本日报',
  },
  'cloudcost.get_billing_detail': {
    avatar: '💳',
    description: '按供应商/项目/产品维度的计费明细',
    group: '云成本',
    parameters: {
      additionalProperties: true,
      properties: {
        date_end: { description: 'YYYY-MM-DD，默认今日', type: 'string' },
        date_start: { description: 'YYYY-MM-DD，默认最近 7 天起点', type: 'string' },
        page: { minimum: 1, type: 'integer' },
        page_size: { maximum: 500, minimum: 1, type: 'integer' },
        product: { type: 'string' },
        project_id: { type: 'string' },
        provider: { description: '云厂商过滤：azure/gcp/...', type: 'string' },
      },
      type: 'object',
    },
    title: '账单明细',
  },

  'kb.search': {
    avatar: '📚',
    description: '企业文档混合检索（向量 + BM25）',
    group: '知识',
    parameters: {
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        top: { maximum: 20, minimum: 1, type: 'integer' },
      },
      required: ['query'],
      type: 'object',
    },
    title: '知识库搜索',
  },
  'ai_search.web': {
    avatar: '🌐',
    description: 'Serper 搜索外网信息',
    group: '搜索',
    parameters: {
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        top: { maximum: 10, minimum: 1, type: 'integer' },
      },
      required: ['query'],
      type: 'object',
    },
    title: 'Web 搜索',
  },
  'sandbox.run': {
    avatar: '🧪',
    description: '在 Daytona 安全沙盒执行代码（Python/Shell）',
    group: '沙盒',
    parameters: {
      additionalProperties: false,
      properties: {
        code: { type: 'string' },
        language: { description: 'python / bash / ...', type: 'string' },
      },
      required: ['code'],
      type: 'object',
    },
    title: '代码沙盒',
  },
  'doc.generate': {
    avatar: '📝',
    description: '调用文档 agent 生成 Word / Markdown',
    group: '文档',
    parameters: {
      additionalProperties: false,
      properties: {
        format: { description: 'word / markdown / ppt', type: 'string' },
        prompt: { type: 'string' },
        topic: { type: 'string' },
      },
      required: ['prompt'],
      type: 'object',
    },
    title: '文档生成',
  },
};

// ─── Identifier 编解码 ────────────────────────────────────────────────

/** toolKey (`gongdan.search_tickets`) → LobeChat identifier (`enterprise-gongdan-search_tickets`) */
export const toolKeyToIdentifier = (toolKey: string): string =>
  `${ENTERPRISE_TOOL_PREFIX}${toolKey.replace('.', '-')}`;

/** identifier → Gateway toolKey（剥前缀 + 第一个 `-` 换为 `.`） */
export const identifierToToolKey = (identifier: string): string | null => {
  if (!identifier.startsWith(ENTERPRISE_TOOL_PREFIX)) return null;
  const rest = identifier.slice(ENTERPRISE_TOOL_PREFIX.length);
  const firstDash = rest.indexOf('-');
  if (firstDash < 0) return null;
  return rest.slice(0, firstDash) + '.' + rest.slice(firstDash + 1);
};

export const isEnterpriseIdentifier = (identifier: string | null | undefined): boolean =>
  !!identifier && identifier.startsWith(ENTERPRISE_TOOL_PREFIX);

// ─── 导出：Meta + Manifest ──────────────────────────────────────────────

export const ENTERPRISE_TOOLS: LobeToolMeta[] = Object.entries(T).map(
  ([toolKey, def]): LobeToolMeta => ({
    author: ENTERPRISE_TOOL_AUTHOR,
    identifier: toolKeyToIdentifier(toolKey),
    meta: {
      avatar: def.avatar,
      description: def.description,
      tags: ['enterprise', def.group],
      title: def.title,
    },
    type: 'builtin' as const,
  }),
);

export const ENTERPRISE_TOOL_MANIFESTS: LobeToolManifest[] = Object.entries(T).map(
  ([toolKey, def]): LobeToolManifest => ({
    api: [
      {
        description: def.description,
        name: ENTERPRISE_TOOL_API_NAME,
        parameters: def.parameters,
      },
    ],
    author: ENTERPRISE_TOOL_AUTHOR,
    identifier: toolKeyToIdentifier(toolKey),
    meta: {
      avatar: def.avatar,
      description: def.description,
      tags: ['enterprise', def.group],
      title: def.title,
    },
    type: 'default',
  }),
);

/** 所有 17 个 identifier 的集合（用于注入 agent.plugins 默认启用） */
export const ENTERPRISE_TOOL_IDENTIFIERS: string[] = ENTERPRISE_TOOLS.map((t) => t.identifier);
