/**
 * 企业工具前端展示清单（17 件套）
 *
 * ## 当前阶段：前端 UI mock
 * 让工具在聊天框"工具面板"里**看得见、点得着**，但**实际调用路径由后端同事在接**。
 * 用户点击 / 模型选择这些工具时，后端如果还没做桥接会返回 mock 或错误——
 * 这是预期的，先把 UI 层能闭环。
 *
 * ## 来源
 * 清单和 `gateway/prisma/seed.ts` 里的 `TOOLS` + `TOOL_INPUT_SCHEMAS`
 * 完全对齐（17 = gongdan×7 + xiaoshou×4 + cloudcost×3 + kb + ai_search + sandbox + doc）。
 *
 * ## identifier 前缀
 * 所有条目以 `enterprise.` 开头，方便后端接入时一眼识别这是走企业 Gateway
 * 的工具（而不是 LobeChat 原生内置或 MCP 外部工具）。
 *
 * ## 后端接入时怎么用
 * - 后端 BuiltinToolsExecutor 在 execute 分发时看到 identifier 以
 *   `enterprise.` 开头 → 剥掉前缀 → 转发到 Gateway `/api/lobechat/tool-gateway`
 * - Gateway 已经返回同样语义的工具（gongdan.search_tickets 等）
 * - 用户身份：从当前 LobeChat session 取 email → local-part → X-Dev-User header
 *
 * @see gateway/prisma/seed.ts
 * @see src/server/services/enterpriseRole/index.ts
 */
import type { LobeToolMeta } from '@lobechat/types';

export const ENTERPRISE_TOOL_AUTHOR = 'Enterprise AI';

const e = (
  identifier: string,
  title: string,
  description: string,
  avatar: string,
  group: string,
): LobeToolMeta => ({
  author: ENTERPRISE_TOOL_AUTHOR,
  identifier: `enterprise.${identifier}`,
  meta: {
    avatar,
    description,
    tags: ['enterprise', group],
    title,
  },
  type: 'builtin' as const,
});

export const ENTERPRISE_TOOLS: LobeToolMeta[] = [
  // ─── 工单系统（gongdan×7） ────────────────────────────────
  e('gongdan.create_ticket', '创建工单', '提交新工单（标题、描述、客户）', '🎫', '工单'),
  e('gongdan.get_own_tickets', '我的工单', '查看当前用户自己的工单列表', '📋', '工单'),
  e('gongdan.search_tickets', '搜索工单', '按状态 / 关键词 / 客户分页搜索', '🔍', '工单'),
  e('gongdan.get_ticket', '工单详情', '通过 ID 查看单个工单完整信息', '📄', '工单'),
  e('gongdan.update_ticket', '更新工单状态', '修改工单状态（open → resolved 等）', '✏️', '工单'),
  e('gongdan.assign_ticket', '分派工单', '指派工程师处理工单', '👤', '工单'),
  e('gongdan.close_ticket', '关闭工单', '客户确认工单完成', '✅', '工单'),

  // ─── 销售系统（xiaoshou×4） ──────────────────────────────
  e('xiaoshou.search_customers', '搜索客户', '分页查询客户列表', '🏢', '销售'),
  e('xiaoshou.get_customer', '客户详情', '按 ID 查单个客户（区域、消费、归属销售）', '👥', '销售'),
  e('xiaoshou.get_customer_insight', '客户洞察', '续约概率、风险等级、AI 分析', '📊', '销售'),
  e('xiaoshou.get_allocations', '客户分配', '客户归属变更日志', '🔁', '销售'),

  // ─── 云成本（cloudcost×3） ───────────────────────────────
  e('cloudcost.get_overview', '云成本概览', '按月查看服务账号总览', '☁️', '云成本'),
  e('cloudcost.get_daily_report', '日报', '按日期范围查看成本日报', '📅', '云成本'),
  e('cloudcost.get_billing_detail', '账单明细', '按供应商/项目/产品维度的计费明细', '💳', '云成本'),

  // ─── 知识与搜索（kb, ai_search） ─────────────────────────
  e('kb.search', '知识库搜索', '企业文档混合检索（向量 + BM25）', '📚', '知识'),
  e('ai_search.web', 'Web 搜索', 'Serper 搜索外网信息', '🌐', '搜索'),

  // ─── 沙盒与文档（sandbox, doc） ──────────────────────────
  e('sandbox.run', '代码沙盒', '在 Daytona 安全执行代码（Python/Shell）', '🧪', '沙盒'),
  e('doc.generate', '文档生成', '调用文档 agent 生成 Word / Markdown', '📝', '文档'),
];

export const ENTERPRISE_TOOL_IDS = new Set(ENTERPRISE_TOOLS.map((t) => t.identifier));

/**
 * 判断某 identifier 是否属于企业 Gateway 工具（用于后端分发 / 前端筛选）。
 */
export const isEnterpriseToolId = (id: string | null | undefined): boolean =>
  !!id && id.startsWith('enterprise.');
