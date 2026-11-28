// Application shell on Mantine AppShell: collapsible grouped sidebar (full, rail or drawer),
// top bar (command-palette search, Create, Help, theme, user menu) and slim notices.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react';
import { ActionIcon, AppShell, Avatar, Drawer, Menu as MMenu, Popover, Tooltip, UnstyledButton } from '@mantine/core';
import { Link, matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { BreakGlassBanner, ChangePasswordDialog } from './AuthPages';
import { CommandPalette, type PaletteLink } from './CommandPalette';
import { api } from './api';
import { useFetch, useMediaQuery } from './hooks';
import { Icon, type IconName } from './Icon';
import { Logo, Wordmark } from './Logo';
import { moduleOn, modules, NAV_GROUPS, preloadRoute, type CreateItem, type NavGroup, type NavItem } from './module';
import { groupLabel } from './navGroups';
import { allowedNav, currentMenuPath, hubCardAt, menuGroups, sectionTabs } from './navModel';
import { cleanPins, MAX_PINS, PINS_KEY, pinsLocalKey, setRecentUser, ShellPage, togglePin, type PinnedPage, type ShellPageContext } from './navMemory';
import { FilterMenu } from './overlay';
import { createEntries } from './createMenu';
import { formatDate, formatDateTime } from './format';
import { useSyncedPreference } from './preferences';
import { ShortcutsDialog } from './Shortcuts';
import { useRouteFocus } from './routeFocus';
import { useTheme } from './theme';
import { cx } from './ui';

const GROUP_ICON: Record<NavGroup, IconName> = {
  Home: 'home', 'IT services': 'ticket', Assets: 'server', Vendors: 'building', 'Projects and funding': 'folder',
  Security: 'shield', 'Risk and compliance': 'scale', 'Safety and emergency management': 'alert',
  'Governance and records': 'clipboard', Documents: 'file-text', 'People and training': 'users', Reports: 'chart', Administration: 'settings',
};
/** The pinned pages' block at the top of the menu. */
const PINNED = 'Pinned';

// The notification bell belongs to the notifications module. It is looked up rather than imported, so the
// core builds and runs without that module, and loaded on demand so it stays out of the core bundle.
const bellFiles = import.meta.glob<{ NotificationBell: ComponentType }>('../modules/notifications/NotificationBell.tsx');
const loadBell = Object.values(bellFiles)[0];
const NotificationBell = loadBell ? lazy(() => loadBell().then((m) => ({ default: m.NotificationBell }))) : null;
const hasNotifications = NotificationBell !== null && modules.some((m) => m.key === 'notifications');
const hasHelp = modules.some((m) => m.key === 'help');
// Calendar feeds (web/src/modules/feeds) are a page of the person's own, offered in the account menu while an administrator has them on.
const hasFeeds = modules.some((m) => m.key === 'feeds');
// Menu and Create entries made while the application runs (E41-06: each register an administrator
// defines), from a module's NavExtras.ts. A fixed list of hooks, each called on every render.
type NavExtras = { nav: NavItem[]; create: CreateItem[] };
const navExtraHooks = Object.values(import.meta.glob<{ useNavExtras?: () => NavExtras }>('../modules/*/NavExtras.ts', { eager: true }))
  .map((m) => m.useNavExtras).filter((f): f is () => NavExtras => typeof f === 'function');

/**
 * The counts shown beside menu entries that ask for one (NavItem.count, E44-09), by API path. Read once
 * at start, again when the person moves to another page if a minute has passed, and every five minutes.
 */
function useNavCounts(paths: string[], pathname: string): Record<string, number> {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const last = useRef(0);
  const key = paths.join('|');
  const read = useCallback(() => {
    last.current = Date.now();
    for (const path of key ? key.split('|') : []) {
      api.get<{ count?: number }>(path)
        .then((res) => setCounts((prev) => (typeof res?.count === 'number' && prev[path] !== res.count ? { ...prev, [path]: res.count } : prev)))
        .catch(() => { /* no count: nothing shown */ });
    }
  }, [key]);
  useEffect(() => {
    read();
    const timer = window.setInterval(read, 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [read]);
  useEffect(() => {
    if (Date.now() - last.current > 60_000) read();
  }, [pathname, read]);
  return counts;
}

/** The number beside a menu entry: read as part of the entry's name by screen readers ("My work, 3 waiting"). */
function NavBadge({ count }: { count: number | undefined }) {
  if (!count) return null;
  return <span className="nav-badge"><span className="sr-only">, </span>{count > 99 ? '99+' : count}<span className="sr-only"> waiting</span></span>;
}

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

interface NavData {
  /** The menu's groups; a "Pinned" group (the person's pinned pages) comes first when there are any. */
  /** `label`: the name shown, shorter while one of a joined group's areas is off (navGroups.ts groupLabel). */
  groups: { group: NavGroup | typeof PINNED; label?: string; items: NavItem[] }[];
  current: string | null;
  /** Counts beside entries that ask for one (NavItem.count), by API path. */
  counts?: Record<string, number>;
}

/**
 * Full sidebar: collapsible groups. Home and the pinned pages are always open; the group of the page
 * on screen opens by itself; the others start closed and stay as the person leaves them (per person,
 * in this browser). Up/Down move between entries, Left/Right close and open a group.
 */
function NavFull({ groups, current, counts, open: openGroups, onToggle }: NavData & { open: Record<string, boolean>; onToggle: (group: string, open?: boolean) => void }) {
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
      {groups.map(({ group, label, items }, g) => {
        const name = label ?? group;
        const holdsCurrent = items.some((i) => i.path === current);
        // A group whose one entry has the group's own name (Administration) is that entry alone, without a heading.
        const alone = items.length === 1 && items[0].label === name;
        const fixed = group === 'Home' || group === PINNED || alone;
        const open = fixed || (openGroups[group] ?? holdsCurrent);
        return (
          <div key={group} className={cx('nav-group', group === PINNED && 'nav-group-pinned', alone && 'nav-group-alone')}>
            {group === PINNED && <p className="nav-group-title" id={`nav-group-${g}-title`}><Icon name="star" size={13} /> {PINNED}</p>}
            {!fixed && (
              <button
                type="button"
                className={cx('nav-heading', !open && holdsCurrent && 'nav-heading-current')}
                aria-expanded={open}
                aria-controls={`nav-group-${g}`}
                data-group={group}
                onClick={() => onToggle(group)}
              >
                <span>{name}</span>
                {!open && <span className="nav-count">{items.length}</span>}
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
            )}
            <ul id={`nav-group-${g}`} hidden={!open} aria-label={group === PINNED ? 'Pinned pages' : name}>
              {items.map((item) => (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    {...preload(item.path)}
                    className={cx('nav-link', group !== PINNED && item.path === current && 'nav-link-active')}
                    aria-current={group !== PINNED && item.path === current ? 'page' : undefined}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="nav-label">{item.label}</span>
                    {item.count && <NavBadge count={counts?.[item.count]} />}
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
function NavRail({ groups, current, counts }: NavData) {
  return (
    <nav className="nav nav-rail" aria-label="Main">
      {groups.map(({ group, label, items }) => {
        const name = label ?? group;
        const active = group !== PINNED && items.some((i) => i.path === current);
        if (items.length === 1 && group !== PINNED) {
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
              <UnstyledButton className={cx('rail-link', active && 'rail-link-active')} aria-label={group === PINNED ? 'Pinned pages' : name}>
                <Icon name={group === PINNED ? 'star' : GROUP_ICON[group] ?? items[0].icon} size={20} />
              </UnstyledButton>
            </MMenu.Target>
            <MMenu.Dropdown className="ui-menu">
              <MMenu.Label>{group === PINNED ? 'Pinned pages' : name}</MMenu.Label>
              {items.map((item) => (
                <MMenu.Item
                  key={item.path}
                  component={Link}
                  to={item.path}
                  {...preload(item.path)}
                  className={cx('ui-menu-item', group !== PINNED && item.path === current && 'ui-menu-item-current')}
                  aria-current={group !== PINNED && item.path === current ? 'page' : undefined}
                  leftSection={<Icon name={item.icon} size={16} />}
                >
                  {item.label}
                  {item.count && <NavBadge count={counts?.[item.count]} />}
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
  const { user, appName, pilot, dataLoadUntil, mfaEnrollmentRequired, mfaGraceEndsAt, can, areaOn, logout } = useAuth();
  const feeds = useFetch<{ enabled: boolean }>(hasFeeds && user ? '/api/me/calendar-feeds/enabled' : null);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const small = useMediaQuery('(max-width: 47.99em)');
  const medium = useMediaQuery('(max-width: 74.99em)');
  const tight = useMediaQuery('(max-width: 62em)');
  const userKey = user?.id ?? 'anon';
  const [collapsed, setCollapsed] = useStored<boolean>(`grc.nav.collapsed.${userKey}`, false);
  // Groups the person opened or closed themselves (wave 24: the others start closed, the current one opens).
  const [openGroups, setOpenGroups] = useStored<Record<string, boolean>>(`grc.nav.open.${userKey}`, {});
  const [storedPins, setPins] = useSyncedPreference<unknown>(PINS_KEY, pinsLocalKey(userKey), []);
  useEffect(() => { setRecentUser(user ? userKey : null); }, [user, userKey]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // "Help for this page": the Help module maps the address to the matching section of the guide.
  const helpHere = location.pathname.startsWith('/help') ? '/help' : `/help?for=${encodeURIComponent(location.pathname)}`;
  const mainRef = useRef<HTMLElement>(null);
  // After a change of page, the focus goes to the new page's heading (screen reader run, E16-15).
  useRouteFocus(mainRef);
  const rail = !small && (medium || collapsed);
  const extras = navExtraHooks.map((use) => use());
  const extrasKey = JSON.stringify(extras);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extra = useMemo(() => ({ nav: extras.flatMap((e) => e.nav), create: extras.flatMap((e) => e.create) }), [extrasKey]);

  // Every entry the person may open (menu entries and the pages that are tabs or Administration cards).
  // Modules of a switched-off area (Administration > Features) contribute nothing.
  const allowed = useMemo(
    () => allowedNav([...modules.filter((m) => moduleOn(m.key, areaOn)).flatMap((m) => m.nav ?? []), ...extra.nav], can),
    [can, areaOn, extra],
  );

  // Pinned pages, left out while their page is switched off or the person may no longer open it.
  const pins = useMemo(() => cleanPins(storedPins), [storedPins]);
  /** Whether an address is a page the person may open now (its module on, its route's permission held). */
  const pathOpen = useCallback((path: string) => {
    const pathname = path.split(/[?#]/)[0];
    if (extra.nav.some((i) => pathname === i.path || pathname.startsWith(`${i.path}/`))) return true;
    for (const m of modules) {
      const route = (m.routes ?? []).find((r) => matchPath({ path: r.path, end: true }, pathname));
      if (route) return moduleOn(m.key, areaOn) && can(route.permission);
    }
    return false;
  }, [extra, areaOn, can]);
  const shownPins = useMemo(() => pins.filter((pin) => pathOpen(pin.path)), [pins, pathOpen]);

  const nav = useMemo<NavData & { pages: PaletteLink[] }>(() => {
    const groups: NavData['groups'] = menuGroups(allowed).map((g) => ({ ...g, label: groupLabel(g.group, areaOn) }));
    const byPath = new Map(allowed.map((i) => [i.path, i]));
    if (shownPins.length > 0) {
      groups.unshift({
        group: PINNED,
        items: shownPins.map((p): NavItem => ({ group: 'Home', label: p.label, path: p.path, icon: byPath.get(p.path)?.icon ?? 'star', count: byPath.get(p.path)?.count })),
      });
    }
    return {
      groups,
      current: currentMenuPath(location.pathname, allowed),
      // The palette's "Go to" offers every page, in the menu or not.
      pages: allowed.map((i) => ({ label: i.label, path: i.path, icon: i.icon, group: i.hub && !i.parent ? 'Administration' : groupLabel(i.group, areaOn) })),
    };
  }, [allowed, shownPins, location.pathname, areaOn]);
  // The numbers beside menu entries that ask for one (My work's waiting count, E44-09).
  const counts = useNavCounts([...new Set(allowed.filter((i) => i.count && i.menu !== false).map((i) => i.count!))], location.pathname);

  // The Create menu is grouped like the navigation, A to Z within a group, and every entry has an
  // icon: its own, or that of the navigation page it opens (E18-63).
  const createItems = useMemo(() => createEntries(
    [...modules.filter((m) => moduleOn(m.key, areaOn)), extra],
    allowed,
    NAV_GROUPS,
  ).filter((item) => can(item.permission)), [can, areaOn, allowed, extra]);

  const openRef = useRef(openGroups);
  openRef.current = openGroups;
  const currentGroup = nav.groups.find((g) => g.group !== PINNED && g.items.some((i) => i.path === nav.current))?.group;
  const toggleGroup = useCallback((group: string, open?: boolean) => {
    const isOpen = openRef.current[group] ?? group === currentGroup;
    setOpenGroups({ ...openRef.current, [group]: open === undefined ? !isOpen : open });
  }, [setOpenGroups, currentGroup]);

  // On every page change: close the drawer, start at the top, and make sure the current page's group is open.
  useEffect(() => {
    setDrawerOpen(false);
    mainRef.current?.scrollTo(0, 0);
    if (currentGroup && openRef.current[currentGroup] === false) {
      const { [currentGroup]: _dropped, ...rest } = openRef.current;
      setOpenGroups(rest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // What page headers show: the tab strip of the page's menu entry, the Administration breadcrumb, the pin button.
  const pageContext = useMemo<ShellPageContext>(() => {
    const card = hubCardAt(location.pathname, allowed);
    return {
      tabs: sectionTabs(location.pathname, allowed),
      hubCrumb: card && !card.parent ? { label: card.label, to: card.path } : null,
      pinned: (path) => pins.some((p) => p.path === path),
      togglePin: (page: PinnedPage) => setPins(togglePin(pins, page)),
      pinsFull: pins.length >= MAX_PINS,
    };
  }, [location.pathname, allowed, pins, setPins]);

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
      header={{ height: 56 + (mfaEnrollmentRequired ? 36 : 0) + (dataLoadUntil ? 36 : 0) }}
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
              <FilterMenu label="Create" icon="plus" variant="primary" align="end" iconOnly={small} filterLabel="Filter what to create"
                items={createItems.map((item) => ({ label: item.label, icon: item.icon, to: item.path, group: item.group ? groupLabel(item.group, areaOn) : item.group }))} />
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
                {/* The mobile app's signed-in devices (wave 13, web/src/modules/mobile), only while that area is on. */}
                {areaOn('mobile') && (
                  <MMenu.Item className="ui-menu-item" component={Link} to="/account/devices" leftSection={<Icon name="key" size={16} />}>Devices</MMenu.Item>
                )}
                {feeds.data?.enabled && (
                  <MMenu.Item className="ui-menu-item" component={Link} to="/account/calendar-feeds" leftSection={<Icon name="calendar" size={16} />}>Calendar feeds</MMenu.Item>
                )}
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="lock" size={16} />} onClick={() => setChangingPassword(true)}>Change password</MMenu.Item>
                <MMenu.Item className="ui-menu-item" component={Link} to="/help" leftSection={<Icon name="help" size={16} />}>Help</MMenu.Item>
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="key" size={16} />} rightSection={<kbd className="kbd" aria-hidden="true">?</kbd>} onClick={() => setShortcutsOpen(true)}>Keyboard shortcuts</MMenu.Item>
                <MMenu.Divider />
                <MMenu.Item className="ui-menu-item" leftSection={<Icon name="logout" size={16} />} onClick={() => void logout()}>Sign out</MMenu.Item>
              </MMenu.Dropdown>
            </MMenu>
          </div>
        </div>

        {dataLoadUntil && (
          <p className="notice notice-warn-soft shell-notice" role="note">
            <Icon name="upload" size={16} />
            <span>
              Data load mode is on until {formatDateTime(dataLoadUntil)}.{' '}
              <Link to="/admin/data-loads">Data loads</Link>
            </span>
          </p>
        )}
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
          {rail ? <NavRail groups={nav.groups} current={nav.current} counts={counts} /> : <NavFull groups={nav.groups} current={nav.current} counts={counts} open={openGroups} onToggle={toggleGroup} />}
        </div>
      </AppShell.Navbar>

      <AppShell.Main id="main" className="content shell-main" tabIndex={-1} ref={mainRef}>
        <BreakGlassBanner />
        <ShellPage.Provider value={pageContext}>{children}</ShellPage.Provider>
      </AppShell.Main>

      <Drawer
        opened={drawerOpen && (small || medium)}
        onClose={() => setDrawerOpen(false)}
        size={288}
        title={<Wordmark name={appName} surface="dark" />}
        closeButtonProps={{ 'aria-label': 'Close navigation' }}
        classNames={{ content: 'nav-drawer', header: 'nav-drawer-head', body: 'nav-drawer-body' }}
      >
        <NavFull groups={nav.groups} current={nav.current} counts={counts} open={openGroups} onToggle={toggleGroup} />
      </Drawer>
      <CommandPalette
        opened={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        pages={nav.pages}
        create={createItems}
        pinned={shownPins.map((p) => ({ label: p.label, path: p.path, icon: nav.pages.find((g) => g.path === p.path)?.icon }))}
        pathOpen={pathOpen}
        userId={userKey}
      />
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </AppShell>
  );
}
