import { type BuiltinAgentSlug } from '@lobechat/builtin-agents';
import { BUILTIN_AGENTS } from '@lobechat/builtin-agents';
import { DEFAULT_AGENT_CONFIG } from '@lobechat/const';
import { type LobeChatDatabase } from '@lobechat/database';
import { type AgentItem, type LobeAgentConfig } from '@lobechat/types';
import { cleanObject, merge } from '@lobechat/utils';
import debug from 'debug';
import { type PartialDeep } from 'type-fest';

import { AgentModel } from '@/database/models/agent';
import { AiProviderModel } from '@/database/models/aiProvider';
import { SessionModel } from '@/database/models/session';
import { UserModel } from '@/database/models/user';
import { getRedisConfig } from '@/envs/redis';
import {
  initializeRedisWithPrefix,
  isRedisEnabled,
  RedisKeyNamespace,
  RedisKeys,
} from '@/libs/redis';
import { getServerDefaultAgentConfig } from '@/server/globalConfig';
import { resolveEnterpriseProviderOwnerId } from '@/server/services/enterpriseRole';

import { type UpdateAgentResult } from './type';

const log = debug('lobe-agent:service');

/**
 * Agent config with required id field.
 * Used when returning agent config from database (id is always present).
 */
export type AgentConfigWithId = LobeAgentConfig & { id: string; slug?: string | null };

interface AgentWelcomeData {
  openQuestions: string[];
  welcomeMessage: string;
}

/**
 * Agent Service
 *
 * Encapsulates "mutation + query" logic for agent operations.
 * After performing update operations, returns the updated agent data.
 */
export class AgentService {
  private readonly userId: string;
  private readonly db: LobeChatDatabase;
  private readonly agentModel: AgentModel;
  private readonly userModel: UserModel;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
    this.agentModel = new AgentModel(db, userId);
    this.userModel = new UserModel(db, userId);
  }

  async createInbox() {
    const sessionModel = new SessionModel(this.db, this.userId);
    // [enterprise-fork] 新用户的 inbox 不再用 env 兜底，而是继承管理员当前
    // 的默认 agent 配置——管理员在自己对话里选的 provider/model，就是所有
    // 新用户开箱即用的默认。admin 自己首登时 enterpriseDefault 为空，退回到
    // 老的 env 默认，不影响 admin 自己。
    const enterpriseDefault = await this.getEnterpriseDefaultAgentConfig();
    const serverDefault = getServerDefaultAgentConfig();
    await sessionModel.createInbox(merge(serverDefault, enterpriseDefault));
  }

  /**
   * Get a builtin agent by slug, creating it if it doesn't exist.
   * This is a generic interface for all builtin agents (page-copilot, inbox, etc.)
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. The actual agent config from database
   * 4. Avatar from builtin-agents package definition (if available)
   *
   * This ensures the frontend always receives a complete config with model/provider.
   */
  async getBuiltinAgent(slug: string) {
    // Fetch agent and both default configs in parallel
    const [agent, defaultAgentConfig, enterpriseDefault, adminEnabledProviders] = await Promise.all(
      [
        this.agentModel.getBuiltinAgent(slug),
        this.userModel.getUserSettingsDefaultAgentConfig(),
        this.getEnterpriseDefaultAgentConfig(),
        this.getAdminEnabledProviderIds(),
      ],
    );

    const mergedConfig = await this.mergeDefaultConfig(
      agent,
      defaultAgentConfig,
      enterpriseDefault,
      adminEnabledProviders,
    );
    if (!mergedConfig) return null;

    // Use builtin avatar as fallback only when DB has no custom avatar
    const builtinAgent = BUILTIN_AGENTS[slug as BuiltinAgentSlug];
    if (builtinAgent?.avatar && !mergedConfig.avatar) {
      return { ...mergedConfig, avatar: builtinAgent.avatar };
    }

    return mergedConfig;
  }

  /**
   * Get agent config by ID or slug with default config merged.
   * Supports both agentId and slug lookup.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   */
  async getAgentConfig(idOrSlug: string): Promise<AgentConfigWithId | null> {
    const [agent, defaultAgentConfig, enterpriseDefault, adminEnabledProviders] = await Promise.all(
      [
        this.agentModel.getAgentConfig(idOrSlug),
        this.userModel.getUserSettingsDefaultAgentConfig(),
        this.getEnterpriseDefaultAgentConfig(),
        this.getAdminEnabledProviderIds(),
      ],
    );

    return (await this.mergeDefaultConfig(
      agent,
      defaultAgentConfig,
      enterpriseDefault,
      adminEnabledProviders,
    )) as AgentConfigWithId | null;
  }

  /**
   * Get agent config by ID with default config merged.
   *
   * The returned agent config is merged with:
   * 1. DEFAULT_AGENT_CONFIG (hardcoded defaults)
   * 2. Server's globalDefaultAgentConfig (from environment variable DEFAULT_AGENT_CONFIG)
   * 3. User's defaultAgentConfig (from user settings)
   * 4. The actual agent config from database
   * 5. AI-generated welcome data from Redis (if available)
   */
  async getAgentConfigById(agentId: string) {
    const [agent, defaultAgentConfig, welcomeData, enterpriseDefault, adminEnabledProviders] =
      await Promise.all([
        this.agentModel.getAgentConfigById(agentId),
        this.userModel.getUserSettingsDefaultAgentConfig(),
        this.getAgentWelcomeFromRedis(agentId),
        this.getEnterpriseDefaultAgentConfig(),
        this.getAdminEnabledProviderIds(),
      ]);

    const config = await this.mergeDefaultConfig(
      agent,
      defaultAgentConfig,
      enterpriseDefault,
      adminEnabledProviders,
    );
    if (!config) return null;

    // Merge AI-generated welcome data if available
    if (welcomeData) {
      return {
        ...config,
        openingMessage: welcomeData.welcomeMessage,
        openingQuestions: welcomeData.openQuestions,
      };
    }

    return config;
  }

  /**
   * Get AI-generated welcome data from Redis
   * Returns null if Redis is disabled or data doesn't exist
   */
  private async getAgentWelcomeFromRedis(agentId: string): Promise<AgentWelcomeData | null> {
    try {
      const redisConfig = getRedisConfig();
      if (!isRedisEnabled(redisConfig)) return null;

      const redis = await initializeRedisWithPrefix(redisConfig, RedisKeyNamespace.AI_GENERATION);
      if (!redis) return null;

      const key = RedisKeys.aiGeneration.agentWelcome(agentId);
      const value = await redis.get(key);
      if (!value) return null;

      return JSON.parse(value) as AgentWelcomeData;
    } catch (error) {
      // Log error for observability but don't break agent retrieval
      log('Failed to get agent welcome from Redis for agent %s: %O', agentId, error);
      return null;
    }
  }

  /**
   * Merge default config with agent config.
   * Returns null if agent is null/undefined.
   *
   * Merge order (later values override earlier):
   * 1. DEFAULT_AGENT_CONFIG - hardcoded defaults
   * 2. serverDefaultAgentConfig - from environment variable
   * 3. enterpriseDefaultAgentConfig - **管理员在自己 user_settings.defaultAgent
   *    里选的 provider/model**，这是企业版的"全公司默认模型"锚点。
   * 4. userDefaultAgentConfig - from user settings (defaultAgent.config)
   * 5. agent - actual agent config from database
   *
   * **[enterprise-fork] 动态 provider 校验**：
   * 合并完成后，如果最终 `provider` 不在管理员已启用的 provider 列表里
   * （典型场景：用户的 inbox agents 行还留着旧的 'openai'，但管理员当前只
   * 配了 gemini），则用管理员默认的 `provider` + `model` 覆盖掉。这样：
   *  - 存量用户无需迁移 DB，登录后自动对齐到管理员最新配置
   *  - 管理员改了自己默认，所有人下次读 agent config 即刻跟随
   *  - 管理员自己不受影响（他的 provider 一定在自己启用列表里）
   */
  private async mergeDefaultConfig(
    agent: any,
    defaultAgentConfig: Awaited<ReturnType<UserModel['getUserSettingsDefaultAgentConfig']>>,
    enterpriseDefault: PartialDeep<LobeAgentConfig>,
    adminEnabledProviders: Set<string>,
  ): Promise<LobeAgentConfig | null> {
    if (!agent) return null;

    const userDefaultAgentConfig =
      (defaultAgentConfig as { config?: PartialDeep<LobeAgentConfig> })?.config || {};

    // Merge configs in order: DEFAULT -> server -> enterprise -> user -> agent
    const serverDefaultAgentConfig = getServerDefaultAgentConfig();
    const baseConfig = merge(DEFAULT_AGENT_CONFIG, serverDefaultAgentConfig);
    const withEnterprise = merge(baseConfig, enterpriseDefault);
    const withUserConfig = merge(withEnterprise, userDefaultAgentConfig);
    const finalConfig = merge(withUserConfig, cleanObject(agent));

    // 动态 provider 校验：如果 agent 行带着一个管理员没启用的 provider，
    // 强制回退到管理员配置的某个启用组合。Fallback 优先级：
    //   1. 管理员自己 user_settings.defaultAgent.config 里的 provider/model
    //   2. 任一"启用 provider + 启用 chat model"的组合（挑第一对）
    // 保证 sales1/普通用户永远不会落到"管理员没启用"的 provider 上（例如
    // DEFAULT_AGENT_CONFIG 硬编码的 anthropic+claude，但管理员已关 anthropic）。
    const finalProvider = (finalConfig as LobeAgentConfig).provider;
    if (
      adminEnabledProviders.size > 0 &&
      finalProvider &&
      !adminEnabledProviders.has(finalProvider)
    ) {
      let fallbackProvider: string | undefined = (enterpriseDefault as LobeAgentConfig).provider;
      let fallbackModel: string | undefined = (enterpriseDefault as LobeAgentConfig).model;

      // 管理员没在自己对话里定过默认 → 从 DB 挑"任一启用模型"做锚点
      if (!fallbackProvider) {
        const firstEnabled = await this.getAdminFirstEnabledChatPair();
        if (firstEnabled) {
          fallbackProvider = firstEnabled.provider;
          fallbackModel = firstEnabled.model;
        }
      }

      if (fallbackProvider) {
        (finalConfig as LobeAgentConfig).provider = fallbackProvider;
        if (fallbackModel) (finalConfig as LobeAgentConfig).model = fallbackModel;
        log(
          'override stale agent provider %s → admin enabled %s/%s (user=%s, agent=%s)',
          finalProvider,
          fallbackProvider,
          fallbackModel,
          this.userId,
          (agent as any)?.id,
        );
      }
    }

    return finalConfig;
  }

  /**
   * [enterprise-fork] 读管理员自己的 `user_settings.defaultAgent.config`
   * ——这就是全公司所有用户默认继承的模型锚点。
   *
   * 返回空对象表示"管理员还没在自己的对话里选过默认模型"，此时不做企业层
   * 覆盖，退化到 env / 硬编码默认。admin 自己读时会跳过（enterprise 锚点
   * 就是 admin 自己），避免循环依赖。
   */
  private async getEnterpriseDefaultAgentConfig(): Promise<PartialDeep<LobeAgentConfig>> {
    try {
      const adminId = await resolveEnterpriseProviderOwnerId(this.db, this.userId);
      if (!adminId || adminId === this.userId) return {};

      const adminUserModel = new UserModel(this.db, adminId);
      const adminDefaultAgent = await adminUserModel.getUserSettingsDefaultAgentConfig();
      return ((adminDefaultAgent as { config?: PartialDeep<LobeAgentConfig> })?.config ||
        {}) as PartialDeep<LobeAgentConfig>;
    } catch (err) {
      log('getEnterpriseDefaultAgentConfig failed, falling back to empty: %O', err);
      return {};
    }
  }

  /**
   * [enterprise-fork] 读管理员已启用的 provider id 集合（`ai_providers`
   * where userId=admin AND enabled=true）。用于把存量用户 agent 行里的
   * 陈旧 provider 动态对齐到管理员当前配置。
   *
   * 返回空集合时不做任何覆盖——可能管理员也还没配任何 provider，或出错了，
   * 此时保持原有行为优于用空列表误伤。
   */
  private async getAdminEnabledProviderIds(): Promise<Set<string>> {
    try {
      const adminId = await resolveEnterpriseProviderOwnerId(this.db, this.userId);
      if (!adminId) return new Set();
      const adminProviderModel = new AiProviderModel(this.db, adminId);
      const list = await adminProviderModel.getAiProviderList();
      return new Set(list.filter((p) => p.enabled).map((p) => p.id));
    } catch (err) {
      log('getAdminEnabledProviderIds failed: %O', err);
      return new Set();
    }
  }

  /**
   * [enterprise-fork] 从 DB 中挑"任一 admin 启用的 chat 模型"作为 fallback：
   * (ai_providers.enabled=true) ∩ (ai_models.enabled=true AND type='chat')，
   * 按 provider 的排序取第一对。
   *
   * 使用场景：管理员没在自己 user_settings.defaultAgent 里定过默认，但
   * 用户 agent 行里的 provider 不在 admin 启用集合里 —— 此时动态覆盖需要
   * 一个兜底目标，就用"全公司第一个可用模型"。永远不会让用户落到
   * 未启用的 provider 上。
   *
   * 返回 null 意味着管理员根本没启用任何 chat 模型，此时保持 agent 行原值，
   * 让 chat 请求自己在后端报"Provider X not configured"类错误。
   */
  private async getAdminFirstEnabledChatPair(): Promise<{
    model: string;
    provider: string;
  } | null> {
    try {
      const adminId = await resolveEnterpriseProviderOwnerId(this.db, this.userId);
      if (!adminId) return null;

      // 借用 AiInfraRepos.getEnabledModels(true)：它已经挑好了
      // (provider.enabled=true AND model.enabled=true) 的集合
      // (见 packages/database/src/repositories/aiInfra/index.ts 的 [enterprise-fork] 改动)。
      const { AiInfraRepos } = await import('@/database/repositories/aiInfra');
      const repos = new AiInfraRepos(this.db, adminId, {});
      const enabled = await repos.getEnabledModels(true);
      const firstChat = (enabled || []).find((m: any) => m?.type === 'chat');
      if (!firstChat) return null;
      return { model: firstChat.id, provider: firstChat.providerId };
    } catch (err) {
      log('getAdminFirstEnabledChatPair failed: %O', err);
      return null;
    }
  }

  /**
   * Update agent config and return the updated data
   * Pattern: update + query
   *
   * This method combines config update and querying into a single operation,
   * reducing the need for separate refresh calls and improving performance.
   */
  async updateAgentConfig(
    agentId: string,
    value: PartialDeep<AgentItem>,
  ): Promise<UpdateAgentResult> {
    // 1. Execute update
    await this.agentModel.updateConfig(agentId, value);

    // 2. Query and return updated data (with default config merged)
    const agent = await this.getAgentConfigById(agentId);

    return { agent: agent as any, success: true };
  }
}
