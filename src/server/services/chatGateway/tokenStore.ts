/**
 * [enterprise-fork] chat-gw 的 access_token 取自 Better Auth 在 Casdoor 登录时
 * 存进 `accounts` 表的那条 OAuth 记录。tRPC procedure 运行时拿 LobeChat userId,
 * 查 accounts where providerId='casdoor' → 拿到 Casdoor 签发的 RS256 JWT,转发给
 * chat-gw。
 *
 * 临过期时(< 60s)自动用 refresh_token 换新,并写回 DB。
 * 读不到 token / refresh 失败 → 抛 `GatewayAuthRequiredError`,前端可引导用户
 * 去 Casdoor 重新登录。
 */
import { and, eq } from 'drizzle-orm';

import { account as accountsTable } from '@/database/schemas/betterAuth';
import type { LobeChatDatabase } from '@/database/type';
import { authEnv } from '@/envs/auth';

export class GatewayAuthRequiredError extends Error {
  constructor(msg = '请先用 Casdoor 账号登录(Settings → 账号 → 连接 Casdoor)') {
    super(msg);
    this.name = 'GatewayAuthRequiredError';
  }
}

export interface CasdoorTokenRecord {
  accessToken: string;
  expiresAt: Date | null;
  refreshToken: string | null;
}

/**
 * 拿当前 LobeChat 用户对应的 Casdoor access_token,过期自动 refresh。
 * 没绑 Casdoor → 抛 GatewayAuthRequiredError。
 */
export async function getCasdoorAccessToken(db: LobeChatDatabase, userId: string): Promise<string> {
  const row = await loadAccount(db, userId);
  if (!row || !row.accessToken) {
    throw new GatewayAuthRequiredError();
  }

  // 还没到期(留 60s 冗余)→ 直接用
  if (row.expiresAt && row.expiresAt.getTime() - Date.now() > 60_000) {
    return row.accessToken;
  }

  // 过期 or 即将过期 → 试着 refresh
  if (row.refreshToken) {
    try {
      const refreshed = await refreshToken(row.refreshToken);
      await persistRefreshed(db, userId, refreshed);
      return refreshed.access_token;
    } catch (err) {
      console.warn('[chatGateway] casdoor refresh failed:', err);
      throw new GatewayAuthRequiredError('Casdoor token 已过期,请重新登录');
    }
  }

  // 没有 refresh token 且老 token 到期 → 直接要求重登
  throw new GatewayAuthRequiredError('Casdoor token 已过期,请重新登录');
}

async function loadAccount(
  db: LobeChatDatabase,
  userId: string,
): Promise<CasdoorTokenRecord | null> {
  const rows = await db
    .select({
      accessToken: accountsTable.accessToken,
      expiresAt: accountsTable.accessTokenExpiresAt,
      refreshToken: accountsTable.refreshToken,
    })
    .from(accountsTable)
    .where(and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, 'casdoor')))
    .limit(1);
  return (rows[0] as CasdoorTokenRecord | undefined) ?? null;
}

interface RefreshResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
}

async function refreshToken(refresh: string): Promise<RefreshResponse> {
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
  const json = (await resp.json()) as RefreshResponse & { error?: string };
  if (json.error) throw new Error(`casdoor refresh error: ${json.error}`);
  return json;
}

async function persistRefreshed(
  db: LobeChatDatabase,
  userId: string,
  refreshed: RefreshResponse,
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
