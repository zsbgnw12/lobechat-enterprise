'use client';

import { Flexbox, FormGroup, Skeleton } from '@lobehub/ui';
import { useTranslation } from 'react-i18next';

import AdminOnly from '@/features/AdminOnly';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { useServerConfigStore } from '@/store/serverConfig';
import { useUserStore } from '@/store/user';
import { authSelectors } from '@/store/user/selectors';

import Advanced from './features/Advanced';

// [enterprise-fork] wrap in AdminOnly — 数据存储配置只给管理员
const Page = () => {
  const { t } = useTranslation('setting');
  const serverConfigInit = useServerConfigStore((s) => s.serverConfigInit);
  const isUserLoaded = useUserStore(authSelectors.isLoaded);

  const isLoading = !serverConfigInit || !isUserLoaded;

  return (
    <AdminOnly>
      <SettingHeader title={t('tab.storage')} />
      <Flexbox style={{ display: isLoading ? 'flex' : 'none' }}>
        <FormGroup collapsible={false} title={t('storage.actions.title')} variant="filled">
          <Skeleton active paragraph={{ rows: 4 }} />
        </FormGroup>
      </Flexbox>
      <Flexbox style={{ display: isLoading ? 'none' : 'flex' }}>
        <Advanced />
      </Flexbox>
    </AdminOnly>
  );
};

export default Page;
