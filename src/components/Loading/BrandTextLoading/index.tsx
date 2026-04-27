// [enterprise-fork] 加载动画保留 heihub 的波纹效果,把文字从 heihub 改为 heihub。
import { BrandLoading } from '@lobehub/ui/brand';
import type { FC } from 'react';

import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId?: string;
}

// BrandLoading 要求 text 是一个 FC,className 会被它加上 "lobe-brand-loading"
// 触发原生 SVG 动画。这里做一个最小的文字块,动画由 inherited className 生效。
const HeihubText: FC<{ size?: number } & React.HTMLAttributes<HTMLSpanElement>> = ({
  size = 40,
  className,
  style,
  ...rest
}) => (
  <span
    className={className}
    style={{
      display: 'inline-block',
      fontSize: size * 0.6,
      fontWeight: 700,
      letterSpacing: 1,
      lineHeight: 1,
      ...style,
    }}
    {...rest}
  >
    heihub
  </span>
);

const BrandTextLoading = (_props: BrandTextLoadingProps) => {
  return (
    <div className={styles.container}>
      <div aria-label="Loading" className={styles.brand} role="status">
        <BrandLoading size={40} text={HeihubText as any} />
      </div>
    </div>
  );
};

export default BrandTextLoading;
