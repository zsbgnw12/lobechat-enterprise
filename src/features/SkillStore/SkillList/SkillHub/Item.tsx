'use client';

import type { SkillHubSearchHit } from '@lobechat/types';
import { ActionIcon, Block, Flexbox, Icon, Tag } from '@lobehub/ui';
import { SkillsIcon } from '@lobehub/ui/icons';
import { App } from 'antd';
import { Check, Plus } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import SkillAvatar from '@/components/SkillAvatar';
import { useToolStore } from '@/store/tool';
import { agentSkillsSelectors } from '@/store/tool/selectors';

import { itemStyles } from '../style';

interface ItemProps {
  hit: SkillHubSearchHit;
}

const Item = memo<ItemProps>(({ hit }) => {
  const { t } = useTranslation('plugin');
  const { t: ts } = useTranslation('setting');
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const installed = useToolStore(agentSkillsSelectors.isSkillHubSkillInstalled(hit.slug));
  const importAgentSkillFromSkillHub = useToolStore((s) => s.importAgentSkillFromSkillHub);

  const handleInstall = async () => {
    if (installed || loading) return;
    setLoading(true);
    try {
      const imported = await importAgentSkillFromSkillHub({
        slug: hit.slug,
        version: hit.version,
      });
      const count = imported?.results.length ?? 0;
      message.success(
        count > 1
          ? ts('agentSkillModal.importSuccessCount', { count })
          : ts('agentSkillModal.importSuccess'),
      );
    } catch (error) {
      message.error(
        ts('agentSkillModal.importError', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Flexbox className={itemStyles.container} gap={0}>
      <Block
        horizontal
        align={'center'}
        gap={12}
        paddingBlock={12}
        paddingInline={12}
        variant={'outlined'}
      >
        <SkillAvatar size={40} />
        <Flexbox flex={1} gap={4} style={{ minWidth: 0, overflow: 'hidden' }}>
          <Flexbox horizontal align="center" gap={8}>
            <span className={itemStyles.title}>{hit.name}</span>
            <Tag icon={<Icon icon={SkillsIcon} />} size={'small'} />
            {hit.version ? <Tag size={'small'}>{hit.version}</Tag> : null}
          </Flexbox>
          <span className={itemStyles.description}>{hit.description || hit.slug}</span>
        </Flexbox>
        {installed ? (
          <ActionIcon icon={Check} title={ts('skillStore.skillHub.installed')} />
        ) : (
          <ActionIcon
            icon={Plus}
            loading={loading}
            title={t('store.actions.install')}
            onClick={handleInstall}
          />
        )}
      </Block>
    </Flexbox>
  );
});

Item.displayName = 'SkillHubListItem';

export default Item;
