import { prisma } from '../db';
import { AuthContext } from '../auth/devAuth';

export interface AuditInput {
  auth?: AuthContext | null;
  toolKey?: string | null;
  action: string;
  outcome: 'ok' | 'denied' | 'error';
  request?: any;
  responseSummary?: any;
  meta?: any;
  log?: { warn: (obj: any, msg?: string) => void } | null;
}

export async function writeAudit(input: AuditInput): Promise<boolean> {
  try {
    await prisma.enterpriseAuditLog.create({
      data: {
        userId: input.auth?.userId || null,
        username: input.auth?.username || null,
        toolKey: input.toolKey || null,
        action: input.action,
        outcome: input.outcome,
        request: input.request ?? undefined,
        responseSummary: input.responseSummary ?? undefined,
        meta: input.meta ?? undefined,
      },
    });
    return true;
  } catch (e) {
    // best-effort audit — don't fail closed, but surface the failure.
    if (input.log && typeof input.log.warn === 'function') {
      input.log.warn({ err: e }, 'audit write failed');
    } else {
      // eslint-disable-next-line no-console
      console.warn('audit write failed', e);
    }
    return false;
  }
}
