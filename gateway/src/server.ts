import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { env } from './env';
import { assertAuthModeSafe } from './auth/middleware';
import { startAuditWorker, stopAuditWorker } from './core/auditQueue';
import { registerRateLimits } from './core/rateLimiter';
import './tools'; // register tool adapters

import { healthRoutes } from './routes/health';
import { meRoutes } from './routes/me';
import { authRoutes } from './routes/auth';
import { capabilitiesRoutes } from './routes/capabilities';
import { toolsCallRoutes } from './routes/toolsCall';
import { lobechatPluginRoutes } from './routes/lobechatPlugin';
import { adminUsersRoutes } from './routes/admin/users';
import { adminRolesRoutes } from './routes/admin/roles';
import { adminToolsRoutes } from './routes/admin/tools';
import { adminScopesRoutes } from './routes/admin/dataScopes';
import { adminIdentityMapRoutes } from './routes/admin/identityMap';
import { adminAuditRoutes } from './routes/admin/audit';
import { adminUiRoutes } from './routes/admin/ui';
import { metricsRoutes } from './routes/metrics';

async function main() {
  assertAuthModeSafe();
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  const allowedOrigins = env.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: (origin, cb) => {
      // Allow same-origin / no-origin (curl, server-to-server)
      if (!origin) return cb(null, true);
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
  });
  await app.register(cookie);
  await registerRateLimits(app);
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(meRoutes);
  await app.register(capabilitiesRoutes);
  await app.register(toolsCallRoutes);
  await app.register(lobechatPluginRoutes);
  await app.register(adminUsersRoutes);
  await app.register(adminRolesRoutes);
  await app.register(adminToolsRoutes);
  await app.register(adminScopesRoutes);
  await app.register(adminIdentityMapRoutes);
  await app.register(adminAuditRoutes);
  await app.register(adminUiRoutes);
  await app.register(metricsRoutes);

  // Start async audit worker (BullMQ). Falls back to sync writes if REDIS_URL unset.
  startAuditWorker({
    warn: (o, m) => app.log.warn(o as any, m),
    info: (o, m) => app.log.info(o as any, m),
  });

  const shutdown = async (sig: string) => {
    app.log.info({ sig }, 'shutting down');
    try { await stopAuditWorker(); } catch {}
    try { await app.close(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: '0.0.0.0', port: env.PORT });
  app.log.info(`api listening on :${env.PORT} (mock=${env.MOCK_MODE}, auth=${env.AUTH_MODE})`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
