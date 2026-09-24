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

  it('lists the organization SOP packages from this repo', async () => {
    const dirs = await listBundledSkillDirs(repoSkillDir);
    const names = dirs.map((dir) => dir.split(/[/\\]/).at(-1));
    expect(names).toEqual(
      expect.arrayContaining(['org-customer-lookup', 'org-sales-followup', 'org-ticket-followup']),
    );
  });

  it.each([
    {
      description: '工单跟进',
      extraResource: 'references/status-map.md',
      name: 'org-ticket-followup',
    },
    {
      description: '客户编号',
      extraResource: 'references/field-map.md',
      name: 'org-customer-lookup',
    },
    {
      description: '销售跟进',
      extraResource: 'references/status-map.md',
      name: 'org-sales-followup',
    },
  ] as const)(
    'zips $name so the parser can import it',
    async ({ name, description, extraResource }) => {
      const zip = await zipSkillDir(join(repoSkillDir, name));
      const parsed = await new SkillParser().parseZipPackage(zip);

      expect(parsed.manifest.name).toBe(name);
      expect(parsed.manifest.description).toContain(description);
      expect(parsed.resources.has('references/reply-template.md')).toBe(true);
      expect(parsed.resources.has(extraResource)).toBe(true);
    },
  );
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
