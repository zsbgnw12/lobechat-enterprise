/**
 * Lobe Skill Store Executor
 *
 * Creates and exports the SkillStoreExecutor instance for registration.
 */
import { SkillStoreExecutionRuntime } from '@lobechat/builtin-tool-skill-store/executionRuntime';
import { SkillStoreExecutor } from '@lobechat/builtin-tool-skill-store/executor';

import { agentSkillService } from '@/services/skill';

const PUBLIC_SKILL_MARKET_DISABLED =
  'Public skill market is disabled. Import from GitHub, URL, or ZIP instead.';

const runtime = new SkillStoreExecutionRuntime({
  service: {
    importFromGitHub: async (gitUrl) => {
      const result = await agentSkillService.importFromGitHub({ gitUrl });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromMarket: async () => {
      throw new Error(PUBLIC_SKILL_MARKET_DISABLED);
    },
    importFromUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    importFromZipUrl: async (url) => {
      const result = await agentSkillService.importFromUrl({ url });
      if (!result) throw new Error('Import failed');
      return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
    },
    onSkillImported: async () => {
      const { getToolStoreState } = await import('@/store/tool/store');
      await getToolStoreState().refreshAgentSkills();
    },
    searchSkill: async () => {
      throw new Error(PUBLIC_SKILL_MARKET_DISABLED);
    },
  },
});

export const skillStoreExecutor = new SkillStoreExecutor(runtime);
