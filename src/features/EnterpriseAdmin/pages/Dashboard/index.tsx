import { Flexbox } from '@lobehub/ui';
import { Alert, Skeleton, Table, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Activity, AlertTriangle, Power, Wrench } from 'lucide-react';
import { memo } from 'react';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import StatCard from '../../components/StatCard';
import { useDashboardStats } from '../../hooks/useAdminData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  category: css`
    margin-block-start: 24px;
  `,
  grid: css`
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 16px;
  `,
  recent: css`
    margin-block-start: 24px;
  `,
  recentTitle: css`
    margin-block: 0 12px;
    font-size: 15px;
    font-weight: 600;
    color: ${cssVar.colorText};
  `,
}));

const outcomeTag = (outcome: string) => {
  const map: Record<string, { color: string; label: string }> = {
    allowed: { color: 'green', label: '成功' },
    denied: { color: 'red', label: '拒绝' },
    error: { color: 'orange', label: '异常' },
    ok: { color: 'green', label: '成功' },
  };
  const cfg = map[outcome] ?? { color: 'default', label: outcome };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
};

const DashboardPage = memo(() => {
  const { data, isLoading, error } = useDashboardStats();

  if (isLoading || !data) {
    return (
      <>
        <PageHeader description="chat-gw 工具目录与最近 24 小时调用概览" title="仪表盘" />
        <PageBody>
          {error ? (
            <Alert
              showIcon
              description={(error as Error).message}
              message="拉取 chat-gw admin 数据失败"
              type="error"
            />
          ) : (
            <Skeleton active paragraph={{ rows: 8 }} />
          )}
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        description="chat-gw 工具目录与最近 24 小时调用概览(数据源:/admin/tools + /admin/audit)"
        title="仪表盘"
      />
      <PageBody>
        <div className={styles.grid}>
          <StatCard icon={Wrench} label="注册工具" value={data.toolCount} />
          <StatCard
            hint={`共 ${data.toolCount} 个`}
            icon={Power}
            label="已启用工具"
            value={data.enabledToolCount}
          />
          <StatCard
            hint={data.auditCapped ? '实际 >500,已截断显示' : undefined}
            hintTone={data.auditCapped ? 'warn' : 'default'}
            icon={Activity}
            label="24h 调用"
            value={data.stats24h.total}
          />
          <StatCard
            hintTone={data.stats24h.denied + data.stats24h.error > 0 ? 'warn' : 'default'}
            icon={AlertTriangle}
            label="24h 失败"
            value={data.stats24h.denied + data.stats24h.error}
            hint={
              data.stats24h.denied + data.stats24h.error > 0
                ? `拒绝 ${data.stats24h.denied} · 异常 ${data.stats24h.error}`
                : '无失败'
            }
          />
        </div>

        <Flexbox className={styles.category}>
          <h3 className={styles.recentTitle}>工具按分类分布</h3>
          <Table
            dataSource={data.toolsByCategory}
            pagination={false}
            rowKey="category"
            size="small"
            columns={[
              { dataIndex: 'category', key: 'category', title: '分类' },
              { dataIndex: 'count', key: 'count', title: '工具数', width: 120 },
            ]}
          />
        </Flexbox>

        <Flexbox className={styles.recent}>
          <h3 className={styles.recentTitle}>最近 10 条调用</h3>
          <Table
            dataSource={data.recentAudit}
            pagination={false}
            rowKey="trace_id"
            size="middle"
            columns={[
              {
                dataIndex: 'at',
                key: 'at',
                render: (v: string) => new Date(v).toLocaleString(),
                title: '时间',
                width: 180,
              },
              { dataIndex: 'user_email', key: 'user_email', title: '用户', width: 180 },
              {
                dataIndex: 'tool_name',
                key: 'tool_name',
                render: (v: string | null) => (v ? <code>{v}</code> : '—'),
                title: '工具',
              },
              {
                dataIndex: 'outcome',
                key: 'outcome',
                render: outcomeTag,
                title: '结果',
                width: 100,
              },
              {
                dataIndex: 'error_kind',
                key: 'error_kind',
                render: (v: string | null, row: any) => v ?? row.deny_reason ?? '—',
                title: '原因',
                width: 200,
              },
            ]}
          />
        </Flexbox>
      </PageBody>
    </>
  );
});

DashboardPage.displayName = 'EnterpriseAdminDashboard';

export default DashboardPage;
