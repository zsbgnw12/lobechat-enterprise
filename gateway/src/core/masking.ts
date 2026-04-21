import crypto from 'crypto';
import { prisma } from '../db';

export interface MaskResult {
  maskedFields: string[];
}

function getPath(obj: any, path: string): { parent: any; key: string } | null {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[parts[i]];
  }
  if (cur == null || typeof cur !== 'object') return null;
  return { parent: cur, key: parts[parts.length - 1] };
}

function applyPolicy(item: any, fieldPath: string, policy: string): boolean {
  // Support wildcard "*.apiKey" — walk every object.
  // Also support key-glob like "*.secret_*" where the suffix contains a trailing "*"
  // matching any key beginning with the given prefix.
  if (fieldPath.startsWith('*.')) {
    const key = fieldPath.slice(2);
    if (key.endsWith('*')) {
      const prefix = key.slice(0, -1);
      return applyWildcardPrefix(item, prefix, policy);
    }
    return applyWildcard(item, key, policy);
  }
  const loc = getPath(item, fieldPath);
  if (!loc) return false;
  if (!(loc.key in loc.parent)) return false;
  const val = loc.parent[loc.key];
  if (policy === 'drop') delete loc.parent[loc.key];
  else if (policy === 'mask') loc.parent[loc.key] = '***';
  else if (policy === 'hash')
    loc.parent[loc.key] = crypto.createHash('sha256').update(String(val)).digest('hex').slice(0, 12);
  return true;
}

function applyWildcardPrefix(obj: any, prefix: string, policy: string): boolean {
  let hit = false;
  const walk = (node: any) => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k.startsWith(prefix)) {
        const val = node[k];
        if (policy === 'drop') delete node[k];
        else if (policy === 'mask') node[k] = '***';
        else if (policy === 'hash')
          node[k] = crypto.createHash('sha256').update(String(val)).digest('hex').slice(0, 12);
        hit = true;
      } else {
        walk(node[k]);
      }
    }
  };
  walk(obj);
  return hit;
}

function applyWildcard(obj: any, key: string, policy: string): boolean {
  let hit = false;
  const walk = (node: any) => {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    for (const k of Object.keys(node)) {
      if (k === key) {
        const val = node[k];
        if (policy === 'drop') delete node[k];
        else if (policy === 'mask') node[k] = '***';
        else if (policy === 'hash')
          node[k] = crypto.createHash('sha256').update(String(val)).digest('hex').slice(0, 12);
        hit = true;
      } else {
        walk(node[k]);
      }
    }
  };
  walk(obj);
  return hit;
}

export async function applyFieldPolicies(
  items: any[],
  sourceSystem: string,
  entityType: string,
  userRoleKeys: string[],
): Promise<MaskResult> {
  const policies = await prisma.enterpriseFieldPolicy.findMany({
    where: {
      OR: [
        { sourceSystem, entityType },
        { sourceSystem: '*', entityType: '*' },
        { sourceSystem, entityType: '*' },
      ],
    },
  });
  const masked = new Set<string>();
  for (const p of policies) {
    // role_keys == roles that still see the field; others get masked
    const exempt = userRoleKeys.some((k) => p.roleKeys.includes(k));
    if (exempt) continue;
    for (const it of items) {
      if (applyPolicy(it, p.fieldPath, p.policy)) masked.add(p.fieldPath);
    }
  }
  return { maskedFields: Array.from(masked) };
}
