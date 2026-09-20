import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isSkillHubConfigured, SkillHubClient, SkillHubNotConfiguredError } from './client';

describe('SkillHubClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('SKILLHUB_URL', 'https://skillhub.example');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reports configured only when SKILLHUB_URL is set', () => {
    expect(isSkillHubConfigured()).toBe(true);
    vi.stubEnv('SKILLHUB_URL', '');
    expect(isSkillHubConfigured()).toBe(false);
  });

  it('throws when downloading without SKILLHUB_URL', async () => {
    vi.stubEnv('SKILLHUB_URL', '');
    const client = new SkillHubClient();
    await expect(client.downloadZip('docx')).rejects.toBeInstanceOf(SkillHubNotConfiguredError);
  });

  it('searches via ClawHub /api/v1/search after well-known discovery', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiBase: '/api/v1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [{ slug: 'office--docx', displayName: 'docx', summary: 'Word files' }],
        }),
      });

    const client = new SkillHubClient();
    const hits = await client.search('docx');

    expect(hits).toEqual([
      { description: 'Word files', name: 'docx', slug: 'office--docx', version: undefined },
    ]);
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://skillhub.example/api/v1/search?q=docx',
    );
  });

  it('downloads zip bytes and sends the bearer token', async () => {
    vi.stubEnv('SKILLHUB_TOKEN', 'sk_test');
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/zip' },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        status: 200,
      });

    const client = new SkillHubClient();
    const zip = await client.downloadZip('docx', '1.0.0');

    expect(zip.equals(Buffer.from([1, 2, 3]))).toBe(true);
    const downloadInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect((downloadInit.headers as Record<string, string>).Authorization).toBe('Bearer sk_test');
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      'https://skillhub.example/api/v1/download?slug=docx&version=1.0.0',
    );
  });

  it('rejects GitHub-hosted JSON handoff downloads', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiBase: '/api/v1' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({
          gitUrl: 'https://github.com/anthropics/skills/tree/main/skills/docx',
          type: 'public-github',
        }),
      });

    const client = new SkillHubClient();
    await expect(client.downloadZip('docx')).rejects.toThrow(/Import from GitHub instead/);
  });

  it('rejects invalid slugs', async () => {
    const client = new SkillHubClient();
    await expect(client.downloadZip('../etc/passwd')).rejects.toThrow('Invalid SkillHub slug');
  });
});
