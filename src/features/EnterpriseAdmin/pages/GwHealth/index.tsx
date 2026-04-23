import { Flexbox } from '@lobehub/ui';
import { Alert, Skeleton, Table, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import { useGatewayInitialize, useGatewayReadyz } from '../../hooks/useGatewayData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 12px;
  `,
  item: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;
    background: ${cssVar.colorBgContainer};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  section: css`
    margin-block-start: 24px;
  `,
  sectionTitle: css`
    margin-block: 0 12px;
    margin-inline: 0;
    font-size: 15px;
    font-weight: 600;
  `,
  value: css`
    margin-block-start: 4px;
    font-size: 18px;
    font-weight: 600;
  `,
}));

const dot = (ok: boolean) => ({
  background: ok ? '#16a34a' : '#dc2626',
  borderRadius: '50%',
  display: 'inline-block',
  height: 10,
  marginRight: 6,
  width: 10,
});

const GwHealthPage = memo(() => {
  const { data: ready, isLoading: rLoading, error: rErr } = useGatewayReadyz();
  const { data: init, isLoading: iLoading, error: iErr } = useGatewayInitialize();

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="chat-gw 服务的实时健康。/readyz 每 10 秒自动刷新;initialize 用当前账号 token 调一次。"
        title="AI 网关 · 健康"
      />
      <PageBody>
        {rErr && (
          <Alert
            message={`无法读取 /readyz: ${(rErr as Error).message}`}
            style={{ marginBottom: 16 }}
            type="error"
          />
        )}

        <h3 className={styles.sectionTitle}>subsystem 状态</h3>
        {rLoading || !ready ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : (
          <>
            <div className={styles.grid}>
              {(['postgres', 'redis', 'jwks'] as const).map((k) => {
                const v = ready.checks[k];
                const ok = v === 'ok';
                return (
                  <div className={styles.item} key={k}>
                    <div className={styles.label}>{k.toUpperCase()}</div>
                    <div className={styles.value}>
                      <span style={dot(ok)} />
                      {ok ? 'OK' : v}
                    </div>
                  </div>
                );
              })}
              <div className={styles.item}>
                <div className={styles.label}>TOOLS</div>
                <div className={styles.value}>
                  <span style={dot(ready.checks.tools.issues.length === 0)} />
                  {ready.checks.tools.ok} / {ready.checks.tools.total}
                </div>
              </div>
              <div className={styles.item}>
                <div className={styles.label}>OVERALL</div>
                <div className={styles.value}>
                  <Tag color={ready.status === 'ready' ? 'green' : 'orange'}>{ready.status}</Tag>
                </div>
              </div>
            </div>

            {ready.checks.tools.issues.length > 0 && (
              <Alert
                message={`${ready.checks.tools.issues.length} 个工具加载异常`}
                style={{ marginTop: 16 }}
                type="warning"
                description={
                  <pre style={{ fontSize: 12, margin: 0 }}>
                    {JSON.stringify(ready.checks.tools.issues, null, 2)}
                  </pre>
                }
              />
            )}

            {ready.checks.production_env && (
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>production_env checks</h3>
                <Table
                  dataSource={ready.checks.production_env}
                  pagination={false}
                  rowKey="name"
                  size="small"
                  columns={[
                    { dataIndex: 'name', key: 'name', title: '检查项', width: 260 },
                    {
                      dataIndex: 'ok',
                      key: 'ok',
                      render: (v: boolean) => (
                        <Tag color={v ? 'green' : 'red'}>{v ? 'OK' : 'FAIL'}</Tag>
                      ),
                      title: '状态',
                      width: 100,
                    },
                    { dataIndex: 'detail', key: 'detail', title: '详情' },
                  ]}
                />
              </div>
            )}
          </>
        )}

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>initialize</h3>
          {iErr && (
            <Alert
              showIcon
              description={(iErr as Error).message}
              message="initialize 失败"
              type="warning"
            />
          )}
          {iLoading ? (
            <Skeleton active paragraph={{ rows: 2 }} />
          ) : init ? (
            <div className={styles.grid}>
              <div className={styles.item}>
                <div className={styles.label}>server name</div>
                <div className={styles.value}>{init.serverInfo?.name}</div>
              </div>
              <div className={styles.item}>
                <div className={styles.label}>server version</div>
                <div className={styles.value}>{init.serverInfo?.version}</div>
              </div>
              <div className={styles.item}>
                <div className={styles.label}>protocol</div>
                <div className={styles.value}>{init.protocolVersion}</div>
              </div>
              <div className={styles.item}>
                <div className={styles.label}>capabilities</div>
                <div className={styles.value} style={{ fontSize: 13, fontWeight: 400 }}>
                  <code>{JSON.stringify(init.capabilities)}</code>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </PageBody>
    </Flexbox>
  );
});

GwHealthPage.displayName = 'EnterpriseAdminGwHealth';

export default GwHealthPage;
