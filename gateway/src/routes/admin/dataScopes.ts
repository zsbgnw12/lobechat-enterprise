import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';
import { RATE_LIMIT_ADMIN_MUTATE } from '../../core/rateLimiter';
import { validateScope } from '../../core/filter';

export async function adminScopesRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };

  app.get('/api/admin/data-scopes', guard, async () => {
    return prisma.enterpriseDataScope.findMany();
  });

  app.post('/api/admin/data-scopes', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    try {
      validateScope(b.scope);
    } catch (e: any) {
      reply.code(400).send({ error: 'bad_request', detail: e?.message ?? 'invalid scope' });
      return;
    }
    const created = await prisma.enterpriseDataScope.create({
      data: {
        subjectType: b.subject_type,
        subjectId: b.subject_id,
        sourceSystem: b.source_system,
        entityType: b.entity_type,
        scope: b.scope,
      },
    });
    reply.code(201).send(created);
  });

  app.delete('/api/admin/data-scopes/:id', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const { id } = req.params as any;
    await prisma.enterpriseDataScope.delete({ where: { id } });
    return { ok: true };
  });
}
