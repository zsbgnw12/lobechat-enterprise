/**
 * [enterprise-fork] chat-gw MCP 代理 tRPC router
 *
 * 服务端拿当前用户的 Casdoor access_token(Better Auth 登录时 Casdoor SSO 存在
 * `accounts` 表里),转发给 chat-gw。浏览器永远看不到 token 也不知道 chat-gw URL。
 *
 * **权限模型(A2 方案)**:chat-gw 这 5 个 procedure **不** 叠加
 * `requireEnterpriseAdmin`——授权完全交给 chat-gw 侧的 Casdoor 角色
 * (cloud_admin/ops/finance/viewer)。heichat 这边只管"调用者得登录 +
 * 有 Casdoor access_token",能不能看/调某工具由 chat-gw 过滤 tools/list
 * 和 tools/call 的 -32001 no_role 错误决定。
 *
 * heichat 自己的企业管理(Users/Roles/Scopes/IdentityMap/Audit 6 页)仍然
 * 走 requireEnterpriseAdmin,两套权限互不相欠。
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { authedProcedure, router } from '@/libs/trpc/lambda';
import { serverDatabase } from '@/libs/trpc/lambda/middleware';
import {
  callTool,
  fetchReadyz,
  initialize,
  listTools,
  McpCallError,
} from '@/server/services/chatGateway/mcpClient';
import {
  GatewayAuthRequiredError,
  getCasdoorAccessToken,
} from '@/server/services/chatGateway/tokenStore';

// [A2] 只要登录 + DB,不做 heichat 层的 admin 门控
const gwProcedure = authedProcedure.use(serverDatabase);

const wrapMcpError = (e: unknown): never => {
  if (e instanceof GatewayAuthRequiredError) {
    throw new TRPCError({ cause: e, code: 'UNAUTHORIZED', message: e.message });
  }
  if (e instanceof McpCallError) {
    throw new TRPCError({
      cause: e,
      code: e.code === -32602 ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
      message: `${e.message}${e.data?.kind ? ` (${e.data.kind})` : ''}`,
    });
  }
  throw new TRPCError({
    cause: e as Error,
    code: 'INTERNAL_SERVER_ERROR',
    message: (e as Error)?.message ?? 'chat-gw call failed',
  });
};

export const chatGatewayRouter = router({
  /** 拉 chat-gw readyz(匿名,不需要 token) */
  readyz: gwProcedure.query(async () => {
    try {
      return await fetchReadyz();
    } catch (e) {
      return wrapMcpError(e);
    }
  }),

  /** MCP initialize —— 服务器版本 / 协议 / capabilities */
  initialize: gwProcedure.query(async ({ ctx }) => {
    try {
      const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
      return await initialize(token);
    } catch (e) {
      return wrapMcpError(e);
    }
  }),

  /** MCP tools/list —— 当前用户可见工具 */
  listTools: gwProcedure.query(async ({ ctx }) => {
    try {
      const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
      return await listTools(token);
    } catch (e) {
      return wrapMcpError(e);
    }
  }),

  /** MCP tools/call —— 调一个工具 */
  callTool: gwProcedure
    .input(
      z.object({
        arguments: z.record(z.any()).default({}),
        name: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const token = await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
        return await callTool(token, input.name, input.arguments);
      } catch (e) {
        return wrapMcpError(e);
      }
    }),

  /** 检查当前登录用户是否已连接 Casdoor(前端决定是否显示"去登录"CTA) */
  connectionStatus: gwProcedure.query(async ({ ctx }) => {
    try {
      await getCasdoorAccessToken(ctx.serverDB, ctx.userId);
      return { connected: true as const };
    } catch (e) {
      if (e instanceof GatewayAuthRequiredError) {
        return { connected: false as const, reason: e.message };
      }
      throw e;
    }
  }),
});

export type ChatGatewayRouter = typeof chatGatewayRouter;
