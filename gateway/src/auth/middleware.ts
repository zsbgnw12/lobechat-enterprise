import { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';
import { resolveDevUser, AuthContext } from './devAuth';
import { validateCasdoorBearer } from './casdoor';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export function assertAuthModeSafe() {
  if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
    throw new Error(
      'AUTH_MODE=dev is not permitted when NODE_ENV=production. Refuse to start.',
    );
  }
}

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  if (env.AUTH_MODE === 'dev' && env.NODE_ENV === 'production') {
    reply.code(500).send({ error: 'server_misconfigured', detail: 'AUTH_MODE=dev forbidden in production' });
    return;
  }
  let ctx: AuthContext | null = null;
  if (env.AUTH_MODE === 'casdoor') {
    ctx = await validateCasdoorBearer(req);
    if (!ctx) {
      reply.code(401).send({ error: 'unauthenticated', hint: 'Authorization: Bearer <jwt>' });
      return;
    }
  } else if (env.AUTH_MODE === 'dev') {
    ctx = await resolveDevUser(req);
    if (!ctx) {
      reply.code(401).send({ error: 'unauthenticated', hint: 'send X-Dev-User header' });
      return;
    }
  } else {
    reply.code(500).send({ error: 'server_misconfigured', detail: `unknown AUTH_MODE=${env.AUTH_MODE}` });
    return;
  }
  req.auth = ctx;
}

export function requireRoles(...roleKeys: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.auth) {
      reply.code(401).send({ error: 'unauthenticated' });
      return;
    }
    const has = req.auth.roleKeys.some((k) => roleKeys.includes(k));
    if (!has) {
      reply.code(403).send({ error: 'forbidden', need: roleKeys });
      return;
    }
  };
}
