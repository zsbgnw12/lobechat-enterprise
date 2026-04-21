import { request } from 'undici';
import { env } from '../env';

export async function httpJson(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: any; timeoutMs?: number } = {},
): Promise<any> {
  const res = await request(url, {
    method: (opts.method as any) || 'GET',
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    bodyTimeout: opts.timeoutMs ?? 8000,
    headersTimeout: opts.timeoutMs ?? 8000,
  });
  const text = await res.body.text();
  if (res.statusCode >= 400) throw new Error(`upstream ${res.statusCode}: ${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const familyEnvKey = {
  gongdan: 'GONGDAN_MOCK',
  xiaoshou: 'XIAOSHOU_MOCK',
  cloudcost: 'CLOUDCOST_MOCK',
  kb: 'KB_MOCK',
  ai_search: 'AI_SEARCH_MOCK',
  sandbox: 'SANDBOX_MOCK',
  doc: 'DOC_AGENT_MOCK',
} as const;

export function isMock(family?: keyof typeof familyEnvKey): boolean {
  if (family) {
    const override = process.env[familyEnvKey[family]];
    if (typeof override === 'string' && override.length > 0) {
      return override.toLowerCase() !== 'false';
    }
  }
  return env.MOCK_MODE;
}
