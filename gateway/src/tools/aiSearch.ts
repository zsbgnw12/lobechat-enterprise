import { registerTool, z } from './registry';
import { httpJson, isMock } from './http';
import { env } from '../env';

type Provider = 'serper' | 'jina';

function currentProvider(): Provider {
  const v = (process.env.SEARCH_PROVIDER || 'serper').toLowerCase();
  return v === 'jina' ? 'jina' : 'serper';
}

async function serperSearch(query: string, top: number) {
  const r = await httpJson(`${env.AI_SEARCH_URL}/search`, {
    method: 'POST',
    headers: { 'X-API-KEY': env.AI_SEARCH_KEY },
    body: { q: query, num: top },
  });
  const organic: any[] = Array.isArray(r?.organic) ? r.organic : [];
  return organic.map((item: any) => ({
    title: item.title ?? '',
    link: item.link ?? '',
    snippet: item.snippet ?? '',
    position: item.position ?? 0,
  }));
}

async function jinaSearch(_query: string, _top: number): Promise<any[]> {
  throw new Error('provider jina not yet implemented');
}

registerTool({
  key: 'ai_search.web',
  applyFilter: false,
  inputSchema: z.object({ query: z.string(), top: z.number().int().min(1).max(10).default(5) }),
  async run(_ctx, params) {
    const provider = currentProvider();
    if (!isMock('ai_search') && env.AI_SEARCH_URL) {
      const results =
        provider === 'jina'
          ? await jinaSearch(params.query, params.top)
          : await serperSearch(params.query, params.top);
      return { provider, results };
    }
    return {
      provider,
      results: [
        { title: `Hit 1 for ${params.query}`, link: 'https://example.com/a', snippet: 'mock web hit', position: 1 },
        { title: `Hit 2 for ${params.query}`, link: 'https://example.com/b', snippet: 'mock web hit', position: 2 },
        { title: `Hit 3 for ${params.query}`, link: 'https://example.com/c', snippet: 'mock web hit', position: 3 },
      ],
    };
  },
});
