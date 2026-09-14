'use client';

import { Flexbox, Segmented } from '@lobehub/ui';
import { type SegmentedOptions } from 'antd/es/segmented';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useIsAdmin } from '@/hooks/useEnterpriseRole';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import CustomList from './SkillList/Custom';
import LobeHubList from './SkillList/LobeHub';
import MCPList from './SkillList/MCP';

export enum SkillStoreTab {
  Custom = 'custom',
  heihub = 'lobehub',
  MCP = 'mcp',
}

export const SkillStoreContent = () => {
  const { t } = useTranslation('setting');
  const isAdmin = useIsAdmin();
  // [enterprise-fork] 默认落到自定义导入；公共 LobeHub 市场页已去掉
  const [activeTab, setActiveTab] = useState<SkillStoreTab>(SkillStoreTab.Custom);
  const [lobehubKeywords, setLobehubKeywords] = useState('');

  const options: SegmentedOptions = [
    { label: t('skillStore.tabs.custom'), value: SkillStoreTab.Custom },
    { label: t('skillStore.tabs.lobehub'), value: SkillStoreTab.heihub },
    { label: t('skillStore.tabs.mcp'), value: SkillStoreTab.MCP },
  ];

  const isLobeHub = activeTab === SkillStoreTab.heihub;
  const isMCP = activeTab === SkillStoreTab.MCP;
  const isCustom = activeTab === SkillStoreTab.Custom;

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={8} paddingInline={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Segmented
            block
            options={options}
            style={{ flex: 1 }}
            value={activeTab}
            variant={'filled'}
            onChange={(v) => setActiveTab(v as SkillStoreTab)}
          />
          {isAdmin ? <AddSkillButton /> : null}
        </Flexbox>
        <Search activeTab={activeTab} onLobeHubSearch={setLobehubKeywords} />
      </Flexbox>
      <Flexbox height={496}>
        <Flexbox flex={1} style={{ display: isCustom ? 'flex' : 'none', overflow: 'auto' }}>
          <CustomList />
        </Flexbox>
        <Flexbox flex={1} style={{ display: isLobeHub ? 'flex' : 'none', overflow: 'auto' }}>
          <LobeHubList keywords={lobehubKeywords} />
        </Flexbox>
        <Flexbox flex={1} style={{ display: isMCP ? 'flex' : 'none', overflow: 'auto' }}>
          <MCPList />
        </Flexbox>
      </Flexbox>
    </Flexbox>
  );
};
