import { prisma } from '../db';
import { AuthContext } from '../auth/devAuth';
import { identityMapMissing } from './metrics';

export interface FilterResult<T> {
  kept: T[];
  droppedCount: number;
  missingIdentityMapCount: number;
  missingIdentityMapIds: string[];
}

/**
 * Whitelist of identity_map fields that scope DSL may reference directly.
 * Any other top-level key must be routed through `metadata.xxx`.
 */
export const SCOPE_FIELD_WHITELIST: ReadonlySet<string> = new Set([
  'tenant_id',
  'customer_id',
  'owner_user_id',
  'department_id',
  'sales_user_id',
  'operation_user_id',
  'region',
  'visibility_level',
]);

const SUPPORTED_OPS = new Set(['$in', '$contains', '$regex']);

/**
 * Validate a data_scope `scope` JSON blob. Throws a human-readable Error
 * when the scope references unknown fields or unsupported operators.
 */
export function validateScope(scope: any): void {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new Error('scope must be a JSON object');
  }
  if (scope.all === true) {
    // Allow {"all":true} plus nothing else strict — but don't require exclusivity.
    return;
  }
  for (const [k, v] of Object.entries(scope)) {
    if (k === 'all') continue;
    if (k.startsWith('metadata.')) {
      const sub = k.slice('metadata.'.length);
      if (!sub) throw new Error(`scope field '${k}' missing metadata sub-key`);
    } else if (!SCOPE_FIELD_WHITELIST.has(k)) {
      throw new Error(
        `scope field '${k}' is not in whitelist; allowed: ${[...SCOPE_FIELD_WHITELIST].join(', ')} or metadata.<key>`,
      );
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const op of Object.keys(v as object)) {
        if (!SUPPORTED_OPS.has(op)) {
          throw new Error(
            `scope operator '${op}' on field '${k}' is unsupported; allowed: ${[...SUPPORTED_OPS].join(', ')}`,
          );
        }
      }
    }
  }
}

function resolveExpected(expected: any, auth: AuthContext): any {
  if (expected === '$self') return auth.userId;
  if (typeof expected === 'string' && expected.startsWith('$user.')) {
    const path = expected.slice(6);
    return (auth as any)[path] ?? (auth.user?.metadata as any)?.[path] ?? null;
  }
  return expected;
}

function getRowValue(row: any, key: string): any {
  if (key.startsWith('metadata.')) {
    const sub = key.slice('metadata.'.length);
    const md = row.metadata ?? row.meta ?? {};
    return md?.[sub];
  }
  return row[snakeToCamel(key)] ?? row[key];
}

function scopeMatches(scope: any, row: any, auth: AuthContext): boolean {
  if (!scope || typeof scope !== 'object') return false;
  if (scope.all === true) return true;
  for (const [k, v] of Object.entries(scope)) {
    if (k === 'all') continue;
    const actual = getRowValue(row, k);

    // Operator object: {$in:[...]} / {$contains:"..."} / {$regex:"..."}
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const opObj = v as Record<string, any>;
      if ('$in' in opObj) {
        const list = (opObj.$in as any[]).map((x) => resolveExpected(x, auth));
        if (!list.includes(actual)) return false;
        continue;
      }
      if ('$contains' in opObj) {
        const needle = resolveExpected(opObj.$contains, auth);
        if (Array.isArray(actual)) {
          if (!actual.includes(needle)) return false;
        } else if (typeof actual === 'string' && typeof needle === 'string') {
          if (!actual.includes(needle)) return false;
        } else {
          return false;
        }
        continue;
      }
      if ('$regex' in opObj) {
        const pattern = String(resolveExpected(opObj.$regex, auth));
        try {
          const re = new RegExp(pattern);
          if (typeof actual !== 'string' || !re.test(actual)) return false;
        } catch {
          return false;
        }
        continue;
      }
      // Unknown operator object -> no match
      return false;
    }

    // Array literal: OR match
    if (Array.isArray(v)) {
      const list = v.map((x) => resolveExpected(x, auth));
      if (!list.includes(actual)) return false;
      continue;
    }

    // Scalar literal (with $self / $user.xxx expansion)
    const expected = resolveExpected(v, auth);
    if (actual !== expected) return false;
  }
  return true;
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export async function filterByIdentityMap<T extends { id?: string | number }>(
  items: T[],
  sourceSystem: string,
  entityType: string,
  auth: AuthContext,
  idField: keyof T = 'id' as any,
): Promise<FilterResult<T>> {
  if (!items.length) {
    return { kept: [], droppedCount: 0, missingIdentityMapCount: 0, missingIdentityMapIds: [] };
  }

  const ids = items.map((it) => String(it[idField]));
  const roles = await prisma.enterpriseRole.findMany({ where: { key: { in: auth.roleKeys } } });
  const roleIds = roles.map((r) => r.id);

  const [maps, roleScopes, userScopes] = await Promise.all([
    prisma.enterpriseIdentityMap.findMany({
      where: { sourceSystem, entityType, sourceEntityId: { in: ids } },
    }),
    roleIds.length
      ? prisma.enterpriseDataScope.findMany({
          where: {
            subjectType: 'role',
            subjectId: { in: roleIds },
            sourceSystem,
            entityType,
          },
        })
      : Promise.resolve([]),
    prisma.enterpriseDataScope.findMany({
      where: { subjectType: 'user', subjectId: auth.userId, sourceSystem, entityType },
    }),
  ]);

  const mapByEntityId = new Map<string, any>();
  for (const m of maps) mapByEntityId.set(m.sourceEntityId, m);

  const allScopes = [...roleScopes, ...userScopes];

  const kept: T[] = [];
  let droppedCount = 0;
  let missingIdentityMapCount = 0;
  const missingIdentityMapIds: string[] = [];

  for (const it of items) {
    const idStr = String(it[idField]);
    const m = mapByEntityId.get(idStr);
    if (!m) {
      missingIdentityMapCount++;
      missingIdentityMapIds.push(idStr);
      droppedCount++;
      try {
        identityMapMissing.inc({ source_system: sourceSystem, entity_type: entityType });
      } catch {
        // metrics must never break the filter path
      }
      continue;
    }
    // super_admin & permission_admin wildcard already seeded as {all:true}
    let pass = false;
    for (const s of allScopes) {
      if (scopeMatches(s.scope, m, auth)) {
        pass = true;
        break;
      }
    }
    if (pass) kept.push(it);
    else droppedCount++;
  }

  return { kept, droppedCount, missingIdentityMapCount, missingIdentityMapIds };
}
