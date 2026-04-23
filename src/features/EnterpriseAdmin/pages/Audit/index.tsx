import { Flexbox } from '@lobehub/ui';
import { Button, DatePicker, Drawer, Input, Select, Space, Table, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useState } from 'react';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import TableToolbar from '../../components/TableToolbar';
import { useAudit } from '../../hooks/useAdminData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  jsonBlock: css`
    overflow: auto;

    max-height: 320px;
    padding: 12px;
    border-radius: 8px;

    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    white-space: pre-wrap;

    background: ${cssVar.colorFillTertiary};
  `,
  label: css`
    margin-block: 12px 6px;
    font-size: 13px;
    font-weight: 600;
    color: ${cssVar.colorTextSecondary};
  `,
  pager: css`
    justify-content: flex-end;
    margin-block-start: 12px;
  `,
}));

const outcomeTag = (v: string) => {
  const map: Record<string, { color: string; label: string }> = {
    allowed: { color: 'green', label: '成功' },
    denied: { color: 'red', label: '拒绝' },
    error: { color: 'orange', label: '异常' },
    ok: { color: 'green', label: '成功' },
  };
  const cfg = map[v] ?? { color: 'default', label: v };
  return <Tag color={cfg.color}>{cfg.label}</Tag>;
};

interface Filters {
  from?: string;
  outcome?: 'ok' | 'allowed' | 'denied' | 'error';
  to?: string;
  toolName?: string;
  userId?: string;
}

const AuditPage = memo(() => {
  const [filters, setFilters] = useState<Filters>({});
  const [cursorStack, setCursorStack] = useState<string[]>([]); // 支持"上一页"
  const currentCursor = cursorStack.at(-1);

  const { data, isLoading } = useAudit({ ...filters, cursor: currentCursor, limit: 50 });
  const [detail, setDetail] = useState<any | null>(null);

  const resetCursor = () => setCursorStack([]);

  const onFilterChange = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    resetCursor();
  };

  const nextPage = () => {
    if (data?.next_cursor) setCursorStack((s) => [...s, data.next_cursor as string]);
  };
  const prevPage = () => setCursorStack((s) => s.slice(0, -1));

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="chat-gw `/admin/audit` · keyset 分页 · 包含 trace_id / latency / error_kind / sensitive_fields_hit"
        title="审计日志"
      />
      <PageBody>
        <TableToolbar>
          <Input
            allowClear
            placeholder="user_id"
            style={{ width: 220 }}
            value={filters.userId}
            onChange={(e) => onFilterChange({ userId: e.target.value || undefined })}
          />
          <Input
            allowClear
            placeholder="tool_name(精确)"
            style={{ width: 220 }}
            value={filters.toolName}
            onChange={(e) => onFilterChange({ toolName: e.target.value || undefined })}
          />
          <Select
            allowClear
            placeholder="结果"
            style={{ width: 180 }}
            value={filters.outcome}
            options={[
              { label: '成功 (allowed/ok)', value: 'allowed' },
              { label: '拒绝 (denied)', value: 'denied' },
              { label: '异常 (error)', value: 'error' },
            ]}
            onChange={(v) => onFilterChange({ outcome: v })}
          />
          <DatePicker.RangePicker
            showTime
            onChange={(range) => {
              onFilterChange({
                from: range?.[0]?.toISOString(),
                to: range?.[1]?.toISOString(),
              });
            }}
          />
          <Button
            onClick={() => {
              setFilters({});
              resetCursor();
            }}
          >
            重置
          </Button>
        </TableToolbar>

        <Table
          dataSource={data?.items ?? []}
          loading={isLoading}
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
            {
              dataIndex: 'user_email',
              key: 'user_email',
              render: (v: string | null, r: any) => v ?? r.user_id.slice(0, 8),
              title: '用户',
              width: 200,
            },
            {
              dataIndex: 'tool_name',
              key: 'tool_name',
              render: (v: string | null) => (v ? <code>{v}</code> : '—'),
              title: '工具',
              width: 240,
            },
            {
              dataIndex: 'outcome',
              key: 'outcome',
              render: outcomeTag,
              title: '结果',
              width: 90,
            },
            {
              dataIndex: 'latency_ms',
              key: 'latency_ms',
              render: (v: number | null) => (v == null ? '—' : `${v} ms`),
              title: '耗时',
              width: 90,
            },
            {
              dataIndex: 'error_kind',
              key: 'error_kind',
              render: (v: string | null, r: any) => v ?? r.deny_reason ?? '—',
              title: '原因/错误类',
              width: 200,
            },
          ]}
          onRow={(row) => ({ onClick: () => setDetail(row) })}
        />

        <Flexbox horizontal className={styles.pager} gap={8}>
          <span style={{ alignSelf: 'center', opacity: 0.6 }}>
            第 {cursorStack.length + 1} 页 · 本页 {data?.items.length ?? 0} 条
          </span>
          <Button
            disabled={cursorStack.length === 0}
            icon={<ChevronLeft size={14} />}
            onClick={prevPage}
          >
            上一页
          </Button>
          <Button
            disabled={!data?.next_cursor}
            icon={<ChevronRight size={14} />}
            iconPosition="end"
            onClick={nextPage}
          >
            下一页
          </Button>
        </Flexbox>

        <Drawer
          open={!!detail}
          width={680}
          title={
            detail
              ? `${detail.tool_name ?? '(no tool)'} · ${detail.user_email ?? detail.user_id}`
              : ''
          }
          onClose={() => setDetail(null)}
        >
          {detail && (
            <Flexbox gap={4}>
              <Space wrap size={8}>
                <Tag>{new Date(detail.at).toLocaleString()}</Tag>
                {outcomeTag(detail.outcome)}
                {detail.latency_ms != null && <Tag>{detail.latency_ms} ms</Tag>}
                {detail.error_code != null && <Tag color="red">code {detail.error_code}</Tag>}
                {detail.error_kind && <Tag color="warning">{detail.error_kind}</Tag>}
              </Space>
              <div className={styles.label}>trace_id</div>
              <pre className={styles.jsonBlock}>{detail.trace_id}</pre>
              <div className={styles.label}>user</div>
              <pre className={styles.jsonBlock}>
                {JSON.stringify(
                  {
                    email: detail.user_email,
                    roles: detail.roles,
                    user_id: detail.user_id,
                  },
                  null,
                  2,
                )}
              </pre>
              <div className={styles.label}>arguments</div>
              <pre className={styles.jsonBlock}>
                {JSON.stringify(detail.arguments ?? null, null, 2)}
              </pre>
              {(detail.sensitive_fields_hit?.length ?? 0) > 0 && (
                <>
                  <div className={styles.label}>sensitive_fields_hit</div>
                  <Space wrap>
                    {detail.sensitive_fields_hit.map((f: string) => (
                      <Tag color="red" key={f}>
                        {f}
                      </Tag>
                    ))}
                  </Space>
                </>
              )}
              {(detail.deny_reason || detail.error_message) && (
                <>
                  <div className={styles.label}>错误/拒绝详情</div>
                  <pre className={styles.jsonBlock}>
                    {detail.deny_reason ?? detail.error_message}
                  </pre>
                </>
              )}
            </Flexbox>
          )}
        </Drawer>
      </PageBody>
    </Flexbox>
  );
});

AuditPage.displayName = 'EnterpriseAdminAudit';

export default AuditPage;
