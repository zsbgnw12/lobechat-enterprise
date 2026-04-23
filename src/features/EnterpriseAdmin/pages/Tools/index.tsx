import { Flexbox } from '@lobehub/ui';
import {
  Button,
  Drawer,
  Form,
  Input,
  message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from 'antd';
import { createStaticStyles } from 'antd-style';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { lambdaClient } from '@/libs/trpc/client/lambda';

import PageHeader from '../../_layout/PageHeader';
import PageBody from '../../components/PageBody';
import TableToolbar from '../../components/TableToolbar';
import { invalidate, useAdminTools } from '../../hooks/useAdminData';

const styles = createStaticStyles(({ css, cssVar }) => ({
  codeBlock: css`
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const DISPATCHER_OPTS = [
  { label: 'http_adapter', value: 'http_adapter' },
  { label: 'mcp_proxy', value: 'mcp_proxy' },
  { label: 'daytona_sandbox', value: 'daytona_sandbox' },
];

const AUTH_OPTS = [
  { label: 'service_key(网关持密钥)', value: 'service_key' },
  { label: 'user_passthrough(JWT 直透)', value: 'user_passthrough' },
];

const parseJsonOr = (s: string | undefined | null, fallback: any) => {
  if (!s || !s.trim()) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    throw new Error('非法 JSON');
  }
};

const ToolsPage = memo(() => {
  const { data: tools, isLoading } = useAdminTools(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form] = Form.useForm();

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of tools ?? []) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [tools]);

  const filtered = useMemo(() => {
    let list = tools ?? [];
    if (search.trim()) {
      const kw = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(kw) ||
          (t.display_name?.toLowerCase().includes(kw) ?? false) ||
          (t.description?.toLowerCase().includes(kw) ?? false),
      );
    }
    if (categoryFilter) list = list.filter((t) => t.category === categoryFilter);
    return list;
  }, [tools, search, categoryFilter]);

  const openCreate = () => {
    setEditingName(null);
    form.resetFields();
    form.setFieldsValue({
      auth_mode: 'service_key',
      config: '{}',
      dispatcher: 'http_adapter',
      enabled: true,
      input_schema: '{}',
    });
    setDrawerOpen(true);
  };

  const openEdit = (row: any) => {
    setEditingName(row.name);
    form.setFieldsValue({
      auth_header: row.auth_header,
      auth_mode: row.auth_mode,
      auth_prefix: row.auth_prefix,
      category: row.category,
      config: JSON.stringify(row.config ?? {}, null, 2),
      description: row.description,
      dispatcher: row.dispatcher,
      display_name: row.display_name,
      enabled: row.enabled,
      input_schema: JSON.stringify(row.input_schema ?? {}, null, 2),
      name: row.name,
      secret_env_name: row.secret_env_name,
    });
    setDrawerOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const v = await form.validateFields();
      let configObj: Record<string, any>;
      let inputSchemaObj: Record<string, any> | null;
      try {
        configObj = parseJsonOr(v.config, {});
        inputSchemaObj = parseJsonOr(v.input_schema, null);
      } catch (e) {
        message.error(`字段 JSON 非法: ${(e as Error).message}`);
        return;
      }
      const payload = {
        auth_header: v.auth_header || null,
        auth_mode: v.auth_mode,
        auth_prefix: v.auth_prefix || null,
        category: v.category || null,
        config: configObj,
        description: v.description || null,
        dispatcher: v.dispatcher,
        display_name: v.display_name || null,
        enabled: v.enabled,
        input_schema: inputSchemaObj,
        name: v.name,
        secret_env_name: v.secret_env_name || null,
      };

      if (editingName) {
        await lambdaClient.enterpriseAdmin.patchTool.mutate({ name: editingName, patch: payload });
      } else {
        await lambdaClient.enterpriseAdmin.upsertTool.mutate(payload);
      }
      message.success(editingName ? '工具已更新' : '工具已注册');
      invalidate('tools');
      invalidate('dashboard');
      setDrawerOpen(false);
    } catch (err: any) {
      if (err?.errorFields) return;
      message.error(err?.message ?? '操作失败');
    }
  };

  const handleToggle = async (row: any, enabled: boolean) => {
    try {
      await lambdaClient.enterpriseAdmin.patchTool.mutate({
        name: row.name,
        patch: { enabled },
      });
      invalidate('tools');
      invalidate('dashboard');
    } catch (err: any) {
      message.error(err?.message ?? '切换失败');
    }
  };

  const handleDelete = async (name: string, hard: boolean) => {
    try {
      await lambdaClient.enterpriseAdmin.deleteTool.mutate({ hard, name });
      message.success(hard ? '工具已硬删除' : '工具已软删(可再启用)');
      invalidate('tools');
      invalidate('grants');
      invalidate('dashboard');
    } catch (err: any) {
      message.error(err?.message ?? '删除失败');
    }
  };

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="chat-gw `/admin/tools` 工具注册表(name 幂等键 / dispatcher / auth_mode / config / input_schema)"
        title="工具注册"
      />
      <PageBody>
        <TableToolbar
          searchPlaceholder="搜索 name / display_name / description"
          searchValue={search}
          actions={
            <Button icon={<Plus size={14} />} type="primary" onClick={openCreate}>
              注册工具
            </Button>
          }
          onSearchChange={setSearch}
        >
          <Select
            allowClear
            options={[
              { label: '全部分类', value: '' },
              ...categories.map((c) => ({ label: c, value: c })),
            ]}
            placeholder="分类"
            style={{ width: 160 }}
            value={categoryFilter}
            onChange={setCategoryFilter}
          />
        </TableToolbar>
        <Table
          dataSource={filtered}
          loading={isLoading}
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: (t) => `共 ${t} 个工具` }}
          rowKey="name"
          size="middle"
          columns={[
            {
              dataIndex: 'name',
              key: 'name',
              render: (v: string) => <code>{v}</code>,
              title: 'Name',
              width: 260,
            },
            { dataIndex: 'display_name', key: 'display_name', title: '显示名', width: 160 },
            { dataIndex: 'category', key: 'category', title: '分类', width: 120 },
            {
              dataIndex: 'dispatcher',
              key: 'dispatcher',
              render: (v: string) => <Tag>{v}</Tag>,
              title: 'dispatcher',
              width: 140,
            },
            {
              dataIndex: 'auth_mode',
              key: 'auth_mode',
              render: (v: string) => (
                <Tag color={v === 'user_passthrough' ? 'blue' : 'default'}>{v}</Tag>
              ),
              title: 'auth_mode',
              width: 140,
            },
            {
              dataIndex: 'version',
              key: 'version',
              render: (v: number) => <span className={styles.codeBlock}>v{v}</span>,
              title: '版本',
              width: 70,
            },
            {
              dataIndex: 'enabled',
              key: 'enabled',
              render: (v: boolean, row: any) => (
                <Switch checked={v} size="small" onChange={(c) => handleToggle(row, c)} />
              ),
              title: '启用',
              width: 70,
            },
            {
              key: 'actions',
              render: (_: any, r: any) => (
                <Space size={0}>
                  <Button
                    icon={<Pencil size={14} />}
                    size="small"
                    type="link"
                    onClick={() => openEdit(r)}
                  >
                    编辑
                  </Button>
                  <Popconfirm
                    title="软删:设 enabled=false,可重启用"
                    onConfirm={() => handleDelete(r.name, false)}
                  >
                    <Button size="small" type="link">
                      软删
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title={`硬删除 "${r.name}"? 关联 grants 一并清除,不可恢复`}
                    onConfirm={() => handleDelete(r.name, true)}
                  >
                    <Tooltip title="hard=true:物理删除 + 级联 grants">
                      <Button danger icon={<Trash2 size={14} />} size="small" type="link">
                        硬删
                      </Button>
                    </Tooltip>
                  </Popconfirm>
                </Space>
              ),
              title: '',
              width: 220,
            },
          ]}
        />

        <Drawer
          open={drawerOpen}
          title={editingName ? `编辑工具 · ${editingName}` : '注册新工具'}
          width={640}
          extra={
            <Space>
              <Button onClick={() => setDrawerOpen(false)}>取消</Button>
              <Button type="primary" onClick={handleSubmit}>
                {editingName ? '保存' : '注册'}
              </Button>
            </Space>
          }
          onClose={() => setDrawerOpen(false)}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              label="name(幂等键,如 cloud_cost.dashboard_overview)"
              name="name"
              rules={[{ message: '必填', required: true }]}
            >
              <Input disabled={!!editingName} />
            </Form.Item>
            <Form.Item label="display_name" name="display_name">
              <Input />
            </Form.Item>
            <Form.Item label="category" name="category">
              <Input placeholder="kb / web / cloud_cost ..." />
            </Form.Item>
            <Form.Item label="dispatcher" name="dispatcher" rules={[{ required: true }]}>
              <Select options={DISPATCHER_OPTS} />
            </Form.Item>
            <Form.Item label="auth_mode" name="auth_mode" rules={[{ required: true }]}>
              <Select options={AUTH_OPTS} />
            </Form.Item>
            <Form.Item
              extra="service_key 模式下必填(chat-gw 从此 env 读下游密钥)"
              label="secret_env_name"
              name="secret_env_name"
            >
              <Input placeholder="如 KB_AGENT_API_KEY" />
            </Form.Item>
            <Form.Item label="auth_header" name="auth_header">
              <Input placeholder="如 Authorization 或 api-key" />
            </Form.Item>
            <Form.Item label="auth_prefix" name="auth_prefix">
              <Input placeholder="如 Bearer (含空格)" />
            </Form.Item>
            <Form.Item label="描述" name="description">
              <Input.TextArea rows={2} />
            </Form.Item>
            <Form.Item
              extra="下游 http/mcp 配置:base_url_env / path / method / timeout_sec 等"
              label="config(JSON)"
              name="config"
              rules={[{ required: true }]}
            >
              <Input.TextArea rows={6} style={{ fontFamily: 'ui-monospace' }} />
            </Form.Item>
            <Form.Item
              extra="JSON Schema,模型调用时按此校验参数"
              label="input_schema(JSON,可空)"
              name="input_schema"
            >
              <Input.TextArea rows={6} style={{ fontFamily: 'ui-monospace' }} />
            </Form.Item>
            <Form.Item label="启用" name="enabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Form>
        </Drawer>
      </PageBody>
    </Flexbox>
  );
});

ToolsPage.displayName = 'EnterpriseAdminTools';

export default ToolsPage;
