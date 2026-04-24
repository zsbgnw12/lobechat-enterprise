import { BRANDING_NAME } from '@lobechat/business-const';
import { Alert, Button, Flexbox, Icon, Skeleton, Text } from '@lobehub/ui';
import { type FormInstance } from 'antd';
import { Badge, Divider } from 'antd';
import Link from 'next/link';
import { Trans, useTranslation } from 'react-i18next';

import AuthIcons from '@/components/AuthIcons';
import { PRIVACY_URL, TERMS_URL } from '@/const/url';

import AuthCard from '../../../../features/AuthCard';

export const EMAIL_REGEX = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/;
export const USERNAME_REGEX = /^\w+$/;

export interface SignInEmailStepProps {
  businessElement?: React.ReactNode;
  disableEmailPassword?: boolean;
  form: FormInstance<{ email: string }>;
  isSocialOnly: boolean;
  lastAuthProvider?: string | null;
  loading: boolean;
  oAuthSSOProviders: string[];
  onCheckUser: (values: { email: string }) => Promise<void>;
  onSetPassword: () => void;
  onSocialSignIn: (provider: string) => void;
  serverConfigInit: boolean;
  socialLoading: string | null;
}

export const SignInEmailStep = ({
  businessElement,
  lastAuthProvider,
  oAuthSSOProviders,
  serverConfigInit,
  socialLoading,
  onSocialSignIn,
}: SignInEmailStepProps) => {
  const { t } = useTranslation('auth');

  const divider = (
    <Divider>
      <Text fontSize={12} type={'secondary'}>
        {t('betterAuth.signin.orContinueWith')}
      </Text>
    </Divider>
  );

  const getProviderLabel = (provider: string) => {
    const normalized = provider
      .toLowerCase()
      .replaceAll(/(^|[_-])([a-z])/g, (_, __, c) => c.toUpperCase());
    const normalizedKey = normalized.replaceAll(/[^\da-z]/gi, '');
    const key = `betterAuth.signin.continueWith${normalizedKey}`;
    return t(key, { defaultValue: `Continue with ${normalized}` });
  };

  const footer = (
    <Text fontSize={13} type={'secondary'}>
      <Trans
        i18nKey={'footer.agreement'}
        ns={'auth'}
        components={{
          privacy: (
            <a
              href={PRIVACY_URL}
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('footer.terms')}
            </a>
          ),
          terms: (
            <a
              href={TERMS_URL}
              style={{ color: 'inherit', cursor: 'pointer', textDecoration: 'underline' }}
            >
              {t('footer.privacy')}
            </a>
          ),
        }}
      />
    </Text>
  );

  return (
    <AuthCard
      footer={footer}
      subtitle={t('signin.subtitle', { appName: BRANDING_NAME })}
      title={'Agent teammates that grow with you'}
    >
      {!serverConfigInit && (
        <Flexbox gap={12}>
          <Skeleton.Button active block size="large" />
          <Skeleton.Button active block size="large" />
          {divider}
        </Flexbox>
      )}
      {serverConfigInit && oAuthSSOProviders.length > 0 && (
        <Flexbox gap={12}>
          {oAuthSSOProviders.map((provider) => {
            const button = (
              <Button
                block
                key={provider}
                loading={socialLoading === provider}
                size="large"
                icon={
                  <Icon
                    icon={AuthIcons(provider, 18)}
                    style={{
                      left: 12,
                      position: 'absolute',
                      top: 13,
                    }}
                  />
                }
                onClick={() => onSocialSignIn(provider)}
              >
                {getProviderLabel(provider)}
              </Button>
            );
            const showLastUsed = provider === lastAuthProvider && oAuthSSOProviders.length > 1;
            return showLastUsed ? (
              <Badge.Ribbon
                color="var(--ant-color-info-fill-tertiary)"
                key={provider}
                styles={{ content: { color: 'var(--ant-color-info)' } }}
                text={t('betterAuth.signin.lastUsed')}
              >
                {button}
              </Badge.Ribbon>
            ) : (
              button
            );
          })}
          {businessElement}
        </Flexbox>
      )}
      {serverConfigInit && oAuthSSOProviders.length === 0 && (
        <Alert showIcon description={t('betterAuth.signin.ssoOnlyNoProviders')} type="warning" />
      )}
      {/* [enterprise-fork] 邮箱/密码登录已禁用 —— 员工走 Casdoor,客户走下方客户编号入口 */}
      {/* [enterprise-fork] 客户编号登录入口(走 gongdan /api/auth/customer-login) */}
      <Divider style={{ marginBlock: 4 }}>
        <Text fontSize={11} type={'secondary'}>
          或
        </Text>
      </Divider>
      <Link
        href="/signin/customer"
        style={{ color: 'inherit', display: 'block', fontSize: 13, textAlign: 'center' }}
      >
        客户凭编号登录 →
      </Link>
    </AuthCard>
  );
};
