import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  body: css`
    overflow-y: auto;
    flex: 1;
    padding-block: 24px;
    padding-inline: 32px;
  `,
}));

const PageBody = memo<{ children: ReactNode }>(({ children }) => {
  return <div className={styles.body}>{children}</div>;
});

PageBody.displayName = 'EnterpriseAdminPageBody';

export default PageBody;
