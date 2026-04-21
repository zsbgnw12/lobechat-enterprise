import { FastifyInstance } from 'fastify';
import { env } from '../env';

// Public auth metadata so a frontend can build the OIDC login URL.
// Only returns non-secret fields (issuer URL + clientId).
export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async () => {
    return {
      mode: env.AUTH_MODE,
      issuer: env.CASDOOR_URL || null,
      client_id: env.CASDOOR_CLIENT_ID || null,
    };
  });
}
