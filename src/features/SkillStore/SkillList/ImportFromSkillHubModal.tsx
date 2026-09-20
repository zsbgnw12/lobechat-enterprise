'use client';

import { Alert, Flexbox, Icon, Input, SearchBar } from '@lobehub/ui';
import { App, Button, Modal, Typography } from 'antd';
import { ArrowLeftRight, Library, Sparkles } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { agentSkillService } from '@/services/skill';
import { useToolStore } from '@/store/tool';

interface ImportFromSkillHubModalProps {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

interface SkillHubHit {
  description?: string;
  name: string;
  slug: string;
  version?: string;
}

const ImportFromSkillHubModal = memo<ImportFromSkillHubModalProps>(({ open, onOpenChange }) => {
  const { t } = useTranslation(['setting', 'common']);
  const { message } = App.useApp();
  const importAgentSkillFromSkillHub = useToolStore((s) => s.importAgentSkillFromSkillHub);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slug, setSlug] = useState('');
  const [hits, setHits] = useState<SkillHubHit[]>([]);

  const handleClose = () => {
    onOpenChange(false);
    setError(null);
    setSlug('');
    setHits([]);
  };

  const handleSearch = async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError(null);
    try {
      const result = await agentSkillService.searchSkillHub(trimmed);
      setHits(result.data);
      if (result.data.length === 1) setSlug(result.data[0].slug);
    } catch (err: unknown) {
      setHits([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSearching(false);
    }
  };

  const handleImport = async (nextSlug = slug) => {
    const trimmed = nextSlug.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const imported = await importAgentSkillFromSkillHub({ slug: trimmed });
      const count = imported?.results.length ?? 0;
      message.success(
        count > 1
          ? t('agentSkillModal.importSuccessCount', { count })
          : t('agentSkillModal.importSuccess'),
      );
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal destroyOnClose footer={null} open={open} title={null} width={480} onCancel={handleClose}>
      <Flexbox align="center" gap={16} padding={'16px 0'}>
        <Flexbox horizontal align="center" gap={8}>
          <Icon icon={Library} size={28} />
          <Icon
            icon={ArrowLeftRight}
            size={16}
            style={{ color: 'var(--ant-color-text-tertiary)' }}
          />
          <Icon icon={Sparkles} size={28} />
        </Flexbox>

        <Flexbox align="center" gap={4}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {t('agentSkillModal.skillHub.title')}
          </Typography.Title>
          <Typography.Text style={{ textAlign: 'center' }} type="secondary">
            {t('agentSkillModal.skillHub.desc')}
          </Typography.Text>
        </Flexbox>
      </Flexbox>

      <Flexbox gap={16}>
        {error && (
          <Alert showIcon title={t('agentSkillModal.importError', { error })} type="error" />
        )}

        <SearchBar
          allowClear
          loading={searching}
          placeholder={t('agentSkillModal.skillHub.searchPlaceholder')}
          onSearch={handleSearch}
        />

        {hits.length > 0 && (
          <Flexbox gap={8}>
            {hits.map((hit) => (
              <Button
                disabled={loading}
                key={hit.slug}
                style={{ height: 'auto', textAlign: 'start' }}
                onClick={() => {
                  setSlug(hit.slug);
                  void handleImport(hit.slug);
                }}
              >
                <Flexbox gap={2}>
                  <span>{hit.name}</span>
                  <Typography.Text type="secondary">{hit.slug}</Typography.Text>
                </Flexbox>
              </Button>
            ))}
          </Flexbox>
        )}

        <Flexbox gap={8}>
          <Typography.Text strong>{t('agentSkillModal.skillHub.slug')}</Typography.Text>
          <Input
            placeholder={t('agentSkillModal.skillHub.slugPlaceholder')}
            value={slug}
            onPressEnter={() => handleImport()}
            onChange={(e) => {
              setSlug(e.target.value);
              if (error) setError(null);
            }}
          />
        </Flexbox>

        <Button block loading={loading} type="primary" onClick={() => handleImport()}>
          {t('common:import')}
        </Button>
      </Flexbox>
    </Modal>
  );
});

ImportFromSkillHubModal.displayName = 'ImportFromSkillHubModal';

export default ImportFromSkillHubModal;
