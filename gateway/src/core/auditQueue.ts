// Async audit pipeline (PLAN §5 — Azure Service Bus local substitute).
//
// enqueueAudit() tries to push a job onto a BullMQ queue backed by the existing
// Redis container. If Redis is unreachable or REDIS_URL is unset, we degrade to
// a synchronous writeAudit() so audit never silently drops.
//
// startAuditWorker() boots an in-process BullMQ Worker with concurrency=4 that
// pops jobs and calls writeAudit(). Jobs that persistently fail land in BullMQ's
// "failed" state and are logged at warn.

import { writeAudit, AuditInput } from './audit';

type QueueLike = {
  add: (name: string, data: any, opts?: any) => Promise<any>;
  close: () => Promise<void>;
};
type WorkerLike = { close: () => Promise<void> };

let queue: QueueLike | null = null;
let worker: WorkerLike | null = null;
let initTried = false;

const QUEUE_NAME = 'audit-writes';

function redisUrl(): string | null {
  return process.env.REDIS_URL || null;
}

function connectionFromUrl(url: string) {
  // BullMQ accepts an ioredis options object. Parse the URL minimally.
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'redis',
      port: parseInt(u.port || '6379', 10),
      password: u.password || undefined,
      // BullMQ requires this to be null for blocking commands.
      maxRetriesPerRequest: null as any,
    };
  } catch {
    return { host: 'redis', port: 6379, maxRetriesPerRequest: null as any };
  }
}

function tryInitQueue(): QueueLike | null {
  if (queue || initTried) return queue;
  initTried = true;
  const url = redisUrl();
  if (!url) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Queue } = require('bullmq');
    queue = new Queue(QUEUE_NAME, {
      connection: connectionFromUrl(url),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    }) as QueueLike;
    // eslint-disable-next-line no-console
    console.log(`[auditQueue] bullmq queue "${QUEUE_NAME}" initialized`);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[auditQueue] bullmq unavailable, using sync fallback:', e?.message || e);
    queue = null;
  }
  return queue;
}

// Strip non-serializable fields (e.g. the log function) before enqueue.
function serializable(input: AuditInput): Omit<AuditInput, 'log'> {
  const { log: _log, ...rest } = input;
  return rest;
}

export async function enqueueAudit(input: AuditInput): Promise<boolean> {
  const q = tryInitQueue();
  if (!q) {
    // Sync fallback — preserves existing behavior when Redis is unreachable.
    return writeAudit(input);
  }
  try {
    await q.add('write', serializable(input), {});
    return true;
  } catch (e: any) {
    if (input.log?.warn) input.log.warn({ err: e }, 'audit enqueue failed, writing sync');
    else console.warn('[auditQueue] enqueue failed, sync fallback:', e?.message || e);
    return writeAudit(input);
  }
}

export function startAuditWorker(logger?: { warn: (o: any, m?: string) => void; info?: (o: any, m?: string) => void }) {
  if (worker) return worker;
  const url = redisUrl();
  if (!url) {
    // eslint-disable-next-line no-console
    console.log('[auditQueue] REDIS_URL unset — worker disabled (sync fallback in effect)');
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Worker } = require('bullmq');
    const w = new Worker(
      QUEUE_NAME,
      async (job: any) => {
        const ok = await writeAudit(job.data as AuditInput);
        if (!ok) throw new Error('writeAudit returned false');
        return { ok: true };
      },
      {
        connection: connectionFromUrl(url),
        concurrency: 4,
      },
    );
    w.on('failed', (job: any, err: any) => {
      const msg = err?.message || String(err);
      if (logger?.warn) logger.warn({ jobId: job?.id, err: msg }, 'audit job failed');
      else console.warn('[auditQueue] job failed', job?.id, msg);
    });
    w.on('ready', () => {
      if (logger?.info) logger.info('[auditQueue] worker ready (concurrency=4)');
      else console.log('[auditQueue] worker ready (concurrency=4)');
    });
    worker = w as WorkerLike;
    return worker;
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[auditQueue] worker boot failed, sync fallback in effect:', e?.message || e);
    worker = null;
    return null;
  }
}

// Return pending audit-queue depth (wait + active). Returns null when
// BullMQ is unavailable (REDIS_URL unset or queue not initialized).
export async function getAuditQueueDepth(): Promise<number | null> {
  const q: any = tryInitQueue();
  if (!q || typeof q.getJobCounts !== 'function') return null;
  try {
    const counts = await q.getJobCounts('wait', 'active');
    return (counts?.wait || 0) + (counts?.active || 0);
  } catch {
    return null;
  }
}

export async function stopAuditWorker() {
  try {
    if (worker) await worker.close();
  } catch {}
  try {
    if (queue) await queue.close();
  } catch {}
  worker = null;
  queue = null;
  initTried = false;
}
