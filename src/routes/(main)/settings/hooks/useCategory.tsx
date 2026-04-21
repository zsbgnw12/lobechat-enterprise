import { isDesktop } from '@lobechat/const';
import { Avatar } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import {
  // BellIcon,
  Brain,
  BrainCircuit,
  ChartColumnBigIcon,
  Coins,
  CreditCard,
  Database,
  EllipsisIcon,
  EthernetPort,
  Gift,
  Info,
  KeyboardIcon,
  KeyIcon,
  KeyRound,
  Map,
  PaletteIcon,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsAdmin } from '@/hooks/useEnterpriseRole';
import { useElectronStore } from '@/store/electron';
import { electronSyncSelectors } from '@/store/electron/selectors';
import { SettingsTabs } from '@/store/global/initialState';
import {
  featureFlagsSelectors,
  serverConfigSelectors,
  useServerConfigStore,
} from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { userProfileSelectors } from '@/store/user/slices/auth/selectors';
import { userGeneralSettingsSelectors } from '@/store/user/slices/settings/selectors';

export enum SettingsGroupKey {
  Agent = 'agent',
  General = 'general',
  Subscription = 'subscription',
  System = 'system',
}

export interface CategoryItem {
  icon: any;
  key: SettingsTabs;
  label: string;
}

export interface CategoryGroup {
  items: CategoryItem[];
  key: SettingsGroupKey;
  title: string;
}

export const useCategory = () => {
  const { t } = useTranslation('setting');
  const { t: tAuth } = useTranslation('auth');
  const { t: tSubscription } = useTranslation('subscription');
  const mobile = useServerConfigStore((s) => s.isMobile);
  const { hideDocs, showApiKeyManage } = useServerConfigStore(featureFlagsSelectors);
  const [avatar, username] = useUserStore((s) => [
    userProfileSelectors.userAvatar(s),
    userProfileSelectors.nickName(s),
  ]);
  const remoteServerUrl = useElectronStore(electronSyncSelectors.remoteServerUrl);
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  // [enterprise-fork] 非管理员角色不应该看到 "模型服务商 / API Key / 凭据 /
  // 存储 / 高级" 这类能动系统配置的菜单项——他们只能用管理员预配的资源。
  // super_admin 和 permission_admin 视为管理员，其他角色（internal_*、customer）
  // 和未解析到角色的用户都按"普通用户"处理。
  const isAdmin = useIsAdmin();

  const avatarUrl = useMemo(() => {
    if (!avatar) return undefined;
    if (isDesktop && avatar.startsWith('/') && remoteServerUrl) {
      return remoteServerUrl + avatar;
    }
    return avatar;
  }, [avatar, remoteServerUrl]);
  const enableBusinessFeatures = useServerConfigStore(serverConfigSelectors.enableBusinessFeatures);
  const categoryGroups: CategoryGroup[] = useMemo(() => {
    const groups: CategoryGroup[] = [];

    // General group
    const generalItems: CategoryItem[] = [
      {
        icon: avatarUrl ? <Avatar avatar={avatarUrl} shape={'square'} size={26} /> : undefined,
        key: SettingsTabs.Profile,
        label: username ? username : tAuth('tab.profile'),
      },
      {
        icon: ChartColumnBigIcon,
        key: SettingsTabs.Stats,
        label: tAuth('tab.stats'),
      },
      {
        icon: PaletteIcon,
        key: SettingsTabs.Appearance,
        label: t('tab.appearance'),
      },
      !mobile && {
        icon: KeyboardIcon,
        key: SettingsTabs.Hotkey,
        label: t('tab.hotkey'),
      },
      // TODO: temporarily disabled until notification UI is polished
      // enableBusinessFeatures && {
      //   icon: BellIcon,
      //   key: SettingsTabs.Notification,
      //   label: t('tab.notification'),
      // },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: generalItems,
      key: SettingsGroupKey.General,
      title: t('group.common'),
    });

    // Subscription group
    if (enableBusinessFeatures) {
      const subscriptionItems: CategoryItem[] = [
        { icon: Map, key: SettingsTabs.Plans, label: tSubscription('tab.plans') },
        { icon: ChartColumnBigIcon, key: SettingsTabs.Usage, label: t('tab.usage') },
        { icon: Coins, key: SettingsTabs.Credits, label: tSubscription('tab.credits') },
        { icon: CreditCard, key: SettingsTabs.Billing, label: tSubscription('tab.billing') },
        { icon: Gift, key: SettingsTabs.Referral, label: tSubscription('tab.referral') },
      ];

      groups.push({
        items: subscriptionItems,
        key: SettingsGroupKey.Subscription,
        title: t('group.subscription'),
      });
    }

    // Agent group —— 配置 AI 能力的地方；普通用户不应该能自己配 provider / key
    const agentItems: CategoryItem[] = [
      // [enterprise-fork] 模型服务商（填 OpenAI Key 等）：管理员专属
      isAdmin &&
        (!enableBusinessFeatures || isDevMode) && {
          icon: Brain,
          key: SettingsTabs.Provider,
          label: t('tab.provider'),
        },
      // [enterprise-fork] 服务模型选择：管理员专属（普通用户只能用管理员分配好的）
      isAdmin && {
        icon: Sparkles,
        key: SettingsTabs.ServiceModel,
        label: t('tab.serviceModel'),
      },
      // [enterprise-fork] 技能 / 插件管理：管理员专属
      isAdmin && {
        icon: SkillsIcon,
        key: SettingsTabs.Skill,
        label: t('tab.skill'),
      },
      // Memory 是每个用户自己的偏好记忆，保留给所有人
      {
        icon: BrainCircuit,
        key: SettingsTabs.Memory,
        label: t('tab.memory'),
      },
      // [enterprise-fork] 凭据管理（MCP / 外部服务 token）：管理员专属
      isAdmin && {
        icon: KeyRound,
        key: SettingsTabs.Creds,
        label: t('tab.creds'),
      },
      // [enterprise-fork] API Key 管理：管理员专属
      isAdmin &&
        showApiKeyManage && {
          icon: KeyIcon,
          key: SettingsTabs.APIKey,
          label: tAuth('tab.apikey'),
        },
    ].filter(Boolean) as CategoryItem[];

    // 如果 Agent 组全部被过滤空了就不 push，避免左栏出现空组
    if (agentItems.length > 0) {
      groups.push({
        items: agentItems,
        key: SettingsGroupKey.Agent,
        title: t('group.aiConfig'),
      });
    }

    // System group —— 存储 / 代理 / 高级设置全部管理员专属，普通用户只保留 About
    const systemItems: CategoryItem[] = [
      isAdmin &&
        isDesktop && {
          icon: EthernetPort,
          key: SettingsTabs.Proxy,
          label: t('tab.proxy'),
        },
      isAdmin &&
        isDesktop && {
          icon: TerminalSquare,
          key: SettingsTabs.SystemTools,
          label: t('tab.systemTools'),
        },
      // [enterprise-fork] 数据存储配置：管理员专属
      isAdmin && {
        icon: Database,
        key: SettingsTabs.Storage,
        label: t('tab.storage'),
      },
      isAdmin &&
        isDevMode && {
          icon: KeyIcon,
          key: SettingsTabs.APIKey,
          label: tAuth('tab.apikey'),
        },
      // [enterprise-fork] 高级设置：管理员专属
      isAdmin && {
        icon: EllipsisIcon,
        key: SettingsTabs.Advanced,
        label: t('tab.advanced'),
      },
      !hideDocs && {
        icon: Info,
        key: SettingsTabs.About,
        label: t('tab.about'),
      },
    ].filter(Boolean) as CategoryItem[];

    groups.push({
      items: systemItems,
      key: SettingsGroupKey.System,
      title: t('group.system'),
    });

    return groups;
  }, [
    t,
    tAuth,
    tSubscription,
    enableBusinessFeatures,
    hideDocs,
    mobile,
    showApiKeyManage,
    isDevMode,
    isAdmin,
    avatarUrl,
    username,
  ]);

  return categoryGroups;
};
