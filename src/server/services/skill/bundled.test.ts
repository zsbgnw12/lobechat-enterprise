// @vitest-environment node
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ensureBundledOrgSkillsInstalled,
  listBundledSkillDirs,
  resetBundledOrgSkillsAutoInstall,
  zipSkillDir,
} from './bundled';
import { SkillParser } from './parser';

describe('bundled org skills', () => {
  const repoSkillDir = join(process.cwd(), 'enterprise/skills');

  it('lists the ticket-followup SOP from this repo', async () => {
    const dirs = await listBundledSkillDirs(repoSkillDir);
    expect(dirs.some((dir) => dir.endsWith('org-ticket-followup'))).toBe(true);
  });

  it('zips SKILL.md and references so the parser can import them', async () => {
    const zip = await zipSkillDir(join(repoSkillDir, 'org-ticket-followup'));
    const parsed = await new SkillParser().parseZipPackage(zip);

    expect(parsed.manifest.name).toBe('org-ticket-followup');
    expect(parsed.manifest.description).toContain('工单跟进');
    expect(parsed.resources.has('references/reply-template.md')).toBe(true);
    expect(parsed.resources.has('references/status-map.md')).toBe(true);
  });
});

describe('ensureBundledOrgSkillsInstalled', () => {
  beforeEach(() => {
    resetBundledOrgSkillsAutoInstall();
  });

  it('runs install once when called concurrently', async () => {
    const install = vi.fn(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
    });

    await Promise.all([
      ensureBundledOrgSkillsInstalled(install),
      ensureBundledOrgSkillsInstalled(install),
    ]);

    expect(install).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed install', async () => {
    const install = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(ensureBundledOrgSkillsInstalled(install)).rejects.toThrow('boom');
    await ensureBundledOrgSkillsInstalled(install);

    expect(install).toHaveBeenCalledTimes(2);
  });
});
