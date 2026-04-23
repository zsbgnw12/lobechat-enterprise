'use client';

import { Flexbox } from '@lobehub/ui';
import { Button, Result } from 'antd';
import { createStaticStyles } from 'antd-style';
import { Lock } from 'lucide-react';
import { memo } from 'react';
import { Link, useParams } from 'react-router-dom';

import { useEnterpriseRole } from '@/hooks/useEnterpriseRole';

import Sidebar from './_layout/Sidebar';
import AuditPage from './pages/Audit';
import CustomerGrantsPage from './pages/CustomerGrants';
import DashboardPage from './pages/Dashboard';
import GrantsPage from './pages/Grants';
import GwCatalogPage from './pages/GwCatalog';
import GwHealthPage from './pages/GwHealth';
import GwTesterPage from './pages/GwTester';
import ToolsPage from './pages/Tools';
import type { AdminPageKey } from './types';

const styles = createStaticStyles(({ css, cssVar }) => ({
  content: css`
    overflow: hidden;
    display: flex;
    flex: 1;
    flex-direction: column;

    height: 100%;
  `,
  wrapper: css`
    width: 100%;
    height: 100%;
    background: ${cssVar.colorBgLayout};
  `,
}));

const PAGE_MAP: Record<AdminPageKey, React.ComponentType> = {
  'audit': AuditPage,
  'customer-grants': CustomerGrantsPage,
  'dashboard': DashboardPage,
  'grants': GrantsPage,
  'gw-catalog': GwCatalogPage,
  'gw-health': GwHealthPage,
  'gw-tester': GwTesterPage,
  'tools': ToolsPage,
};

/** 这 3 页走 chat-gw `/mcp` —— 任何登录用户都能进,真正的工具可见性由
 *  chat-gw 那端的 Casdoor 角色决定(cloud_admin / ops / finance / viewer)。
 *  其他 4 页(仪表盘/工具/授权/审计)都是 `/admin/*`,只 `cloud_admin` 能访问。*/
const GW_ONLY_PAGES = new Set<AdminPageKey>(['gw-health', 'gw-catalog', 'gw-tester']);

const EnterpriseAdmin = memo(() => {
  const { page } = useParams<{ page?: string }>();
  const { isAdmin, roles, username } = useEnterpriseRole();

  const pageKey = (page as AdminPageKey) || 'dashboard';
  const requiresEnterpriseAdmin = !GW_ONLY_PAGES.has(pageKey);

  if (requiresEnterpriseAdmin && !isAdmin) {
    return (
      <Result
        icon={<Lock size={48} style={{ color: '#999' }} />}
        status="403"
        title="需要 cloud_admin 权限"
        extra={
          <Link to="/chat">
            <Button type={'primary'}>返回对话</Button>
          </Link>
        }
        subTitle={
          username
            ? `当前用户 ${username},角色 [${roles.join(', ') || '未授权'}]`
            : '未识别到企业身份'
        }
      />
    );
  }

  const PageComp = PAGE_MAP[pageKey] ?? DashboardPage;

  return (
    <Flexbox horizontal className={styles.wrapper}>
      <Sidebar active={pageKey} />
      <div className={styles.content}>
        <PageComp />
      </div>
    </Flexbox>
  );
});

EnterpriseAdmin.displayName = 'EnterpriseAdmin';

export default EnterpriseAdmin;
