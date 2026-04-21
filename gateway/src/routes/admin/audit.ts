import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';

export async function adminAuditRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };

  app.get('/api/admin/audit', guard, async (req) => {
    const q = req.query as any;
    const where: any = {};
    if (q.user) where.username = q.user;
    if (q.tool) where.toolKey = q.tool;
    if (q.outcome) where.outcome = q.outcome;
    if (q.from || q.to) {
      where.at = {};
      if (q.from) where.at.gte = new Date(q.from);
      if (q.to) where.at.lte = new Date(q.to);
    }
    const rows = await prisma.enterpriseAuditLog.findMany({
      where,
      orderBy: { at: 'desc' },
      take: 200,
    });
    return rows;
  });
}
