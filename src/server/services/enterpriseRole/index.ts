/**
 * Enterprise Role Resolution Service
 *
 * 把 heichat 的 Better Auth user → Enterprise Gateway 的 6 角色之一映射起来。
 *
 * ## 映射约定
 * 用户的 heichat 注册邮箱 local-part（`@` 之前的部分）就是 Gateway username。
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
 *   - 松耦合：heichat 和 Gateway 通过 HTTP 通信，Gateway 可以独立演进
 *   - 身份桥雏形：这条 fetch 路径之后可以扩展为"调用工具时透传身份"
 *   - Gateway 的 JWKS/dev/M2M 三态鉴权在此路径统一处理
 *
 * ## 缓存
 * 为避免前端每次轮询都触发 fetch，本地内存缓存 5 分钟。Gateway 侧权限变更
 * 后可调用 `invalidateEnterpriseRoleCache(userId)` 定点失效。
 */
import debug from 'debug';
import { and, eq } from 'drizzle-orm';

import { UserModel } from '@/database/models/user';
import { account as accountsTable } from '@/database/schemas/betterAuth';
import type { LobeChatDatabase } from '@/database/type';

const log = debug('lobe-enterprise:role');

export interface EnterpriseRoleInfo {
  /** 是否视为 heichat 管理员(super_admin 等价) */
  isAdmin: boolean;
  /** 角色 key 数组。方案 X 下,直接来自 Casdoor JWT 的 `roles` claim
   *  (如 cloud_admin / cloud_ops / engineer-l3 等),不再由我们 gateway 维护。*/
  roles: string[];
  /** 用户名:Casdoor SSO 用户 → JWT `name` claim;邮箱登录用户 → 邮箱 local-part */
  username: string | null;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { info: EnterpriseRoleInfo; at: number }>();

/**
 * [方案 X] Casdoor 角色 → heichat "管理员" 判定。
 * `cloud_admin` 视为 heichat super_admin 等价体(能 CRUD provider/model、
 * 进企业管理页)。其他 Casdoor 角色(engineer-l3 等) / 非 Casdoor 用户都
 * 不是 admin。legacy `super_admin` / `permission_admin`(gateway `enterprise_roles`
 * 里的)也兼容保留,给老 sa 邮箱登录的场景。
 */
const ADMIN_ROLES = new Set(['cloud_admin', 'super_admin', 'permission_admin']);

function computeIsAdmin(roles: string[]): boolean {
  return roles.some((r) => ADMIN_ROLES.has(r));
}

/**
 * 把 JWT 的 payload 段 base64url-decode 出来。不做签名校验 —— 这段
 * JWT 是 Better Auth 在 OAuth 登录时验证过签名后写进 DB 的,我们只
 * 相信 DB 里的就够了。过期也不 check,过期由 tokenStore 那边处理。
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
    const json = Buffer.from(padded.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString(
      'utf8',
    );
    return JSON.parse(json) as Record<string, any>;
  } catch {
    return null;
  }
}

/**
 * 从 Casdoor JWT payload 里提取 roles。Casdoor 有两种输出:
 *   - `roles: ["cloud_admin", ...]` (已展平)
 *   - `roles: [{ name: "cloud_admin", ... }]` (对象数组,我们登录后实测是这种)
 * 两种都兼容。
 */
function extractCasdoorRoles(payload: Record<string, any>): string[] {
  const raw = payload?.roles;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => (typeof r === 'string' ? r : r?.name))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
}

/**
 * 读取某个 heichat 用户的企业角色。
 *
 * [方案 X] 角色从 Better Auth `accounts` 表里 Casdoor access_token 的 `roles`
 * claim 解出。如果当前用户不是 Casdoor 登录(邮箱密码注册的测试账号),roles
 * 空数组,isAdmin=false。老 Fastify gateway 回退路径已废弃。
 */
export async function getEnterpriseRole(
  db: LobeChatDatabase,
  lobechatUserId: string,
): Promise<EnterpriseRoleInfo> {
  if (!lobechatUserId) {
    return { username: null, roles: [], isAdmin: false };
  }

  // 1. cache hit(5 分钟 TTL)
  const hit = cache.get(lobechatUserId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    log('cache hit for %s: roles=%o', lobechatUserId, hit.info.roles);
    return hit.info;
  }

  // 2. 从 Better Auth accounts 表读 Casdoor JWT,解 roles claim
  const casdoorInfo = await resolveRoleFromCasdoor(db, lobechatUserId);
  if (casdoorInfo) {
    log('casdoor resolved %s → roles=%o', lobechatUserId, casdoorInfo.roles);
    cache.set(lobechatUserId, { info: casdoorInfo, at: Date.now() });
    return casdoorInfo;
  }

  // 3. 非 Casdoor 登录(邮箱密码注册)→ 拿 email 做展示用 username,roles 空
  let username: string | null = null;
  try {
    const user = await UserModel.findById(db, lobechatUserId);
    const email = user?.email ?? null;
    if (email) {
      const at = email.indexOf('@');
      username = (at === -1 ? email : email.slice(0, at)).trim().toLowerCase() || null;
    }
  } catch (err) {
    log('findById failed for %s: %O', lobechatUserId, err);
  }
  const info: EnterpriseRoleInfo = { username, roles: [], isAdmin: false };
  cache.set(lobechatUserId, { info, at: Date.now() });
  return info;
}

/**
 * 从 Better Auth `accounts` 表读 Casdoor access_token,解出 roles claim。
 * 没有 Casdoor 绑定返回 null(让上层走 gateway 回退)。
 */
async function resolveRoleFromCasdoor(
  db: LobeChatDatabase,
  userId: string,
): Promise<EnterpriseRoleInfo | null> {
  try {
    const rows = await db
      .select({
        accessToken: accountsTable.accessToken,
        idToken: accountsTable.idToken,
      })
      .from(accountsTable)
      .where(and(eq(accountsTable.userId, userId), eq(accountsTable.providerId, 'casdoor')))
      .limit(1);
    const row = rows[0];
    if (!row) return null;

    // 优先 access_token,不行用 id_token
    const token = row.accessToken ?? row.idToken;
    if (!token) return null;

    const payload = decodeJwtPayload(token);
    if (!payload) return null;

    const roles = extractCasdoorRoles(payload);
    const username =
      (typeof payload.name === 'string' && payload.name) ||
      (typeof payload.preferred_username === 'string' && payload.preferred_username) ||
      null;
    return {
      isAdmin: computeIsAdmin(roles),
      roles,
      username,
    };
  } catch (err) {
    log('resolveRoleFromCasdoor failed for %s: %O', userId, err);
    return null;
  }
}

/**
 * 强制让指定 user 的缓存失效(例如管理员外部变更该用户在 Casdoor 里的角色)。
 */
export function invalidateEnterpriseRoleCache(lobechatUserId: string): void {
  cache.delete(lobechatUserId);
}

// ─── Enterprise provider owner (管理员 userId) ─────────────────────────
// 所有"provider/model 配置" 的查询都走 sa 的 vault —— 管理员在 UI 里配了
// 什么，所有用户共享。见 aiProvider router / aiModel router / ModelRuntime。
//
// 管理员邮箱通过 env `ENTERPRISE_ADMIN_EMAIL` 指定，默认 `sa@enterprise.local`。
// 查不到管理员时退回 fallbackUserId（通常是当前调用者）。

const adminIdCache: { at: number; id: string | null } = { at: 0, id: null };
const ADMIN_ID_TTL_MS = 60 * 1000;

export async function resolveEnterpriseProviderOwnerId(
  db: LobeChatDatabase,
  fallbackUserId: string,
): Promise<string> {
  const now = Date.now();
  if (adminIdCache.id && now - adminIdCache.at < ADMIN_ID_TTL_MS) {
    return adminIdCache.id;
  }
  const adminEmail = process.env.ENTERPRISE_ADMIN_EMAIL || 'sa@enterprise.local';
  try {
    const user = await UserModel.findByEmail(db, adminEmail);
    if (user?.id) {
      adminIdCache.id = user.id;
      adminIdCache.at = now;
      return user.id;
    }
  } catch (err) {
    log('resolveEnterpriseProviderOwnerId failed: %O', err);
  }
  return fallbackUserId;
}
