/**
 * [enterprise-fork] gongdan 客户认证客户端
 *
 * 仅用于"客户编号登录"场景:
 *   - `POST ${GONGDAN_API_BASE}/auth/customer-login` { customerCode }
 *     → { accessToken, refreshToken, expiresIn, user }
 *   - `POST ${GONGDAN_API_BASE}/auth/refresh` { refreshToken }
 *     → { accessToken, refreshToken, expiresIn }
 *
 * JWT 由 gongdan 用 HS256 + `GONGDAN_JWT_SECRET` 签。chat-gw 与 gongdan 共享同一个
 * secret,拿到 JWT 后看 `role: "CUSTOMER"` claim 自动走客户分支。
 *
 * 我们 LobeChat 这边完全不解 token,只透传。
 */

export class GongdanAuthError extends Error {
  status: number;
  body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(`gongdan auth ${status}: ${message}`);
    this.name = 'GongdanAuthError';
    this.status = status;
    this.body = body;
  }
}

const baseUrl = () => {
  const u = process.env.GONGDAN_API_BASE;
  if (!u) throw new Error('GONGDAN_API_BASE env 未配置(例: https://<host>.azurewebsites.net/api)');
  return u.replace(/\/+$/, '');
};

export interface CustomerLoginResponse {
  accessToken: string;
  expiresIn: number; // seconds
  refreshToken: string;
  user: {
    customerCode: string;
    id: string; // gongdan customer.id (UUID)
    name?: string;
    role: 'CUSTOMER';
    tier?: string;
  };
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

/**
 * 拿客户 JWT。成功返回 token pair,失败抛 GongdanAuthError(401 = 客户编号无效)。
 */
export async function customerLogin(customerCode: string): Promise<CustomerLoginResponse> {
  const resp = await fetch(`${baseUrl()}/auth/customer-login`, {
    body: JSON.stringify({ customerCode }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const text = await resp.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep raw text */
  }
  if (!resp.ok) {
    throw new GongdanAuthError(
      resp.status,
      parsed?.message || parsed?.error || text || resp.statusText,
      parsed,
    );
  }
  return parsed as CustomerLoginResponse;
}

/** 续 token;失败抛 GongdanAuthError。上游会 rotate refreshToken,我们按返回的覆盖。 */
export async function refreshCustomerToken(refreshToken: string): Promise<RefreshResponse> {
  const resp = await fetch(`${baseUrl()}/auth/refresh`, {
    body: JSON.stringify({ refreshToken }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const text = await resp.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  if (!resp.ok) {
    throw new GongdanAuthError(resp.status, parsed?.message || text || resp.statusText, parsed);
  }
  return parsed as RefreshResponse;
}

/**
 * 合成 Better Auth 登录密码。客户不感知密码,我们用服务端 pepper + customerCode
 * 推导出一个确定性密码。相同客户 → 相同密码 → 可反复登录同一个 LobeChat 用户。
 *
 * 安全性:pepper 不泄露,即使知道 customerCode 也无法反推密码;即使 DB 泄露
 * (Better Auth 存 bcrypt hash),没有 pepper 也无法批量暴破。
 */
export function deriveSyntheticPassword(customerCode: string): string {
  const pepper = process.env.GONGDAN_SYNTHETIC_PASSWORD_PEPPER;
  if (!pepper) {
    throw new Error(
      'GONGDAN_SYNTHETIC_PASSWORD_PEPPER env 未配置(用 openssl rand -base64 32 生成)',
    );
  }
  // 使用 Node 内置 crypto,HMAC-SHA256 足够
  // 避免 import,用标准库 subtle-compatible 方式

  const { createHmac } = require('node:crypto');
  return createHmac('sha256', pepper).update(customerCode).digest('hex');
}

export function customerEmail(customerCode: string): string {
  return `${customerCode}@customer.local`;
}

export const GONGDAN_PROVIDER_ID = 'gongdan-customer';
