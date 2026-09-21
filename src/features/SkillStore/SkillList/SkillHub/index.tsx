'use client';

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

import Empty from '../Empty';
import Loading from '../Loading';
import { gridStyles } from '../style';
import Item from './Item';

export const SkillHubList = memo(() => {
  const { t } = useTranslation('setting');
  const searchKeywords = useToolStore((s) => s.customPluginSearchKeywords || '');
  const useFetchAgentSkills = useToolStore((s) => s.useFetchAgentSkills);
  const useFetchSkillHubSkills = useToolStore((s) => s.useFetchSkillHubSkills);
  useFetchAgentSkills(true);
  const { data, error, isLoading } = useFetchSkillHubSkills(true, searchKeywords);
  const hits = data ?? [];
  const hasSearchKeywords = Boolean(searchKeywords.trim());

  if (error) {
    return <Empty description={t('skillStore.networkError')} />;
  }

  if (isLoading || data === undefined) return <Loading />;

  if (hits.length === 0) {
    return (
      <Empty
        search={hasSearchKeywords}
        description={
          hasSearchKeywords ? t('skillStore.emptySearch') : t('skillStore.skillHub.empty')
        }
      />
    );
  }

  return (
    <div className={gridStyles.grid}>
      {hits.map((hit) => (
        <Item hit={hit} key={hit.slug} />
      ))}
    </div>
  );
});

SkillHubList.displayName = 'SkillHubList';

export default SkillHubList;
