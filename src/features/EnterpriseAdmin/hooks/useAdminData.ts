/**
 * [enterprise-fork] EnterpriseAdmin SWR hooks —— chat-gw `/admin/*` 封装
 *
 * 所有数据都来自 chat-gw 的 §9 Admin API。heichat 这边完全不存 admin 数据。
 */
import useSWR, { mutate as globalMutate } from 'swr';

import { lambdaClient } from '@/libs/trpc/client/lambda';

export const SWR_KEYS = {
  audit: 'enterpriseAdmin/audit',
  customerGrants: 'enterpriseAdmin/customer-grants',
  dashboard: 'enterpriseAdmin/dashboard',
  grants: 'enterpriseAdmin/grants',
  tools: 'enterpriseAdmin/tools',
} as const;

export const useDashboardStats = () =>
  useSWR(SWR_KEYS.dashboard, () => lambdaClient.enterpriseAdmin.dashboardStats.query());

export const useAdminTools = (includeDisabled = true) =>
  useSWR([SWR_KEYS.tools, includeDisabled], ([, inc]) =>
    lambdaClient.enterpriseAdmin.listTools.query({ includeDisabled: inc as boolean }),
  );

export const useGrants = () =>
  useSWR(SWR_KEYS.grants, () => lambdaClient.enterpriseAdmin.listGrants.query());

export const useCustomerGrants = () =>
  useSWR(SWR_KEYS.customerGrants, () => lambdaClient.enterpriseAdmin.listCustomerGrants.query());

/** gongdan 客户名录,供下拉选择用。30s 去重。 */
export const useGongdanCustomers = () =>
  useSWR(
    'enterpriseAdmin/gongdan-customers',
    () => lambdaClient.enterpriseAdmin.listGongdanCustomers.query(),
    { dedupingInterval: 30_000 },
  );

/** Audit 有过滤参数,SWR key 根据参数派生 */
export const useAudit = (input: {
  cursor?: string;
  from?: string;
  limit?: number;
  outcome?: 'ok' | 'allowed' | 'denied' | 'error';
  to?: string;
  toolName?: string;
  userId?: string;
}) =>
  useSWR([SWR_KEYS.audit, input], ([, i]) =>
    lambdaClient.enterpriseAdmin.queryAudit.query({ limit: 50, ...(i as typeof input) }),
  );

/** 失效某个资源的 SWR 缓存 —— mutation 之后调用 */
export const invalidate = (key: keyof typeof SWR_KEYS) => {
  if (key === 'audit') {
    globalMutate((k) => Array.isArray(k) && k[0] === SWR_KEYS.audit);
    return;
  }
  if (key === 'tools') {
    globalMutate((k) => Array.isArray(k) && k[0] === SWR_KEYS.tools);
    return;
  }
  globalMutate(SWR_KEYS[key]);
};
