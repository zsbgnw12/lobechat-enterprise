'use client';

import { Button, Icon } from '@lobehub/ui';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AdminOnly from '@/features/AdminOnly';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import CreateCredModal from './features/CreateCredModal';
import CredsList from './features/CredsList';

// [enterprise-fork] wrap in AdminOnly — 凭据管理由管理员统一维护
const Page = () => {
  const { t } = useTranslation('setting');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const handleCreateSuccess = () => {
    setCreateModalOpen(false);
    setRefreshKey((k) => k + 1);
  };

  return (
    <AdminOnly>
      <SettingHeader
        title={t('tab.creds')}
        extra={
          <Button icon={<Icon icon={Plus} />} size="large" onClick={() => setCreateModalOpen(true)}>
            {t('creds.create')}
          </Button>
        }
      />
      <CredsList key={refreshKey} />
      <CreateCredModal
        open={createModalOpen}
        onCancel={() => setCreateModalOpen(false)}
        onSuccess={handleCreateSuccess}
      />
    </AdminOnly>
  );
};

Page.displayName = 'CredsSetting';

export default Page;
