'use client';

import { Flexbox } from '@lobehub/ui';

import { useIsAdmin } from '@/hooks/useEnterpriseRole';

import Search from './Search';
import AddSkillButton from './SkillList/AddSkillButton';
import CustomList from './SkillList/Custom';

export const SkillStoreContent = () => {
  const isAdmin = useIsAdmin();

  return (
    <Flexbox gap={8} style={{ maxHeight: '75vh' }} width={'100%'}>
      <Flexbox gap={8} paddingInline={16}>
        <Flexbox horizontal align={'center'} gap={8}>
          <Search />
          {isAdmin ? <AddSkillButton /> : null}
        </Flexbox>
      </Flexbox>
      <Flexbox height={496} style={{ overflow: 'auto' }}>
        <CustomList />
      </Flexbox>
    </Flexbox>
  );
};
