// Casdoor OIDC Bearer validator.
// Active when AUTH_MODE=casdoor. Validates JWT via JWKS fetched from
// ${CASDOOR_JWKS_URL} or `${CASDOOR_URL}/.well-known/jwks.json`.
//
// Claim mapping:
//   sub              -> EnterpriseUser.casdoorSub (unique; row upserted on first sight)
//   preferred_username|name|email -> username/displayName/email
//   roles[]          -> mapped via CASDOOR_ROLE_MAP (JSON) or 1:1 to enterprise_roles.key;
//                       when empty or no matches, fall back to DB user_roles.
import { FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { env } from '../env';
import { prisma } from '../db';
import { AuthContext } from './devAuth';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function resolveJwksUrl(): string {
  if (env.CASDOOR_JWKS_URL) return env.CASDOOR_JWKS_URL;
  if (env.CASDOOR_URL) return `${env.CASDOOR_URL.replace(/\/$/, '')}/.well-known/jwks.json`;
  return '';
}

function getJwks() {
  if (jwks) return jwks;
  const url = resolveJwksUrl();
  if (!url) return null;
  jwks = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60 * 1000, cooldownDuration: 30_000 });
  return jwks;
}

function parseRoleMap(): Record<string, string> {
  if (!env.CASDOOR_ROLE_MAP) return {};
  try {
    const obj = JSON.parse(env.CASDOOR_ROLE_MAP);
    if (obj && typeof obj === 'object') return obj as Record<string, string>;
  } catch {
    /* ignore */
  }
  return {};
}

function extractTokenRoles(payload: JWTPayload): string[] {
  const raw = (payload as any).roles;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((r: any) => {
        if (typeof r === 'string') return r;
        if (r && typeof r === 'object') return r.name || r.key || r.displayName || '';
        return '';
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string') return raw.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

export async function validateCasdoorBearer(req: FastifyRequest): Promise<AuthContext | null> {
  const authz = (req.headers['authorization'] as string | undefined) || '';
  const m = /^Bearer\s+(.+)$/i.exec(authz);
  if (!m) return null;
  const token = m[1].trim();

  const keyset = getJwks();
  if (!keyset) {
    req.log.warn('casdoor: no JWKS url configured');
    return null;
  }

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(token, keyset, {
      issuer: env.CASDOOR_ISSUER || env.CASDOOR_URL || undefined,
      audience: env.CASDOOR_AUDIENCE || undefined,
    });
    payload = verified.payload;
  } catch (e: any) {
    req.log.warn({ err: e?.message }, 'casdoor: jwt verify failed');
    return null;
  }

  const sub = String(payload.sub || '');
  if (!sub) return null;
  const username =
    (payload as any).preferred_username ||
    (payload as any).name ||
    (payload as any).username ||
    sub;
  const email = (payload as any).email || null;
  const displayName = (payload as any).displayName || (payload as any).name || username;

  // Upsert user row keyed by casdoorSub.
  const user = await prisma.enterpriseUser.upsert({
    where: { casdoorSub: sub },
    update: { displayName, email: email ?? undefined },
    create: {
      casdoorSub: sub,
      username: String(username).slice(0, 64),
      displayName: String(displayName).slice(0, 128),
      email: email ?? undefined,
    },
    include: { userRoles: { include: { role: true } } },
  });

  // Role resolution: token > DB fallback.
  const tokenRoles = extractTokenRoles(payload);
  const map = parseRoleMap();
  const candidateKeys = tokenRoles.map((r) => map[r] || r);
  let roleKeys: string[] = [];
  if (candidateKeys.length) {
    const found = await prisma.enterpriseRole.findMany({
      where: { key: { in: candidateKeys } },
    });
    roleKeys = found.map((r) => r.key);
  }
  if (!roleKeys.length) {
    roleKeys = user.userRoles.map((ur) => ur.role.key);
  }

  const meta = (user.metadata as any) || {};
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    departmentId: user.departmentId,
    region: user.region,
    customerId: meta.customer_id || null,
    roleKeys,
    user,
  };
}
