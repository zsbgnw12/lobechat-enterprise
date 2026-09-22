import { readFile } from 'node:fs/promises';

import { type LobeChatDatabase } from '@lobechat/database';
import {
  type CreateSkillInput,
  type ImportGitHubInput,
  type ImportSkillHubInput,
  type ImportUrlInput,
  type ImportZipInput,
  type SkillImportResult,
  type SkillManifest,
} from '@lobechat/types';
import { nanoid } from '@lobechat/utils';
import debug from 'debug';

import { AgentSkillModel } from '@/database/models/agentSkill';
import type { GitHubRepoInfo } from '@/server/modules/GitHub';
import { GitHub, GitHubNotFoundError, GitHubParseError } from '@/server/modules/GitHub';
import { FileService } from '@/server/services/file';
import { SkillHubClient, SkillHubNotConfiguredError } from '@/server/services/skillHub/client';

import { listBundledSkillDirs, zipSkillDir } from './bundled';
import { SkillImportError, SkillManifestError } from './errors';
import { SkillParser } from './parser';
import { SkillResourceService } from './resource';

const log = debug('lobe-chat:service:skill-importer');

export class SkillImporter {
  private skillModel: AgentSkillModel;
  private parser: SkillParser;
  private resourceService: SkillResourceService;
  private fileService: FileService;
  private github: GitHub;
  private skillHub: SkillHubClient;
  private userId: string;

  constructor(db: LobeChatDatabase, userId: string) {
    this.skillModel = new AgentSkillModel(db, userId);
    this.parser = new SkillParser();
    this.resourceService = new SkillResourceService(db, userId);
    this.fileService = new FileService(db, userId);
    this.github = new GitHub({ userAgent: 'heihub-skill-importer' });
    this.skillHub = new SkillHubClient();
    this.userId = userId;
  }

  /**
   * Create a skill manually by user
   */
  async createUserSkill(input: CreateSkillInput) {
    // Check if name already exists for this user
    const existingByName = await this.skillModel.findByName(input.name);
    if (existingByName) {
      throw new SkillImportError(`Skill with name "${input.name}" already exists`, 'CONFLICT');
    }

    const identifier = input.identifier || `user.${nanoid(12)}`;

    // Check if identifier already exists
    const existingByIdentifier = await this.skillModel.findByIdentifier(identifier);
    if (existingByIdentifier) {
      throw new SkillImportError(
        `Skill with identifier "${identifier}" already exists`,
        'CONFLICT',
      );
    }

    const manifest: SkillManifest = {
      description: input.description || '',
      name: input.name,
    };

    return this.skillModel.create({
      content: input.content,
      description: input.description,
      identifier,
      manifest,
      name: input.name,
      source: 'user',
    });
  }

  /**
   * Import skill from ZIP file
   * @param input - Contains zipFileId from files table
   * @returns SkillImportResult with status: 'created'
   */
  async importFromZip(input: ImportZipInput): Promise<SkillImportResult> {
    log('importFromZip: starting with zipFileId=%s', input.zipFileId);

    // 1. Download ZIP file to local
    const { filePath, cleanup } = await this.fileService.downloadFileToLocal(input.zipFileId);
    log('importFromZip: downloaded to filePath=%s', filePath);

    try {
      const buffer = await readFile(filePath);
      log('importFromZip: read buffer size=%d bytes', buffer.length);

      // 2. Parse ZIP package
      const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(buffer);
      log(
        'importFromZip: parsed manifest=%o, resources count=%d, zipHash=%s',
        manifest,
        resources.size,
        zipHash,
      );

      // 3. If a skill with this name already exists, update it (re-upload replaces)
      const existingByName = await this.skillModel.findByName(manifest.name);
      const identifier = existingByName?.identifier || `user.${nanoid(12)}`;
      log('importFromZip: identifier=%s existing=%s', identifier, Boolean(existingByName));

      const resourceIds = zipHash
        ? await this.resourceService.storeResources(zipHash, resources)
        : {};
      log('importFromZip: stored resources=%o', resourceIds);

      if (existingByName) {
        const skill = await this.skillModel.update(existingByName.id, {
          content,
          description: manifest.description,
          manifest,
          name: manifest.name,
          resources: resourceIds,
          zipFileHash: zipHash,
        });
        log('importFromZip: updated skill id=%s', skill.id);
        return { skill, status: 'updated' };
      }

      const skill = await this.skillModel.create({
        content,
        description: manifest.description,
        identifier,
        manifest,
        name: manifest.name,
        resources: resourceIds,
        source: 'user',
        zipFileHash: zipHash,
      });
      log('importFromZip: created skill id=%s', skill.id);
      return { skill, status: 'created' };
    } finally {
      cleanup();
      log('importFromZip: cleaned up temp file');
    }
  }

  /**
   * [enterprise-fork] Import SKILL.md packages shipped in enterprise/skills (copied into the image).
   */
  async importBundledOrgSkills(): Promise<SkillImportResult[]> {
    const dirs = await listBundledSkillDirs();
    if (dirs.length === 0) {
      throw new SkillImportError('No bundled organization skills found', 'NOT_FOUND');
    }

    const results: SkillImportResult[] = [];
    for (const dir of dirs) {
      const zipBuffer = await zipSkillDir(dir);
      const { manifest, content, resources, zipHash } = await this.parser.parseZipPackage(
        zipBuffer,
        { repackSkillZip: true },
      );
      const existingByName = await this.skillModel.findByName(manifest.name);
      const identifier = existingByName?.identifier || manifest.name;

      if (
        existingByName &&
        existingByName.zipFileHash === zipHash &&
        existingByName.content != null
      ) {
        results.push({ skill: existingByName, status: 'unchanged' });
        continue;
      }

      const resourceIds = zipHash
        ? await this.resourceService.storeResources(zipHash, resources)
        : {};

      if (existingByName) {
        const skill = await this.skillModel.update(existingByName.id, {
          content,
          description: manifest.description,
          manifest,
          name: manifest.name,
          resources: resourceIds,
          zipFileHash: zipHash,
        });
        results.push({ skill, status: 'updated' });
        continue;
      }

      const skill = await this.skillModel.create({
        content,
        description: manifest.description,
        identifier,
        manifest,
        name: manifest.name,
        resources: resourceIds,
        source: 'user',
        zipFileHash: zipHash,
      });
      results.push({ skill, status: 'created' });
    }

    return results;
  }

  /**
   * Import one or more skills from a GitHub repository.
   * A subdirectory URL imports that skill only; a repo URL imports every top-level SKILL.md.
   */
  async importFromGitHub(input: ImportGitHubInput): Promise<SkillImportResult> {
    const results = await this.importGitHubSkills(input);
    if (results.length === 0) {
      throw new SkillImportError('SKILL.md not found in repository', 'NOT_FOUND');
    }
    return results[0];
  }

  async importGitHubSkills(input: ImportGitHubInput): Promise<SkillImportResult[]> {
    log('importFromGitHub: starting with gitUrl=%s, branch=%s', input.gitUrl, input.branch);

    let repoInfo;
    try {
      repoInfo = this.github.parseRepoUrl(input.gitUrl, input.branch);
      log('importFromGitHub: parsed repoInfo=%o', repoInfo);
    } catch (error) {
      log('importFromGitHub: failed to parse URL, error=%s', (error as Error).message);
      if (error instanceof GitHubParseError) {
        throw new SkillImportError(error.message, 'INVALID_URL');
      }
      throw error;
    }

    const commitSha = await this.github.resolveCommitSha(repoInfo);
    if (commitSha) {
      repoInfo = { ...repoInfo, commitSha };
    }

    let zipBuffer;
    try {
      log('importFromGitHub: downloading repository ZIP...');
      zipBuffer = await this.github.downloadRepoZip(repoInfo);
      log('importFromGitHub: downloaded ZIP size=%d bytes', zipBuffer.length);
    } catch (error) {
      log('importFromGitHub: download failed, error=%s', (error as Error).message);
      if (error instanceof GitHubNotFoundError) {
        throw new SkillImportError(error.message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download GitHub repository: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    const parsedSkills = await this.parser.parseZipPackageAll(zipBuffer, {
      basePath: repoInfo.path,
      repackSkillZip: true,
    });
    log('importFromGitHub: parsed %d skill(s)', parsedSkills.length);

    if (parsedSkills.length === 0) {
      throw new SkillImportError('SKILL.md not found in repository', 'NOT_FOUND');
    }

    const results: SkillImportResult[] = [];
    for (const parsed of parsedSkills) {
      results.push(
        await this.upsertGitHubSkill({
          commitSha,
          gitRef: repoInfo.branch,
          gitUrl: input.gitUrl,
          parsed,
          repoInfo: {
            ...repoInfo,
            path: parsed.skillDir || repoInfo.path,
          },
        }),
      );
    }
    return results;
  }

  /**
   * Import one or more skills from a self-hosted SkillHub / ClawHub registry.
   * [enterprise-fork]
   */
  async importFromSkillHub(input: ImportSkillHubInput): Promise<SkillImportResult> {
    const results = await this.importSkillHubSkills(input);
    if (results.length === 0) {
      throw new SkillImportError('SKILL.md not found in SkillHub package', 'NOT_FOUND');
    }
    return results[0];
  }

  async importSkillHubSkills(input: ImportSkillHubInput): Promise<SkillImportResult[]> {
    if (!this.skillHub.configured) {
      throw new SkillImportError(
        'SkillHub is not configured. Set SKILLHUB_URL on the server.',
        'INVALID_URL',
      );
    }

    let zipBuffer: Buffer;
    try {
      zipBuffer = await this.skillHub.downloadZip(input.slug, input.version);
    } catch (error) {
      if (error instanceof SkillHubNotConfiguredError) {
        throw new SkillImportError(error.message, 'INVALID_URL');
      }
      const message = (error as Error).message;
      const gitUrl = message.match(/https:\/\/github\.com\/\S+/)?.[0];
      if (gitUrl) {
        log('importFromSkillHub: GitHub-hosted package, delegating to importFromGitHub %s', gitUrl);
        return this.importGitHubSkills({ gitUrl });
      }
      if (message.includes('not found')) {
        throw new SkillImportError(message, 'NOT_FOUND');
      }
      throw new SkillImportError(
        `Failed to download SkillHub package: ${message}`,
        'DOWNLOAD_FAILED',
      );
    }

    const parsedSkills = await this.parser.parseZipPackageAll(zipBuffer, {
      repackSkillZip: true,
    });
    if (parsedSkills.length === 0) {
      throw new SkillImportError('SKILL.md not found in SkillHub package', 'NOT_FOUND');
    }

    const results: SkillImportResult[] = [];
    for (const parsed of parsedSkills) {
      results.push(
        await this.upsertSkillHubSkill({ parsed, slug: input.slug, version: input.version }),
      );
    }
    return results;
  }

  private async upsertSkillHubSkill(input: {
    parsed: {
      content: string;
      manifest: SkillManifest;
      resources: Map<string, Buffer>;
      skillDir?: string;
      skillZipBuffer?: Buffer;
      zipHash?: string;
    };
    slug: string;
    version?: string;
  }): Promise<SkillImportResult> {
    const { parsed, slug, version } = input;
    const { manifest, content, resources, zipHash, skillZipBuffer } = parsed;
    const identifier = `skillhub-${slug.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
    const existing =
      (await this.skillModel.findByIdentifier(identifier)) ??
      (await this.skillModel.findByName(manifest.name));
    if (existing && existing.zipFileHash === zipHash && existing.content != null) {
      return { skill: existing, status: 'unchanged' };
    }

    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};
    const sourceUrl = `${this.skillHub.registryOrigin}/skills/${encodeURIComponent(slug)}`;
    const fullManifest: SkillManifest = {
      ...manifest,
      ...(version ? { version } : {}),
      skillHubSlug: slug,
      sourceUrl,
    };

    let zipFileHash: string | undefined;
    if (zipHash && skillZipBuffer) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, skillZipBuffer, 'application/zip');
      await this.fileService.createGlobalFile({
        fileHash: zipHash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${zipHash}.zip`,
          path: zipKey,
        },
        size: skillZipBuffer.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
    }

    if (existing) {
      const skill = await this.skillModel.update(existing.id, {
        content,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash,
      });
      return { skill, status: 'updated' };
    }

    const skill = await this.skillModel.create({
      content,
      description: manifest.description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      resources: resourceIds,
      source: 'user',
      zipFileHash,
    });
    return { skill, status: 'created' };
  }

  /**
   * Re-import a skill from the GitHub URL stored on its manifest.
   */
  async refreshFromSource(skillId: string): Promise<SkillImportResult> {
    const skill = await this.skillModel.findById(skillId);
    if (!skill) {
      throw new SkillImportError('Skill not found', 'NOT_FOUND');
    }

    const sourceUrl =
      typeof skill.manifest?.sourceUrl === 'string' ? skill.manifest.sourceUrl : undefined;
    const skillHubSlug =
      typeof skill.manifest?.skillHubSlug === 'string' ? skill.manifest.skillHubSlug : undefined;
    if (skillHubSlug) {
      return this.importFromSkillHub({ slug: skillHubSlug, version: skill.manifest.version });
    }
    if (!sourceUrl?.includes('github.com')) {
      throw new SkillImportError('Skill has no GitHub source to refresh from', 'INVALID_URL');
    }

    return this.importFromGitHub({ gitUrl: sourceUrl });
  }

  private async upsertGitHubSkill(input: {
    commitSha?: string;
    gitRef: string;
    gitUrl: string;
    parsed: {
      content: string;
      manifest: SkillManifest;
      resources: Map<string, Buffer>;
      skillDir?: string;
      skillZipBuffer?: Buffer;
      zipHash?: string;
    };
    repoInfo: GitHubRepoInfo;
  }): Promise<SkillImportResult> {
    const { parsed, repoInfo, gitUrl, commitSha, gitRef } = input;
    const { manifest, content, resources, zipHash, skillZipBuffer } = parsed;

    const identifier = this.github.generateIdentifier(repoInfo);
    log('importFromGitHub: identifier=%s', identifier);

    const existing =
      (await this.skillModel.findByIdentifier(identifier)) ??
      (await this.skillModel.findByName(manifest.name));
    if (existing && existing.zipFileHash === zipHash && existing.content != null) {
      log(
        'importFromGitHub: skill unchanged (same zipHash=%s), skipping update id=%s',
        zipHash,
        existing.id,
      );
      return { skill: existing, status: 'unchanged' };
    }

    log('importFromGitHub: storing %d resources...', resources.size);
    const resourceIds = zipHash
      ? await this.resourceService.storeResources(zipHash, resources)
      : {};
    log('importFromGitHub: stored resources=%o', resourceIds);

    const sourceUrl = parsed.skillDir
      ? `https://github.com/${repoInfo.owner}/${repoInfo.repo}/tree/${gitRef}/${parsed.skillDir}`
      : gitUrl;

    const fullManifest: SkillManifest = {
      ...manifest,
      ...(commitSha ? { commitSha } : {}),
      gitRef,
      repository: `https://github.com/${repoInfo.owner}/${repoInfo.repo}`,
      sourceUrl,
    };

    let zipFileHash: string | undefined;
    const zipToUpload = skillZipBuffer;
    if (zipHash && zipToUpload) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, zipToUpload, 'application/zip');
      await this.fileService.createGlobalFile({
        fileHash: zipHash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${zipHash}.zip`,
          path: zipKey,
        },
        size: zipToUpload.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
    }

    if (existing) {
      const skill = await this.skillModel.update(existing.id, {
        content,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        resources: resourceIds,
        zipFileHash,
      });
      return { skill, status: 'updated' };
    }

    const skill = await this.skillModel.create({
      content,
      description: manifest.description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      resources: resourceIds,
      source: 'user', // [enterprise-fork] GitHub 导入进组织目录，和手写/ZIP 一样走 Custom 列表
      zipFileHash,
    });
    return { skill, status: 'created' };
  }

  /**
   * Import skill from a direct URL pointing to SKILL.md
   * @param input - URL to SKILL.md file
   * @returns SkillImportResult with status: 'created' | 'updated' | 'unchanged'
   */
  async importFromUrl(
    input: ImportUrlInput,
    options?: { identifier?: string; source?: 'market' | 'user' },
  ): Promise<SkillImportResult> {
    log('importFromUrl: starting with url=%s', input.url);

    // 1. Validate URL
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw new SkillImportError('Invalid URL format', 'INVALID_URL');
    }

    // 1.5. Detect GitHub repo/tree/blob URLs and delegate to importFromGitHub for full directory support
    // Only delegate URLs that parseRepoUrl can handle (owner/repo, tree, blob patterns).
    // Let direct download URLs (e.g. /archive/*.zip, /releases/download/*) fall through
    // to the generic fetch logic below which handles ZIP files correctly.
    if (
      url.hostname === 'github.com' &&
      /^\/[^/]+\/[^/]+(?:\/(?:tree|blob)\/.+)?$/.test(url.pathname.replace(/\/+$/, ''))
    ) {
      log('importFromUrl: detected GitHub repo URL, delegating to importFromGitHub');
      return this.importFromGitHub({ gitUrl: input.url });
    }

    // 2. Fetch content (auto-detect SKILL.md or ZIP)
    let manifest: SkillManifest;
    let skillContent: string;
    let zipHash: string | undefined;
    let resources: Map<string, Buffer> | undefined;
    let zipBuffer: Buffer | undefined;

    try {
      log('importFromUrl: fetching URL...');
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

      let response: Response;
      try {
        response = await fetch(input.url, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        if (response.status === 404) {
          throw new SkillImportError(`Resource not found at ${input.url}`, 'NOT_FOUND');
        }
        throw new SkillImportError(
          `Failed to fetch URL: ${response.status} ${response.statusText}`,
          'DOWNLOAD_FAILED',
        );
      }

      // Detect if it's a ZIP file based on URL or content-type
      // Use optional chaining for headers to handle mock responses in tests
      const contentType = response.headers?.get?.('content-type') || '';
      const isZip =
        url.pathname.endsWith('.zip') ||
        url.pathname.includes('/download') ||
        contentType.includes('application/zip') ||
        contentType.includes('application/octet-stream');

      if (isZip) {
        // Handle ZIP file
        log('importFromUrl: detected ZIP file, parsing as package...');
        zipBuffer = Buffer.from(await response.arrayBuffer());
        const parsed = await this.parser.parseZipPackage(zipBuffer);
        manifest = parsed.manifest;
        skillContent = parsed.content;
        zipHash = parsed.zipHash;
        resources = parsed.resources;
        log('importFromUrl: parsed ZIP, manifest=%o, resources count=%d', manifest, resources.size);
      } else {
        // Handle plain SKILL.md
        log('importFromUrl: detected SKILL.md, parsing as markdown...');
        const content = await response.text();
        const parsed = this.parser.parseSkillMd(content);
        manifest = parsed.manifest;
        skillContent = parsed.content;
        log('importFromUrl: parsed SKILL.md, manifest=%o', manifest);
      }
    } catch (error) {
      if (error instanceof SkillImportError || error instanceof SkillManifestError) throw error;
      log('importFromUrl: fetch error: %O', error);
      log('importFromUrl: error type: %s', error?.constructor?.name);
      log('importFromUrl: error message: %s', (error as Error).message);
      log('importFromUrl: error stack: %s', (error as Error).stack);
      throw new SkillImportError(
        `Failed to process URL: ${(error as Error).message}`,
        'DOWNLOAD_FAILED',
      );
    }

    log('importFromUrl: parsed manifest=%o', manifest);

    // 4. Generate identifier based on URL host and path
    const pathPart = url.pathname
      .replace(/^\//, '') // Remove leading slash
      .replace(/\.md$/i, '') // Remove .md extension
      .replaceAll('/', '.'); // Replace slashes with dots
    const identifier = options?.identifier || `url.${url.host}.${pathPart || 'skill'}`;
    log('importFromUrl: identifier=%s', identifier);

    // 5. Check for existing skill
    const existing = await this.skillModel.findByIdentifier(identifier);

    // 6. Build manifest with source URL
    const fullManifest: SkillManifest = {
      ...manifest,
      sourceUrl: input.url,
    };

    // 7. Handle ZIP resources if present
    let resourceMap: Record<string, { fileHash: string; size: number }> | undefined;
    if (resources && resources.size > 0 && zipHash) {
      log('importFromUrl: storing %d resource files...', resources.size);
      resourceMap = await this.resourceService.storeResources(zipHash, resources);
      log('importFromUrl: stored resource files');
    }

    // 8. Upload ZIP file to S3 and create globalFiles record (for zipFileHash foreign key)
    let zipFileHash: string | undefined;
    if (zipHash && zipBuffer) {
      const zipKey = `skills/zip/${zipHash}.zip`;
      await this.fileService.uploadBuffer(zipKey, zipBuffer, 'application/zip');
      // Use createGlobalFile directly - no need to create then delete user file record
      await this.fileService.createGlobalFile({
        fileHash: zipHash,
        fileType: 'application/zip',
        metadata: {
          dirname: 'skills/zip',
          filename: `${zipHash}.zip`,
          path: zipKey,
        },
        size: zipBuffer.length,
        url: zipKey,
      });
      zipFileHash = zipHash;
      log(
        'importFromUrl: uploaded ZIP file, hash=%s, size=%d bytes',
        zipFileHash,
        zipBuffer.length,
      );
    }

    // 9. Update existing skill or create new
    if (existing) {
      // Check if content is the same (simple deduplication based on content and zipHash)
      // Use nullish coalescing to handle null/undefined comparison correctly
      const existingHash = existing.zipFileHash ?? undefined;
      const isSameContent = existing.content === skillContent && existingHash === zipFileHash;
      if (isSameContent) {
        log('importFromUrl: skill unchanged, skipping update id=%s', existing.id);
        return { skill: existing, status: 'unchanged' };
      }

      log('importFromUrl: skill exists but content changed, updating id=%s', existing.id);
      const skill = await this.skillModel.update(existing.id, {
        content: skillContent,
        description: manifest.description,
        manifest: fullManifest,
        name: manifest.name,
        ...(resourceMap && { resources: resourceMap }),
        ...(zipFileHash && { zipFileHash }),
      });
      log('importFromUrl: updated skill id=%s', skill.id);
      return { skill, status: 'updated' };
    }

    // 10. Create new skill record
    log('importFromUrl: creating new skill...');
    const skill = await this.skillModel.create({
      content: skillContent,
      description: manifest.description,
      identifier,
      manifest: fullManifest,
      name: manifest.name,
      ...(resourceMap && { resources: resourceMap }),
      source: options?.source || 'user', // [enterprise-fork] URL 导入默认进组织自定义目录
      ...(zipFileHash && { zipFileHash }),
    });
    log('importFromUrl: created skill id=%s', skill.id);
    return { skill, status: 'created' };
  }
}
