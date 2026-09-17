// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GitHub,
  github,
  GitHubDownloadError,
  GitHubNotFoundError,
  GitHubParseError,
} from './index';

describe('GitHub', () => {
  describe('parseRepoUrl', () => {
    const gh = new GitHub();

    it('should parse standard GitHub URL', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with tree/branch', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat/tree/develop');
      expect(result).toEqual({
        branch: 'develop',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with tree/branch and path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/lobehub/lobe-chat/tree/feature/new-ui/src/components',
      );
      expect(result).toEqual({
        branch: 'feature',
        owner: 'lobehub',
        path: 'new-ui/src/components',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    // When URL contains subdirectory path like /tree/main/skills/skill-creator,
    // the path should be captured and returned
    it('should capture subdirectory path from GitHub URL', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/openclaw/openclaw/tree/main/skills/skill-creator',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'openclaw',
        path: 'skills/skill-creator',
        refKind: 'branch',
        repo: 'openclaw',
      });
    });

    it('should capture nested subdirectory path from GitHub URL', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/lobehub/skills/tree/develop/agents/coding/python-expert',
      );
      expect(result).toEqual({
        branch: 'develop',
        owner: 'lobehub',
        path: 'agents/coding/python-expert',
        refKind: 'branch',
        repo: 'skills',
      });
    });

    it('should not have path when URL has no subdirectory', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat/tree/main');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
      expect(result.path).toBeUndefined();
    });

    it('should parse /blob/ URL and strip file name to get directory path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/kepano/obsidian-skills/blob/main/skills/json-canvas/SKILL.md',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'kepano',
        path: 'skills/json-canvas',
        refKind: 'branch',
        repo: 'obsidian-skills',
      });
    });

    it('should parse /blob/ URL pointing to a file at repo root (no subdirectory)', () => {
      const result = gh.parseRepoUrl('https://github.com/owner/repo/blob/main/SKILL.md');
      expect(result).toEqual({
        branch: 'main',
        owner: 'owner',
        refKind: 'branch',
        repo: 'repo',
      });
      expect(result.path).toBeUndefined();
    });

    it('should parse /blob/ URL with nested path', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/anthropics/skills/blob/main/skills/pptx/SKILL.md',
      );
      expect(result).toEqual({
        branch: 'main',
        owner: 'anthropics',
        path: 'skills/pptx',
        refKind: 'branch',
        repo: 'skills',
      });
    });

    it('should parse GitHub URL without protocol', () => {
      const result = gh.parseRepoUrl('github.com/lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should parse GitHub URL with .git suffix', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat.git');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should parse a commit URL', () => {
      const result = gh.parseRepoUrl(
        'https://github.com/lobehub/lobe-chat/commit/0123456789abcdef0123456789abcdef01234567',
      );
      expect(result).toEqual({
        branch: '0123456789abcdef0123456789abcdef01234567',
        owner: 'lobehub',
        refKind: 'commit',
        repo: 'lobe-chat',
      });
    });

    it('should parse a release tag URL', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat/releases/tag/v1.2.3');
      expect(result).toEqual({
        branch: 'v1.2.3',
        owner: 'lobehub',
        refKind: 'tag',
        repo: 'lobe-chat',
      });
    });

    it('should treat a 40-char hex tree ref as a commit', () => {
      const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const result = gh.parseRepoUrl(`https://github.com/lobehub/lobe-chat/tree/${sha}`);
      expect(result.refKind).toBe('commit');
      expect(result.branch).toBe(sha);
    });

    it('should parse shorthand format (owner/repo)', () => {
      const result = gh.parseRepoUrl('lobehub/lobe-chat');
      expect(result).toEqual({
        branch: 'main',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should use custom default branch', () => {
      const result = gh.parseRepoUrl('https://github.com/lobehub/lobe-chat', 'dev');
      expect(result).toEqual({
        branch: 'dev',
        owner: 'lobehub',
        refKind: 'branch',
        repo: 'lobe-chat',
      });
    });

    it('should handle repo names with dots and hyphens', () => {
      const result = gh.parseRepoUrl('https://github.com/owner-name/repo.name-v2');
      expect(result).toEqual({
        branch: 'main',
        owner: 'owner-name',
        refKind: 'branch',
        repo: 'repo.name-v2',
      });
    });

    it('should throw GitHubParseError for invalid URL', () => {
      expect(() => gh.parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(GitHubParseError);
      expect(() => gh.parseRepoUrl('invalid-url')).toThrow(GitHubParseError);
      expect(() => gh.parseRepoUrl('https://github.com/')).toThrow(GitHubParseError);
    });
  });

  describe('buildRepoZipUrl', () => {
    const gh = new GitHub();

    it('should build correct ZIP URL', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe('https://github.com/lobehub/lobe-chat/archive/refs/heads/main.zip');
    });

    it('should handle different branches', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'feature/new-ui',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe(
        'https://github.com/lobehub/lobe-chat/archive/refs/heads/feature/new-ui.zip',
      );
    });

    it('should pin a resolved commit SHA', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'main',
        commitSha: '0123456789abcdef0123456789abcdef01234567',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe(
        'https://github.com/lobehub/lobe-chat/archive/0123456789abcdef0123456789abcdef01234567.zip',
      );
    });

    it('should use refs/tags for tag refs', () => {
      const url = gh.buildRepoZipUrl({
        branch: 'v1.2.3',
        owner: 'lobehub',
        refKind: 'tag',
        repo: 'lobe-chat',
      });
      expect(url).toBe('https://github.com/lobehub/lobe-chat/archive/refs/tags/v1.2.3.zip');
    });
  });

  describe('buildRawFileUrl', () => {
    const gh = new GitHub();

    it('should build correct raw file URL', () => {
      const url = gh.buildRawFileUrl({
        branch: 'main',
        filePath: 'README.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe('https://raw.githubusercontent.com/lobehub/lobe-chat/main/README.md');
    });

    it('should handle nested file paths', () => {
      const url = gh.buildRawFileUrl({
        branch: 'develop',
        filePath: 'src/components/Button/index.tsx',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(url).toBe(
        'https://raw.githubusercontent.com/lobehub/lobe-chat/develop/src/components/Button/index.tsx',
      );
    });
  });

  describe('downloadRepoZip', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    it('should download repository ZIP successfully', async () => {
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      const result = await gh.downloadRepoZip({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBeInstanceOf(Buffer);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://github.com/lobehub/lobe-chat/archive/refs/heads/main.zip',
        {
          headers: {
            'User-Agent': 'heihub',
          },
        },
      );
    });

    it('should throw GitHubNotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        gh.downloadRepoZip({
          branch: 'main',
          owner: 'lobehub',
          repo: 'non-existent',
        }),
      ).rejects.toThrow(GitHubNotFoundError);
    });

    it('should throw GitHubDownloadError for other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await expect(
        gh.downloadRepoZip({
          branch: 'main',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubDownloadError);
    });

    it('should use custom user agent', async () => {
      const customGh = new GitHub({ userAgent: 'CustomAgent/1.0' });
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      await customGh.downloadRepoZip({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
        headers: {
          'User-Agent': 'CustomAgent/1.0',
        },
      });
    });

    it('should send a bearer token when SKILL_GITHUB_TOKEN is set', async () => {
      vi.stubEnv('SKILL_GITHUB_TOKEN', 'ghp_test_token');
      const mockBuffer = new ArrayBuffer(100);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      await gh.downloadRepoZip({
        branch: 'main',
        owner: 'lobehub',
        repo: 'private-skills',
      });

      expect(mockFetch).toHaveBeenCalledWith(expect.any(String), {
        headers: {
          'Authorization': 'Bearer ghp_test_token',
          'User-Agent': 'heihub',
        },
      });
    });
  });

  describe('downloadRawFile', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should download raw file successfully', async () => {
      const mockContent = '# README\n\nThis is a test.';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(mockContent),
      });

      const result = await gh.downloadRawFile({
        branch: 'main',
        filePath: 'README.md',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe(mockContent);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/lobehub/lobe-chat/main/README.md',
        {
          headers: {
            'User-Agent': 'heihub',
          },
        },
      );
    });

    it('should throw GitHubNotFoundError for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(
        gh.downloadRawFile({
          branch: 'main',
          filePath: 'non-existent.md',
          owner: 'lobehub',
          repo: 'lobe-chat',
        }),
      ).rejects.toThrow(GitHubNotFoundError);
    });
  });

  describe('downloadRawFileBuffer', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should download raw file as buffer successfully', async () => {
      const mockBuffer = new ArrayBuffer(50);
      mockFetch.mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(mockBuffer),
        ok: true,
      });

      const result = await gh.downloadRawFileBuffer({
        branch: 'main',
        filePath: 'image.png',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('resolveCommitSha', () => {
    const gh = new GitHub();
    const mockFetch = vi.fn();

    beforeEach(() => {
      vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('should return a pinned SHA without calling the API', async () => {
      const sha = '0123456789abcdef0123456789abcdef01234567';
      const result = await gh.resolveCommitSha({
        branch: 'main',
        commitSha: sha,
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(result).toBe(sha);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should resolve a branch via the commits API', async () => {
      const sha = 'abcdefabcdefabcdefabcdefabcdefabcdefabcd';
      mockFetch.mockResolvedValueOnce({
        json: () => Promise.resolve({ sha }),
        ok: true,
      });

      const result = await gh.resolveCommitSha({
        branch: 'main',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });

      expect(result).toBe(sha);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.github.com/repos/lobehub/lobe-chat/commits/main',
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it('should return undefined when the API fails', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
      const result = await gh.resolveCommitSha({
        branch: 'missing',
        owner: 'lobehub',
        repo: 'lobe-chat',
      });
      expect(result).toBeUndefined();
    });
  });

  describe('github singleton', () => {
    it('should be an instance of GitHub', () => {
      expect(github).toBeInstanceOf(GitHub);
    });
  });
});
