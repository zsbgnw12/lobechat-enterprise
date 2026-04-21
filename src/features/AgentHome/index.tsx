'use client';

import { Flexbox } from '@lobehub/ui';
import isEqual from 'fast-deep-equal';
import { memo } from 'react';

import ToolAuthAlert from '@/routes/(main)/agent/features/Conversation/AgentWelcome/ToolAuthAlert';
import { useAgentStore } from '@/store/agent';
import { agentSelectors } from '@/store/agent/selectors';

import AgentInfo from './AgentInfo';

// [enterprise-fork] 去掉首页对话框下的 "示例问题" 板块——企业场景用户进来
// 明确是要调工具，不需要上游的闲聊引导样例。如需恢复，import OpeningQuestions
// 并把下面的注释行取消注释。
const AgentHome = memo(() => {
  // 保留 hook 调用维持选择器订阅稳定（避免 re-render 波动），但不再渲染
  useAgentStore(agentSelectors.openingQuestions, isEqual);

  return (
    <>
      <Flexbox flex={1} />
      <Flexbox gap={32} style={{ paddingBottom: 'max(4vh, 16px)' }} width={'100%'}>
        <AgentInfo />
        {/* <OpeningQuestions questions={openingQuestions} /> --- disabled */}
        <ToolAuthAlert />
      </Flexbox>
    </>
  );
});

export default AgentHome;
