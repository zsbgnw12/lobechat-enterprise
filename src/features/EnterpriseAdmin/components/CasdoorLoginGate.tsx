import { Alert, Button } from 'antd';
import { LogIn } from 'lucide-react';
import { memo } from 'react';

import { useGatewayConnection } from '../hooks/useGatewayData';

/**
 * 所有 chat-gw 页面顶部的条件 Alert:
 *   - 未绑 Casdoor → 显示"请用 Casdoor 登录"+ CTA
 *   - 已绑 → 渲染 children(页面主体)
 *
 * 不阻断 children 挂载;只在顶部提示。这样页面自己的请求会自然抛
 * UNAUTHORIZED,由 SWR 显示错误态。
 */
const CasdoorLoginGate = memo<{ children: React.ReactNode }>(({ children }) => {
  const { data, isLoading } = useGatewayConnection();
  if (isLoading) return <>{children}</>;

  if (data && !data.connected) {
    const callbackUrl = encodeURIComponent(window.location.pathname + window.location.search);
    const signInUrl = `/signin?sso=casdoor&callbackUrl=${callbackUrl}`;
    return (
      <>
        <Alert
          banner
          showIcon
          message="需要 Casdoor 登录"
          type="warning"
          action={
            <Button href={signInUrl} icon={<LogIn size={14} />} type="primary">
              用 Casdoor 登录
            </Button>
          }
          description={
            data.reason ||
            '当前账号尚未绑定 Casdoor 身份,无法向 chat-gw 发起请求。请用 Casdoor 账号登录后再回来。'
          }
        />
        {children}
      </>
    );
  }
  return <>{children}</>;
});

CasdoorLoginGate.displayName = 'CasdoorLoginGate';

export default CasdoorLoginGate;
