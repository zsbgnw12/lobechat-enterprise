import debug from 'debug';

const log = debug('lobe-chat:module:github');

const FULL_COMMIT_SHA = /^[0-9a-f]{40}$/i;

export type GitHubRefKind = 'branch' | 'tag' | 'commit';

export interface GitHubRepoInfo {
  branch: string;
  commitSha?: string;
  owner: string;
  /**
   * Subdirectory path within the repository (e.g., 'skills/skill-creator')
   * Extracted from URLs like: https://github.com/owner/repo/tree/branch/path/to/dir
   */
  path?: string;
  refKind?: GitHubRefKind;
  repo: string;
}

export interface GitHubRawFileInfo extends GitHubRepoInfo {
  filePath: string;
}

export class GitHub {
  private readonly userAgent: string;
  private readonly token?: string;

  constructor(options?: { token?: string; userAgent?: string }) {
    this.userAgent = options?.userAgent || 'heihub';
    this.token = options?.token;
  }

  /**
   * Parse GitHub URL to extract owner, repo, ref, and optional path
   * Supports:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/branch
   * - https://github.com/owner/repo/tree/branch/path/to/dir
   * - https://github.com/owner/repo/blob/branch/path/to/file.md
   * - https://github.com/owner/repo/commit/{sha}
   * - https://github.com/owner/repo/releases/tag/{tag}
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   * - https://github.com/owner/repo.git
   */
  parseRepoUrl(url: string, defaultBranch = 'main'): GitHubRepoInfo {
    log('parseRepoUrl: input url=%s, defaultBranch=%s', url, defaultBranch);

    // Handle shorthand format: owner/repo
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
      const [owner, repo] = url.split('/');
      const result: GitHubRepoInfo = { branch: defaultBranch, owner, refKind: 'branch', repo };
      log('parseRepoUrl: matched shorthand format, result=%o', result);
      return result;
    }

    const stripped = url.replace(/\.git$/, '');

    const commitMatch = stripped.match(
      /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/commit\/([0-9a-f]{7,40})\/?$/i,
    );
    if (commitMatch) {
      const result: GitHubRepoInfo = {
        branch: commitMatch[3],
        owner: commitMatch[1],
        refKind: 'commit',
        repo: commitMatch[2],
      };
      log('parseRepoUrl: matched commit URL, result=%o', result);
      return result;
    }

    const tagMatch = stripped.match(
      /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)\/releases\/tag\/([^/]+)\/?$/,
    );
    if (tagMatch) {
      const result: GitHubRepoInfo = {
        branch: decodeURIComponent(tagMatch[3]),
        owner: tagMatch[1],
        refKind: 'tag',
        repo: tagMatch[2],
      };
      log('parseRepoUrl: matched release tag URL, result=%o', result);
      return result;
    }

    // Capture: owner, repo, type (tree/blob), branch, and optional path after branch
    const match = stripped.match(
      /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)(?:\/(tree|blob)\/([^/]+)(?:\/(.+))?)?$/,
    );

    if (!match) {
      log('parseRepoUrl: failed to parse url=%s', url);
      throw new GitHubParseError(`Invalid GitHub URL format: ${url}`);
    }

    const [, owner, repo, urlType, branch, rawPath] = match;
    const ref = branch || defaultBranch;
    const result: GitHubRepoInfo = {
      branch: ref,
      owner,
      refKind: FULL_COMMIT_SHA.test(ref) ? 'commit' : 'branch',
      repo: repo.replace(/\.git$/, ''),
    };

    // Process path: for /blob/ URLs pointing to a file, strip the file name to get the directory
    if (rawPath) {
      let path = rawPath;
      if (urlType === 'blob') {
        // Strip trailing file name (e.g. "skills/json-canvas/SKILL.md" -> "skills/json-canvas")
        const lastSlash = path.lastIndexOf('/');
        if (lastSlash > 0) {
          path = path.slice(0, lastSlash);
        } else {
          // The path is just a file at the repo root, no subdirectory
          path = '';
        }
      }
      if (path) {
        result.path = path;
      }
    }

    log('parseRepoUrl: matched full URL format, result=%o', result);
    return result;
  }

  /**
   * Generate skill identifier from repo info
   *
   * Format: {owner}-{repo}-{skillName}
   * The skill name is the last segment of the path (directory name).
   * All parts are lowercased and joined with hyphens.
   */
  generateIdentifier(info: GitHubRepoInfo): string {
    const parts = [
      this.normalizeIdentifierPart(info.owner),
      this.normalizeIdentifierPart(info.repo),
    ];

    if (info.path) {
      const lastSegment = info.path.split('/').findLast(Boolean);
      if (lastSegment) {
        parts.push(this.normalizeIdentifierPart(lastSegment));
      }
    }

    return parts.join('-').toLowerCase();
  }

  /**
   * Normalize a string for use as part of a skill identifier.
   * Replaces non-alphanumeric characters (except hyphens) with hyphens,
   * collapses consecutive hyphens, and trims leading/trailing hyphens.
   */
  private normalizeIdentifierPart(part: string): string {
    return part
      .replaceAll(/[^\w-]/g, '-')
      .replaceAll(/-+/g, '-')
      .replaceAll(/^-|-$/g, '');
  }

  /**
   * Build the ZIP download URL for a GitHub repository.
   * Prefers a resolved commit SHA so the archive is pinned.
   */
  buildRepoZipUrl(info: GitHubRepoInfo): string {
    const { owner, repo } = info;
    if (info.commitSha) {
      return `https://github.com/${owner}/${repo}/archive/${info.commitSha}.zip`;
    }
    if (info.refKind === 'tag') {
      return `https://github.com/${owner}/${repo}/archive/refs/tags/${info.branch}.zip`;
    }
    if (info.refKind === 'commit' || FULL_COMMIT_SHA.test(info.branch)) {
      return `https://github.com/${owner}/${repo}/archive/${info.branch}.zip`;
    }
    return `https://github.com/${owner}/${repo}/archive/refs/heads/${info.branch}.zip`;
  }

  /**
   * Build the raw file URL for a GitHub repository
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    const ref = info.commitSha || info.branch;
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${ref}/${info.filePath}`;
  }

  /**
   * Resolve a branch / tag / SHA to a full commit SHA via the GitHub API.
   * Returns undefined when the API is unreachable so callers can still
   * fall back to downloading the named ref.
   */
  async resolveCommitSha(info: GitHubRepoInfo): Promise<string | undefined> {
    if (info.commitSha) return info.commitSha;
    if (FULL_COMMIT_SHA.test(info.branch)) return info.branch.toLowerCase();

    const ref = encodeURIComponent(info.branch);
    const apiUrl = `https://api.github.com/repos/${info.owner}/${info.repo}/commits/${ref}`;
    log('resolveCommitSha: fetching url=%s', apiUrl);

    try {
      const response = await fetch(apiUrl, { headers: this.requestHeaders() });
      if (!response.ok) {
        log('resolveCommitSha: status=%d', response.status);
        return undefined;
      }
      const body = (await response.json()) as { sha?: string };
      if (typeof body.sha === 'string' && FULL_COMMIT_SHA.test(body.sha)) {
        return body.sha.toLowerCase();
      }
      return undefined;
    } catch (error) {
      log('resolveCommitSha: failed %s', (error as Error).message);
      return undefined;
    }
  }

  /**
   * Download repository as ZIP buffer
   */
  async downloadRepoZip(info: GitHubRepoInfo): Promise<Buffer> {
    const zipUrl = this.buildRepoZipUrl(info);
    log('downloadRepoZip: fetching url=%s', zipUrl);

    const response = await fetch(zipUrl, {
      headers: this.requestHeaders(),
    });

    log('downloadRepoZip: response status=%d, ok=%s', response.status, response.ok);

    if (!response.ok) {
      if (response.status === 404) {
        log('downloadRepoZip: repository not found');
        throw new GitHubNotFoundError(
          `Repository not found: ${info.owner}/${info.repo}@${info.commitSha || info.branch}`,
        );
      }
      log('downloadRepoZip: download failed with status=%d', response.status);
      throw new GitHubDownloadError(
        `Failed to download repository: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    log('downloadRepoZip: downloaded %d bytes', buffer.length);
    return buffer;
  }

  /**
   * Download a single raw file from GitHub
   */
  async downloadRawFile(info: GitHubRawFileInfo): Promise<string> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: this.requestHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    return response.text();
  }

  /**
   * Download a single raw file as buffer from GitHub
   */
  async downloadRawFileBuffer(info: GitHubRawFileInfo): Promise<Buffer> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: this.requestHeaders(),
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.userAgent,
    };
    const token = this.token ?? process.env.SKILL_GITHUB_TOKEN;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  }
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubParseError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubParseError';
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubDownloadError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubDownloadError';
  }
}

export const github = new GitHub();
