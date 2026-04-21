import { FastifyInstance } from 'fastify';
import { authenticate } from '../auth/middleware';
import { resolveAllowedTools } from '../core/capabilities';

export async function capabilitiesRoutes(app: FastifyInstance) {
  app.get('/api/capabilities', { preHandler: authenticate }, async (req) => {
    const tools = await resolveAllowedTools(req.auth!);
    return {
      tools: tools.map((t) => ({
        key: t.key,
        category: t.category,
        display_name: t.displayName,
        description: t.description,
        input_schema: t.inputSchema,
        allowed: true,
      })),
    };
  });
}
