/**
 * [enterprise-fork] chat-gw MCP 相关的 SWR hooks —— 和 useAdminData 并列,
 * 但走独立 tRPC router(chatGateway),独立缓存 key。
 */
import useSWR, { mutate as globalMutate } from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';

export const GW_SWR_KEYS = {
  connection: 'chatGateway/connection',
  initialize: 'chatGateway/initialize',
  readyz: 'chatGateway/readyz',
  tools: 'chatGateway/tools',
} as const;

/** 是否已绑定 Casdoor 账号。未绑 → 前端提示"去登录"。*/
export const useGatewayConnection = () =>
  useSWR(GW_SWR_KEYS.connection, () => lambdaClient.chatGateway.connectionStatus.query(), {
    // 该状态变化不频繁,减少噪音
    dedupingInterval: 30_000,
  });

/** readyz(4 灯 + tool 数),每 10 秒轮询 */
export const useGatewayReadyz = () =>
  useSWR(GW_SWR_KEYS.readyz, () => lambdaClient.chatGateway.readyz.query(), {
    refreshInterval: 10_000,
  });

/** initialize —— 服务器版本、协议版本,较静态 */
export const useGatewayInitialize = () =>
  useSWR(GW_SWR_KEYS.initialize, () => lambdaClient.chatGateway.initialize.query(), {
    dedupingInterval: 60_000,
  });

/** tools/list —— 当前用户可见工具 */
export const useGatewayTools = () =>
  useSWR(GW_SWR_KEYS.tools, () => lambdaClient.chatGateway.listTools.query(), {
    dedupingInterval: 30_000,
  });

export const invalidateGateway = (key: keyof typeof GW_SWR_KEYS) => globalMutate(GW_SWR_KEYS[key]);
