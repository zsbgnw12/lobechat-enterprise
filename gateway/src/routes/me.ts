import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';

export async function meRoutes(app: FastifyInstance) {
  app.get('/api/me', { preHandler: authenticate }, async (req) => {
    const a = req.auth!;
    return {
      user: { id: a.userId, username: a.username, display_name: a.displayName },
      roles: a.roleKeys,
      casdoor_sub: (a.user as any).casdoorSub || null,
      department_id: a.departmentId,
      region: a.region,
      customer_id: a.customerId,
    };
  });
}
