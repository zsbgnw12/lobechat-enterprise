// @vitest-environment node
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listBundledSkillDirs, zipSkillDir } from './bundled';
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
