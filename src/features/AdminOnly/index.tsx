/**
 * AdminOnly — 路由级守卫。
 *
 * 把需要"企业管理员"权限的页面包一层，非管理员看到简洁的"无权限"提示
 * 并一键回到对话页，不给他们半开半闭的设置表单。
 *
 * ## 搭配前端菜单隐藏 (useCategory) 一起用
 * 菜单隐藏只是 UX 层，用户仍可手敲 URL 进设置子页。AdminOnly 把贴 URL
 * 进来的非管理员拦在外面。
 *
 * ## 这不是安全边界
 * 真正的安全边界是后端——LobeChat 后端的 provider / apiKey 修改接口
 * 目前没有角色校验，直接通过 tRPC 也能改。B′ 的下一阶段会给这些 router
 * 加 `adminOnly` middleware。前端守卫只是第一道墙。
 */
'use client';

import { Button, Result } from 'antd';
import { Lock } from 'lucide-react';
import { memo, type PropsWithChildren } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { useEnterpriseRole } from '@/hooks/useEnterpriseRole';

const AdminOnly = memo<PropsWithChildren>(({ children }) => {
  const { isAdmin, username, roles } = useEnterpriseRole();
  const { t } = useTranslation('common');

  if (isAdmin) return <>{children}</>;

  // 还没加载完（SWR 首次 fetch 时 username/roles 为默认空值，但 isAdmin
  // 已经是 false）——为避免管理员短暂看到"无权限"画面，可以在数据未就绪
  // 时渲染 null。这里简单处理：只要 isAdmin=false 就拦截。
  return (
    <Result
      icon={<Lock size={48} style={{ color: '#999' }} />}
      status="403"
      title="需要管理员权限"
      extra={
        <Link to="/chat">
          <Button type={'primary'}>{t('back', { defaultValue: '返回对话' })}</Button>
        </Link>
      }
      subTitle={
        username
          ? `当前用户 ${username}，角色 [${roles.join(', ') || '未授权'}]。如需管理员权限，请联系系统管理员。`
          : '未识别到企业身份。请使用企业邮箱登录后重试。'
      }
    />
  );
});

AdminOnly.displayName = 'AdminOnly';

export default AdminOnly;
