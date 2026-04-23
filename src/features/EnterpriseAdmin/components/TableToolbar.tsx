import { Flexbox } from '@lobehub/ui';
import { Input } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Search } from 'lucide-react';
import { memo, type ReactNode } from 'react';

const styles = createStaticStyles(({ css }) => ({
  search: css`
    width: 280px;
  `,
  wrapper: css`
    gap: 12px;
    padding-block: 16px;
    padding-inline: 32px;
  `,
}));

interface TableToolbarProps {
  actions?: ReactNode;
  children?: ReactNode;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  searchValue?: string;
}

const TableToolbar = memo<TableToolbarProps>(
  ({ searchValue, onSearchChange, searchPlaceholder, children, actions }) => {
    return (
      <Flexbox horizontal align={'center'} className={styles.wrapper} justify={'space-between'}>
        <Flexbox horizontal align={'center'} gap={12}>
          {onSearchChange && (
            <Input
              allowClear
              className={styles.search}
              placeholder={searchPlaceholder ?? '搜索...'}
              prefix={<Search size={14} />}
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          )}
          {children}
        </Flexbox>
        {actions && (
          <Flexbox horizontal gap={8}>
            {actions}
          </Flexbox>
        )}
      </Flexbox>
    );
  },
);

TableToolbar.displayName = 'EnterpriseAdminTableToolbar';

export default TableToolbar;
