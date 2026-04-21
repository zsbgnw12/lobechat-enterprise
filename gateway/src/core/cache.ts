// Thin cache abstraction: Redis when REDIS_URL is set, else in-memory Map.
// Used to cut DB hits for policy/capability resolution.
import type Redis from 'ioredis';

type Entry = { value: string; expiresAt: number };

interface Backend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  invalidate(prefix: string): Promise<void>;
}

class MemoryBackend implements Backend {
  private store = new Map<string, Entry>();
  async get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return e.value;
  }
  async set(key: string, value: string, ttlSec: number) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }
  async del(key: string) {
    this.store.delete(key);
  }
  async invalidate(prefix: string) {
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }
}

class RedisBackend implements Backend {
  constructor(private client: Redis) {}
  async get(key: string) {
    return this.client.get(key);
  }
  async set(key: string, value: string, ttlSec: number) {
    await this.client.set(key, value, 'EX', ttlSec);
  }
  async del(key: string) {
    await this.client.del(key);
  }
  async invalidate(prefix: string) {
    // SCAN to avoid blocking; small key-space in practice.
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await this.client.del(...keys);
    } while (cursor !== '0');
  }
}

let backend: Backend;
const url = process.env.REDIS_URL;
if (url) {
  try {
    // lazy require so tests without ioredis installed don't explode
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    const client: Redis = new IORedis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
    client.on('error', (e: any) => {
      // eslint-disable-next-line no-console
      console.error('[cache] redis error', e?.message || e);
    });
    backend = new RedisBackend(client);
    // eslint-disable-next-line no-console
    console.log(`[cache] using redis ${url}`);
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.warn('[cache] ioredis unavailable, falling back to memory:', e?.message || e);
    backend = new MemoryBackend();
  }
} else {
  backend = new MemoryBackend();
}

export const cache = {
  async getJSON<T = any>(key: string): Promise<T | null> {
    const raw = await backend.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  async setJSON(key: string, value: any, ttlSec: number) {
    await backend.set(key, JSON.stringify(value), ttlSec);
  },
  async del(key: string) {
    await backend.del(key);
  },
  async invalidate(prefix: string) {
    await backend.invalidate(prefix);
  },
};
