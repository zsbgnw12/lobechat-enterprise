'use client';

import { DEFAULT_REWRITE_QUERY } from '@lobechat/prompts';
import { useTranslation } from 'react-i18next';

import AdminOnly from '@/features/AdminOnly';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';
import { featureFlagsSelectors, useServerConfigStore } from '@/store/serverConfig';

import SystemAgentForm from '../agent/features/SystemAgentForm';
import Image from '../image/features/Image';
import OpenAI from '../tts/features/OpenAI';
import STT from '../tts/features/STT';

// [enterprise-fork] wrap in AdminOnly — 系统级 Agent 的模型绑定只给管理员
const Page = () => {
  const { t } = useTranslation('setting');
  const { enableKnowledgeBase, enableSTT, showAiImage } =
    useServerConfigStore(featureFlagsSelectors);
  return (
    <AdminOnly>
      <SettingHeader title={t('tab.serviceModel')} />
      <SystemAgentForm systemAgentKey="topic" />
      <SystemAgentForm systemAgentKey="generationTopic" />
      <SystemAgentForm systemAgentKey="translation" />
      <SystemAgentForm systemAgentKey="historyCompress" />
      <SystemAgentForm systemAgentKey="agentMeta" />
      <SystemAgentForm allowDisable systemAgentKey="inputCompletion" />
      <SystemAgentForm allowDisable systemAgentKey="promptRewrite" />
      {enableKnowledgeBase && (
        <SystemAgentForm
          allowCustomPrompt
          allowDisable
          defaultPrompt={DEFAULT_REWRITE_QUERY}
          systemAgentKey="queryRewrite"
        />
      )}
      {enableSTT && (
        <>
          <STT />
          <OpenAI />
        </>
      )}
      {showAiImage && <Image />}
    </AdminOnly>
  );
};

export default Page;
