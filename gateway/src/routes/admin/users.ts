import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';
import { cache } from '../../core/cache';
import { CAP_CACHE_PREFIX } from '../../core/capabilities';
import { RATE_LIMIT_ADMIN_MUTATE } from '../../core/rateLimiter';

export async function adminUsersRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };

  app.get('/api/admin/users', guard, async () => {
    const users = await prisma.enterpriseUser.findMany({
      include: { userRoles: { include: { role: true } } },
      orderBy: { username: 'asc' },
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      display_name: u.displayName,
      department_id: u.departmentId,
      region: u.region,
      roles: u.userRoles.map((ur) => ur.role.key),
    }));
  });

  app.post('/api/admin/users', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const b = req.body as any;
    const created = await prisma.enterpriseUser.create({
      data: {
        username: b.username,
        displayName: b.display_name || b.username,
        email: b.email,
        departmentId: b.department_id,
        region: b.region,
        metadata: b.metadata,
      },
    });
    return created;
  });

  app.post('/api/admin/users/:id/roles', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req) => {
    const { id } = req.params as any;
    const { role_keys } = req.body as any;
    const roles = await prisma.enterpriseRole.findMany({ where: { key: { in: role_keys } } });
    await prisma.enterpriseUserRole.deleteMany({ where: { userId: id } });
    for (const r of roles) {
      await prisma.enterpriseUserRole.create({ data: { userId: id, roleId: r.id } });
    }
    await cache.invalidate(CAP_CACHE_PREFIX);
    return { ok: true, granted: roles.map((r) => r.key) };
  });
}
