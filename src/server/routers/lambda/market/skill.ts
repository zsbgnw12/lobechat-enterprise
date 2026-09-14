import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { publicProcedure, router } from '@/libs/trpc/lambda';
import { SkillSorts } from '@/types/discover';

const PUBLIC_SKILL_MARKET_DISABLED =
  'Public skill market is disabled. Import from GitHub, URL, or ZIP instead.';

const disabledSkillMarket = () => {
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: PUBLIC_SKILL_MARKET_DISABLED,
  });
};

/**
 * [enterprise-fork] 公共技能市场查询全部关掉。社区 /community/skill 若仍被直链打开，
 * 这里直接 FORBIDDEN，不再代理 market.lobehub.com。
 */
export const skillRouter = router({
  getSkillCategories: publicProcedure
    .input(
      z
        .object({
          locale: z.string().optional(),
          q: z.string().optional(),
        })
        .optional(),
    )
    .query(async () => disabledSkillMarket()),

  getSkillDetail: publicProcedure
    .input(
      z.object({
        identifier: z.string(),
        locale: z.string().optional(),
        version: z.string().optional(),
      }),
    )
    .query(async () => disabledSkillMarket()),

  getSkillList: publicProcedure
    .input(
      z
        .object({
          category: z.string().optional(),
          locale: z.string().optional(),
          order: z.enum(['asc', 'desc']).optional(),
          page: z.number().optional(),
          pageSize: z.number().optional(),
          q: z.string().optional(),
          sort: z.nativeEnum(SkillSorts).optional(),
        })
        .optional(),
    )
    .query(async () => disabledSkillMarket()),
});
