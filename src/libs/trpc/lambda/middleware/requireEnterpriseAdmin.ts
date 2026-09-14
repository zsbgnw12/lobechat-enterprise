import { TRPCError } from '@trpc/server';

import { getEnterpriseRole } from '@/server/services/enterpriseRole';

import { trpc } from '../init';

/**
 * [enterprise-fork] 硬门控：只有 super_admin / permission_admin 能通过。
 *
 * 用于组织级配置类 mutation（provider / model / 技能安装）—— 普通用户只能读取
 * 管理员配好的内容，不能增删改。
 *
 * 前置条件：procedure 已链接 `authedProcedure` 与 `serverDatabase` 中间件，
 * 即 ctx 里必须有 `userId` 与 `serverDB`。
 */
export const requireEnterpriseAdmin = trpc.middleware(async (opts) => {
  const { ctx } = opts as { ctx: { serverDB?: any; userId?: string } };

  if (!ctx.userId || !ctx.serverDB) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'requireEnterpriseAdmin must be chained after authedProcedure + serverDatabase',
    });
  }

  const role = await getEnterpriseRole(ctx.serverDB, ctx.userId);
  if (!role.isAdmin) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only enterprise admins can modify organization configuration',
    });
  }

  return opts.next({ ctx: { enterpriseRole: role } });
});
