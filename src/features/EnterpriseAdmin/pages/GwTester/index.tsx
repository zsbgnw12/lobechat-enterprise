import { Flexbox } from '@lobehub/ui';
import { Alert, Button, Form, message, Select, Skeleton, Space, Tag } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Play } from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { lambdaClient } from '@/libs/trpc/client/lambda';

import PageHeader from '../../_layout/PageHeader';
import CasdoorLoginGate from '../../components/CasdoorLoginGate';
import PageBody from '../../components/PageBody';
import { useGatewayTools } from '../../hooks/useGatewayData';
import SchemaForm, { collectValues, type ObjectSchema } from './SchemaForm';

const styles = createStaticStyles(({ css, cssVar }) => ({
  col: css`
    gap: 12px;
    min-height: 420px;
  `,
  colLeft: css`
    flex: 1;
    min-width: 360px;
  `,
  colRight: css`
    flex: 1;
    min-width: 360px;
  `,
  panel: css`
    padding: 16px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 10px;
    background: ${cssVar.colorBgContainer};
  `,
  resultBox: css`
    overflow: auto;

    max-height: 520px;
    padding: 12px;
    border-radius: 8px;

    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
    white-space: pre-wrap;

    background: ${cssVar.colorFillTertiary};
  `,
  title: css`
    margin-block: 0 10px;
    margin-inline: 0;
    font-size: 14px;
    font-weight: 600;
  `,
}));

const GwTesterPage = memo(() => {
  const [form] = Form.useForm();
  const [sp, setSp] = useSearchParams();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    durationMs?: number;
    error?: string;
    isError?: boolean;
    text?: string;
  } | null>(null);

  const { data: tools, isLoading } = useGatewayTools();
  const selectedName = sp.get('name') ?? '';
  const selected = useMemo(
    () => (tools ?? []).find((t) => t.name === selectedName),
    [tools, selectedName],
  );

  useEffect(() => {
    // 切换工具时重置 form + result
    form.resetFields();
    setResult(null);
  }, [selectedName, form]);

  const handleRun = async () => {
    if (!selected) return;
    try {
      const values = await form.validateFields();
      const args = collectValues(selected.inputSchema as ObjectSchema, values);
      setRunning(true);
      setResult(null);
      const t0 = Date.now();
      const r = await lambdaClient.chatGateway.callTool.mutate({
        arguments: args,
        name: selected.name,
      });
      const firstText =
        r.content?.find((c: any) => c.type === 'text')?.text ?? JSON.stringify(r.content, null, 2);
      setResult({
        durationMs: Date.now() - t0,
        isError: r.isError,
        text: firstText,
      });
    } catch (err: any) {
      if (err?.errorFields) {
        message.error('参数校验失败,请检查红框字段');
        return;
      }
      setResult({ error: err?.message ?? String(err) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <Flexbox style={{ height: '100%' }}>
      <PageHeader
        description="选一个工具,按 inputSchema 填参数,调用返回实时可见。所有调用都带当前登录账号 token,chat-gw 侧会写 audit log。"
        title="AI 网关 · 调试"
      />
      <PageBody>
        <CasdoorLoginGate>
          <Flexbox horizontal wrap className={styles.col} gap={16}>
            <div className={`${styles.colLeft} ${styles.panel}`}>
              <div className={styles.title}>工具</div>
              {isLoading ? (
                <Skeleton active paragraph={{ rows: 1 }} />
              ) : (
                <Select
                  showSearch
                  options={(tools ?? []).map((t) => ({ label: t.name, value: t.name }))}
                  placeholder="选择工具"
                  style={{ width: '100%' }}
                  value={selectedName || undefined}
                  filterOption={(input, opt) =>
                    ((opt?.label as string) ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  onChange={(v) => {
                    const next = new URLSearchParams(sp);
                    if (v) next.set('name', v);
                    else next.delete('name');
                    setSp(next);
                  }}
                />
              )}

              {selected && (
                <>
                  <div
                    style={{
                      color: '#8c8c8c',
                      fontSize: 13,
                      marginBlock: 12,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {selected.description}
                  </div>
                  <SchemaForm form={form} schema={selected.inputSchema as ObjectSchema} />
                  <Button
                    icon={<Play size={14} />}
                    loading={running}
                    type="primary"
                    onClick={handleRun}
                  >
                    调用
                  </Button>
                </>
              )}
            </div>

            <div className={`${styles.colRight} ${styles.panel}`}>
              <div className={styles.title}>返回</div>
              {!result ? (
                <div style={{ color: '#8c8c8c' }}>
                  {selected ? '填参数后点"调用"' : '先选一个工具'}
                </div>
              ) : result.error ? (
                <Alert showIcon message={result.error} type="error" />
              ) : (
                <Flexbox gap={8}>
                  <Space size={8}>
                    {result.isError ? (
                      <Tag color="red">tool 返回 isError</Tag>
                    ) : (
                      <Tag color="green">success</Tag>
                    )}
                    {typeof result.durationMs === 'number' && <Tag>{result.durationMs} ms</Tag>}
                  </Space>
                  <pre className={styles.resultBox}>{result.text}</pre>
                </Flexbox>
              )}
            </div>
          </Flexbox>
        </CasdoorLoginGate>
      </PageBody>
    </Flexbox>
  );
});

GwTesterPage.displayName = 'EnterpriseAdminGwTester';

export default GwTesterPage;
