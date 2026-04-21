import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { timingSafeEqual } from 'crypto';
import { authenticate } from '../auth/middleware';
import { env } from '../env';
import {
  renderMetrics,
  metricsContentType,
  auditQueueDepth,
} from '../core/metrics';
import { getAuditQueueDepth } from '../core/auditQueue';

function tokenMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// GET /metrics — Prometheus scrape endpoint.
// Auth: super_admin via authenticate() preHandler, OR
//       Authorization: Bearer <METRICS_TOKEN> (static token for Prom server).
export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
    // Allow a static bearer token first (Prometheus scrape convention).
    const auth = (req.headers['authorization'] || '') as string;
    const token = env.METRICS_TOKEN;
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(auth);
    const bearerToken = bearerMatch?.[1]?.trim();

    let authorized = false;
    if (tokenMatch(bearerToken, token)) {
      authorized = true;
    } else {
      // Fall back to the standard authenticate() — super_admin only.
      await authenticate(req, reply);
      if (reply.sent) return;
      const roles = req.auth?.roleKeys ?? [];
      if (roles.includes('super_admin')) {
        authorized = true;
      }
    }

    if (!authorized) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }

    // Refresh audit queue depth on each scrape.
    try {
      const depth = await getAuditQueueDepth();
      if (depth !== null) auditQueueDepth.set(depth);
    } catch {
      // non-fatal
    }

    const body = await renderMetrics();
    reply.type(metricsContentType()).send(body);
  });
}
