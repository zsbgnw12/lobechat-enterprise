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
  categoryRow: css`
    background: ${cssVar.colorFillTertiary};
  `,
  tip: css`
    margin-block-end: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

interface TreeRow {
  category: string;
  children?: TreeRow[];
  description?: string | null;
  display_name?: string | null;
  isCategory?: boolean;
  key: string;
  name: string;
  toolNames?: string[]; // 只在 category 行有:该分类下所有 enabled 工具名
}

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

  // 构造 tree:category 节点 + 其下子工具节点
  const treeData = useMemo<TreeRow[]>(() => {
    let list = (tools ?? []).filter((t) => t.enabled);
    if (search.trim()) {
      const kw = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(kw) ||
          (t.display_name?.toLowerCase().includes(kw) ?? false),
      );
    }
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);

    const buckets = new Map<string, typeof list>();
    for (const t of list) {
      const c = t.category || 'other';
      const arr = buckets.get(c);
      if (arr) arr.push(t);
      else buckets.set(c, [t]);
    }

    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, arr]) => ({
        category: cat,
        children: arr.map((t) => ({
          category: cat,
          description: t.description,
          display_name: t.display_name,
          key: t.name,
          name: t.name,
        })),
        display_name: `(${arr.length} 工具)`,
        isCategory: true,
        key: `__cat__${cat}`,
        name: cat,
        toolNames: arr.map((t) => t.name),
      }));
  }, [tools, search, categoryFilter]);

  const handleToggleOne = async (role: Role, toolName: string, granted: boolean) => {
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

  /** 分类级全选/全清:按当前状态决定方向,并发调 setGrant */
  const handleToggleCategory = async (role: Role, category: string, toolNames: string[]) => {
    const targetChecked = toolNames.some((n) => !grantsSet.has(`${role}|${n}`)); // 有未选 → 全选
    const busyKey = `__cat__${role}|${category}`;
    setBusy((b) => ({ ...b, [busyKey]: true }));
    try {
      await Promise.all(
        toolNames.map((n) => {
          const isIn = grantsSet.has(`${role}|${n}`);
          if (targetChecked && !isIn) {
            return lambdaClient.enterpriseAdmin.setGrant.mutate({
              granted: true,
              role,
              toolName: n,
            });
          }
          if (!targetChecked && isIn) {
            return lambdaClient.enterpriseAdmin.setGrant.mutate({
              granted: false,
              role,
              toolName: n,
            });
          }
          return null;
        }),
      );
      invalidate('grants');
    } catch (err: any) {
      message.error(err?.message ?? '批量切换失败');
    } finally {
      setBusy((b) => {
        const n = { ...b };
        delete n[busyKey];
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

  const renderCell = (role: Role) => (_: any, r: TreeRow) => {
    if (r.isCategory) {
      const names = r.toolNames || [];
      const selected = names.filter((n) => grantsSet.has(`${role}|${n}`));
      const all = selected.length === names.length && names.length > 0;
      const none = selected.length === 0;
      const busyKey = `__cat__${role}|${r.category}`;
      return (
        <Flexbox gap={2} style={{ alignItems: 'center' }}>
          <Checkbox
            checked={all}
            className={busy[busyKey] ? styles.cellBusy : undefined}
            disabled={!!busy[busyKey]}
            indeterminate={!all && !none}
            onChange={() => handleToggleCategory(role, r.category, names)}
          />
          <span style={{ color: '#888', fontSize: 11 }}>
            {selected.length}/{names.length}
          </span>
        </Flexbox>
      );
    }
    const k = `${role}|${r.name}`;
    return (
      <Checkbox
        checked={grantsSet.has(k)}
        className={busy[k] ? styles.cellBusy : undefined}
        disabled={!!busy[k]}
        onChange={(e) => handleToggleOne(role, r.name, e.target.checked)}
      />
    );
  };

  const roleColumn = (role: Role) => ({
    align: 'center' as const,
    key: role,
    render: renderCell(role),
    title: (
      <Flexbox gap={2} style={{ textAlign: 'center' }}>
        <span>{ROLE_LABELS[role]}</span>
        <Tag style={{ margin: 0 }}>{roleCounts[role]}</Tag>
      </Flexbox>
    ),
    width: 130,
  });

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="4 角色 × 工具 授权矩阵。可按分类展开单个工具,或直接勾分类表头批量授权。对应 chat-gw `/admin/tool-role-grants`。"
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
        <Table<TreeRow>
          sticky
          dataSource={treeData}
          loading={tLoading || gLoading}
          pagination={false}
          rowClassName={(r) => (r.isCategory ? styles.categoryRow : '')}
          rowKey="key"
          size="middle"
          columns={[
            {
              dataIndex: 'name',
              key: 'name',
              render: (v: string, r) => (r.isCategory ? <strong>{v}</strong> : <code>{v}</code>),
              title: '工具 / 分类',
              width: 320,
            },
            { dataIndex: 'display_name', key: 'display_name', title: '显示名' },
            roleColumn('cloud_admin'),
            roleColumn('cloud_ops'),
            roleColumn('cloud_finance'),
            roleColumn('cloud_viewer'),
          ]}
          expandable={{
            defaultExpandAllRows: false,
            indentSize: 16,
          }}
        />
      </PageBody>
    </Flexbox>
  );
});

GrantsPage.displayName = 'EnterpriseAdminGrants';

export default GrantsPage;
