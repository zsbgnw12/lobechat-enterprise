import { useTranslation } from 'react-i18next';

import AdminOnly from '@/features/AdminOnly';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import ApiKey from './features/ApiKey';

// [enterprise-fork] wrap in AdminOnly — 普通用户不能签发个人 API Key
const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <AdminOnly>
      <SettingHeader title={t('tab.apikey')} />
      <ApiKey />
    </AdminOnly>
  );
};

export default Page;
