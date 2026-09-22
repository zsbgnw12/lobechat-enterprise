import type { SkillManifest } from '@lobechat/types';
import { skillManifestSchema } from '@lobechat/types';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { AgentSkillModel } from '@/database/models/agentSkill';
import { FileModel } from '@/database/models/file';
import { authedProcedure, router } from '@/libs/trpc/lambda';
import { requireEnterpriseAdmin, serverDatabase } from '@/libs/trpc/lambda/middleware';
import { resolveEnterpriseSkillOwnerId } from '@/server/services/enterpriseRole';
import { FileService } from '@/server/services/file';
import {
  SkillImporter,
  SkillImportError,
  SkillManifestError,
  SkillParseError,
  SkillResourceError,
  SkillResourceService,
} from '@/server/services/skill';
import { SkillHubClient } from '@/server/services/skillHub/client';

const PUBLIC_SKILL_MARKET_DISABLED =
  'Public skill market is disabled. Import from GitHub, URL, or ZIP instead.';

// ===== Error Handling =====

const skillImportErrorToTRPCCode = (
  code: SkillImportError['code'],
): 'CONFLICT' | 'BAD_REQUEST' | 'NOT_FOUND' | 'BAD_GATEWAY' => {
  switch (code) {
    case 'CONFLICT': {
      return 'CONFLICT';
    }

    case 'NOT_FOUND':
    case 'FILE_NOT_FOUND': {
      return 'NOT_FOUND';
    }

    case 'DOWNLOAD_FAILED': {
      return 'BAD_GATEWAY';
    }

    default: {
      return 'BAD_REQUEST';
    }
  }
};

const handleSkillImportError = (error: unknown): never => {
  if (error instanceof SkillImportError) {
    throw new TRPCError({
      code: skillImportErrorToTRPCCode(error.code),
      message: error.message,
    });
  }
  if (error instanceof SkillManifestError || error instanceof SkillParseError) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error.message,
    });
  }
  throw error;
};

// ===== Procedure with Context =====

const skillProcedure = authedProcedure.use(serverDatabase).use(async (opts) => {
  const { ctx } = opts;

  // [enterprise-fork] 技能目录挂在管理员 vault 上，全员读同一份
  const ownerId = await resolveEnterpriseSkillOwnerId(ctx.serverDB, ctx.userId);

  return opts.next({
    ctx: {
      fileModel: new FileModel(ctx.serverDB, ownerId),
      fileService: new FileService(ctx.serverDB, ownerId),
      skillImporter: new SkillImporter(ctx.serverDB, ownerId),
      skillModel: new AgentSkillModel(ctx.serverDB, ownerId),
      skillResourceService: new SkillResourceService(ctx.serverDB, ownerId),
    },
  });
});

/** [enterprise-fork] 安装 / 删除 / 改技能仅 cloud_admin */
const skillAdminProcedure = skillProcedure.use(requireEnterpriseAdmin);

// ===== Input Schemas =====

const createSkillSchema = z.object({
  content: z.string(),
  description: z.string().min(1),
  identifier: z.string().optional(),
  name: z.string().min(1),
});

const updateSkillSchema = z.object({
  content: z.string().optional(),
  id: z.string(),
  // All metadata should be passed through manifest
  manifest: skillManifestSchema.partial().optional(),
});

// ===== Router =====

export const agentSkillsRouter = router({
  // ===== Create =====

  create: skillAdminProcedure.input(createSkillSchema).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.skillImporter.createUserSkill(input);
    } catch (error) {
      handleSkillImportError(error);
    }
  }),

  // ===== Delete =====

  delete: skillAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return ctx.skillModel.delete(input.id);
    }),

  // ===== Query =====

  getById: skillProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findById(input.id);
  }),

  getByIdWithZipUrl: skillProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.zipFileHash) {
        return { name: skill.name, url: null };
      }

      const fileInfo = await ctx.fileModel.checkHash(skill.zipFileHash);
      if (!fileInfo.isExist || !fileInfo.url) {
        return { name: skill.name, url: null };
      }

      const fullUrl = await ctx.fileService.getFullFileUrl(fileInfo.url);
      return { name: skill.name, url: fullUrl || null };
    }),

  getByIdentifier: skillProcedure
    .input(z.object({ identifier: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.skillModel.findByIdentifier(input.identifier);
    }),

  getByName: skillProcedure.input(z.object({ name: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.findByName(input.name);
  }),

  importFromGitHub: skillAdminProcedure
    .input(
      z.object({
        branch: z.string().optional(),
        gitUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromGitHub(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importGitHubSkills: skillAdminProcedure
    .input(
      z.object({
        branch: z.string().optional(),
        gitUrl: z.string().url(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const results = await ctx.skillImporter.importGitHubSkills(input);
        return { results };
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromSkillHub: skillAdminProcedure
    .input(
      z.object({
        slug: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z0-9][\w.-]{0,127}$/i),
        version: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromSkillHub(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importSkillHubSkills: skillAdminProcedure
    .input(
      z.object({
        slug: z
          .string()
          .min(1)
          .max(128)
          .regex(/^[A-Z0-9][\w.-]{0,127}$/i),
        version: z.string().max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const results = await ctx.skillImporter.importSkillHubSkills(input);
        return { results };
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  searchSkillHub: skillAdminProcedure
    .input(z.object({ query: z.string().max(200).optional() }))
    .query(async ({ input }) => {
      const client = new SkillHubClient();
      if (!client.configured) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'SkillHub is not configured. Set SKILLHUB_URL on the server.',
        });
      }
      try {
        const query = input.query?.trim();
        const data = query ? await client.search(query) : await client.list();
        return { data };
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_GATEWAY',
          message: (error as Error).message,
        });
      }
    }),

  refreshFromSource: skillAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.refreshFromSource(input.id);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromUrl: skillAdminProcedure
    .input(z.object({ url: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromUrl(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromZip: skillAdminProcedure
    .input(z.object({ zipFileId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.skillImporter.importFromZip(input);
      } catch (error) {
        handleSkillImportError(error);
      }
    }),

  importFromMarket: skillAdminProcedure
    .input(z.object({ identifier: z.string() }))
    .mutation(async () => {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: PUBLIC_SKILL_MARKET_DISABLED,
      });
    }),

  list: skillProcedure
    .input(
      z
        .object({
          source: z.enum(['builtin', 'market', 'user']).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.source) {
        return ctx.skillModel.listBySource(input.source);
      }

      return ctx.skillModel.findAll();
    }),

  listResources: skillProcedure
    .input(z.object({ id: z.string(), includeContent: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources) {
        return [];
      }

      return ctx.skillResourceService.listResources(skill.resources, input.includeContent);
    }),

  readResource: skillProcedure
    .input(
      z.object({
        id: z.string(),
        path: z.string(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const skill = await ctx.skillModel.findById(input.id);
      if (!skill) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Skill not found' });
      }

      if (!skill.resources || Object.keys(skill.resources).length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Skill has no resources' });
      }

      try {
        return await ctx.skillResourceService.readResource(skill.resources, input.path);
      } catch (error) {
        if (error instanceof SkillResourceError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: error.message });
        }

        throw error;
      }
    }),

  search: skillProcedure.input(z.object({ query: z.string() })).query(async ({ ctx, input }) => {
    return ctx.skillModel.search(input.query);
  }),

  // ===== Update =====

  update: skillAdminProcedure.input(updateSkillSchema).mutation(async ({ ctx, input }) => {
    const { id, content, manifest } = input;
    return ctx.skillModel.update(id, {
      content,
      // Sync name/description from manifest to top-level fields
      description: manifest?.description,
      manifest: manifest as SkillManifest | undefined,
      name: manifest?.name,
    });
  }),
});

export type AgentSkillsRouter = typeof agentSkillsRouter;
