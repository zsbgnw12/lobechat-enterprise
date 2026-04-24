// [enterprise-fork] 去掉 LobeHub 品牌加载动画 —— 统一用 CircleLoading。
import CircleLoading from '../CircleLoading';
import styles from './index.module.css';

interface BrandTextLoadingProps {
  debugId?: string;
}

const BrandTextLoading = (_props: BrandTextLoadingProps) => {
  return (
    <div className={styles.container}>
      <CircleLoading />
    </div>
  );
};

export default BrandTextLoading;
