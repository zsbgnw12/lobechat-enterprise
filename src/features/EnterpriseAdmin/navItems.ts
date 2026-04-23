import {
  Activity,
  BookOpen,
  Building2,
  HeartPulse,
  KeyRound,
  LayoutDashboard,
  PlayCircle,
  Wrench,
} from 'lucide-react';

import type { AdminNavItem } from './types';

/**
 * [enterprise-fork] EnterpriseAdmin 左侧子导航。
 *
 * chat-gw 重构后只剩 7 项:
 *   前 4 项是"企业管理"(走 chat-gw `/admin/*`,cloud_admin-only)
 *   后 3 项是"AI 网关"(走 chat-gw `/mcp`,登录用户都能用自己角色的视角看)
 *
 * 用户/角色/数据范围/身份映射 4 页已删 —— Casdoor 管身份,chat-gw 的
 * user_passthrough 模式把 JWT 直透下游,不需要 LobeChat 本地映射表。
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    description: '实时概览:工具总数、24h 调用、失败 TopN',
    icon: LayoutDashboard,
    key: 'dashboard',
    label: '仪表盘',
  },
  {
    description: 'chat-gw 工具注册表 CRUD(dispatcher / config / input_schema)',
    icon: Wrench,
    key: 'tools',
    label: '工具注册',
  },
  {
    description: '4 角色 × N 工具 的授权矩阵,一格一条 grant',
    icon: KeyRound,
    key: 'grants',
    label: '角色授权',
  },
  {
    description: '客户(customer_code)× 工具 的授权矩阵,LobeChat 客户场景',
    icon: Building2,
    key: 'customer-grants',
    label: '客户授权',
  },
  {
    description: '所有工具调用的不可变流水,keyset 分页',
    icon: Activity,
    key: 'audit',
    label: '审计日志',
  },
  // ─── AI 网关(任意登录用户)─────────────────
  {
    description: 'chat-gw 服务健康:postgres / redis / jwks / 工具数',
    icon: HeartPulse,
    key: 'gw-health',
    label: 'AI 网关 · 健康',
  },
  {
    description: '当前账号视角下可见的工具清单 + inputSchema',
    icon: BookOpen,
    key: 'gw-catalog',
    label: 'AI 网关 · 目录',
  },
  {
    description: '选一个工具,按 schema 填参数,实时调用看返回',
    icon: PlayCircle,
    key: 'gw-tester',
    label: 'AI 网关 · 调试',
  },
];
