/**
 * [enterprise-fork] chat-gw 的 access_token 两条来源:
 *
 *   1. **gongdan-customer**(LobeChat 客户登录,v0.2.1 新增)
 *      - 客户在 `/api/auth/customer-login` 输 customerCode
 *      - LobeChat 后端调 gongdan `/auth/customer-login` 拿 HS256 JWT
 *      - 存进 `account` 表 providerId='gongdan-customer'
 *      - chat-gw 看 `role: "CUSTOMER"` claim,走客户分支
 *
 *   2. **casdoor**(员工 SSO,原流程)
 *      - 员工走 Casdoor OIDC,token 存 providerId='casdoor'
 *      - chat-gw 按 roles claim 过滤工具
 *
 * 优先级:**客户优先**(如果一个 userId 同时有 gongdan-customer 和 casdoor,
 * 说明是客户身份优先于 Casdoor 身份;正常不会发生)。
 *
 * 过期自动 refresh:
 *   - gongdan-customer 调 gongdan `/auth/refresh`
 *   - casdoor 调 Casdoor `/api/login/oauth/access_token` (grant_type=refresh_token)
 *
 * 两路都不通 → 抛 `GatewayAuthRequiredError`,前端提示重登。
 */
import { and, eq } from 'drizzle-orm';

import { account as accountsTable } from '@/database/schemas/betterAuth';
import type { LobeChatDatabase } from '@/database/type';
import { authEnv } from '@/envs/auth';
import { GONGDAN_PROVIDER_ID, refreshCustomerToken } from '@/server/services/gongdan/customerAuth';

export class GatewayAuthRequiredError extends Error {
  constructor(msg = '请先登录(Casdoor 员工登录 或 客户编号登录)') {
    super(msg);
    this.name = 'GatewayAuthRequiredError';
  }
}

interface TokenRecord {
  accessToken: string;
  expiresAt: Date | null;
  providerId: string;
  refreshToken: string | null;
}

/**
 * 拿当前用户发给 chat-gw 的 access_token。两条通道,客户优先。
 */
export async function getCasdoorAccessToken(db: LobeChatDatabase, userId: string): Promise<string> {
  // 1. 先查 gongdan-customer(客户场景)
  const customer = await loadAccount(db, userId, GONGDAN_PROVIDER_ID);
  if (customer && customer.accessToken) {
    return useOrRefreshCustomerToken(db, userId, customer);
  }

  // 2. 退回 Casdoor(员工场景)
  const casdoor = await loadAccount(db, userId, 'casdoor');
  if (!casdoor || !casdoor.accessToken) {
    throw new GatewayAuthRequiredError();
  }
  return useOrRefreshCasdoorToken(db, userId, casdoor);
}

async function loadAccount(
  db: LobeChatDatabase,
  userId: string,
  providerId: string,
): Promise<TokenRecord | null> {
  const rows = await db
    .select({
      accessToken: accountsTable.accessToken,
      expiresAt: accountsTable.accessTokenExpiresAt,
      providerId: accountsTable.providerId,
      refreshToken: accountsTable.refreshToken,
    })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, providerId)))
    .limit(1);
  return (rows[0] as TokenRecord | undefined) ?? null;
}

// ─── 客户 token ──────────────────────────────────────────────────

async function useOrRefreshCustomerToken(
  db: LobeChatDatabase,
  userId: string,
  row: TokenRecord,
): Promise<string> {
  // 还没到期(留 60s 冗余)→ 直接用
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000) {
    return row.accessToken;
  }
  if (!row.refreshToken) {
    throw new GatewayAuthRequiredError('客户会话已过期,请重新登录客户编号');
  }
  try {
    const refreshed = await refreshCustomerToken(row.refreshToken);
    const expiresAt = new Date(Date.now() + refreshed.expiresIn * 1000);
    await db
      .update(accountsTable)
      .set({
        accessToken: refreshed.accessToken,
        accessTokenExpiresAt: expiresAt,
        refreshToken: refreshed.refreshToken,
      })
      .where(
        and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, GONGDAN_PROVIDER_ID)),
      );
    return refreshed.accessToken;
  } catch (err) {
    console.warn('[chatGateway] gongdan refresh failed:', err);
    throw new GatewayAuthRequiredError('客户会话已过期,请重新登录客户编号');
  }
}

// ─── 员工 Casdoor token ─────────────────────────────────────────

async function useOrRefreshCasdoorToken(
  db: LobeChatDatabase,
  userId: string,
  row: TokenRecord,
): Promise<string> {
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000) {
    return row.accessToken;
  }
  if (row.refreshToken) {
    try {
      const refreshed = await refreshCasdoorToken(row.refreshToken);
      await persistRefreshedCasdoor(db, userId, refreshed);
      return refreshed.access_token;
    } catch (err) {
      console.warn('[chatGateway] casdoor refresh failed:', err);
      throw new GatewayAuthRequiredError('Casdoor token 已过期,请重新登录');
    }
  }
  throw new GatewayAuthRequiredError('Casdoor token 已过期,请重新登录');
}

interface CasdoorRefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}

async function refreshCasdoorToken(refresh: string): Promise<CasdoorRefreshResponse> {
  const issuer = authEnv.AUTH_CASDOOR_ISSUER;
  const clientId = authEnv.AUTH_CASDOOR_ID;
  const clientSecret = authEnv.AUTH_CASDOOR_SECRET;
  if (!issuer || !clientId || !clientSecret) {
    throw new Error('Casdoor env (AUTH_CASDOOR_*) not configured');
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  const resp = await fetch(`${issuer}/api/login/oauth/access_token`, {
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
  });
  if (!resp.ok) throw new Error(`casdoor refresh http ${resp.status}`);
  const json = (await resp.json()) as CasdoorRefreshResponse & { error?: string };
  if (json.error) throw new Error(`casdoor refresh error: ${json.error}`);
  return json;
}

async function persistRefreshedCasdoor(
  db: LobeChatDatabase,
  userId: string,
  refreshed: CasdoorRefreshResponse,
): Promise<void> {
  const expiresAt = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null;
  await db
    .update(accountsTable)
    .set({
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: expiresAt,
      ...(refreshed.refresh_token ? { refreshToken: refreshed.refresh_token } : {}),
    })
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, 'casdoor')));
}
