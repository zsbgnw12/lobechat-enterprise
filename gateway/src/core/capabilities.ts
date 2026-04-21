import { prisma } from '../db';
import { AuthContext } from '../auth/devAuth';
import { cache } from './cache';
import { cacheHits, cacheMisses } from './metrics';

export interface AllowedTool {
  id: string;
  key: string;
  category: string;
  displayName: string;
  description: string | null;
  inputSchema: any;
}

export const CAP_CACHE_PREFIX = 'cap:v1:';
const CAP_TTL_SEC = 60;

/**
 * 定点失效某个用户的能力缓存。
 * 权限变更只影响具体 user 时首选此函数，避免一次性清空全部用户缓存。
 */
export async function invalidateUserCapabilityCache(userId: string): Promise<void> {
  if (!userId) return;
  await cache.del(`${CAP_CACHE_PREFIX}${userId}`);
}

/**
 * 定点失效：某个角色下所有绑定用户的能力缓存。
 * 用于角色级工具授权变更（tool-permission subjectType='role'）。
 * 注意：这里仍是"批量失效一组 userId"，不是全量 prefix-scan；
 * 如果该角色绑定用户数量很大，可再改成异步作业。
 */
export async function invalidateRoleCapabilityCache(roleId: string): Promise<void> {
  if (!roleId) return;
  const links = await prisma.enterpriseUserRole.findMany({
    where: { roleId },
    select: { userId: true },
  });
  await Promise.all(links.map((l) => cache.del(`${CAP_CACHE_PREFIX}${l.userId}`)));
}

/**
 * 全量失效兜底。仅用于：
 *  - 种子/迁移后强制刷新
 *  - 不确定影响面的管理操作
 * 业务代码应优先使用上面两个定点失效函数。
 */
export async function invalidateAllCapabilityCache(): Promise<void> {
  await cache.invalidate(CAP_CACHE_PREFIX);
}

export async function resolveAllowedTools(auth: AuthContext): Promise<AllowedTool[]> {
  const cacheKey = `${CAP_CACHE_PREFIX}${auth.userId}`;
  const cached = await cache.getJSON<AllowedTool[]>(cacheKey);
  if (cached) {
    try { cacheHits.inc({ cache: 'cap' }); } catch {}
    return cached;
  }
  try { cacheMisses.inc({ cache: 'cap' }); } catch {}
  const resolved = await resolveAllowedToolsUncached(auth);
  await cache.setJSON(cacheKey, resolved, CAP_TTL_SEC);
  return resolved;
}

async function resolveAllowedToolsUncached(auth: AuthContext): Promise<AllowedTool[]> {
  const roles = await prisma.enterpriseRole.findMany({ where: { key: { in: auth.roleKeys } } });
  const roleIds = roles.map((r) => r.id);

  const [tools, rolePerms, userPerms] = await Promise.all([
    prisma.enterpriseToolRegistry.findMany({ where: { isEnabled: true } }),
    roleIds.length
      ? prisma.enterpriseToolPermission.findMany({
          where: { subjectType: 'role', subjectId: { in: roleIds } },
        })
      : Promise.resolve([]),
    prisma.enterpriseToolPermission.findMany({
      where: { subjectType: 'user', subjectId: auth.userId },
    }),
  ]);

  // Two-pass, deny-wins semantics (deterministic regardless of row order):
  //   pass 1: collect all allows from role ∪ user grants.
  //   pass 2: subtract any explicit denies from role ∪ user grants.
  const allows = new Set<string>();
  const denies = new Set<string>();
  for (const p of [...rolePerms, ...userPerms]) {
    if (p.allow) allows.add(p.toolId);
    else denies.add(p.toolId);
  }

  const out: AllowedTool[] = [];
  for (const t of tools) {
    if (allows.has(t.id) && !denies.has(t.id)) {
      out.push({
        id: t.id,
        key: t.key,
        category: t.category,
        displayName: t.displayName,
        description: t.description,
        inputSchema: t.inputSchema,
      });
    }
  }
  return out;
}
