import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import type { LucideIcon } from 'lucide-react';
import { memo } from 'react';

const styles = createStaticStyles(({ css, cssVar }) => ({
  iconBox: css`
    display: flex;
    align-items: center;
    justify-content: center;

    width: 40px;
    height: 40px;
    border-radius: 10px;

    color: ${cssVar.colorPrimaryText};

    background: ${cssVar.colorPrimaryBg};
  `,
  label: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  trend: css`
    font-size: 12px;
    color: ${cssVar.colorTextTertiary};
  `,
  trendDanger: css`
    color: ${cssVar.colorError};
  `,
  trendWarn: css`
    color: ${cssVar.colorWarning};
  `,
  value: css`
    font-size: 28px;
    font-weight: 600;
    line-height: 1;
    color: ${cssVar.colorText};
  `,
  wrapper: css`
    gap: 12px;

    padding: 20px;
    border: 1px solid ${cssVar.colorBorderSecondary};
    border-radius: 12px;

    background: ${cssVar.colorBgContainer};

    transition: border-color 0.16s;

    :hover {
      border-color: ${cssVar.colorBorder};
    }
  `,
}));

interface StatCardProps {
  hint?: string;
  hintTone?: 'default' | 'warn' | 'danger';
  icon: LucideIcon;
  label: string;
  value: number | string;
}

const StatCard = memo<StatCardProps>(({ label, value, icon: Icon, hint, hintTone = 'default' }) => {
  const hintCls =
    hintTone === 'danger'
      ? `${styles.trend} ${styles.trendDanger}`
      : hintTone === 'warn'
        ? `${styles.trend} ${styles.trendWarn}`
        : styles.trend;
  return (
    <Flexbox className={styles.wrapper}>
      <Flexbox horizontal align={'center'} justify={'space-between'}>
        <span className={styles.label}>{label}</span>
        <div className={styles.iconBox}>
          <Icon size={20} />
        </div>
      </Flexbox>
      <div className={styles.value}>{value}</div>
      {hint && <div className={hintCls}>{hint}</div>}
    </Flexbox>
  );
});

StatCard.displayName = 'EnterpriseAdminStatCard';

export default StatCard;
