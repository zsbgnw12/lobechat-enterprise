/**
 * [enterprise-fork] 从 MCP 工具的 inputSchema(JSON Schema)生成 antd 表单。
 *
 * 只支持文档里看到的类型组合:
 *   - type: object (root)
 *   - properties: { [k]: schema }
 *   - required: string[]
 *   - 基本类型: string, integer, number, boolean, array, object
 *   - enum / pattern / minimum / maximum / default / description
 *
 * 复杂 schema (oneOf/anyOf/$ref) 暂退化为 JSON 文本框。
 * 不追求全量 JSON Schema 实现,只保 MCP 工具常见子集。
 */
import type { FormInstance } from 'antd';
import { Alert, Form, Input, InputNumber, Select, Switch } from 'antd';
import { memo } from 'react';

export interface PropSchema {
  default?: any;
  description?: string;
  enum?: any[];
  format?: string;
  items?: PropSchema;
  maximum?: number;
  minimum?: number;
  pattern?: string;
  type?: string | string[];
}

export interface ObjectSchema {
  properties?: Record<string, PropSchema>;
  required?: string[];
  type?: string;
}

const typeOf = (s: PropSchema): string => {
  if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null') || 'string';
  return s.type || 'string';
};

interface Props {
  form: FormInstance;
  schema: ObjectSchema;
}

const SchemaForm = memo<Props>(({ schema, form }) => {
  if (!schema || schema.type !== 'object' || !schema.properties) {
    return (
      <Alert
        showIcon
        description="此工具 inputSchema 不是纯 object,建议切到 JSON 编辑器直接写。"
        message="schema 结构不规则"
        type="info"
      />
    );
  }

  const required = new Set(schema.required ?? []);
  const entries = Object.entries(schema.properties);

  if (entries.length === 0) {
    return <Alert showIcon message="此工具无入参" type="info" />;
  }

  return (
    <Form form={form} layout="vertical">
      {entries.map(([name, prop]) => {
        const t = typeOf(prop);
        const label = (
          <span>
            {name}
            {prop.description ? (
              <span style={{ color: '#8c8c8c', fontWeight: 400 }}> — {prop.description}</span>
            ) : null}
          </span>
        );
        const isReq = required.has(name);
        const rules = isReq ? [{ message: `${name} 必填`, required: true }] : undefined;
        const initialValue = prop.default;

        if (prop.enum) {
          return (
            <Form.Item
              initialValue={initialValue}
              key={name}
              label={label}
              name={name}
              rules={rules}
            >
              <Select
                allowClear={!isReq}
                options={prop.enum.map((v) => ({ label: String(v), value: v }))}
                placeholder={`选择 ${name}`}
              />
            </Form.Item>
          );
        }

        if (t === 'boolean') {
          return (
            <Form.Item
              initialValue={initialValue ?? false}
              key={name}
              label={label}
              name={name}
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          );
        }

        if (t === 'integer' || t === 'number') {
          return (
            <Form.Item
              initialValue={initialValue}
              key={name}
              label={label}
              name={name}
              rules={rules}
            >
              <InputNumber
                max={prop.maximum}
                min={prop.minimum}
                placeholder={prop.description || name}
                precision={t === 'integer' ? 0 : undefined}
                style={{ width: '100%' }}
              />
            </Form.Item>
          );
        }

        if (t === 'array' || t === 'object') {
          return (
            <Form.Item
              extra={'填合法 JSON(如 ["a","b"] 或 {...})'}
              key={name}
              label={label}
              name={name}
              rules={rules}
              initialValue={
                initialValue !== undefined ? JSON.stringify(initialValue, null, 2) : undefined
              }
            >
              <Input.TextArea
                autoSize={{ maxRows: 6, minRows: 2 }}
                placeholder={t === 'array' ? '[]' : '{}'}
              />
            </Form.Item>
          );
        }

        // string-ish
        return (
          <Form.Item
            initialValue={initialValue}
            key={name}
            label={label}
            name={name}
            rules={[
              ...(rules ?? []),
              ...(prop.pattern
                ? [
                    {
                      message: `需匹配正则 ${prop.pattern}`,
                      pattern: new RegExp(prop.pattern),
                    },
                  ]
                : []),
            ]}
          >
            <Input placeholder={prop.description || name} />
          </Form.Item>
        );
      })}
    </Form>
  );
});

SchemaForm.displayName = 'EnterpriseAdminSchemaForm';

/**
 * 读取表单值,按 schema 的 type 做最小回转换:
 *   - array/object 类型的字段:JSON.parse
 *   - 其它直接用
 *   - undefined 字段:剔除
 */
export function collectValues(
  schema: ObjectSchema,
  values: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  const props = schema.properties ?? {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue;
    const prop = props[k];
    const t = prop ? typeOf(prop) : 'string';
    if ((t === 'array' || t === 'object') && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v);
      } catch {
        throw new Error(`字段 "${k}" 不是合法 JSON`);
      }
    } else {
      out[k] = v;
    }
  }
  return out;
}

export default SchemaForm;
