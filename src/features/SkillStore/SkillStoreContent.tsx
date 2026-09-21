'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsAdmin } from '@/hooks/useEnterpriseRole';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import CustomList from './SkillList/Custom';
import SkillHubList from './SkillList/SkillHub';

type CatalogTab = 'org' | 'skillHub';

export const SkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const isAdmin = useIsAdmin();
  const enableSkillHub = useServerConfigStore(serverConfigSelectors.enableSkillHub);
  const showSkillHub = isAdmin && enableSkillHub;
  const [tab, setTab] = useState<CatalogTab>('org');
  const activeTab = showSkillHub ? tab : 'org';

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={8} paddingInline={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Search />
          {isAdmin ? <AddSkillButton /> : null}
        </Flexbox>
        {showSkillHub ? (
          <Segmented
            block
            value={activeTab}
            options={[
              { label: t('skillStore.tabs.org'), value: 'org' },
              { label: t('skillStore.tabs.skillHub'), value: 'skillHub' },
            ]}
            onChange={(value) => setTab(value as CatalogTab)}
          />
        ) : null}
      </Flexbox>
      <Flexbox height={496} style={{ overflow: 'auto' }}>
        {activeTab === 'skillHub' ? <SkillHubList /> : <CustomList />}
      </Flexbox>
    </Flexbox>
  );
};
