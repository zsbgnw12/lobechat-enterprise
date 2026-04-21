import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { callTool } from '../core/gateway';
import { RATE_LIMIT_TOOLS } from '../core/rateLimiter';

export async function toolsCallRoutes(app: FastifyInstance) {
  app.post('/api/tools/call', { preHandler: authenticate, config: RATE_LIMIT_TOOLS }, async (req, reply) => {
    const body = req.body as any;
    if (!body || typeof body.tool !== 'string') {
      reply.code(400).send({ error: 'tool is required' });
      return;
    }
    const r = await callTool({ auth: req.auth!, tool: body.tool, params: body.params ?? {} });
    if (!r.ok) {
      reply.code(r.status).send({ error: r.error, detail: r.detail });
      return;
    }
    return r.result;
  });
}
