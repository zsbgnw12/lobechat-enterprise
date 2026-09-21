import type { SkillHubSearchHit } from '@lobechat/types';
import debug from 'debug';

// [enterprise-fork] ClawHub-compatible client for a self-hosted SkillHub registry.
const log = debug('lobe-chat:service:skillhub');

const DEFAULT_API_BASE = '/api/v1';
const REQUEST_TIMEOUT_MS = 30_000;

export type { SkillHubSearchHit } from '@lobechat/types';

export class SkillHubNotConfiguredError extends Error {
  constructor() {
    super('SkillHub is not configured. Set SKILLHUB_URL on the server.');
    this.name = 'SkillHubNotConfiguredError';
  }
}

export const isSkillHubConfigured = () => Boolean(process.env.SKILLHUB_URL?.trim());

const slugSchema = /^[A-Z0-9][\w.-]{0,127}$/i;

export const assertSkillHubSlug = (slug: string) => {
  if (!slugSchema.test(slug)) {
    throw new Error('Invalid SkillHub slug');
  }
};

const withTimeout = async (input: RequestInfo | URL, init?: RequestInit) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const readString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : undefined;

const normalizeHit = (value: unknown): SkillHubSearchHit | undefined => {
  const record = asRecord(value);
  if (!record) return undefined;
  const slug = readString(record.slug) ?? readString(record.name);
  if (!slug) return undefined;
  return {
    description: readString(record.description) ?? readString(record.summary),
    name: readString(record.displayName) ?? readString(record.name) ?? slug,
    slug,
    version: readString(record.version),
  };
};

const extractHits = (payload: unknown): SkillHubSearchHit[] => {
  if (Array.isArray(payload)) {
    return payload.map(normalizeHit).filter((hit): hit is SkillHubSearchHit => Boolean(hit));
  }

  const record = asRecord(payload);
  if (!record) return [];

  const candidates = [record.results, record.items, record.skills, record.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(normalizeHit).filter((hit): hit is SkillHubSearchHit => Boolean(hit));
    }
  }

  return [];
};

export class SkillHubClient {
  constructor(private readonly options?: { baseUrl?: string; token?: string }) {}

  get configured() {
    return Boolean(this.baseUrlOrUndefined);
  }

  get registryOrigin() {
    return this.baseUrl;
  }

  private get baseUrlOrUndefined() {
    return (this.options?.baseUrl ?? process.env.SKILLHUB_URL)?.trim() || undefined;
  }

  private get baseUrl() {
    const url = this.baseUrlOrUndefined;
    if (!url) throw new SkillHubNotConfiguredError();
    return url.replace(/\/+$/, '');
  }

  private get token() {
    return this.options?.token ?? process.env.SKILLHUB_TOKEN?.trim();
  }

  private headers(accept: string): HeadersInit {
    const headers: Record<string, string> = {
      'Accept': accept,
      'User-Agent': 'heihub-skillhub-client',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  async resolveApiBase(): Promise<string> {
    const root = this.baseUrl;
    try {
      const response = await withTimeout(`${root}/.well-known/clawhub.json`, {
        headers: this.headers('application/json'),
      });
      if (response.ok) {
        const body = asRecord(await response.json());
        const apiBase = readString(body?.apiBase) ?? DEFAULT_API_BASE;
        if (apiBase.startsWith('http://') || apiBase.startsWith('https://')) {
          return apiBase.replace(/\/+$/, '');
        }
        return `${root}${apiBase.startsWith('/') ? apiBase : `/${apiBase}`}`.replace(/\/+$/, '');
      }
    } catch (error) {
      log(
        'resolveApiBase: well-known lookup failed, falling back to /api/v1: %s',
        (error as Error).message,
      );
    }
    return `${root}${DEFAULT_API_BASE}`;
  }

  async search(query: string): Promise<SkillHubSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const apiBase = await this.resolveApiBase();
    const url = new URL(`${apiBase}/search`);
    url.searchParams.set('q', trimmed);

    log('search: %s', url.toString());
    const response = await withTimeout(url, { headers: this.headers('application/json') });
    if (!response.ok) {
      throw new Error(`SkillHub search failed: ${response.status} ${response.statusText}`);
    }

    return extractHits(await response.json());
  }

  async list(limit = 50): Promise<SkillHubSearchHit[]> {
    const apiBase = await this.resolveApiBase();
    const url = new URL(`${apiBase}/skills`);
    const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
    url.searchParams.set('limit', String(safeLimit));
    url.searchParams.set('sort', 'updated');

    log('list: %s', url.toString());
    const response = await withTimeout(url, { headers: this.headers('application/json') });
    if (!response.ok) {
      throw new Error(`SkillHub list failed: ${response.status} ${response.statusText}`);
    }

    return extractHits(await response.json());
  }

  async downloadZip(slug: string, version?: string): Promise<Buffer> {
    assertSkillHubSlug(slug);
    const apiBase = await this.resolveApiBase();
    const url = new URL(`${apiBase}/download`);
    url.searchParams.set('slug', slug);
    if (version) url.searchParams.set('version', version);

    log('downloadZip: %s', url.toString());
    const response = await withTimeout(url, { headers: this.headers('*/*') });
    if (response.status === 404) {
      throw new Error(`SkillHub skill not found: ${slug}`);
    }
    if (!response.ok) {
      throw new Error(`SkillHub download failed: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = asRecord(await response.json());
      const gitUrl =
        readString(body?.url) ?? readString(body?.gitUrl) ?? readString(body?.githubUrl);
      throw new Error(
        gitUrl
          ? `SkillHub returned a GitHub-hosted package. Import from GitHub instead: ${gitUrl}`
          : 'SkillHub returned a GitHub-hosted package. Import from GitHub instead.',
      );
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
