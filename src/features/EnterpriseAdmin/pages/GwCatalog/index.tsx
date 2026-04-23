import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Collapse, Empty, Skeleton, Space, Tag, Tooltip } from 'antd';
import { createStaticStyles } from 'antd-style';
import { PlayCircle } from 'lucide-react';
import { memo, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import PageHeader from '../../_layout/PageHeader';
import CasdoorLoginGate from '../../components/CasdoorLoginGate';
import PageBody from '../../components/PageBody';
import TableToolbar from '../../components/TableToolbar';
import { useGatewayTools } from '../../hooks/useGatewayData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  cat: css`
    margin-block-end: 16px;
  `,
  catHeader: css`
    display: flex;
    gap: 8px;
    align-items: center;

    padding-block: 8px;
    padding-inline: 12px;
    border-radius: 8px;

    font-size: 14px;
    font-weight: 600;

    background: ${cssVar.colorFillQuaternary};
  `,
  desc: css`
    font-size: 13px;
    color: ${cssVar.colorTextSecondary};
  `,
  schema: css`
    overflow: auto;

    max-height: 260px;
    margin-block-start: 8px;
    padding: 10px;
    border-radius: 6px;

    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    white-space: pre;

    background: ${cssVar.colorFillTertiary};
  `,
  toolKey: css`
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 13px;
  `,
}));

const GwCatalogPage = memo(() => {
  const navigate = useNavigate();
  const { data: tools, isLoading, error } = useGatewayTools();
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const list = tools ?? [];
    const kw = search.trim().toLowerCase();
    const filtered = kw
      ? list.filter(
          (t) =>
            t.name.toLowerCase().includes(kw) ||
            (t.description?.toLowerCase().includes(kw) ?? false),
        )
      : list;
    const map: Record<string, typeof list> = {};
    for (const t of filtered) {
      const cat = t.name.split('.')[0] || 'other';
      (map[cat] ||= []).push(t);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [tools, search]);

  const total = tools?.length ?? 0;

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="chat-gw 的 tools/list 返回 —— 当前账号角色下可见的完整工具清单。展开看每个工具的 inputSchema。"
        title={`AI 网关 · 目录  (${total})`}
      />
      <PageBody>
        <CasdoorLoginGate>
          <TableToolbar
            searchPlaceholder="搜索工具名 / 描述"
            searchValue={search}
            onSearchChange={setSearch}
          />
          {error ? (
            <Alert
              showIcon
              description={(error as Error).message}
              message="tools/list 调用失败"
              type="error"
            />
          ) : isLoading ? (
            <Skeleton active paragraph={{ rows: 12 }} />
          ) : total === 0 ? (
            <Empty description="当前账号无可见工具。" />
          ) : (
            grouped.map(([cat, list]) => (
              <div className={styles.cat} key={cat}>
                <div className={styles.catHeader}>
                  <Tag color="blue">{cat}</Tag>
                  <span>{list.length} 个</span>
                </div>
                <Collapse
                  bordered={false}
                  size="small"
                  items={list.map((t) => ({
                    children: (
                      <Flexbox gap={8}>
                        {t.description && <div className={styles.desc}>{t.description}</div>}
                        <Space size={8}>
                          <Tooltip title="去调试台试这个工具">
                            <Button
                              icon={<PlayCircle size={14} />}
                              size="small"
                              type="primary"
                              onClick={() =>
                                navigate(
                                  `/settings/enterprise-admin/gw-tester?name=${encodeURIComponent(t.name)}`,
                                )
                              }
                            >
                              试调用
                            </Button>
                          </Tooltip>
                        </Space>
                        <pre className={styles.schema}>
                          {JSON.stringify(t.inputSchema, null, 2)}
                        </pre>
                      </Flexbox>
                    ),
                    key: t.name,
                    label: <span className={styles.toolKey}>{t.name}</span>,
                  }))}
                />
              </div>
            ))
          )}
        </CasdoorLoginGate>
      </PageBody>
    </Flexbox>
  );
});

GwCatalogPage.displayName = 'EnterpriseAdminGwCatalog';

export default GwCatalogPage;
