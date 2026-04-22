import { LOBE_CHAT_CLOUD, UTM_SOURCE } from '@lobechat/business-const';
import { DOWNLOAD_URL, isDesktop } from '@lobechat/const';
import { Flexbox, Hotkey, Icon, Tag } from '@lobehub/ui';
import { type ItemType } from 'antd/es/menu/interface';
import {
  BrainCircuit,
  Cloudy,
  Download,
  HardDriveDownload,
  LogOut,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { type PropsWithChildren } from 'react';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import useBusinessMenuItems from '@/business/client/features/User/useBusinessMenuItems';
import { type MenuProps } from '@/components/Menu';
import { DEFAULT_DESKTOP_HOTKEY_CONFIG } from '@/const/desktop';
import { OFFICIAL_URL } from '@/const/url';
import DataImporter from '@/features/DataImporter';
import { useEnterpriseRole } from '@/hooks/useEnterpriseRole';
import { useNavLayout } from '@/hooks/useNavLayout';
import { usePlatform } from '@/hooks/usePlatform';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import { useNewVersion } from './useNewVersion';

const NewVersionBadge = memo(
  ({
    children,
    showBadge,
    onClick,
  }: PropsWithChildren & { onClick?: () => void; showBadge?: boolean }) => {
    const { t } = useTranslation('common');
    if (!showBadge)
      return (
        <Flexbox flex={1} onClick={onClick}>
          {children}
        </Flexbox>
      );
    return (
      <Flexbox horizontal align={'center'} flex={1} gap={8} width={'100%'} onClick={onClick}>
        {children}
        <Tag color={'info'} size={'small'} style={{ borderRadius: 16, paddingInline: 8 }}>
          {t('upgradeVersion.hasNew')}
        </Tag>
      </Flexbox>
    );
  },
);

export const useMenu = () => {
  const hasNewVersion = useNewVersion();
  const { t } = useTranslation(['common', 'setting', 'auth']);
  const { showCloudPromotion, hideDocs } = useServerConfigStore(featureFlagsSelectors);
  const [isLogin, isLoginWithAuth] = useUserStore((s) => [
    authSelectors.isLogin(s),
    authSelectors.isLoginWithAuth(s),
  ]);
  const { userPanel } = useNavLayout();
  const businessMenuItems = useBusinessMenuItems(isLogin);
  const { isIOS, isAndroid } = usePlatform();
  // [enterprise-fork] 企业管理员菜单入口：super_admin / permission_admin 可见
  const { isAdmin, username: enterpriseUsername } = useEnterpriseRole();
  // Gateway admin UI 是浏览器直接可达的 URL（不是 docker 内部的 http://gateway:3001）。
  // 生产：通过 NEXT_PUBLIC_GATEWAY_PUBLIC_URL 设为对外域名。
  const gatewayAdminUrl = process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_URL || 'http://localhost:3001';

  const downloadUrl = useMemo(() => {
    if (isIOS) return DOWNLOAD_URL.ios;
    if (isAndroid) return DOWNLOAD_URL.android;
    return DOWNLOAD_URL.default;
  }, [isIOS, isAndroid]);

  const settings: MenuProps['items'] = [
    {
      extra: isDesktop ? (
        <div>
          <Hotkey keys={DEFAULT_DESKTOP_HOTKEY_CONFIG.openSettings} />
        </div>
      ) : undefined,
      icon: <Icon icon={Settings2} />,
      key: 'setting',
      label: (
        <Link to="/settings">
          <NewVersionBadge showBadge={hasNewVersion}>{t('userPanel.setting')}</NewVersionBadge>
        </Link>
      ),
    },
    ...(userPanel.showMemory
      ? [
          {
            icon: <Icon icon={BrainCircuit} />,
            key: 'memory',
            label: <Link to="/memory">{t('tab.memory')}</Link>,
          },
        ]
      : []),
  ];

  const getDesktopApp: MenuProps['items'] = [
    {
      icon: <Icon icon={Download} />,
      key: 'get-desktop-app',
      label: (
        <a href={downloadUrl} rel="noopener noreferrer" target="_blank">
          {t('getDesktopApp')}
        </a>
      ),
    },
  ];

  const helps: MenuProps['items'] = [
    showCloudPromotion && {
      icon: <Icon icon={Cloudy} />,
      key: 'cloud',
      label: (
        <a
          href={`${OFFICIAL_URL}?utm_source=${UTM_SOURCE}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t('userPanel.cloud', { name: LOBE_CHAT_CLOUD })}
        </a>
      ),
    },
  ].filter(Boolean) as ItemType[];

  const mainItems = [
    {
      type: 'divider',
    },

    ...(isLogin ? settings : []),
    // [enterprise-fork] 企业权限管理入口：只给 super_admin / permission_admin
    // 点击新开 tab 到 Gateway `/admin`，复用那边已有的 6 页管理 UI（用户 /
    // 工具授权 / 数据范围 / 身份映射 / 审计）。不重新在 LobeChat 内实现一套，
    // 减少维护成本；Gateway 升级后管理员功能自动同步。
    ...(isAdmin
      ? [
          {
            icon: <Icon icon={ShieldCheck} />,
            key: 'enterprise-admin',
            label: (
              // Gateway /admin 未登录直接 401，先跳到 /admin/login 设 dev_user
              // cookie。带 ?u=<username> 预填 username，用户点一下 Login 即可。
              // 生产接 Casdoor 后 /admin/login 自己走 SSO，参数被忽略。
              <a
                rel="noopener noreferrer"
                target="_blank"
                href={`${gatewayAdminUrl}/admin/login${
                  enterpriseUsername ? `?u=${encodeURIComponent(enterpriseUsername)}` : ''
                }`}
              >
                {t('userPanel.enterpriseAdmin', { defaultValue: '企业权限管理' })}
              </a>
            ),
          },
        ]
      : []),
    ...businessMenuItems,
    // [enterprise-fork] Desktop-app download entry removed — this is a
    // web-only enterprise deployment, users should not be directed to
    // download an external desktop app.
    ...(userPanel.showDataImporter && isLogin
      ? [
          {
            icon: <Icon icon={HardDriveDownload} />,
            key: 'import',
            label: <DataImporter>{t('importData')}</DataImporter>,
          },
          {
            type: 'divider' as const,
          },
        ]
      : []),
    ...(!hideDocs ? helps : []),
  ].filter(Boolean) as MenuProps['items'];

  const logoutItems: MenuProps['items'] = isLoginWithAuth
    ? [
        {
          icon: <Icon icon={LogOut} />,
          key: 'logout',
          label: <span>{t('signout', { ns: 'auth' })}</span>,
        },
        {
          type: 'divider',
        },
      ]
    : [];

  return { logoutItems, mainItems };
};
