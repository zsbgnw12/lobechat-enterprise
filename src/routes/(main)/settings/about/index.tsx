import { useTranslation } from 'react-i18next';

import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

import About from './features/About';

const Page = ({ mobile }: { mobile?: boolean }) => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.about')} />
      <About mobile={mobile} />
    </>
  );
};

export default Page;
