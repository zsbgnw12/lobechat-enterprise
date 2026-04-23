/**
 * [enterprise-fork] Enterprise Admin tRPC router —— 接 chat-gw §9 `/admin/*`
 *
 * 认证层:三重闸门
 *   1. `authedProcedure`  —— 必须已登录
 *   2. `serverDatabase`   —— 拿到 db 用于读 Casdoor token
 *   3. `requireEnterpriseAdmin` —— LobeChat 侧先看是不是 cloud_admin(从 Casdoor JWT
 *      roles claim 解出),避免无谓的网络调用
 *
 * chat-gw 侧仍会二次校验 `cloud_admin` 角色(非 admin 返 403),我们翻成 FORBIDDEN。
 *
 * 数据全部来自 chat-gw,无 mock、无本地数据库(老 gateway 已删)。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { requireEnterpriseAdmin, serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  AdminForbiddenError,
  AdminHttpError,
  deleteAdminTool,
  listAdminTools,
  listGrants,
  patchAdminTool,
  queryAudit,
  setGrant,
  upsertAdminTool,
} from '@/server/services/chatGateway/adminClient';
import {
  GatewayAuthRequiredError,
  getCasdoorAccessToken,
} from '@/server/services/chatGateway/tokenStore';

const adminProcedure = authedProcedure.use(serverDatabase).use(requireEnterpriseAdmin);

/** 把底层 error 映射成 tRPC error,避免把内部细节吐给前端 */
function wrapAdminError(e: unknown): never {
  if (e instanceof GatewayAuthRequiredError) {
    throw new TRPCError({ cause: e, code: 'UNAUTHORIZED', message: e.message });
  }
  if (e instanceof AdminForbiddenError) {
    throw new TRPCError({ cause: e, code: 'FORBIDDEN', message: e.message });
  }
  if (e instanceof AdminHttpError) {
    const code =
      e.status === 404
        ? 'NOT_FOUND'
        : e.status === 400 || e.status === 422
          ? 'BAD_REQUEST'
          : 'INTERNAL_SERVER_ERROR';
    throw new TRPCError({ cause: e, code, message: e.message });
  }
  throw new TRPCError({
    cause: e as Error,
    code: 'INTERNAL_SERVER_ERROR',
    message: (e as Error)?.message ?? 'chat-gw admin call failed',
  });
}

// ─── Zod input schemas ─────────────────────────────────────────────

const DispatcherEnum = z.enum(['http_adapter', 'mcp_proxy', 'daytona_sandbox']);
const AuthModeEnum = z.enum(['service_key', 'user_passthrough']);
const RoleEnum = z.enum(['cloud_admin', 'cloud_ops', 'cloud_finance', 'cloud_viewer']);
const OutcomeEnum = z.enum(['ok', 'allowed', 'denied', 'error']);

const UpsertToolInput = z.object({
  auth_header: z.string().nullable().optional(),
  auth_mode: AuthModeEnum,
  auth_prefix: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  config: z.record(z.any()),
  description: z.string().nullable().optional(),
  dispatcher: DispatcherEnum,
  display_name: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  input_schema: z.record(z.any()).nullable().optional(),
  name: z.string().min(1).max(128),
  output_schema: z.record(z.any()).nullable().optional(),
  secret_env_name: z.string().nullable().optional(),
});

const PatchToolInput = z.object({
  name: z.string().min(1),
  patch: z
    .object({
      auth_header: z.string().nullable().optional(),
      auth_mode: AuthModeEnum.optional(),
      auth_prefix: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      config: z.record(z.any()).optional(),
      description: z.string().nullable().optional(),
      dispatcher: DispatcherEnum.optional(),
      display_name: z.string().nullable().optional(),
      enabled: z.boolean().optional(),
      input_schema: z.record(z.any()).nullable().optional(),
      output_schema: z.record(z.any()).nullable().optional(),
      secret_env_name: z.string().nullable().optional(),
    })
    .refine((p) => Object.keys(p).length > 0, { message: 'patch body 不能为空' }),
});

// ─── Router ────────────────────────────────────────────────────────

export const enterpriseAdminRouter = router({
  // ─── Tools CRUD ────────────────────────────────────────────────
  listTools: adminProcedure
    .input(z.object({ includeDisabled: z.boolean().default(true) }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        return await listAdminTools(token, { includeDisabled: input?.includeDisabled ?? true });
      } catch (e) {
        wrapAdminError(e);
      }
    }),

  upsertTool: adminProcedure.input(UpsertToolInput).mutation(async ({ ctx, input }) => {
    try {
      const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
      return await upsertAdminTool(token, input);
    } catch (e) {
      wrapAdminError(e);
    }
  }),

  patchTool: adminProcedure.input(PatchToolInput).mutation(async ({ ctx, input }) => {
    try {
      const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
      return await patchAdminTool(token, input.name, input.patch);
    } catch (e) {
      wrapAdminError(e);
    }
  }),

  deleteTool: adminProcedure
    .input(z.object({ hard: z.boolean().default(false), name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        await deleteAdminTool(token, input.name, input.hard);
        return { ok: true };
      } catch (e) {
        wrapAdminError(e);
      }
    }),

  // ─── Tool-role grants ──────────────────────────────────────────
  listGrants: adminProcedure
    .input(z.object({ role: RoleEnum.optional(), toolName: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        return await listGrants(token, { role: input?.role, toolName: input?.toolName });
      } catch (e) {
        wrapAdminError(e);
      }
    }),

  setGrant: adminProcedure
    .input(z.object({ granted: z.boolean(), role: RoleEnum, toolName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        return await setGrant(token, {
          granted: input.granted,
          role: input.role,
          toolName: input.toolName,
        });
      } catch (e) {
        wrapAdminError(e);
      }
    }),

  // ─── Audit ─────────────────────────────────────────────────────
  queryAudit: adminProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          from: z.string().optional(),
          limit: z.number().int().min(1).max(500).default(50),
          outcome: OutcomeEnum.optional(),
          to: z.string().optional(),
          toolName: z.string().optional(),
          traceId: z.string().optional(),
          userId: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        return await queryAudit(token, input);
      } catch (e) {
        wrapAdminError(e);
      }
    }),

  // ─── Dashboard(由 tools + audit 聚合出来,chat-gw 无单独 endpoint) ─────
  dashboardStats: adminProcedure.query(async ({ ctx }) => {
    try {
      const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);

      // 并发拉:工具列表 + 最近 24h 审计一页
      const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const [tools, auditPage] = await Promise.all([
        listAdminTools(token, { includeDisabled: true }),
        queryAudit(token, { from, limit: 500 }),
      ]);

      const enabledCount = tools.filter((t) => t.enabled).length;
      const byCategory = new Map<string, number>();
      for (const t of tools) {
        const c = t.category ?? 'uncategorized';
        byCategory.set(c, (byCategory.get(c) ?? 0) + 1);
      }

      const items = auditPage.items;
      const total24h = items.length; // 500 上限,需要提示前端 "可能 >500"
      const deniedOrError = items.filter((a) => a.outcome === 'denied' || a.outcome === 'error');
      const denied24h = items.filter((a) => a.outcome === 'denied').length;
      const error24h = items.filter((a) => a.outcome === 'error').length;

      return {
        auditCapped: !!auditPage.next_cursor, // 若有 cursor 说明 24h 内 >500 条
        enabledToolCount: enabledCount,
        recentAudit: items.slice(0, 10),
        recentFailures: deniedOrError.slice(0, 5),
        stats24h: { denied: denied24h, error: error24h, total: total24h },
        toolCount: tools.length,
        toolsByCategory: [...byCategory.entries()]
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count),
      };
    } catch (e) {
      wrapAdminError(e);
    }
  }),
});

export type EnterpriseAdminRouter = typeof enterpriseAdminRouter;
