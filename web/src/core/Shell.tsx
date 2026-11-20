// Application shell on Mantine AppShell: collapsible grouped sidebar (full, rail or drawer),
// top bar (command-palette search, Create, Help, theme, user menu) and slim notices.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { ActionIcon, AppShell, Avatar, Drawer, Menu as MMenu, Popover, Tooltip, UnstyledButton } from '@mantine/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { BreakGlassBanner, ChangePasswordDialog } from './AuthPages';
import { CommandPalette, type PaletteLink } from './CommandPalette';
import { useMediaQuery } from './hooks';
import { Icon, type IconName } from './Icon';
import { Logo, Wordmark } from './Logo';
import { moduleOn, modules, NAV_GROUPS, preloadRoute, type NavGroup, type NavItem } from './module';
import { Menu } from './overlay';
import { formatDate } from './format';
import { ShortcutsDialog } from './Shortcuts';
import { useTheme } from './theme';
import { cx } from './ui';

const GROUP_ICON: Record<NavGroup, IconName> = {
  Home: 'home', 'Service desk': 'ticket', Inventory: 'server', Change: 'refresh', Vendors: 'building',
  Cybersecurity: 'shield', Safety: 'alert', Projects: 'folder', Reports: 'chart', Administration: 'settings', Help: 'help',
};

// The notification bell belongs to the notifications module. It is looked up rather than imported, so the
// core builds and runs without that module, and loaded on demand so it stays out of the core bundle.
const bellFiles = import.meta.glob<{ NotificationBell: ComponentType }>('../modules/notifications/NotificationBell.tsx');
const loadBell = Object.values(bellFiles)[0];
const NotificationBell = loadBell ? lazy(() => loadBell().then((m) => ({ default: m.NotificationBell }))) : null;
const hasNotifications = NotificationBell !== null && modules.some((m) => m.key === 'notifications');
const hasHelp = modules.some((m) => m.key === 'help');

/** Start fetching a page's code when the pointer or focus reaches its link. */
const preload = (path: string) => ({ onMouseEnter: () => preloadRoute(path), onFocus: () => preloadRoute(path) });

/** State kept in localStorage (read synchronously, so there is no flash on load). */
function useStored<T>(key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback((next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, [key]);
  return [value, set];
}

/** The one navigation entry that best matches the address: the longest path that is a prefix of it. */
function activePath(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const { path } of items) {
    const hit = path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`);
    if (hit && (best === null || path.length > best.length)) best = path;
  }
  return best;
}

interface NavData {
  groups: { group: NavGroup; items: NavItem[] }[];
  current: string | null;
}

/** Full sidebar: collapsible groups. Up/Down move between entries, Left/Right close and open a group. */
function NavFull({ groups, current, closed, onToggle }: NavData & { closed: Record<string, boolean>; onToggle: (group: string, open?: boolean) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a[href], button'));
    const at = all.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
    if (next !== undefined && at >= 0) {
      e.preventDefault();
      all[Math.min(all.length - 1, Math.max(0, next))]?.focus();
      return;
    }
    const heading = (document.activeElement as HTMLElement | null)?.dataset.group;
    if (heading && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      onToggle(heading, e.key === 'ArrowRight');
    }
  };

  return (
    <nav className="nav" aria-label="Main" onKeyDown={onKeyDown}>
      {groups.map(({ group, items }, g) => {
        const open = group === 'Home' || !closed[group];
        const holdsCurrent = items.some((i) => i.path === current);
        return (
          <div key={group} className="nav-group">
            {group !== 'Home' && (
              <button
                type="button"
                className={cx('nav-heading', !open && holdsCurrent && 'nav-heading-current')}
                aria-expanded={open}
                aria-controls={`nav-group-${g}`}
                data-group={group}
                onClick={() => onToggle(group)}
              >
                <span>{group}</span>
                {!open && <span className="nav-count">{items.length}</span>}
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
            )}
            <ul id={`nav-group-${g}`} hidden={!open} aria-label={group}>
              {items.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    {...preload(item.path)}
                    className={cx('nav-link', item.path === current && 'nav-link-active')}
                    aria-current={item.path === current ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="nav-label">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

/** Rail: one icon per group; groups with several pages open a fly-out menu. */
function NavRail({ groups, current }: NavData) {
  return (
    <nav className="nav nav-rail" aria-label="Main">
      {groups.map(({ group, items }) => {
        const active = items.some((i) => i.path === current);
        if (items.length === 1) {
          return (
            <Tooltip key={group} label={items[0].label} position="right">
              <Link to={items[0].path} {...preload(items[0].path)} className={cx('rail-link', active && 'rail-link-active')} aria-label={items[0].label} aria-current={active ? 'page' : undefined}>
                <Icon name={items[0].icon} size={20} />
              </Link>
            </Tooltip>
          );
        }
        return (
          <MMenu key={group} position="right-start" offset={10} trigger="click-hover" openDelay={80} closeDelay={160}>
            <MMenu.Target>
              <UnstyledButton className={cx('rail-link', active && 'rail-link-active')} aria-label={group}>
                <Icon name={GROUP_ICON[group] ?? items[0].icon} size={20} />
              </UnstyledButton>
            </MMenu.Target>
            <MMenu.Dropdown className="ui-menu">
              <MMenu.Label>{group}</MMenu.Label>
              {items.map((item) => (
                <MMenu.Item
                  key={item.path}
                  component={Link}
                  to={item.path}
                  {...preload(item.path)}
                  className={cx('ui-menu-item', item.path === current && 'ui-menu-item-current')}
                  aria-current={item.path === current ? 'page' : undefined}
                  leftSection={<Icon name={item.icon} size={16} />}
                >
                  {item.label}
                </MMenu.Item>
              ))}
            </MMenu.Dropdown>
          </MMenu>
        );
      })}
    </nav>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, appName, pilot, mfaEnrollmentRequired, mfaGraceEndsAt, can, areaOn, logout } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const small = useMediaQuery('(max-width: 47.99em)');
  const medium = useMediaQuery('(max-width: 74.99em)');
  const tight = useMediaQuery('(max-width: 62em)');
  const userKey = user?.id ?? 'anon';
  const [collapsed, setCollapsed] = useStored<boolean>(`grc.nav.collapsed.${userKey}`, false);
  const [closed, setClosed] = useStored<Record<string, boolean>>(`grc.nav.groups.${userKey}`, {});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // "Help for this page": the Help module maps the address to the matching section of the guide.
  const helpHere = location.pathname.startsWith('/help') ? '/help' : `/help?for=${encodeURIComponent(location.pathname)}`;
  const mainRef = useRef<HTMLElement>(null);
  const rail = !small && (medium || collapsed);

  const nav = useMemo<NavData & { pages: PaletteLink[] }>(() => {
    // Modules of a switched-off area (Administration > Features) contribute nothing.
    const items = modules.filter((m) => moduleOn(m.key, areaOn)).flatMap((m) => m.nav ?? []).filter((item) => can(item.permission));
    const groups = NAV_GROUPS
      .map((group) => ({ group, items: items.filter((i) => i.group === group).sort((a, b) => (a.order ?? 100) - (b.order ?? 100)) }))
      .filter((g) => g.items.length > 0);
    return {
      groups,
      current: activePath(location.pathname, items),
      pages: groups.flatMap((g) => g.items.map((i) => ({ label: i.label, path: i.path, icon: i.icon, group: g.group }))),
    };
  }, [can, areaOn, location.pathname]);

  const createItems = useMemo(() => modules
    .filter((m) => moduleOn(m.key, areaOn))
    .flatMap((m) => m.create ?? [])
    .filter((item) => can(item.permission))
    .sort((a, b) => a.label.localeCompare(b.label)), [can, areaOn]);

  const closedRef = useRef(closed);
  closedRef.current = closed;
  const toggleGroup = useCallback((group: string, open?: boolean) => {
    const isClosed = Boolean(closedRef.current[group]);
    setClosed({ ...closedRef.current, [group]: open === undefined ? !isClosed : !open });
  }, [setClosed]);

  // On every page change: close the drawer, start at the top, and make sure the current page's group is open.
  useEffect(() => {
    setDrawerOpen(false);
    mainRef.current?.scrollTo(0, 0);
    const group = nav.groups.find((g) => g.items.some((i) => i.path === nav.current))?.group;
    if (group && closedRef.current[group]) setClosed({ ...closedRef.current, [group]: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Keyboard shortcuts: "/" or Ctrl+K opens the search, "?" the list of shortcuts, and "g" followed
  // by a letter goes somewhere. Single keys are ignored while typing and while a dialog is open.
  const helpHereRef = useRef(helpHere);
  helpHereRef.current = helpHere;
  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const modified = e.ctrlKey || e.metaKey || e.altKey;
      const inDialog = () => Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !modified)) {
        if (inDialog()) return;
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing || modified || inDialog()) return;
      if (e.key === '?') {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'g') {
        pendingG = Date.now();
        return;
      }
      if (Date.now() - pendingG < 1500) {
        const to = { o: '/', n: hasNotifications ? '/notifications' : null, h: hasHelp ? helpHereRef.current : null }[key];
        if (to) {
          e.preventDefault();
          navigate(to);
        }
      }
      pendingG = 0;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navigate]);

  const navToggle = small || medium
    ? { icon: 'menu' as const, label: 'Open navigation', run: () => setDrawerOpen(true) }
    : collapsed
      ? { icon: 'sidebar-expand' as const, label: 'Expand navigation', run: () => setCollapsed(false) }
      : { icon: 'sidebar-collapse' as const, label: 'Collapse navigation', run: () => setCollapsed(true) };
  const name = user?.displayName ?? 'Account';

  return (
    <AppShell
      className="shell"
      layout="alt"
      padding={0}
      withBorder={false}
      header={{ height: mfaEnrollmentRequired ? 92 : 56 }}
      navbar={{ width: rail ? 64 : 256, breakpoint: 'sm', collapsed: { mobile: true, desktop: false } }}
    >
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
      >
        Skip to content
      </a>

      {/* The top bar comes before the sidebar in the page (both are fixed in place, so the look is the
          same): Tab reaches search, Create and the account menu without first passing every navigation entry. */}
      <AppShell.Header className="shell-header">
        <div className="topbar">
          <Tooltip label={navToggle.label}>
            <ActionIcon size={36} aria-label={navToggle.label} className="ui-btn-ghost" onClick={navToggle.run}>
              <Icon name={navToggle.icon} size={20} />
            </ActionIcon>
          </Tooltip>

          {/* The visible words are the button's name (speech users say what they see); the narrow form adds the rest unseen. */}
          <button type="button" className="gsearch" aria-keyshortcuts="/ Control+K" aria-haspopup="dialog" onClick={() => setPaletteOpen(true)}>
            <Icon name="search" size={17} />
            <span className="gsearch-text">{tight ? <>Search<span className="sr-only"> records, pages and actions</span>…</> : 'Search records, pages and actions…'}</span>
            <kbd className="kbd" aria-hidden="true">Ctrl K</kbd>
          </button>

          <div className="topbar-actions">
            {pilot && (
              <Popover width={300} position="bottom-end" withArrow>
                <Popover.Target>
                  <button type="button" className="chip chip-amber pilot-badge">
                    <Icon name="flask" size={14} />
                    {tight ? 'Pilot' : 'Pilot: test data only'}
                    <span className="sr-only">{tight ? ' mode: test data only' : ''}. More information</span>
                  </button>
                </Popover.Target>
                <Popover.Dropdown>
                  <p className="popover-title">Pilot mode</p>
                  <p className="muted">Use sample and test data only. Do not enter real records, personal details or anything confidential while this label is showing.</p>
                </Popover.Dropdown>
              </Popover>
            )}
            {createItems.length > 0 && (
              <Menu label="Create" icon="plus" variant="primary" align="end" iconOnly={small}
                items={createItems.map((item) => ({ label: item.label, icon: item.icon, to: item.path }))} />
            )}
            {hasNotifications && NotificationBell && (
              <Suspense fallback={<span className="topbar-slot" aria-hidden="true" />}>
                <NotificationBell />
              </Suspense>
            )}
            <Tooltip label={hasHelp ? 'Help for this page' : 'Help'}>
              <ActionIcon component={Link} to={hasHelp ? helpHere : '/help'} size={36} aria-label={hasHelp ? 'Help for this page' : 'Help'} className="ui-btn-ghost" {...preload('/help')}>
                <Icon name="help" size={20} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
              <ActionIcon size={36} className="ui-btn-ghost" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
              </ActionIcon>
            </Tooltip>
            <MMenu position="bottom-end" offset={6} width={240}>
              <MMenu.Target>
                <UnstyledButton className="user-button" aria-label={`Account: ${name}`}>
                  {/* Initials are drawn by CSS (shell.css), so the button's visible text is the name its label starts from. */}
                  <Avatar size={30} radius="xl" color="brand" variant="filled" aria-hidden="true"><span className="user-initials" data-initials={initials(name)} /></Avatar>
                  {!tight && <span className="user-name">{name}</span>}
                  {!tight && <Icon name="chevron-down" size={14} />}
                </UnstyledButton>
              </MMenu.Target>
              <MMenu.Dropdown className="ui-menu">
                <div className="user-card">
                  <span className="user-card-name">{name}</span>
                  {user?.email && <span className="muted">{user.email}</span>}
                </div>
                <MMenu.Divider />
                {hasNotifications && (
                  <MMenu.Item className="ui-menu-item" component={Link} to="/notifications" leftSection={<Icon name="bell" size={16} />}>Notifications</MMenu.Item>
                )}
                <MMenu.Item className="ui-menu-item" component={Link} to="/account/security" leftSection={<Icon name="shield" size={16} />}>Account security</MMenu.Item>
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="lock" size={16} />} onClick={() => setChangingPassword(true)}>Change password</MMenu.Item>
                <MMenu.Item className="ui-menu-item" component={Link} to="/help" leftSection={<Icon name="help" size={16} />}>Help</MMenu.Item>
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="key" size={16} />} rightSection={<kbd className="kbd" aria-hidden="true">?</kbd>} onClick={() => setShortcutsOpen(true)}>Keyboard shortcuts</MMenu.Item>
                <MMenu.Divider />
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="logout" size={16} />} onClick={() => void logout()}>Sign out</MMenu.Item>
              </MMenu.Dropdown>
            </MMenu>
          </div>
        </div>

        {mfaEnrollmentRequired && (
          <p className="notice notice-warn-soft shell-notice" role="note">
            <Icon name="shield" size={16} />
            <span>
              Your account needs a second sign-in factor{mfaGraceEndsAt ? ` by ${formatDate(mfaGraceEndsAt)}; after that you will not be able to work until it is set up` : ''}.{' '}
              <Link to="/account/security">Set it up now</Link>
            </span>
          </p>
        )}
      </AppShell.Header>

      <AppShell.Navbar className={cx('sidebar', rail && 'sidebar-rail')}>
        <Link className="brand" to="/" aria-label={`${appName}: overview`}>
          {rail ? <Logo size={30} surface="dark" /> : <Wordmark name={appName} surface="dark" />}
        </Link>
        <div className="sidebar-scroll">
          {rail ? <NavRail groups={nav.groups} current={nav.current} /> : <NavFull groups={nav.groups} current={nav.current} closed={closed} onToggle={toggleGroup} />}
        </div>
      </AppShell.Navbar>

      <AppShell.Main id="main" className="content shell-main" tabIndex={-1} ref={mainRef}>
        <BreakGlassBanner />
        {children}
      </AppShell.Main>

      <Drawer
        opened={drawerOpen && (small || medium)}
        onClose={() => setDrawerOpen(false)}
        size={288}
        title={<Wordmark name={appName} surface="dark" />}
        closeButtonProps={{ 'aria-label': 'Close navigation' }}
        classNames={{ content: 'nav-drawer', header: 'nav-drawer-head', body: 'nav-drawer-body' }}
      >
        <NavFull groups={nav.groups} current={nav.current} closed={closed} onToggle={toggleGroup} />
      </Drawer>
      <CommandPalette
        opened={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={nav.pages}
        create={createItems}
        userId={userKey}
      />
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </AppShell>
  );
}
