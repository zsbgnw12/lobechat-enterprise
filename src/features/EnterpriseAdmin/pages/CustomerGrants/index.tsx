import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Checkbox, Form, Input, message, Modal, Select, Table, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Plus, Trash2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client/lambda';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import TableToolbar from '../../components/TableToolbar';
import { invalidate, useAdminTools, useCustomerGrants } from '../../hooks/useAdminData';

const CUSTOMER_CODE_REGEX = /^[\w-]{1,32}$/u;

const styles = createStaticStyles(({ css, cssVar }) => ({
  cellBusy: css`
    opacity: 0.4;
  `,
  customerHeader: css`
    min-width: 140px;
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    word-break: break-all;
  `,
  tip: css`
    margin-block-end: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const CustomerGrantsPage = memo(() => {
  const { data: tools, isLoading: tLoading } = useAdminTools(false); // 只管 enabled 工具
  const { data: grants, isLoading: gLoading } = useCustomerGrants();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [addOpen, setAddOpen] = useState(false);
  const [newCustomerCode, setNewCustomerCode] = useState('');
  const [extraCustomers, setExtraCustomers] = useState<string[]>([]); // 还没授权但已列入矩阵
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // 从 grants 抽出"所有出现过"的 customer_code(大写比较,保顺序)
  const customersFromGrants = useMemo(() => {
    const set = new Set<string>();
    for (const g of grants ?? []) set.add(g.customer_code);
    return [...set].sort();
  }, [grants]);

  const allCustomers = useMemo(() => {
    const set = new Set([...customersFromGrants, ...extraCustomers]);
    return [...set].sort();
  }, [customersFromGrants, extraCustomers]);

  const grantsSet = useMemo(() => {
    const s = new Set<string>();
    for (const g of grants ?? []) s.add(`${g.customer_code}|${g.tool_name}`);
    return s;
  }, [grants]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tools ?? []) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [tools]);

  const filteredTools = useMemo(() => {
    let list = tools ?? [];
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

  const customerCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of grants ?? []) m[g.customer_code] = (m[g.customer_code] ?? 0) + 1;
    return m;
  }, [grants]);

  const handleAddCustomer = () => {
    const code = newCustomerCode.trim();
    if (!CUSTOMER_CODE_REGEX.test(code)) {
      message.error('格式应为 1-32 位字母/数字/下划线/连字符,建议 CUST-XXXXXXXX');
      return;
    }
    if (allCustomers.includes(code)) {
      message.info('该客户已在矩阵里');
    } else {
      setExtraCustomers((s) => [...s, code]);
      message.success(`客户 ${code} 已加入矩阵,勾选工具即开通授权`);
    }
    setNewCustomerCode('');
    setAddOpen(false);
  };

  const handleToggle = async (customerCode: string, toolName: string, granted: boolean) => {
    const k = `${customerCode}|${toolName}`;
    setBusy((b) => ({ ...b, [k]: true }));
    try {
      await lambdaClient.enterpriseAdmin.setCustomerGrant.mutate({
        customerCode,
        granted,
        toolName,
      });
      invalidate('customerGrants');
      // 如果客户之前只是 extraCustomers 里的,取消最后一个授权后仍保留(方便继续配置)
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

  const handleRemoveCustomerFromMatrix = (code: string) => {
    // 只是从界面移除,已保存的授权不动
    setExtraCustomers((s) => s.filter((c) => c !== code));
  };

  const customerColumn = (code: string) => ({
    align: 'center' as const,
    key: code,
    render: (_: any, t: any) => {
      const k = `${code}|${t.name}`;
      const checked = grantsSet.has(k);
      return (
        <Checkbox
          checked={checked}
          className={busy[k] ? styles.cellBusy : undefined}
          disabled={!!busy[k]}
          onChange={(e) => handleToggle(code, t.name, e.target.checked)}
        />
      );
    },
    title: (
      <Flexbox className={styles.customerHeader} gap={4}>
        <code>{code}</code>
        <Flexbox horizontal justify="center">
          <Tag style={{ margin: 0 }}>{customerCounts[code] ?? 0} 个工具</Tag>
          {extraCustomers.includes(code) && customerCounts[code] === undefined && (
            <Button
              icon={<Trash2 size={12} />}
              size="small"
              type="link"
              onClick={() => handleRemoveCustomerFromMatrix(code)}
            />
          )}
        </Flexbox>
      </Flexbox>
    ),
    width: 160,
  });

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="客户-工具 授权矩阵 (v0.2.0)。勾选 = 给某客户开通某工具。对应 chat-gw `/admin/tool-customer-grants`。"
        title="客户授权"
      />
      <PageBody>
        <Alert
          showIcon
          className={styles.tip}
          message="客户主档由工单系统托管,chat-gw 不存客户。这里的客户列来自已配置的授权 + 你手动加入的新客户。登录时 chat-gw 会实时校验 customer_code 是否真实存在于工单系统。"
          type="info"
        />

        {allCustomers.length === 0 && !gLoading && !tLoading && (
          <Alert
            showIcon
            message="还没有任何客户授权 — 先添加一个客户编号(比如 CUST-C5265489),然后勾选要开通的工具。"
            type="warning"
            action={
              <Button
                icon={<Plus size={14} />}
                size="small"
                type="primary"
                onClick={() => setAddOpen(true)}
              >
                添加客户
              </Button>
            }
          />
        )}

        <TableToolbar
          searchPlaceholder="搜索工具 name / display_name"
          searchValue={search}
          actions={
            <Button icon={<Plus size={14} />} type="primary" onClick={() => setAddOpen(true)}>
              添加客户
            </Button>
          }
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

        {allCustomers.length > 0 && (
          <Table
            sticky
            dataSource={filteredTools}
            loading={tLoading || gLoading}
            rowKey="name"
            scroll={{ x: 'max-content' }}
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
              ...allCustomers.map(customerColumn),
            ]}
            pagination={{
              defaultPageSize: 50,
              showSizeChanger: true,
              showTotal: (t) => `共 ${t} 个工具 · ${allCustomers.length} 个客户`,
            }}
          />
        )}

        <Modal
          okText="加入矩阵"
          open={addOpen}
          title="添加客户到授权矩阵"
          onOk={handleAddCustomer}
          onCancel={() => {
            setAddOpen(false);
            setNewCustomerCode('');
          }}
        >
          <Form layout="vertical">
            <Form.Item
              extra="格式:CUST-C5265489(1-32 位,字母/数字/下划线/连字符)。不会立即创建任何东西,只是让它出现在矩阵里供你勾选。"
              label="客户编号 (customer_code)"
            >
              <Input
                autoFocus
                placeholder="CUST-C5265489"
                value={newCustomerCode}
                onChange={(e) => setNewCustomerCode(e.target.value)}
                onPressEnter={handleAddCustomer}
              />
            </Form.Item>
          </Form>
        </Modal>
      </PageBody>
    </Flexbox>
  );
});

CustomerGrantsPage.displayName = 'EnterpriseAdminCustomerGrants';

export default CustomerGrantsPage;
