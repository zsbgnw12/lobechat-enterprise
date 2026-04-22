/**
 * tRPC router — 暴露企业角色 / 可见工具查询给前端。
 *
 * 接口：
 *   - getMyRole()        → `{ username, roles, isAdmin }`
 *   - getMyVisibleTools() → `string[]`（用户当前可见的 Gateway tool keys，
 *                           例如 `["kb.search", "gongdan.create_ticket"]`）
 *
 * ## 为什么 visible tools 由后端算
 * 前端如果直接信任 ENTERPRISE_TOOLS 常量会看到全部 17 个——但 Gateway 按身份
 * 返回一个子集（cust1 只有 3-6 个）。这个查询走 LobeChat 后端代理 Gateway
 * `/api/lobechat/manifest`，身份头由服务端注入，浏览器不需要了解 Gateway URL。
 *
 * ## 缓存
 * visibleTools 也在 5 min 内存缓存（和 role 一起），任何 role 变化会让缓存失效。
 */
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getEnterpriseRole, getEnterpriseVisibleToolKeys } from '@/server/services/enterpriseRole';

export const enterpriseRoleRouter = router({
  getMyRole: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    if (!ctx.userId) {
      return { username: null, roles: [] as string[], isAdmin: false };
    }
    return getEnterpriseRole(ctx.serverDB, ctx.userId);
  }),

  getMyVisibleTools: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    if (!ctx.userId) return [] as string[];
    return getEnterpriseVisibleToolKeys(ctx.serverDB, ctx.userId);
  }),
});
