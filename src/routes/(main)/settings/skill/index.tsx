'use client';

import { Button, Icon } from '@lobehub/ui';
import { Store } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import AdminOnly from '@/features/AdminOnly';
import { createSkillStoreModal } from '@/features/SkillStore';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import SkillList from './features/SkillList';

// [enterprise-fork] wrap in AdminOnly — 技能 / 插件库由管理员统一维护
const Page = () => {
  const { t } = useTranslation('setting');

  const handleOpenStore = useCallback(() => {
    createSkillStoreModal();
  }, []);

  return (
    <AdminOnly>
      <SettingHeader
        title={t('tab.skill')}
        extra={
          <Button icon={<Icon icon={Store} />} size="large" onClick={handleOpenStore}>
            {t('skillStore.button')}
          </Button>
        }
      />
      <SkillList />
    </AdminOnly>
  );
};

Page.displayName = 'SkillsSetting';

export default Page;
