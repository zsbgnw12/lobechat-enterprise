'use client';

import { Flexbox, SearchBar } from '@lobehub/ui';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { useToolStore } from '@/store/tool';

export const Search = memo(() => {
  const { t } = useTranslation('setting');
  const keywords = useToolStore((s) => s.customPluginSearchKeywords || '');

  return (
    <Flexbox flex={1}>
      <SearchBar
        allowClear
        defaultValue={keywords}
        placeholder={t('skillStore.search')}
        variant="outlined"
        onSearch={(value: string) => {
          useToolStore.setState({ customPluginSearchKeywords: value });
        }}
      />
    </Flexbox>
  );
});

export default Search;
