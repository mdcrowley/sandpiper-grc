// The links between the Administration > Asset tags pages (formats, stock, series, print, settings).
// Owner: TAGS-CORE; every Asset tags administration page puts it under its PageHeader.
import { Link, useLocation } from 'react-router-dom';
import { cx, useAuth } from '../../core';

const PAGES: { label: string; path: string; permission: string; exact?: boolean }[] = [
  { label: 'Formats', path: '/admin/asset-tags', permission: 'tags.view', exact: true },
  { label: 'Stock', path: '/admin/asset-tags/stock', permission: 'tags.view' },
  { label: 'Series', path: '/admin/asset-tags/series', permission: 'tags.view' },
  { label: 'Print tags', path: '/admin/asset-tags/print', permission: 'tags.manage' },
  { label: 'Settings', path: '/admin/asset-tags/settings', permission: 'tags.view' },
];

export function AssetTagsTabs() {
  const { can } = useAuth();
  const { pathname } = useLocation();
  return (
    <nav className="tg-tabs no-print" aria-label="Asset tags pages">
      <ul>
        {PAGES.filter((p) => can(p.permission)).map((p) => {
          const current = p.exact ? pathname === p.path : pathname === p.path || pathname.startsWith(`${p.path}/`);
          return (
            <li key={p.path}>
              <Link to={p.path} className={cx('tg-tab', current && 'is-current')} aria-current={current ? 'page' : undefined}>{p.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
