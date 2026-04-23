import { Flexbox } from '@lobehub/ui';
import { Alert, Checkbox, message, Select, Table, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { memo, useMemo, useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client/lambda';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import TableToolbar from '../../components/TableToolbar';
import { invalidate, useAdminTools, useGrants } from '../../hooks/useAdminData';

const ROLES = ['cloud_admin', 'cloud_ops', 'cloud_finance', 'cloud_viewer'] as const;
type Role = (typeof ROLES)[number];

const ROLE_LABELS: Record<Role, string> = {
  cloud_admin: 'A · admin',
  cloud_finance: 'F · finance',
  cloud_ops: 'O · ops',
  cloud_viewer: 'V · viewer',
};

const styles = createStaticStyles(({ css, cssVar }) => ({
  cellBusy: css`
    opacity: 0.4;
  `,
  tip: css`
    margin-block-end: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const GrantsPage = memo(() => {
  const { data: tools, isLoading: tLoading } = useAdminTools(true);
  const { data: grants, isLoading: gLoading } = useGrants();
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // { "cloud_admin|kb.search": true }
  const grantsSet = useMemo(() => {
    const s = new Set<string>();
    for (const g of grants ?? []) s.add(`${g.role}|${g.tool_name}`);
    return s;
  }, [grants]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tools ?? []) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [tools]);

  const filtered = useMemo(() => {
    let list = (tools ?? []).filter((t) => t.enabled); // 只展示启用的工具,给 admin 更清晰视图
    if (search.trim()) {
      const kw = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(kw) ||
          (t.display_name?.toLowerCase().includes(kw) ?? false),
      );
    }
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    return list;
  }, [tools, search, categoryFilter]);

  const handleToggle = async (role: Role, toolName: string, granted: boolean) => {
    const k = `${role}|${toolName}`;
    setBusy((b) => ({ ...b, [k]: true }));
    try {
      await lambdaClient.enterpriseAdmin.setGrant.mutate({ granted, role, toolName });
      invalidate('grants');
    } catch (err: any) {
      message.error(err?.message ?? '切换失败');
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[k];
        return n;
      });
    }
  };

  const roleCounts = useMemo(() => {
    const c: Record<Role, number> = {
      cloud_admin: 0,
      cloud_finance: 0,
      cloud_ops: 0,
      cloud_viewer: 0,
    };
    for (const g of grants ?? []) if (ROLES.includes(g.role as Role)) c[g.role as Role]++;
    return c;
  }, [grants]);

  const roleColumn = (role: Role) => ({
    align: 'center' as const,
    key: role,
    render: (_: any, t: any) => {
      const k = `${role}|${t.name}`;
      const checked = grantsSet.has(k);
      return (
        <Checkbox
          checked={checked}
          className={busy[k] ? styles.cellBusy : undefined}
          disabled={!!busy[k]}
          onChange={(e) => handleToggle(role, t.name, e.target.checked)}
        />
      );
    },
    title: (
      <Flexbox gap={2} style={{ textAlign: 'center' }}>
        <span>{ROLE_LABELS[role]}</span>
        <Tag style={{ margin: 0 }}>{roleCounts[role]}</Tag>
      </Flexbox>
    ),
    width: 120,
  });

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="4 角色 × 工具 授权矩阵。勾选 = INSERT,取消 = DELETE(幂等)。对应 chat-gw `/admin/tool-role-grants`。"
        title="角色授权"
      />
      <PageBody>
        <Alert
          showIcon
          className={styles.tip}
          message="授权变更立即生效:本实例刷新内存缓存 + Postgres NOTIFY 广播 + 对所有 SSE 会话推 notifications/tools/list_changed"
          type="info"
        />
        <TableToolbar
          searchPlaceholder="搜索工具 name / display_name"
          searchValue={search}
          onSearchChange={setSearch}
        >
          <Select
            allowClear
            placeholder="分类"
            style={{ width: 160 }}
            value={categoryFilter}
            options={[
              { label: '全部分类', value: '' },
              ...categories.map((c) => ({ label: c, value: c })),
            ]}
            onChange={setCategoryFilter}
          />
        </TableToolbar>
        <Table
          sticky
          dataSource={filtered}
          loading={tLoading || gLoading}
          pagination={{
            defaultPageSize: 50,
            showSizeChanger: true,
            showTotal: (t) => `共 ${t} 个工具`,
          }}
          rowKey="name"
          size="middle"
          columns={[
            { dataIndex: 'category', key: 'category', title: '分类', width: 110 },
            {
              dataIndex: 'name',
              key: 'name',
              render: (v: string) => <code>{v}</code>,
              title: 'Name',
              width: 240,
            },
            { dataIndex: 'display_name', key: 'display_name', title: '显示名' },
            roleColumn('cloud_admin'),
            roleColumn('cloud_ops'),
            roleColumn('cloud_finance'),
            roleColumn('cloud_viewer'),
          ]}
        />
      </PageBody>
    </Flexbox>
  );
});

GrantsPage.displayName = 'EnterpriseAdminGrants';

export default GrantsPage;
