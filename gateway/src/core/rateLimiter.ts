/**
 * Rate-limit registration helper.
 *
 * Global default : 300 req/min per identity
 * /api/tools/call + /api/lobechat/tool-gateway : 60 req/min
 * /api/admin/* mutating methods (POST/PUT/PATCH/DELETE) : 30 req/min
 * /health : unlimited
 *
 * Identity key (in priority order):
 *   1. req.auth.userId  (set by authenticate preHandler)
 *   2. X-Dev-User header
 *   3. IP address
 */
import { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { env } from '../env';

function keyGenerator(req: FastifyRequest): string {
  const auth = (req as any).auth;
  if (auth?.userId) return `uid:${auth.userId}`;
  // X-Dev-User is ONLY honored in dev mode to prevent bypass-via-spoofed-header
  if (env.AUTH_MODE === 'dev') {
    const devUser = req.headers['x-dev-user'] as string | undefined;
    if (devUser) return `dvu:${devUser}`;
  }
  return `ip:${req.ip}`;
}

export async function registerRateLimits(app: FastifyInstance): Promise<void> {
  if (env.RATE_LIMIT_DISABLED) {
    app.log.info('[rate-limit] disabled via RATE_LIMIT_DISABLED=true');
    return;
  }

  // Build store config
  let storeOptions: Record<string, any> = {};
  if (env.REDIS_URL) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const IORedis = require('ioredis');
      const redis = new IORedis(env.REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 2 });
      redis.on('error', (e: any) => {
        app.log.warn({ err: e?.message }, '[rate-limit] redis error');
      });
      storeOptions = { redis };
      app.log.info('[rate-limit] using redis store');
    } catch (e: any) {
      app.log.warn({ err: e?.message }, '[rate-limit] ioredis unavailable, using memory store');
    }
  }

  // Register global default: 300 req/min
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    keyGenerator,
    ...storeOptions,
    // Skip /health entirely
    allowList: (req: FastifyRequest) => req.url === '/health' || (req as any).routerPath === '/health',
    errorResponseBuilder: (_req: FastifyRequest, context) => ({
      statusCode: 429,
      error: 'rate_limited',
      retry_after_ms: context.ttl,
    }),
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });

  app.log.info('[rate-limit] global default: 300/min registered');
}

/**
 * Route-level config objects to attach as `config.rateLimit` on specific routes.
 * @fastify/rate-limit picks these up automatically when global=true.
 */
export const RATE_LIMIT_TOOLS = {
  rateLimit: {
    max: 60,
    timeWindow: '1 minute',
    keyGenerator,
    errorResponseBuilder: (_req: any, context: any) => ({
      statusCode: 429,
      error: 'rate_limited',
      retry_after_ms: context.ttl,
    }),
  },
};

export const RATE_LIMIT_ADMIN_MUTATE = {
  rateLimit: {
    max: 30,
    timeWindow: '1 minute',
    keyGenerator,
    errorResponseBuilder: (_req: any, context: any) => ({
      statusCode: 429,
      error: 'rate_limited',
      retry_after_ms: context.ttl,
    }),
  },
};
