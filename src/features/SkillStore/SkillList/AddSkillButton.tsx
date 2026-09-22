import { Button, DropdownMenu, Flexbox, Icon, Text } from '@lobehub/ui';
import { GithubIcon } from '@lobehub/ui/icons';
import { App } from 'antd';
import { ChevronDown, ClipboardList, FileArchive, Grid2x2Plus, Library, Link } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serverConfigSelectors, useServerConfigStore } from '@/store/serverConfig';
import { useToolStore } from '@/store/tool';

import ImportFromGithubModal from './ImportFromGithubModal';
import ImportFromSkillHubModal from './ImportFromSkillHubModal';
import ImportFromUrlModal from './ImportFromUrlModal';
import UploadSkillModal from './UploadSkillModal';

const MenuLabel = ({ desc, title }: { desc: string; title: ReactNode }) => (
  <Flexbox gap={2}>
    <span>{title}</span>
    <Text style={{ fontSize: 12 }} type="secondary">
      {desc}
    </Text>
  </Flexbox>
);

const AddSkillButton = () => {
  const { t } = useTranslation('setting');
  const { message } = App.useApp();
  // [enterprise-fork] SkillHub 入口仅在服务端配置了 SKILLHUB_URL 后出现
  const enableSkillHub = useServerConfigStore(serverConfigSelectors.enableSkillHub);
  const importBundledOrgSkills = useToolStore((s) => s.importBundledOrgSkills);
  const [showUrlModal, setUrlModal] = useState(false);
  const [showGithubModal, setGithubModal] = useState(false);
  const [showSkillHubModal, setSkillHubModal] = useState(false);
  const [showUploadModal, setUploadModal] = useState(false);
  const [bundledLoading, setBundledLoading] = useState(false);

  const handleImportBundled = async () => {
    setBundledLoading(true);
    try {
      const imported = await importBundledOrgSkills();
      const count = imported?.results.length ?? 0;
      message.success(
        count > 1
          ? t('agentSkillModal.importSuccessCount', { count })
          : t('agentSkillModal.importSuccess'),
      );
    } catch (error) {
      message.error(
        t('agentSkillModal.importError', {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBundledLoading(false);
    }
  };

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <ImportFromUrlModal open={showUrlModal} onOpenChange={setUrlModal} />
      <ImportFromGithubModal open={showGithubModal} onOpenChange={setGithubModal} />
      <ImportFromSkillHubModal open={showSkillHubModal} onOpenChange={setSkillHubModal} />
      <UploadSkillModal open={showUploadModal} onOpenChange={setUploadModal} />
      <DropdownMenu
        nativeButton={false}
        placement="bottomRight"
        items={[
          {
            // [enterprise-fork] 安装镜像自带的组织 SOP，不依赖 GitHub
            disabled: bundledLoading,
            icon: <Icon icon={ClipboardList} />,
            key: 'importBundled',
            label: (
              <MenuLabel
                desc={t('tab.importBundledOrgSkills.desc')}
                title={t('tab.importBundledOrgSkills')}
              />
            ),
            onClick: () => void handleImportBundled(),
          },
          {
            icon: <Icon icon={Link} />,
            key: 'importUrl',
            label: <MenuLabel desc={t('tab.importFromUrl.desc')} title={t('tab.importFromUrl')} />,
            onClick: () => setUrlModal(true),
          },
          {
            icon: <Icon icon={GithubIcon} />,
            key: 'importGithub',
            label: (
              <MenuLabel desc={t('tab.importFromGithub.desc')} title={t('tab.importFromGithub')} />
            ),
            onClick: () => setGithubModal(true),
          },
          ...(enableSkillHub
            ? [
                {
                  icon: <Icon icon={Library} />,
                  key: 'importSkillHub',
                  label: (
                    <MenuLabel
                      desc={t('tab.importFromSkillHub.desc')}
                      title={t('tab.importFromSkillHub')}
                    />
                  ),
                  onClick: () => setSkillHubModal(true),
                },
              ]
            : []),
          {
            icon: <Icon icon={FileArchive} />,
            key: 'uploadZip',
            label: <MenuLabel desc={t('tab.uploadZip.desc')} title={t('tab.uploadZip')} />,
            onClick: () => setUploadModal(true),
          },
        ]}
      >
        <Button icon={Grid2x2Plus} loading={bundledLoading}>
          {t('tab.addCustomSkill')}
          <Icon icon={ChevronDown} size={14} />
        </Button>
      </DropdownMenu>
    </div>
  );
};

export default AddSkillButton;
