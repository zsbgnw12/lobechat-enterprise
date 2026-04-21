import { FastifyInstance } from 'fastify';
import { authenticate, requireRoles } from '../../auth/middleware';
import { prisma } from '../../db';
import { RATE_LIMIT_ADMIN_MUTATE } from '../../core/rateLimiter';

// NOTE: role CRUD 本身不改变"某个用户现在能调哪些工具"的计算结果：
//   - POST：新角色还没有任何 user / tool-permission 绑定，没人受影响
//   - PUT：只改 name / description，能力矩阵不变
//   - DELETE：前面已校验"有引用就 409"，走到删除说明无用户绑定
// 所以这里不再做 capability cache 失效。真正影响能力的是：
//   - user 绑定角色（admin/users.ts）
//   - tool-permission 增删（admin/tools.ts）
// 由这两个入口负责定点失效。

export async function adminRolesRoutes(app: FastifyInstance) {
  const guard = { preHandler: [authenticate, requireRoles('super_admin', 'permission_admin')] };
  const superGuard = { preHandler: [authenticate, requireRoles('super_admin')] };

  app.get('/api/admin/roles', guard, async () => {
    return prisma.enterpriseRole.findMany({ orderBy: { key: 'asc' } });
  });

  app.post('/api/admin/roles', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req, reply) => {
    const b = (req.body ?? {}) as any;
    if (!b.key || typeof b.key !== 'string' || !b.name || typeof b.name !== 'string') {
      reply.code(400).send({ error: 'bad_request', detail: 'key and name are required strings' });
      return;
    }
    const existing = await prisma.enterpriseRole.findUnique({ where: { key: b.key } });
    if (existing) {
      reply.code(409).send({ error: 'conflict', detail: `role key '${b.key}' already exists` });
      return;
    }
    const created = await prisma.enterpriseRole.create({
      data: { key: b.key, name: b.name, description: b.description ?? null },
    });
    reply.code(201).send(created);
  });

  app.put('/api/admin/roles/:id', { ...guard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req, reply) => {
    const { id } = req.params as any;
    const b = (req.body ?? {}) as any;
    if ('key' in b) {
      reply.code(400).send({ error: 'bad_request', detail: 'role key is immutable' });
      return;
    }
    const data: any = {};
    if (typeof b.name === 'string') data.name = b.name;
    if ('description' in b) data.description = b.description ?? null;
    if (Object.keys(data).length === 0) {
      reply.code(400).send({ error: 'bad_request', detail: 'nothing to update' });
      return;
    }
    try {
      const updated = await prisma.enterpriseRole.update({ where: { id }, data });
      return updated;
    } catch (e: any) {
      reply.code(404).send({ error: 'not_found', detail: `role ${id} not found` });
    }
  });

  app.delete('/api/admin/roles/:id', { ...superGuard, config: RATE_LIMIT_ADMIN_MUTATE }, async (req, reply) => {
    const { id } = req.params as any;
    const role = await prisma.enterpriseRole.findUnique({ where: { id } });
    if (!role) {
      reply.code(404).send({ error: 'not_found', detail: `role ${id} not found` });
      return;
    }
    const [userRefs, toolPermRefs] = await Promise.all([
      prisma.enterpriseUserRole.count({ where: { roleId: id } }),
      prisma.enterpriseToolPermission.count({ where: { subjectType: 'role', subjectId: id } }),
    ]);
    if (userRefs > 0 || toolPermRefs > 0) {
      reply.code(409).send({
        error: 'conflict',
        detail: 'role is referenced and cannot be deleted',
        user_role_refs: userRefs,
        tool_permission_refs: toolPermRefs,
      });
      return;
    }
    await prisma.enterpriseRole.delete({ where: { id } });
    return { ok: true };
  });
}
