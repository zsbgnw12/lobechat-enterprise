import {
  KLAVIS_SERVER_TYPES,
  LOBEHUB_SKILL_PROVIDERS,
  RECOMMENDED_SKILLS,
  RecommendedSkillType,
} from '@lobechat/const';
import { type ItemType } from '@lobehub/ui';
import { Avatar, Icon } from '@lobehub/ui';
import { McpIcon, SkillsIcon } from '@lobehub/ui/icons';
import isEqual from 'fast-deep-equal';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatGwTools } from '@/features/EnterpriseAdmin/hooks/useChatGwTools';
import { useCheckPluginsIsInstalled } from '@/hooks/useCheckPluginsIsInstalled';
import { useFetchInstalledPlugins } from '@/hooks/useFetchInstalledPlugins';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors, chatConfigByIdSelectors } from '@/store/agent/selectors';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';
import {
  agentSkillsSelectors,
  builtinToolSelectors,
  klavisStoreSelectors,
  lobehubSkillStoreSelectors,
  pluginSelectors,
} from '@/store/tool/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import KlavisServerItem from './KlavisServerItem';
import KlavisSkillIcon from './KlavisSkillIcon';
import LobehubSkillIcon from './LobehubSkillIcon';
import LobehubSkillServerItem from './LobehubSkillServerItem';
import MarketAgentSkillPopoverContent from './MarketAgentSkillPopoverContent';
import MarketSkillIcon from './MarketSkillIcon';
import ToolItem from './ToolItem';
import ToolItemDetailPopover from './ToolItemDetailPopover';

const SKILL_ICON_SIZE = 20;

export const useControls = ({ setUpdating }: { setUpdating: (updating: boolean) => void }) => {
  const { t } = useTranslation('setting');
  const agentId = useAgentId();
  const list = useToolStore(pluginSelectors.installedPluginMetaList, isEqual);
  const [checked, togglePlugin] = useAgentStore((s) => [
    agentByIdSelectors.getAgentPluginsById(agentId)(s),
    s.togglePlugin,
  ]);
  // In manual skill-activate mode, surface hidden builtin tools (web-browsing,
  // cloud-sandbox, knowledge-base, etc.) so users can explicitly enable/disable them.
  // In auto mode the activator handles those tools transparently, so they remain hidden.
  // NOTE: must read by `agentId` (not via the activeAgentId-based selector) so that
  // embedded / group-member chat inputs render the right agent's mode.
  const isManualSkillMode = useAgentStore(
    (s) => chatConfigByIdSelectors.getSkillActivateModeById(agentId)(s) === 'manual',
  );
  const builtinList = useToolStore(
    isManualSkillMode
      ? builtinToolSelectors.metaListIncludingHidden
      : builtinToolSelectors.metaList,
    isEqual,
  );
  const plugins = useAgentStore((s) => agentByIdSelectors.getAgentPluginsById(agentId)(s));

  // Klavis-related state
  const allKlavisServers = useToolStore(klavisStoreSelectors.getServers, isEqual);
  const isKlavisEnabledInEnv = useServerConfigStore(serverConfigSelectors.enableKlavis);

  // heihub Skill related state
  const allLobehubSkillServers = useToolStore(lobehubSkillStoreSelectors.getServers, isEqual);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);

  // Agent Skills related state
  const installedBuiltinSkills = useToolStore(builtinToolSelectors.installedBuiltinSkills, isEqual);
  const marketAgentSkills = useToolStore(agentSkillsSelectors.getMarketAgentSkills, isEqual);
  const userAgentSkills = useToolStore(agentSkillsSelectors.getUserAgentSkills, isEqual);

  const [
    useFetchUserKlavisServers,
    useFetchLobehubSkillConnections,
    useFetchUninstalledBuiltinTools,
    useFetchAgentSkills,
  ] = useToolStore((s) => [
    s.useFetchUserKlavisServers,
    s.useFetchLobehubSkillConnections,
    s.useFetchUninstalledBuiltinTools,
    s.useFetchAgentSkills,
  ]);

  useFetchInstalledPlugins();
  useFetchUninstalledBuiltinTools(true);
  useFetchAgentSkills(true);

  // [enterprise-fork] chat-gw 工具清单(当前 Casdoor 用户视角,按角色已过滤)
  const { data: chatGwTools } = useChatGwTools();
  useCheckPluginsIsInstalled(plugins);

  // Load user's Klavis integrations via SWR (from database)
  useFetchUserKlavisServers(isKlavisEnabledInEnv);

  // Load user's heihub Skill connections via SWR
  useFetchLobehubSkillConnections(isLobehubSkillEnabled);

  // Get connected server by identifier
  const getServerByName = (identifier: string) => {
    return allKlavisServers.find((server) => server.identifier === identifier);
  };

  // Get all Klavis server type identifier sets (used for filtering builtinList)
  // Using KLAVIS_SERVER_TYPES instead of connected servers here, because we want to filter out all possible Klavis types
  const allKlavisTypeIdentifiers = useMemo(
    () => new Set(KLAVIS_SERVER_TYPES.map((type) => type.identifier)),
    [],
  );
  // Get all skill identifier sets (used for filtering builtinList)
  const allSkillIdentifiers = useMemo(() => {
    const ids = new Set<string>();
    for (const s of installedBuiltinSkills) ids.add(s.identifier);
    for (const s of marketAgentSkills) ids.add(s.identifier);
    for (const s of userAgentSkills) ids.add(s.identifier);
    return ids;
  }, [installedBuiltinSkills, marketAgentSkills, userAgentSkills]);

  // Filter out Klavis tools and skills from builtinList (they will be displayed separately)
  const filteredBuiltinList = useMemo(() => {
    let list = builtinList;
    if (isKlavisEnabledInEnv) {
      list = list.filter((item) => !allKlavisTypeIdentifiers.has(item.identifier));
    }
    return list.filter((item) => !allSkillIdentifiers.has(item.identifier));
  }, [builtinList, allKlavisTypeIdentifiers, isKlavisEnabledInEnv, allSkillIdentifiers]);

  // Get recommended Klavis skill IDs
  const recommendedKlavisIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Klavis).map((s) => s.id),
      ),
    [],
  );

  // Get recommended Lobehub skill IDs
  const recommendedLobehubIds = useMemo(
    () =>
      new Set(
        RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Lobehub).map((s) => s.id),
      ),
    [],
  );

  // Get installed Klavis server IDs
  const installedKlavisIds = useMemo(
    () => new Set(allKlavisServers.map((s) => s.identifier)),
    [allKlavisServers],
  );

  // Get installed Lobehub skill IDs
  const installedLobehubIds = useMemo(
    () => new Set(allLobehubSkillServers.map((s) => s.identifier)),
    [allLobehubSkillServers],
  );

  // Klavis server list items - only show installed or recommended
  const klavisServerItems = useMemo(
    () =>
      isKlavisEnabledInEnv
        ? KLAVIS_SERVER_TYPES.filter(
            (type) =>
              installedKlavisIds.has(type.identifier) || recommendedKlavisIds.has(type.identifier),
          ).map((type) => ({
            icon: <KlavisSkillIcon icon={type.icon} label={type.label} size={SKILL_ICON_SIZE} />,
            key: type.identifier,
            label: (
              <KlavisServerItem
                agentId={agentId}
                identifier={type.identifier}
                label={type.label}
                server={getServerByName(type.identifier)}
                serverName={type.serverName}
              />
            ),
            popoverContent: (
              <ToolItemDetailPopover
                icon={<KlavisSkillIcon icon={type.icon} label={type.label} size={36} />}
                identifier={type.identifier}
                sourceLabel={type.author}
                title={type.label}
                description={t(`tools.klavis.servers.${type.identifier}.description` as any, {
                  defaultValue: type.description,
                })}
              />
            ),
          }))
        : [],
    [isKlavisEnabledInEnv, allKlavisServers, installedKlavisIds, recommendedKlavisIds, agentId, t],
  );

  // heihub Skill Provider list items - only show installed or recommended
  const lobehubSkillItems = useMemo(
    () =>
      isLobehubSkillEnabled
        ? LOBEHUB_SKILL_PROVIDERS.filter(
            (provider) =>
              installedLobehubIds.has(provider.id) || recommendedLobehubIds.has(provider.id),
          ).map((provider) => ({
            icon: (
              <LobehubSkillIcon
                icon={provider.icon}
                label={provider.label}
                size={SKILL_ICON_SIZE}
              />
            ),
            key: provider.id, // Use provider.id as key, consistent with pluginId
            label: (
              <LobehubSkillServerItem
                agentId={agentId}
                label={provider.label}
                provider={provider.id}
              />
            ),
            popoverContent: (
              <ToolItemDetailPopover
                icon={<LobehubSkillIcon icon={provider.icon} label={provider.label} size={36} />}
                identifier={provider.id}
                sourceLabel={provider.author}
                title={provider.label}
                description={t(`tools.lobehubSkill.providers.${provider.id}.description` as any, {
                  defaultValue: provider.description,
                })}
              />
            ),
          }))
        : [],
    [
      isLobehubSkillEnabled,
      allLobehubSkillServers,
      installedLobehubIds,
      recommendedLobehubIds,
      agentId,
      t,
    ],
  );

  // Builtin tool list items (excluding Klavis and heihub Skill)
  const builtinItems = useMemo(
    () =>
      filteredBuiltinList.map((item) => ({
        icon: (
          <Avatar
            avatar={item.meta.avatar}
            shape={'square'}
            size={SKILL_ICON_SIZE}
            style={{ flex: 'none' }}
          />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={checked.includes(item.identifier)}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              <Avatar
                avatar={item.meta.avatar}
                shape={'square'}
                size={36}
                style={{ flex: 'none', marginInlineEnd: 0 }}
              />
            }
            title={t(`tools.builtins.${item.identifier}.title` as any, {
              defaultValue: item.meta?.title || item.identifier,
            })}
          />
        ),
      })),
    [filteredBuiltinList, checked, togglePlugin, setUpdating, t],
  );

  // Builtin Agent Skills list items (grouped under heihub)
  const builtinAgentSkillItems = useMemo(
    () =>
      installedBuiltinSkills.map((skill) => ({
        icon: skill.avatar ? (
          <Avatar avatar={skill.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={checked.includes(skill.identifier)}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${skill.identifier}.description` as any, {
              defaultValue: skill.description,
            })}
            icon={
              skill.avatar ? (
                <Avatar
                  avatar={skill.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
            title={t(`tools.builtins.${skill.identifier}.title` as any, {
              defaultValue: skill.name,
            })}
          />
        ),
      })),
    [installedBuiltinSkills, checked, togglePlugin, setUpdating, t],
  );

  // Market Agent Skills list items (grouped under Community)
  const marketAgentSkillItems = useMemo(
    () =>
      marketAgentSkills.map((skill) => ({
        icon: (
          <MarketSkillIcon identifier={skill.identifier} name={skill.name} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={checked.includes(skill.identifier)}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <MarketAgentSkillPopoverContent
            description={skill.description}
            identifier={skill.identifier}
            name={skill.name}
            sourceLabel={t('skillStore.tabs.community')}
          />
        ),
      })),
    [marketAgentSkills, checked, togglePlugin, setUpdating, t],
  );

  // User Agent Skills list items (grouped under Custom)
  const userAgentSkillItems = useMemo(
    () =>
      userAgentSkills.map((skill) => ({
        icon: <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />,
        key: skill.identifier,
        label: (
          <ToolItem
            checked={checked.includes(skill.identifier)}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Icon icon={SkillsIcon} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={skill.name}
          />
        ),
      })),
    [userAgentSkills, checked, togglePlugin, setUpdating, t],
  );

  // Skills list items (including heihub Skill and Klavis)
  // Connected items listed first, deduplicated by key (heihub takes priority)
  const skillItems = useMemo(() => {
    // Deduplicate by key - heihub items take priority over Klavis
    const seenKeys = new Set<string>();
    const allItems: typeof lobehubSkillItems = [];

    // Add heihub items first (they take priority)
    for (const item of lobehubSkillItems) {
      if (!seenKeys.has(item.key as string)) {
        seenKeys.add(item.key as string);
        allItems.push(item);
      }
    }

    // Add Klavis items only if not already present
    for (const item of klavisServerItems) {
      if (!seenKeys.has(item.key as string)) {
        seenKeys.add(item.key as string);
        allItems.push(item);
      }
    }

    return allItems.sort((a, b) => {
      const isConnectedA =
        installedLobehubIds.has(a.key as string) || installedKlavisIds.has(a.key as string);
      const isConnectedB =
        installedLobehubIds.has(b.key as string) || installedKlavisIds.has(b.key as string);

      if (isConnectedA && !isConnectedB) return -1;
      if (!isConnectedA && isConnectedB) return 1;
      return 0;
    });
  }, [lobehubSkillItems, klavisServerItems, installedLobehubIds, installedKlavisIds]);

  // Distinguish community plugins and custom plugins
  const communityPlugins = list.filter((item) => item.type !== 'customPlugin');
  const customPlugins = list.filter((item) => item.type === 'customPlugin');

  // Function to map plugins to list items
  const mapPluginToItem = (item: (typeof list)[0]) => {
    const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
    const isCustom = item.type === 'customPlugin';
    return {
      icon: isMcp ? (
        <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
      ) : (
        <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
      ),
      key: item.identifier,
      label: (
        <ToolItem
          checked={checked.includes(item.identifier)}
          id={item.identifier}
          label={item.title}
          onUpdate={async () => {
            setUpdating(true);
            await togglePlugin(item.identifier);
            setUpdating(false);
          }}
        />
      ),
      popoverContent: (
        <ToolItemDetailPopover
          description={item.description}
          identifier={item.identifier}
          sourceLabel={isCustom ? t('skillStore.tabs.custom') : t('skillStore.tabs.community')}
          title={item.title}
          icon={
            isMcp ? (
              <Icon icon={McpIcon} size={36} />
            ) : (
              <Avatar
                avatar={item.avatar}
                shape={'square'}
                size={36}
                style={{ flex: 'none', marginInlineEnd: 0 }}
              />
            )
          }
        />
      ),
    };
  };

  // Build heihub group children (including Builtin Agent Skills, builtin tools, and heihub Skill/Klavis)
  const lobehubGroupChildren: ItemType[] = [
    // 1. Builtin Agent Skills
    ...builtinAgentSkillItems,
    // 2. Builtin tools
    ...builtinItems,
    // 3. heihub Skill and Klavis (as builtin skills)
    ...skillItems,
  ];

  // [enterprise-fork] AI 网关(chat-gw)工具组 —— 按 **category 大类** 聚合,
  // 每个大类是一个 checkbox。勾选 = 把该类下所有工具的 identifier 一次性加到
  // agent.plugins;取消 = 一次性移除。模型发送时看到的是工具列表(仍然按工具级
  // 过滤),只是 UI 把 N 个工具合并成 1 个类别 checkbox。
  const CATEGORY_LABELS: Record<string, string> = {
    cloud_cost: '云成本',
    doc: '文档生成',
    jina: 'Jina',
    kb: '知识库',
    sales: '销售',
    sandbox: '代码沙箱',
    ticket: '工单',
    web: 'Web 搜索',
  };
  const chatGwGroupChildren: ItemType[] = useMemo(() => {
    if (!chatGwTools || chatGwTools.length === 0) return [];
    // 按 category 分桶
    const buckets = new Map<string, typeof chatGwTools>();
    for (const t of chatGwTools) {
      const c = t.category || 'other';
      const arr = buckets.get(c);
      if (arr) arr.push(t);
      else buckets.set(c, [t]);
    }
    const categories = [...buckets.keys()].sort();

    return categories.map((cat) => {
      const toolsInCat = buckets.get(cat)!;
      const ids = toolsInCat.map((t) => t.identifier);
      const selectedCount = ids.filter((id) => checked.includes(id)).length;
      const allChecked = selectedCount === ids.length && ids.length > 0;
      const noneChecked = selectedCount === 0;
      const label = CATEGORY_LABELS[cat] || cat;
      const displayName = `${label} (${toolsInCat.length} 工具${
        selectedCount > 0 && !allChecked ? ` · 已选 ${selectedCount}` : ''
      })`;

      return {
        icon: <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />,
        key: `chatgw-cat-${cat}`,
        label: (
          <ToolItem
            checked={allChecked}
            id={`chatgw-cat-${cat}`}
            label={displayName}
            onUpdate={async () => {
              setUpdating(true);
              // 全选 / 取消全选:按当前是否有勾选决定方向
              // - 有一个以上勾选 → 全部移除
              // - 一个都没勾选 → 全部添加
              const targetChecked = noneChecked;
              for (const id of ids) {
                const isIn = checked.includes(id);
                if (targetChecked && !isIn) await togglePlugin(id);
                else if (!targetChecked && isIn) await togglePlugin(id);
              }
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            icon={<Icon icon={McpIcon} size={36} />}
            identifier={`chatgw-cat-${cat}`}
            sourceLabel="AI 网关"
            title={label}
            description={`该分类包含 ${toolsInCat.length} 个工具:\n${toolsInCat
              .map((t) => `• ${t.name}`)
              .join('\n')}`}
          />
        ),
      };
    });
  }, [chatGwTools, checked, togglePlugin, setUpdating]);

  // Build Community group children (Market Agent Skills + community plugins)
  const communityGroupChildren: ItemType[] = [
    ...marketAgentSkillItems,
    ...communityPlugins.map(mapPluginToItem),
  ];

  // Build Custom group children (User Agent Skills + custom plugins)
  const customGroupChildren: ItemType[] = [
    ...userAgentSkillItems,
    ...customPlugins.map(mapPluginToItem),
  ];

  // Items for the market tab
  const marketItems: ItemType[] = [
    // heihub group
    ...(lobehubGroupChildren.length > 0
      ? [
          {
            children: lobehubGroupChildren,
            key: 'lobehub',
            label: t('skillStore.tabs.lobehub'),
            type: 'group' as const,
          },
        ]
      : []),
    // [enterprise-fork] AI 网关分组 —— 当前账号按 Casdoor 角色可见的工具
    ...(chatGwGroupChildren.length > 0
      ? [
          {
            children: chatGwGroupChildren,
            key: 'chat-gw',
            label: 'AI 网关',
            type: 'group' as const,
          },
        ]
      : []),
    // Community group
    ...(communityGroupChildren.length > 0
      ? [
          {
            children: communityGroupChildren,
            key: 'community',
            label: t('skillStore.tabs.community'),
            type: 'group' as const,
          },
        ]
      : []),
    // Custom group (only shown when there are custom plugins)
    ...(customGroupChildren.length > 0
      ? [
          {
            children: customGroupChildren,
            key: 'custom',
            label: t('skillStore.tabs.custom'),
            type: 'group' as const,
          },
        ]
      : []),
  ];

  // Items for the installed tab - only show installed plugins
  const installedPluginItems: ItemType[] = useMemo(() => {
    const installedItems: ItemType[] = [];

    // Installed builtin tools
    const enabledBuiltinItems = filteredBuiltinList
      .filter((item) => checked.includes(item.identifier))
      .map((item) => ({
        icon: (
          <Avatar
            avatar={item.meta.avatar}
            shape={'square'}
            size={SKILL_ICON_SIZE}
            style={{ flex: 'none' }}
          />
        ),
        key: item.identifier,
        label: (
          <ToolItem
            checked={true}
            id={item.identifier}
            label={item.meta?.title}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(item.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={item.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${item.identifier}.description` as any, {
              defaultValue: item.meta?.description || '',
            })}
            icon={
              <Avatar
                avatar={item.meta.avatar}
                shape={'square'}
                size={36}
                style={{ flex: 'none', marginInlineEnd: 0 }}
              />
            }
            title={t(`tools.builtins.${item.identifier}.title` as any, {
              defaultValue: item.meta?.title || item.identifier,
            })}
          />
        ),
      }));

    // Connected Klavis servers
    const connectedKlavisItems = klavisServerItems.filter((item) =>
      checked.includes(item.key as string),
    );

    // Connected heihub Skill Providers
    const connectedLobehubSkillItems = lobehubSkillItems.filter((item) =>
      checked.includes(item.key as string),
    );

    // Merge enabled heihub Skill and Klavis (as builtin skills)
    const enabledSkillItems = [...connectedLobehubSkillItems, ...connectedKlavisItems];

    // Enabled Builtin Agent Skills
    const enabledBuiltinAgentSkillItems = installedBuiltinSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: skill.avatar ? (
          <Avatar avatar={skill.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
        ) : (
          <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.lobehub')}
            description={t(`tools.builtins.${skill.identifier}.description` as any, {
              defaultValue: skill.description,
            })}
            icon={
              skill.avatar ? (
                <Avatar
                  avatar={skill.avatar}
                  shape={'square'}
                  size={36}
                  style={{ flex: 'none', marginInlineEnd: 0 }}
                />
              ) : (
                <Icon icon={SkillsIcon} size={36} />
              )
            }
            title={t(`tools.builtins.${skill.identifier}.title` as any, {
              defaultValue: skill.name,
            })}
          />
        ),
      }));

    // Build builtin tools group children (including Builtin Agent Skills, builtin tools, and heihub Skill/Klavis)
    const allBuiltinItems: ItemType[] = [
      // 1. Builtin Agent Skills
      ...enabledBuiltinAgentSkillItems,
      // 2. Builtin tools
      ...enabledBuiltinItems,
      // 3. divider (if there are builtin tools and skill items)
      ...(enabledBuiltinItems.length > 0 && enabledSkillItems.length > 0
        ? [{ key: 'installed-divider-builtin-skill', type: 'divider' as const }]
        : []),
      // 4. heihub Skill and Klavis
      ...enabledSkillItems,
    ];

    if (allBuiltinItems.length > 0) {
      installedItems.push({
        children: allBuiltinItems,
        key: 'installed-lobehub',
        label: t('skillStore.tabs.lobehub'),
        type: 'group',
      });
    }

    // [enterprise-fork] Enabled chat-gw tools in installed tab
    const enabledChatGwItems = (chatGwTools ?? [])
      .filter((tool) => checked.includes(tool.identifier))
      .map((tool) => ({
        icon: <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />,
        key: tool.identifier,
        label: (
          <ToolItem
            checked={true}
            id={tool.identifier}
            label={tool.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(tool.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            description={tool.description ?? ''}
            icon={<Icon icon={McpIcon} size={36} />}
            identifier={tool.identifier}
            sourceLabel="AI 网关"
            title={tool.name}
          />
        ),
      }));
    if (enabledChatGwItems.length > 0) {
      installedItems.push({
        children: enabledChatGwItems,
        key: 'installed-chat-gw',
        label: 'AI 网关',
        type: 'group',
      });
    }

    // Enabled community plugins
    const enabledCommunityPlugins = communityPlugins
      .filter((item) => checked.includes(item.identifier))
      .map((item) => {
        const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
        return {
          icon: isMcp ? (
            <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
          ) : (
            <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                setUpdating(true);
                await togglePlugin(item.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={item.description}
              identifier={item.identifier}
              sourceLabel={t('skillStore.tabs.community')}
              title={item.title}
              icon={
                isMcp ? (
                  <Icon icon={McpIcon} size={36} />
                ) : (
                  <Avatar
                    avatar={item.avatar}
                    shape={'square'}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                )
              }
            />
          ),
        };
      });

    // Enabled custom plugins
    const enabledCustomPlugins = customPlugins
      .filter((item) => checked.includes(item.identifier))
      .map((item) => {
        const isMcp = item?.avatar === 'MCP_AVATAR' || !item?.avatar;
        return {
          icon: isMcp ? (
            <Icon icon={McpIcon} size={SKILL_ICON_SIZE} />
          ) : (
            <Avatar avatar={item.avatar} shape={'square'} size={SKILL_ICON_SIZE} />
          ),
          key: item.identifier,
          label: (
            <ToolItem
              checked={true}
              id={item.identifier}
              label={item.title}
              onUpdate={async () => {
                setUpdating(true);
                await togglePlugin(item.identifier);
                setUpdating(false);
              }}
            />
          ),
          popoverContent: (
            <ToolItemDetailPopover
              description={item.description}
              identifier={item.identifier}
              sourceLabel={t('skillStore.tabs.custom')}
              title={item.title}
              icon={
                isMcp ? (
                  <Icon icon={McpIcon} size={36} />
                ) : (
                  <Avatar
                    avatar={item.avatar}
                    shape={'square'}
                    size={36}
                    style={{ flex: 'none', marginInlineEnd: 0 }}
                  />
                )
              }
            />
          ),
        };
      });

    // Enabled Market Agent Skills
    const enabledMarketAgentSkillItems = marketAgentSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: (
          <MarketSkillIcon identifier={skill.identifier} name={skill.name} size={SKILL_ICON_SIZE} />
        ),
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <MarketAgentSkillPopoverContent
            description={skill.description}
            identifier={skill.identifier}
            name={skill.name}
            sourceLabel={t('skillStore.tabs.community')}
          />
        ),
      }));

    // Community group (Market Agent Skills + community plugins)
    const allCommunityItems = [...enabledMarketAgentSkillItems, ...enabledCommunityPlugins];
    if (allCommunityItems.length > 0) {
      installedItems.push({
        children: allCommunityItems,
        key: 'installed-community',
        label: t('skillStore.tabs.community'),
        type: 'group',
      });
    }

    // Enabled User Agent Skills
    const enabledUserAgentSkillItems = userAgentSkills
      .filter((skill) => checked.includes(skill.identifier))
      .map((skill) => ({
        icon: <Icon icon={SkillsIcon} size={SKILL_ICON_SIZE} />,
        key: skill.identifier,
        label: (
          <ToolItem
            checked={true}
            id={skill.identifier}
            label={skill.name}
            onUpdate={async () => {
              setUpdating(true);
              await togglePlugin(skill.identifier);
              setUpdating(false);
            }}
          />
        ),
        popoverContent: (
          <ToolItemDetailPopover
            description={skill.description}
            icon={<Icon icon={SkillsIcon} size={36} />}
            identifier={skill.identifier}
            sourceLabel={t('skillStore.tabs.custom')}
            title={skill.name}
          />
        ),
      }));

    // Custom group (User Agent Skills + custom plugins)
    const allCustomItems = [...enabledUserAgentSkillItems, ...enabledCustomPlugins];
    if (allCustomItems.length > 0) {
      installedItems.push({
        children: allCustomItems,
        key: 'installed-custom',
        label: t('skillStore.tabs.custom'),
        type: 'group',
      });
    }

    return installedItems;
  }, [
    filteredBuiltinList,
    installedBuiltinSkills,
    marketAgentSkills,
    userAgentSkills,
    communityPlugins,
    customPlugins,
    klavisServerItems,
    lobehubSkillItems,
    checked,
    togglePlugin,
    setUpdating,
    t,
  ]);

  return { installedPluginItems, marketItems };
};
