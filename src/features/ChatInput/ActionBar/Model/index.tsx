import { LoadingOutlined } from '@ant-design/icons';
import { ModelIcon } from '@lobehub/icons';
import { Center, Flexbox } from '@lobehub/ui';
import { Spin } from 'antd';
import { createStaticStyles, cx } from 'antd-style';
import { Settings2Icon } from 'lucide-react';
import { memo, Suspense, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import ModelSwitchPanel from '@/features/ModelSwitchPanel';
import ModelDetailPanel from '@/features/ModelSwitchPanel/components/ModelDetailPanel';
import { useIsAdmin } from '@/hooks/useEnterpriseRole';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { aiModelSelectors, useAiInfraStore } from '@/store/aiInfra';
import { useUserStore } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import { useActionBarContext } from '../context';

const styles = createStaticStyles(({ css, cssVar }) => ({
  container: css`
    border-radius: 24px;
    background: ${cssVar.colorFillTertiary};
  `,
  icon: cx(
    'model-switch',
    css`
      transition: scale 400ms cubic-bezier(0.215, 0.61, 0.355, 1);
    `,
  ),
  model: css`
    cursor: pointer;
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillSecondary};
    }

    :active {
      .model-switch {
        scale: 0.8;
      }
    }
  `,
  modelWithControl: css`
    border-radius: 24px;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
}));

const ModelSwitch = memo(() => {
  const { t } = useTranslation('chat');
  const { dropdownPlacement } = useActionBarContext();
  const isDevMode = useUserStore((s) => userGeneralSettingsSelectors.config(s).isDevMode);
  // [enterprise-fork] 所有用户（包括普通用户）都可以在对话框切换模型，
  // 下拉内容是管理员启用的集合（严格来自 ai_models.enabled=true，见
  // packages/database/src/repositories/aiInfra/index.ts 的 enterprise-fork 改动）。
  // `isAdmin` 现在只用于控制 DevMode 下才显示的高级参数面板入口。
  const isAdmin = useIsAdmin();

  const agentId = useAgentId();
  const [model, provider, updateAgentConfigById] = useAgentStore((s) => [
    agentByIdSelectors.getAgentModelById(agentId)(s),
    agentByIdSelectors.getAgentModelProviderById(agentId)(s),
    s.updateAgentConfigById,
  ]);

  const isModelHasExtendParams = useAiInfraStore(
    aiModelSelectors.isModelHasExtendParams(model, provider),
  );

  const showExtendParams = isDevMode && isModelHasExtendParams && isAdmin;

  const handleModelChange = useCallback(
    async (params: { model: string; provider: string }) => {
      await updateAgentConfigById(agentId, params);
    },
    [agentId, updateAgentConfigById],
  );

  return (
    <Flexbox horizontal align={'center'} className={showExtendParams ? styles.container : ''}>
      <ModelSwitchPanel
        model={model}
        placement={dropdownPlacement}
        provider={provider}
        onModelChange={handleModelChange}
      >
        <Center
          className={cx(styles.model, showExtendParams && styles.modelWithControl)}
          height={36}
          width={36}
        >
          <div className={styles.icon}>
            <ModelIcon model={model} size={22} />
          </div>
        </Center>
      </ModelSwitchPanel>

      {showExtendParams && (
        <Action
          icon={Settings2Icon}
          showTooltip={false}
          style={{ borderRadius: 24, marginInlineStart: -4 }}
          title={t('extendParams.title')}
          popover={{
            content: (
              <Suspense
                fallback={
                  <Flexbox
                    align={'center'}
                    justify={'center'}
                    style={{ minHeight: 100, width: '100%' }}
                  >
                    <Spin indicator={<LoadingOutlined spin />} />
                  </Flexbox>
                }
              >
                <ModelDetailPanel model={model} provider={provider} />
              </Suspense>
            ),
            maxWidth: 400,
            minWidth: 400,
            placement: 'topLeft',
          }}
        />
      )}
    </Flexbox>
  );
});

ModelSwitch.displayName = 'ModelSwitch';

export default ModelSwitch;
