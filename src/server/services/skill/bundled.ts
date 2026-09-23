import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { zip as fflateZip } from 'fflate';

import { SkillImportError } from './errors';

/** [enterprise-fork] Pack SKILL.md trees from enterprise/skills for in-image install. */

const SKIP_FILES = new Set(['.gitignore', 'pack.ps1', 'README.md']);

export const resolveBundledOrgSkillsDir = () =>
  process.env.ORG_SKILLS_DIR?.trim() || join(process.cwd(), 'enterprise/skills');

export const listBundledSkillDirs = async (root = resolveBundledOrgSkillsDir()) => {
  if (!existsSync(root)) {
    throw new SkillImportError(`Bundled organization skills not found: ${root}`, 'NOT_FOUND');
  }

  const entries = await readdir(root, { withFileTypes: true });
  const dirs: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillMd = join(root, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) dirs.push(join(root, entry.name));
  }
  dirs.sort();
  return dirs;
};

const zipFiles = (files: Record<string, Uint8Array>) =>
  new Promise<Buffer>((resolve, reject) => {
    fflateZip(files, { level: 6 }, (error, data) => {
      if (error) reject(error);
      else resolve(Buffer.from(data));
    });
  });

export const zipSkillDir = async (dir: string) => {
  const skillMdPath = join(dir, 'SKILL.md');
  if (!existsSync(skillMdPath)) {
    throw new SkillImportError(`SKILL.md not found in ${dir}`, 'NOT_FOUND');
  }

  const files: Record<string, Uint8Array> = {
    'SKILL.md': new Uint8Array(await readFile(skillMdPath)),
  };

  const referencesDir = join(dir, 'references');
  if (existsSync(referencesDir) && (await stat(referencesDir)).isDirectory()) {
    const names = await readdir(referencesDir);
    for (const name of names.sort()) {
      if (name.startsWith('.') || SKIP_FILES.has(name)) continue;
      const fullPath = join(referencesDir, name);
      if (!(await stat(fullPath)).isFile()) continue;
      files[`references/${name}`] = new Uint8Array(await readFile(fullPath));
    }
  }

  return zipFiles(files);
};

let autoInstall: Promise<unknown> | undefined;

/** Reset in-process auto-install latch (tests only). */
export const resetBundledOrgSkillsAutoInstall = () => {
  autoInstall = undefined;
};

/**
 * [enterprise-fork] Install image-bundled SOP once per process.
 * Concurrent callers share the same promise; a failure clears the latch so the next list retries.
 */
export const ensureBundledOrgSkillsInstalled = async (install: () => Promise<unknown>) => {
  autoInstall ??= install().catch((error) => {
    autoInstall = undefined;
    throw error;
  });
  return autoInstall;
};
