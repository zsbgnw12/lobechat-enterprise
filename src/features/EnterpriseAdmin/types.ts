/**
 * [enterprise-fork] 前端 EnterpriseAdmin 内部类型
 *
 * 实体类型从后端 tRPC 返回推导;这里只放纯前端的 UI 类型(Page key、路由映射等)。
 *
 * 页面收敛到 7 项(chat-gw 重构后):
 *   dashboard / tools / grants / audit / gw-health / gw-catalog / gw-tester
 *
 * 已删除:users / scopes / identity —— 这三项都是老 Fastify gateway 的本地
 * 数据库概念。现在用户/角色由 Casdoor 管、数据范围由 chat-gw
 * user_passthrough(JWT 直透)管,没有 "heichat 侧的映射表" 这层存在。
 */
import type { LucideIcon } from 'lucide-react';

export type AdminPageKey =
  | 'dashboard'
  | 'tools'
  | 'grants'
  | 'customer-grants'
  | 'audit'
  | 'gw-health'
  | 'gw-catalog'
  | 'gw-tester';

export interface AdminNavItem {
  description: string;
  icon: LucideIcon;
  key: AdminPageKey;
  label: string;
}
