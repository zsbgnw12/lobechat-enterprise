/**
 * tRPC router — 暴露企业角色给前端。
 *
 * [enterprise-fork] 方案 X 起,角色从 Casdoor JWT 的 roles claim 直接取
 *   (见 `src/server/services/enterpriseRole/index.ts`),老的
 *   getMyVisibleTools / enterprise_* 表相关已随老 gateway 一起废弃。
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
