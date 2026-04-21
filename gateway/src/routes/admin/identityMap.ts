import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';
import { getTool } from '../../tools/registry';
import { writeAudit } from '../../core/audit';
import { AuthContext } from '../../auth/devAuth';
import { RATE_LIMIT_ADMIN_MUTATE } from '../../core/rateLimiter';

function normalizeEntry(b: any) {
  if (!b || typeof b !== 'object') return null;
  if (!b.source_system || !b.entity_type || !b.source_entity_id) return null;
  return {
    sourceSystem: String(b.source_system),
    entityType: String(b.entity_type),
    sourceEntityId: String(b.source_entity_id),
    tenantId: b.tenant_id ?? null,
    customerId: b.customer_id ?? null,
    ownerUserId: b.owner_user_id ?? null,
    departmentId: b.department_id ?? null,
    salesUserId: b.sales_user_id ?? null,
    operationUserId: b.operation_user_id ?? null,
    region: b.region ?? null,
    visibilityLevel: b.visibility_level ?? null,
    metadata: b.metadata ?? undefined,
  };
}

export async function adminIdentityMapRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };
  const superOnly = { preHandler: [authenticate, requireRoles('super_admin')] };

  app.get('/api/admin/identity-map', guard, async () => {
    return prisma.enterpriseIdentityMap.findMany({ take: 500 });
  });

  app.post('/api/admin/identity-map', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const b = req.body as any;
    const e = normalizeEntry(b);
    if (!e) {
      return { error: 'invalid_entry' };
    }
    return prisma.enterpriseIdentityMap.upsert({
      where: {
        sourceSystem_entityType_sourceEntityId: {
          sourceSystem: e.sourceSystem,
          entityType: e.entityType,
          sourceEntityId: e.sourceEntityId,
        },
      },
      update: {
        tenantId: e.tenantId,
        customerId: e.customerId,
        ownerUserId: e.ownerUserId,
        departmentId: e.departmentId,
        salesUserId: e.salesUserId,
        operationUserId: e.operationUserId,
        region: e.region,
        visibilityLevel: e.visibilityLevel,
        metadata: e.metadata,
      },
      create: {
        sourceSystem: e.sourceSystem,
        entityType: e.entityType,
        sourceEntityId: e.sourceEntityId,
        tenantId: e.tenantId,
        customerId: e.customerId,
        ownerUserId: e.ownerUserId,
        departmentId: e.departmentId,
        salesUserId: e.salesUserId,
        operationUserId: e.operationUserId,
        region: e.region,
        visibilityLevel: e.visibilityLevel,
        metadata: e.metadata,
      },
    });
  });

  // Bulk import: upserts many entries. Returns counts.
  app.post('/api/admin/identity-map/import', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const b = req.body as any;
    const entries: any[] = Array.isArray(b?.entries) ? b.entries : [];
    let inserted = 0;
    let updated = 0;
    let skipped_invalid = 0;
    for (const raw of entries) {
      const e = normalizeEntry(raw);
      if (!e) {
        skipped_invalid++;
        continue;
      }
      const existing = await prisma.enterpriseIdentityMap.findUnique({
        where: {
          sourceSystem_entityType_sourceEntityId: {
            sourceSystem: e.sourceSystem,
            entityType: e.entityType,
            sourceEntityId: e.sourceEntityId,
          },
        },
      });
      await prisma.enterpriseIdentityMap.upsert({
        where: {
          sourceSystem_entityType_sourceEntityId: {
            sourceSystem: e.sourceSystem,
            entityType: e.entityType,
            sourceEntityId: e.sourceEntityId,
          },
        },
        update: {
          tenantId: e.tenantId,
          customerId: e.customerId,
          ownerUserId: e.ownerUserId,
          departmentId: e.departmentId,
          salesUserId: e.salesUserId,
          operationUserId: e.operationUserId,
          region: e.region,
          visibilityLevel: e.visibilityLevel,
          metadata: e.metadata,
        },
        create: {
          sourceSystem: e.sourceSystem,
          entityType: e.entityType,
          sourceEntityId: e.sourceEntityId,
          tenantId: e.tenantId,
          customerId: e.customerId,
          ownerUserId: e.ownerUserId,
          departmentId: e.departmentId,
          salesUserId: e.salesUserId,
          operationUserId: e.operationUserId,
          region: e.region,
          visibilityLevel: e.visibilityLevel,
          metadata: e.metadata,
        },
      });
      if (existing) updated++;
      else inserted++;
    }
    await writeAudit({
      auth: (req as any).auth || null,
      toolKey: null,
      action: 'identity_map_imported',
      outcome: 'ok',
      meta: { inserted, updated, skipped_invalid, total: entries.length },
    });
    return { inserted, updated, skipped_invalid, total: entries.length };
  });

  // Auto-discover: runs a tool adapter in "system" mode using the seeded
  // `system-discoverer` super_admin identity, then infers identity_map rows.
  app.post('/api/admin/identity-map/discover', { ...superOnly, config: RATE_LIMIT_ADMIN_MUTATE }, async (req, reply) => {
    const b = req.body as any;
    const source_system = String(b?.source_system || '');
    const entity_type = String(b?.entity_type || '');
    const limit = Math.max(1, Math.min(Number(b?.limit || 200), 1000));
    if (!source_system || !entity_type) {
      reply.code(400);
      return { error: 'source_system and entity_type required' };
    }

    // Pick a reader tool for the (source_system, entity_type).
    const toolKey =
      source_system === 'gongdan' && entity_type === 'ticket'
        ? 'gongdan.search_tickets'
        : source_system === 'xiaoshou' && entity_type === 'customer'
          ? 'xiaoshou.search_customers'
          : null;
    if (!toolKey) {
      reply.code(400);
      return { error: 'unsupported source_system/entity_type' };
    }
    const adapter = getTool(toolKey);
    if (!adapter) {
      reply.code(404);
      return { error: `no adapter for ${toolKey}` };
    }

    // Resolve internal system identity (super_admin) to bypass RBAC filter.
    const sys = await prisma.enterpriseUser.findUnique({
      where: { username: 'system-discoverer' },
      include: { userRoles: { include: { role: true } } },
    });
    if (!sys) {
      reply.code(500);
      return { error: 'system-discoverer user not seeded' };
    }
    const sysAuth: AuthContext = {
      userId: sys.id,
      username: sys.username,
      displayName: sys.displayName,
      departmentId: sys.departmentId,
      region: sys.region,
      customerId: null,
      roleKeys: sys.userRoles.map((ur) => ur.role.key),
      user: sys,
    };

    let raw: any;
    try {
      raw = await adapter.run({ auth: sysAuth }, {});
    } catch (e: any) {
      reply.code(502);
      return { error: 'adapter_error', detail: String(e?.message || e) };
    }
    const items: any[] = Array.isArray(raw) ? raw : raw?.items ?? raw?.data ?? raw?.tickets ?? [];
    const sliced = items.slice(0, limit);

    let inserted = 0;
    let updated = 0;
    let skipped_invalid = 0;
    for (const it of sliced) {
      let entry: ReturnType<typeof normalizeEntry> | null = null;
      if (source_system === 'gongdan' && entity_type === 'ticket') {
        const id = it?.id;
        if (!id) {
          skipped_invalid++;
          continue;
        }
        entry = normalizeEntry({
          source_system,
          entity_type,
          source_entity_id: String(id),
          customer_id: it.customer_id ?? it.customerId ?? it.accountInfo?.customer_id ?? null,
          owner_user_id: it.owner_user_id ?? it.creator ?? null,
          operation_user_id: it.operation_user_id ?? it.assignedEngineerId ?? null,
          region: it.region ?? null,
        });
      } else if (source_system === 'xiaoshou' && entity_type === 'customer') {
        const id = it?.id;
        if (!id) {
          skipped_invalid++;
          continue;
        }
        entry = normalizeEntry({
          source_system,
          entity_type,
          source_entity_id: String(id),
          customer_id: it.customer_code ?? it.id ?? null,
          sales_user_id: it.sales_user_id ?? null,
          operation_user_id: it.operation_user_id ?? null,
          region: it.region ?? null,
          tenant_id: null,
        });
      }
      if (!entry) {
        skipped_invalid++;
        continue;
      }
      const existing = await prisma.enterpriseIdentityMap.findUnique({
        where: {
          sourceSystem_entityType_sourceEntityId: {
            sourceSystem: entry.sourceSystem,
            entityType: entry.entityType,
            sourceEntityId: entry.sourceEntityId,
          },
        },
      });
      await prisma.enterpriseIdentityMap.upsert({
        where: {
          sourceSystem_entityType_sourceEntityId: {
            sourceSystem: entry.sourceSystem,
            entityType: entry.entityType,
            sourceEntityId: entry.sourceEntityId,
          },
        },
        update: {
          tenantId: entry.tenantId,
          customerId: entry.customerId,
          ownerUserId: entry.ownerUserId,
          departmentId: entry.departmentId,
          salesUserId: entry.salesUserId,
          operationUserId: entry.operationUserId,
          region: entry.region,
          visibilityLevel: entry.visibilityLevel,
          metadata: entry.metadata,
        },
        create: {
          sourceSystem: entry.sourceSystem,
          entityType: entry.entityType,
          sourceEntityId: entry.sourceEntityId,
          tenantId: entry.tenantId,
          customerId: entry.customerId,
          ownerUserId: entry.ownerUserId,
          departmentId: entry.departmentId,
          salesUserId: entry.salesUserId,
          operationUserId: entry.operationUserId,
          region: entry.region,
          visibilityLevel: entry.visibilityLevel,
          metadata: entry.metadata,
        },
      });
      if (existing) updated++;
      else inserted++;
    }
    const total = sliced.length;
    await writeAudit({
      auth: (req as any).auth || null,
      toolKey,
      action: 'identity_map_discovered',
      outcome: 'ok',
      meta: { source_system, entity_type, inserted, updated, skipped_invalid, total },
    });
    return { inserted, updated, skipped_invalid, total, source_system, entity_type };
  });
}
