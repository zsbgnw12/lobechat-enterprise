import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';
import { cache } from '../../core/cache';
import { CAP_CACHE_PREFIX } from '../../core/capabilities';
import { RATE_LIMIT_ADMIN_MUTATE } from '../../core/rateLimiter';

export async function adminToolsRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };

  app.get('/api/admin/tools', guard, async () => {
    return prisma.enterpriseToolRegistry.findMany({ orderBy: { key: 'asc' } });
  });

  app.get('/api/admin/tools/:key/schema', guard, async (req, reply) => {
    const { key } = req.params as any;
    const tool = await prisma.enterpriseToolRegistry.findUnique({ where: { key } });
    if (!tool) {
      reply.code(404).send({ error: 'not_found', detail: `tool '${key}' not registered` });
      return;
    }
    return { key: tool.key, input_schema: tool.inputSchema ?? {} };
  });

  app.get('/api/admin/tool-permissions', guard, async () => {
    return prisma.enterpriseToolPermission.findMany();
  });

  app.post('/api/admin/tool-permissions', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const b = req.body as any;
    const created = await prisma.enterpriseToolPermission.create({
      data: {
        subjectType: b.subject_type,
        subjectId: b.subject_id,
        toolId: b.tool_id,
        allow: b.allow ?? true,
        constraints: b.constraints,
      },
    });
    await cache.invalidate(CAP_CACHE_PREFIX);
    return created;
  });

  app.delete('/api/admin/tool-permissions/:id', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const { id } = req.params as any;
    await prisma.enterpriseToolPermission.delete({ where: { id } });
    await cache.invalidate(CAP_CACHE_PREFIX);
    return { ok: true };
  });
}
