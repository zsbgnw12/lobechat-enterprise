import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  actions: css`
    flex-shrink: 0;
  `,
  description: css`
    margin-block-start: 4px;
    font-size: 13px;
    color: ${cssVar.colorTextTertiary};
  `,
  title: css`
    margin: 0;

    font-size: 22px;
    font-weight: 600;
    line-height: 1.2;
    color: ${cssVar.colorText};
  `,
  wrapper: css`
    padding-block: 24px 20px;
    padding-inline: 32px;
    border-block-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface PageHeaderProps {
  actions?: ReactNode;
  description?: string;
  title: string;
}

const PageHeader = memo<PageHeaderProps>(({ title, description, actions }) => {
  return (
    <Flexbox horizontal align={'flex-start'} className={styles.wrapper} gap={16}>
      <Flexbox flex={1}>
        <h1 className={styles.title}>{title}</h1>
        {description && <div className={styles.description}>{description}</div>}
      </Flexbox>
      {actions && <div className={styles.actions}>{actions}</div>}
    </Flexbox>
  );
});

PageHeader.displayName = 'EnterpriseAdminPageHeader';

export default PageHeader;
