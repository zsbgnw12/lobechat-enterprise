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
