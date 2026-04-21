import { FastifyInstance } from 'fastify';
import { prisma } from '../db';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    let db = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'fail';
    }
    return { status: 'ok', db };
  });
}
