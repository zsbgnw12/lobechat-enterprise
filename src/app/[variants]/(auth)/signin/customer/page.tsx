'use client';

import { Alert, Button, Flexbox, Icon, Input, Text } from '@lobehub/ui';
import { Form } from 'antd';
import { createStaticStyles } from 'antd-style';
import { KeyRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import AuthCard from '@/features/AuthCard';

const styles = createStaticStyles(({ css, cssVar }) => ({
  backLink: css`
    margin-block-start: 16px;
    text-align: center;

    a {
      color: ${cssVar.colorTextSecondary};

      &:hover {
        color: ${cssVar.colorPrimary};
      }
    }
  `,
  hint: css`
    margin-block-end: 4px;
    color: ${cssVar.colorTextSecondary};
  `,
}));

const CUSTOMER_CODE_REGEX = /^[\w-]{1,32}$/u;

const CustomerSignInPage = () => {
  const router = useRouter();
  const [form] = Form.useForm<{ customerCode: string }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async ({ customerCode }: { customerCode: string }) => {
    setError(null);
    if (!CUSTOMER_CODE_REGEX.test(customerCode.trim())) {
      setError('客户编号格式不合法(应为 1-32 位字母/数字/下划线/连字符)');
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch('/api/auth/customer-login', {
        body: JSON.stringify({ customerCode: customerCode.trim() }),
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        setError(json?.message || `登录失败(HTTP ${resp.status})`);
        setLoading(false);
        return;
      }
      router.push(json?.redirectTo || '/chat');
    } catch (err) {
      setError(`网络异常: ${(err as Error).message}`);
      setLoading(false);
    }
  };

  return (
    <AuthCard description="" title="客户编号登录">
      <Flexbox gap={12}>
        <Text className={styles.hint}>凭工单系统发放的客户编号登录,无需密码。</Text>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            label="客户编号"
            name="customerCode"
            rules={[{ message: '必填', required: true }]}
          >
            <Input
              autoFocus
              disabled={loading}
              placeholder="CUST-XXXXXXXX"
              prefix={<Icon icon={KeyRound} size={16} />}
              size="large"
            />
          </Form.Item>
          {error && <Alert closable showIcon message={error} type="error" />}
          <Button block htmlType="submit" loading={loading} size="large" type="primary">
            登录
          </Button>
        </Form>
        <div className={styles.backLink}>
          <Link href="/signin">← 返回员工登录(Casdoor)</Link>
        </div>
      </Flexbox>
    </AuthCard>
  );
};

export default CustomerSignInPage;
