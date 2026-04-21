import { FastifyRequest } from 'fastify';
import { prisma } from '../db';

export interface AuthContext {
  userId: string;
  username: string;
  displayName: string;
  departmentId: string | null;
  region: string | null;
  customerId: string | null;
  roleKeys: string[];
  user: any;
}

export async function resolveDevUser(req: FastifyRequest): Promise<AuthContext | null> {
  const headerName = (req.headers['x-dev-user'] as string | undefined) || undefined;
  // @ts-ignore cookies added by @fastify/cookie
  const cookieName = (req.cookies?.dev_user as string | undefined) || undefined;
  const username = headerName || cookieName;
  if (!username) return null;
  const user = await prisma.enterpriseUser.findUnique({
    where: { username },
    include: { userRoles: { include: { role: true } } },
  });
  if (!user || !user.isActive) return null;
  const roleKeys = user.userRoles.map((ur) => ur.role.key);
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
