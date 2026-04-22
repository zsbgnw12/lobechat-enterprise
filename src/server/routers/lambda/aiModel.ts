import { type AiProviderModelListItem } from 'model-bank';
import {
  AiModelTypeSchema,
  CreateAiModelSchema,
  ToggleAiModelEnableSchema,
  UpdateAiModelSchema,
} from 'model-bank';
import { z } from 'zod';

import { AiModelModel } from '@/database/models/aiModel';
import { UserModel } from '@/database/models/user';
import { AiInfraRepos } from '@/database/repositories/aiInfra';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { requireEnterpriseAdmin, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { getServerGlobalConfig } from '@/server/globalConfig';
import { KeyVaultsGateKeeper } from '@/server/modules/KeyVaultsEncrypt';
import { type ProviderConfig } from '@/types/user/settings';

const aiModelProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const { aiProvider } = await getServerGlobalConfig();

  // [enterprise-fork] 所有 model list 读写都走 admin vault
  const { resolveEnterpriseProviderOwnerId } = await import('@/server/services/enterpriseRole');
  const ownerId = await resolveEnterpriseProviderOwnerId(ctx.serverDB, ctx.userId);
  return opts.next({
    ctx: {
      aiInfraRepos: new AiInfraRepos(
        ctx.serverDB,
        ownerId,
        aiProvider as Record<string, ProviderConfig>,
      ),
      aiModelModel: new AiModelModel(ctx.serverDB, ownerId),
      gateKeeper,
      userModel: new UserModel(ctx.serverDB, ctx.userId),
    },
  });
});

/**
 * [enterprise-fork] 只有企业管理员才能新增/修改/删除模型列表、顺序、启用状态。
 * 普通用户只能通过 query 接口读取管理员已启用的模型。
 */
const aiModelAdminProcedure = aiModelProcedure.use(requireEnterpriseAdmin);

export const aiModelRouter = router({
  batchToggleAiModels: aiModelAdminProcedure
    .input(
      z.object({
        enabled: z.boolean(),
        id: z.string(),
        models: z.array(z.string()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.batchToggleAiModels(input.id, input.models, input.enabled);
    }),
  batchUpdateAiModels: aiModelAdminProcedure
    .input(
      z.object({
        id: z.string(),
        // TODO: Complete validation schema
        models: z.array(z.any()),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.batchUpdateAiModels(input.id, input.models);
    }),

  clearModelsByProvider: aiModelAdminProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearModelsByProvider(input.providerId);
    }),
  clearRemoteModels: aiModelAdminProcedure
    .input(z.object({ providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.clearRemoteModels(input.providerId);
    }),

  createAiModel: aiModelAdminProcedure
    .input(CreateAiModelSchema)
    .mutation(async ({ input, ctx }) => {
      const data = await ctx.aiModelModel.create(input);

      return data?.id;
    }),

  getAiModelById: aiModelProcedure
    .input(z.object({ id: z.string() }))

    .query(async ({ input, ctx }) => {
      return ctx.aiModelModel.findById(input.id);
    }),

  getAiProviderModelList: aiModelProcedure
    .input(
      z.object({
        enabled: z.boolean().optional(),
        id: z.string(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
        type: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }): Promise<AiProviderModelListItem[]> => {
      return ctx.aiInfraRepos.getAiProviderModelList(input.id, {
        enabled: input.enabled,
        limit: input.limit,
        offset: input.offset,
        type: input.type,
      });
    }),

  removeAiModel: aiModelAdminProcedure
    .input(z.object({ id: z.string(), providerId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.delete(input.id, input.providerId);
    }),

  toggleModelEnabled: aiModelAdminProcedure
    .input(ToggleAiModelEnableSchema)
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.toggleModelEnabled(input);
    }),

  updateAiModel: aiModelAdminProcedure
    .input(
      z.object({
        id: z.string(),
        providerId: z.string(),
        value: UpdateAiModelSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.update(input.id, input.providerId, input.value);
    }),

  updateAiModelOrder: aiModelAdminProcedure
    .input(
      z.object({
        providerId: z.string(),
        sortMap: z.array(
          z.object({
            id: z.string(),
            sort: z.number(),
            type: AiModelTypeSchema.optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return ctx.aiModelModel.updateModelsOrder(input.providerId, input.sortMap);
    }),
});

export type AiModelRouter = typeof aiModelRouter;
