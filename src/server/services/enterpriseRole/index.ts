/**
 * Enterprise Role Resolution Service
 *
 * 把 LobeChat 的 Better Auth user → Enterprise Gateway 的 6 角色之一映射起来。
 *
 * ## 映射约定
 * 用户的 LobeChat 注册邮箱 local-part（`@` 之前的部分）就是 Gateway username。
 * 例如：
 *   - `sa@enterprise.local`      → Gateway username `sa`   → super_admin
 *   - `sales1@yourco.com`        → Gateway username `sales1` → internal_sales
 *   - `random_user@gmail.com`    → Gateway username `random_user` → 找不到 → 空数组（访客）
 *
 * 这个 "邮箱约定" 是 dev 阶段的最小可行桥（P0 路线），生产环境会被 Casdoor
 * SSO 取代——SSO 直接带 `roles` claim，映射逻辑更强也更安全。
 *
 * ## 调用路径
 * 此服务通过 HTTP 调 Gateway 的 `GET /api/me` 读取 roles，而不是直连 Gateway
 * 的 Postgres 数据库。原因：
 *   - 松耦合：LobeChat 和 Gateway 通过 HTTP 通信，Gateway 可以独立演进
 *   - 身份桥雏形：这条 fetch 路径之后可以扩展为"调用工具时透传身份"
 *   - Gateway 的 JWKS/dev/M2M 三态鉴权在此路径统一处理
 *
 * ## 缓存
 * 为避免前端每次轮询都触发 fetch，本地内存缓存 5 分钟。Gateway 侧权限变更
 * 后可调用 `invalidateEnterpriseRoleCache(userId)` 定点失效。
 */
import debug from 'debug';

import { UserModel } from '@/database/models/user';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-enterprise:role');

export interface EnterpriseRoleInfo {
  /** super_admin 或 permission_admin 视为管理员 */
  isAdmin: boolean;
  /** Gateway 返回的 roleKeys，未命中时为空数组 */
  roles: string[];
  /** 该用户在 Gateway 里的 username（邮箱 local-part），或 null 表示无法解析 */
  username: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { info: EnterpriseRoleInfo; at: number }>();

const ADMIN_ROLES = new Set(['super_admin', 'permission_admin']);

function computeIsAdmin(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.has(r));
}

/**
 * 从邮箱地址推导 Gateway username。
 * 当前约定：local-part（`@` 前的部分），trim 后小写。
 * Returns null 如果邮箱为空或缺 local-part。
 */
export function deriveEnterpriseUsername(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  const local = (at === -1 ? email : email.slice(0, at)).trim().toLowerCase();
  if (!local) return null;
  return local;
}

/**
 * 读取某个 LobeChat 用户的企业角色。
 * - 首次调用：查 DB 拿 email → 推 username → 调 Gateway `/api/me` 拿 roles
 * - 二次调用：5 分钟内走缓存
 * - Gateway 不可达 / 返回 401 / 用户不在 Gateway 里：返回空 roles，isAdmin=false
 */
export async function getEnterpriseRole(
  db: LobeChatDatabase,
  lobechatUserId: string,
): Promise<EnterpriseRoleInfo> {
  if (!lobechatUserId) {
    return { username: null, roles: [], isAdmin: false };
  }

  // 1. cache hit
  const hit = cache.get(lobechatUserId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    log('cache hit for %s: roles=%o', lobechatUserId, hit.info.roles);
    // eslint-disable-next-line no-console
    console.log('[enterpriseRole] cache hit:', lobechatUserId, JSON.stringify(hit.info));
    return hit.info;
  }

  // 2. 查 LobeChat user 拿 email
  let email: string | null = null;
  try {
    const user = await UserModel.findById(db, lobechatUserId);
    email = user?.email ?? null;
  } catch (err) {
    log('findById failed for %s: %O', lobechatUserId, err);
  }

  const username = deriveEnterpriseUsername(email);
  // eslint-disable-next-line no-console
  console.log('[enterpriseRole] resolved email → username:', email, '→', username);
  if (!username) {
    const info: EnterpriseRoleInfo = { username: null, roles: [], isAdmin: false };
    cache.set(lobechatUserId, { info, at: Date.now() });
    return info;
  }

  // 3. 调 Gateway /api/me
  const gatewayUrl = process.env.GATEWAY_INTERNAL_URL || 'http://localhost:3001';
  // eslint-disable-next-line no-console
  console.log('[enterpriseRole] calling gateway:', gatewayUrl, 'X-Dev-User:', username);
  const info = await fetchGatewayRole(gatewayUrl, username);
  // eslint-disable-next-line no-console
  console.log('[enterpriseRole] gateway returned:', JSON.stringify(info));
  cache.set(lobechatUserId, { info, at: Date.now() });
  return info;
}

async function fetchGatewayRole(gatewayUrl: string, username: string): Promise<EnterpriseRoleInfo> {
  try {
    // AbortController + 2s timeout —— 不要因为 Gateway 短暂不可达阻塞前端渲染
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2000);
    const resp = await fetch(`${gatewayUrl}/api/me`, {
      headers: { 'X-Dev-User': username },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (resp.status === 401 || resp.status === 403) {
      log('gateway says user %s is unauthenticated (status %d)', username, resp.status);
      return { username, roles: [], isAdmin: false };
    }
    if (!resp.ok) {
      log('gateway /api/me returned %d for %s, treating as guest', resp.status, username);
      return { username, roles: [], isAdmin: false };
    }
    const body = (await resp.json()) as { roles?: string[] };
    const roles = Array.isArray(body.roles) ? body.roles : [];
    log('gateway resolved %s → roles=%o', username, roles);
    return { username, roles, isAdmin: computeIsAdmin(roles) };
  } catch (err) {
    // 网络失败 / 超时 / JSON 解析失败一律 fail-closed（不给管理员权限）
    log('gateway call failed for %s: %O', username, err);
    return { username, roles: [], isAdmin: false };
  }
}

/**
 * 强制让指定 user 的缓存失效（例如 admin 在 Gateway 侧改了某人的角色）。
 */
export function invalidateEnterpriseRoleCache(lobechatUserId: string): void {
  cache.delete(lobechatUserId);
}
