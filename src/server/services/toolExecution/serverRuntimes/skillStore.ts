import {
  type MarketSkillItem,
  type SearchSkillParams,
  SkillStoreIdentifier,
} from '@lobechat/builtin-tool-skill-store';
import {
  type SkillImportServiceResult,
  SkillStoreExecutionRuntime,
  type SkillStoreRuntimeService,
} from '@lobechat/builtin-tool-skill-store/executionRuntime';
import debug from 'debug';

import { getEnterpriseRole, resolveEnterpriseSkillOwnerId } from '@/server/services/enterpriseRole';
import { SkillImporter } from '@/server/services/skill/importer';

import { type ServerRuntimeRegistration } from './types';

const log = debug('lobe-server:skill-store-runtime');

const PUBLIC_SKILL_MARKET_DISABLED =
  'Public skill market is disabled. Import from GitHub, URL, or ZIP instead.';

const ORGANIZATION_SKILL_WRITE_FORBIDDEN =
  'Only enterprise admins can install organization skills.';

class SkillStoreServerRuntimeService implements SkillStoreRuntimeService {
  private importer: SkillImporter;
  private isAdmin: boolean;

  constructor(options: { importer: SkillImporter; isAdmin: boolean }) {
    this.importer = options.importer;
    this.isAdmin = options.isAdmin;
  }

  private assertAdmin = () => {
    if (!this.isAdmin) {
      throw new Error(ORGANIZATION_SKILL_WRITE_FORBIDDEN);
    }
  };

  importFromGitHub = async (gitUrl: string): Promise<SkillImportServiceResult> => {
    this.assertAdmin();
    const result = await this.importer.importGitHubSkills({ gitUrl });
    const first = result[0];
    if (!first) {
      throw new Error('SKILL.md not found in repository');
    }
    return {
      skill: { id: first.skill.id, name: result.map((item) => item.skill.name).join(', ') },
      status: first.status,
    };
  };

  importFromUrl = async (url: string): Promise<SkillImportServiceResult> => {
    this.assertAdmin();
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  importFromZipUrl = async (url: string): Promise<SkillImportServiceResult> => {
    this.assertAdmin();
    const result = await this.importer.importFromUrl({ url });
    return { skill: { id: result.skill.id, name: result.skill.name }, status: result.status };
  };

  searchSkill = async (
    _params: SearchSkillParams,
  ): Promise<{ items: MarketSkillItem[]; page: number; pageSize: number; total: number }> => {
    log('searchSkill blocked: %s', PUBLIC_SKILL_MARKET_DISABLED);
    throw new Error(PUBLIC_SKILL_MARKET_DISABLED);
  };

  importFromMarket = async (_identifier: string): Promise<SkillImportServiceResult> => {
    throw new Error(PUBLIC_SKILL_MARKET_DISABLED);
  };
}

/**
 * Skill Store Server Runtime
 * Per-request runtime (needs serverDB, userId)
 */
export const skillStoreRuntime: ServerRuntimeRegistration = {
  factory: async (context) => {
    if (!context.serverDB) {
      throw new Error('serverDB is required for Skill Store execution');
    }
    if (!context.userId) {
      throw new Error('userId is required for Skill Store execution');
    }

    const ownerId = await resolveEnterpriseSkillOwnerId(context.serverDB, context.userId);
    const role = await getEnterpriseRole(context.serverDB, context.userId);
    const importer = new SkillImporter(context.serverDB, ownerId);

    const service = new SkillStoreServerRuntimeService({
      importer,
      isAdmin: role.isAdmin,
    });

    return new SkillStoreExecutionRuntime({ service });
  },
  identifier: SkillStoreIdentifier,
};
