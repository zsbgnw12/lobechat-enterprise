import { createHash } from 'crypto';
import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';
import { cache } from '../core/cache';

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

async function callUpstreamWithRetry(
  query: string,
  top: number,
  searchMode: string,
): Promise<{ data: any; attempts: number }> {
  const delays = [1000, 3000];
  let lastErr: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await httpJson(`${env.KB_AGENT_URL}/api/v1/search`, {
        method: 'POST',
        headers: { 'api-key': env.KB_API_KEY },
        body: { query, top, search_mode: searchMode },
        timeoutMs: 20000,
      });
      return { data: r, attempts: attempt };
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || e);
      const is5xx = /upstream 5\d\d/.test(msg);
      const isTimeout = /timeout|UND_ERR|ECONN|ETIMEDOUT|aborted/i.test(msg);
      if (attempt < 3 && (is5xx || isTimeout)) {
        await new Promise((r) => setTimeout(r, delays[attempt - 1]));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

registerTool({
  key: 'kb.search',
  applyFilter: false,
  inputSchema: z.object({ query: z.string(), top: z.number().int().min(1).max(20).optional() }),
  async run(_ctx, params) {
    if (!isMock('kb') && env.KB_AGENT_URL) {
      const top = params.top ?? 5;
      const searchMode = 'hybrid';
      const noCache = (process.env.KB_NO_CACHE || 'false').toLowerCase() === 'true';
      const cacheKey = `kb:v1:${sha1(`${params.query}|${top}|${searchMode}`)}`;

      if (!noCache) {
        const cached = await cache.getJSON<{ results: any[]; attempts: number }>(cacheKey);
        if (cached) {
          return {
            results: cached.results,
            meta: { cached: true, attempts: cached.attempts },
          };
        }
      }

      const { data: r, attempts } = await callUpstreamWithRetry(params.query, top, searchMode);
      let results: any[];
      if (Array.isArray(r?.results)) {
        results = r.results.map((item: any) => ({
          id: item.id,
          title: item.title,
          snippet: item.content,
          score: item.score,
          url: item.url,
          category: item.category,
          project: item.project,
        }));
      } else {
        results = Array.isArray(r) ? r : [r];
      }

      if (!noCache) {
        await cache.setJSON(cacheKey, { results, attempts }, 60);
      }
      return {
        results,
        meta: { cached: false, attempts },
      };
    }
    return [
      { id: 'KB-1', title: `Result A for "${params.query}"`, snippet: 'mock kb hit', score: 0.92 },
      { id: 'KB-2', title: `Result B for "${params.query}"`, snippet: 'mock kb hit', score: 0.85 },
    ];
  },
});
