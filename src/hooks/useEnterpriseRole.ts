/**
 * useEnterpriseRole — 前端读当前用户的企业角色。
 *
 * 通过 tRPC 调 `enterpriseRole.getMyRole`，结果：
 *   { username, roles[], isAdmin }
 *
 * ## 为什么放 hooks/ 而不是 store/
 * 企业角色几乎不变（绑定到 Gateway 6 角色）、不需要本地可变状态、由 SWR 做
 * 缓存和刷新就够了。
 *
 * ## 缓存策略
 *   - revalidateOnFocus: false —— 切 tab 不重刷
 *   - dedupingInterval: 5 min —— 5 分钟内重复调用返回同一缓存
 * 服务端还有 5 分钟 in-memory 缓存兜底，两层 5min 已经够。
 *
 * ## 退化
 * 未登录 / Gateway 不通 / 用户未录入企业表：返回 `{ isAdmin: false, roles: [] }`
 * 调用侧始终安全：`useIsAdmin()` 为 false 就隐藏管理员项。
 */
import useSWR, { type SWRResponse } from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';

export interface EnterpriseRoleSnapshot {
  isAdmin: boolean;
  roles: string[];
  username: string | null;
}

const EMPTY: EnterpriseRoleSnapshot = { username: null, roles: [], isAdmin: false };

const FIVE_MIN_MS = 5 * 60 * 1000;

export const useEnterpriseRole = (): EnterpriseRoleSnapshot => {
  const { data } = useSWR<EnterpriseRoleSnapshot>(
    'enterprise-role/me',
    async () => {
      try {
        const r = await lambdaClient.enterpriseRole.getMyRole.query();
        return {
          isAdmin: !!r?.isAdmin,
          roles: r?.roles ?? [],
          username: r?.username ?? null,
        };
      } catch {
        return EMPTY;
      }
    },
    {
      dedupingInterval: FIVE_MIN_MS,
      revalidateOnFocus: false,
    },
  ) as SWRResponse<EnterpriseRoleSnapshot>;
  return data ?? EMPTY;
};

export const useIsAdmin = (): boolean => useEnterpriseRole().isAdmin;

export const useHasRole = (roleKey: string): boolean => useEnterpriseRole().roles.includes(roleKey);

// [enterprise-fork] `useEnterpriseVisibleTools` 已删除。老 gateway 的 17 工具
// 被 chat-gw 的 69 工具取代,展示面走 `useChatGwTools`(见
// src/features/EnterpriseAdmin/hooks/useChatGwTools.ts),过滤由 chat-gw
// 基于 Casdoor 角色在 tools/list 返回时完成,前端不再按 key 列表二次过滤。
