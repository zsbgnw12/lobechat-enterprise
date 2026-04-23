import { Flexbox } from '@lobehub/ui';
import { createStaticStyles } from 'antd-style';
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { ADMIN_NAV_ITEMS } from '../navItems';

const styles = createStaticStyles(({ css, cssVar }) => ({
  desc: css`
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 1;

    font-size: 12px;
    line-height: 1.4;
    color: ${cssVar.colorTextTertiary};
    text-overflow: ellipsis;
  `,
  item: css`
    cursor: pointer;

    padding-block: 8px;
    padding-inline: 12px;
    border: 1px solid transparent;
    border-radius: 10px;

    transition: all 0.16s;

    :hover {
      background: ${cssVar.colorFillTertiary};
    }
  `,
  itemActive: css`
    border-color: ${cssVar.colorPrimaryBorder};
    background: ${cssVar.colorPrimaryBg};

    :hover {
      background: ${cssVar.colorPrimaryBg};
    }
  `,
  label: css`
    font-size: 14px;
    font-weight: 500;
    color: ${cssVar.colorText};
  `,
  labelActive: css`
    color: ${cssVar.colorPrimaryText};
  `,
  nav: css`
    gap: 4px;
    padding-block: 16px;
    padding-inline: 12px;
  `,
  title: css`
    padding-block: 0 8px;
    padding-inline: 12px;

    font-size: 11px;
    font-weight: 600;
    color: ${cssVar.colorTextTertiary};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  wrapper: css`
    flex-shrink: 0;
    width: 240px;
    height: 100%;
    border-inline-end: 1px solid ${cssVar.colorBorderSecondary};
  `,
}));

interface SidebarProps {
  active: string;
}

const Sidebar = memo<SidebarProps>(({ active }) => {
  const navigate = useNavigate();
  const { search } = useLocation();

  return (
    <aside className={styles.wrapper}>
      <Flexbox vertical className={styles.nav}>
        <div className={styles.title}>企业管理</div>
        {ADMIN_NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = item.key === active;
          return (
            <Flexbox
              horizontal
              className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
              gap={10}
              key={item.key}
              onClick={() => navigate(`/settings/enterprise-admin/${item.key}${search}`)}
            >
              <Icon size={18} style={{ flexShrink: 0, marginTop: 2 }} />
              <Flexbox flex={1} gap={2}>
                <span className={`${styles.label} ${isActive ? styles.labelActive : ''}`}>
                  {item.label}
                </span>
                <span className={styles.desc}>{item.description}</span>
              </Flexbox>
            </Flexbox>
          );
        })}
      </Flexbox>
    </aside>
  );
});

Sidebar.displayName = 'EnterpriseAdminSidebar';

export default Sidebar;
