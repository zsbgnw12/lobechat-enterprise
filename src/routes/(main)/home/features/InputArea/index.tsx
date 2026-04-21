import { Flexbox } from '@lobehub/ui';
import { useEffect, useMemo, useRef } from 'react';

import DragUploadZone, { useUploadFiles } from '@/components/DragUploadZone';
import { type ActionKeys } from '@/features/ChatInput';
import { ChatInputProvider, DesktopChatInput } from '@/features/ChatInput';
import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';
import { useChatStore } from '@/store/chat';
import { useGlobalStore } from '@/store/global';
import { systemStatusSelectors } from '@/store/global/selectors';
import { useHomeStore } from '@/store/home';
import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';

import ModeTag from './ModeTag';
import SkillInstallBanner, { SKILL_INSTALL_BANNER_ID } from './SkillInstallBanner';
import { useSend } from './useSend';

// [enterprise-fork] 以下 import 已在注释掉的 JSX 里使用；保留 JSX 需要时恢复：
//   import { AnimatePresence, m } from 'motion/react';
//   import CommunityRecommend from '../CommunityRecommend';
//   import SuggestQuestions from '../SuggestQuestions';
//   import StarterList from './StarterList';

const leftActions: ActionKeys[] = ['model', 'search', 'fileUpload', 'tools'];

const InputArea = () => {
  const { loading, send, inboxAgentId } = useSend();
  const inputActiveMode = useHomeStore((s) => s.inputActiveMode);
  const isLobehubSkillEnabled = useServerConfigStore(serverConfigSelectors.enableLobehubSkill);
  const isKlavisEnabled = useServerConfigStore(serverConfigSelectors.enableKlavis);
  const isSkillBannerDismissed = useGlobalStore(
    systemStatusSelectors.isBannerDismissed(SKILL_INSTALL_BANNER_ID),
  );
  const showSkillBanner = (isLobehubSkillEnabled || isKlavisEnabled) && !isSkillBannerDismissed;
  const chatInputRef = useRef<HTMLDivElement>(null);

  // When a starter mode is activated (e.g. Create Agent / Create Group / Write),
  // the SuggestQuestions panel renders below the ChatInput and may push the total
  // content height beyond the viewport, causing the ChatInput to scroll out of view.
  // Re-focus the editor and scroll it into view so the user can type immediately.
  useEffect(() => {
    if (!inputActiveMode) return;

    requestAnimationFrame(() => {
      chatInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      useChatStore.getState().mainInputEditor?.focus();
    });
  }, [inputActiveMode]);

  // Get agent's model info for vision support check
  const model = useAgentStore((s) => agentByIdSelectors.getAgentModelById(inboxAgentId)(s));
  const provider = useAgentStore((s) =>
    agentByIdSelectors.getAgentModelProviderById(inboxAgentId)(s),
  );
  const { handleUploadFiles } = useUploadFiles({ model, provider });

  // A slot to insert content above the chat input
  // Override some default behavior of the chat input
  const inputContainerProps = useMemo(
    () => ({
      minHeight: 88,
      resize: false,
      style: {
        borderRadius: 20,
        boxShadow: '0 12px 32px rgba(0,0,0,.04)',
      },
    }),
    [],
  );

  // [enterprise-fork] hideStarterList / showSuggestQuestions 是给已注释掉的
  // StarterList / SuggestQuestions 用的——恢复 JSX 时一起恢复这两个 const。

  const extraActionItems = useMemo(
    () =>
      inputActiveMode
        ? [
            {
              children: <ModeTag />,
              key: 'mode-tag',
            },
          ]
        : [],
    [inputActiveMode],
  );

  return (
    <Flexbox gap={16} style={{ marginBottom: 16 }}>
      <Flexbox
        ref={chatInputRef}
        style={{ paddingBottom: showSkillBanner ? 32 : 0, position: 'relative' }}
      >
        {showSkillBanner && <SkillInstallBanner />}
        <DragUploadZone
          style={{ position: 'relative', zIndex: 1 }}
          onUploadFiles={handleUploadFiles}
        >
          <ChatInputProvider
            agentId={inboxAgentId}
            allowExpand={false}
            leftActions={leftActions}
            slashPlacement="bottom"
            chatInputEditorRef={(instance) => {
              if (!instance) return;
              useChatStore.setState({ mainInputEditor: instance });
            }}
            sendButtonProps={{
              disabled: loading,
              generating: loading,
              onStop: () => {},
              shape: 'round',
            }}
            onSend={send}
            onMarkdownContentChange={(content) => {
              useChatStore.setState({ inputMessage: content });
            }}
          >
            <DesktopChatInput
              dropdownPlacement="bottomLeft"
              extraActionItems={extraActionItems}
              inputContainerProps={inputContainerProps}
              showRuntimeConfig={false}
            />
          </ChatInputProvider>
        </DragUploadZone>
      </Flexbox>

      {/* [enterprise-fork] 隐藏首页对话框下方的引导 / 示例 / 社区推荐板块。
          原先在此渲染 StarterList / SuggestQuestions / CommunityRecommend
          三件套（闲聊引导 chip、AI 推荐问题、社区分享入口）。企业场景用户
          明确是来调工具的，这些只是噪音。保留了 `showSuggestQuestions` 等
          计算值的声明以维持 hook 调用顺序稳定。如需恢复，取消下面 JSX 注释即可。
      <div style={{ display: hideStarterList ? 'none' : undefined }}>
        <StarterList />
      </div>
      <AnimatePresence mode="popLayout">
        {showSuggestQuestions && (
          <m.div
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            key={inputActiveMode ?? 'chat'}
            style={{ marginTop: inputActiveMode ? 0 : 24 }}
            transition={{
              duration: 0.2,
              ease: [0.4, 0, 0.2, 1],
            }}
          >
            <Flexbox gap={24}>
              <SuggestQuestions mode={inputActiveMode} />
              <CommunityRecommend mode={inputActiveMode} />
            </Flexbox>
          </m.div>
        )}
      </AnimatePresence>
      */}
    </Flexbox>
  );
};

export default InputArea;
