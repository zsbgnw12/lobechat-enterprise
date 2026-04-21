/**
 * tRPC router — 暴露企业角色查询给前端。
 *
 * 只读接口（目前）：
 *   - getMyRole()  : 返回 `{ username, roles, isAdmin }`
 *
 * 之后可能扩展：
 *   - listTools(): 返回 LobeChat 侧能用的企业工具列表
 *   - invalidateMyRole(): 强制刷新本人缓存
 */
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getEnterpriseRole } from '@/server/services/enterpriseRole';

export const enterpriseRoleRouter = router({
  getMyRole: authedProcedure.use(serverDatabase).query(async ({ ctx }) => {
    if (!ctx.userId) {
      return { username: null, roles: [] as string[], isAdmin: false };
    }
    return getEnterpriseRole(ctx.serverDB, ctx.userId);
  }),
});
