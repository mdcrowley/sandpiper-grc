// Application shell: grouped left navigation, top bar (search, Create, theme, user menu), notices.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { qs } from './api';
import { useAuth } from './auth';
import { ChangePasswordDialog } from './AuthPages';
import { useDebounced, useDismiss, useFetch, useMediaQuery } from './hooks';
import { Icon } from './Icon';
import { recordHref } from './meta';
import { modules, NAV_GROUPS } from './module';
import { Drawer, Menu } from './overlay';
import { useTheme } from './theme';
import { IconButton, cx } from './ui';

function Nav() {
  const { can } = useAuth();
  const items = modules.flatMap((m) => m.nav ?? []).filter((item) => can(item.permission));
  return (
    <nav className="nav" aria-label="Main">
      {NAV_GROUPS.map((group) => {
        const inGroup = items.filter((i) => i.group === group).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
        if (inGroup.length === 0) return null;
        return (
          <div key={group} className="nav-group" role="group" aria-label={group}>
            {group !== 'Home' && <p className="nav-heading" aria-hidden="true">{group}</p>}
            <ul>
              {inGroup.map((item) => (
                <li key={item.path}>
                  <NavLink to={item.path} end={item.path === '/'} className={({ isActive }) => cx('nav-link', isActive && 'nav-link-active')}>
                    <Icon name={item.icon} />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

interface SearchHit {
  type: string;
  typeLabel: string;
  id: string;
  label: string;
  ref: string | null;
  route: string;
}

function GlobalSearch() {
  const navigate = useNavigate();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const { data, loading, error } = useFetch<SearchHit[]>(q.length >= 2 ? `/api/search${qs({ q })}` : null);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const hits = data ?? [];
  const showList = open && q.length >= 2;

  useEffect(() => setActive(0), [data]);

  // "/" (outside a text box) or Ctrl+K focuses the search box.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      const shortcut = ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey);
      if (!shortcut || document.querySelector('dialog[open]')) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setText('');
    navigate(recordHref(hit.route, hit.id));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (hits.length > 0) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length);
    } else if (e.key === 'Enter' && showList && hits[active]) {
      e.preventDefault();
      go(hits[active]);
    }
  };

  return (
    <div className="gsearch" ref={ref} role="search">
      <Icon name="search" size={16} className="gsearch-icon" />
      <input
        ref={inputRef}
        className="input gsearch-input"
        type="search"
        role="combobox"
        aria-label="Search all records"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
        aria-keyshortcuts="/ Control+K"
        autoComplete="off"
        placeholder="Search all records"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      <kbd className="gsearch-kbd" aria-hidden="true">/</kbd>
      <ul id={listId} className="combo-list gsearch-list" role="listbox" aria-label="Search results" hidden={!showList}>
        {showList && error !== undefined && error !== null && <li className="menu-empty" role="presentation">Search is unavailable right now</li>}
        {showList && !error && !data && loading && <li className="menu-empty" role="presentation">Searching…</li>}
        {showList && data && hits.length === 0 && <li className="menu-empty" role="presentation">No records match “{q}”</li>}
        {showList && hits.map((hit, i) => (
          <li
            key={`${hit.type}-${hit.id}`}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={cx('combo-option gsearch-option', i === active && 'combo-option-active')}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(hit)}
          >
            <span className="gsearch-type">{hit.typeLabel}</span>
            <span className="truncate">
              {hit.ref && <span className="ref">{hit.ref}</span>}
              {hit.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, appName, pilot, mfaEnrollmentRequired, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const narrow = useMediaQuery('(max-width: 960px)');
  const [navOpen, setNavOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setNavOpen(false);
    mainRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  const createItems = modules
    .flatMap((m) => m.create ?? [])
    .filter((item) => can(item.permission))
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((item) => ({ label: item.label, icon: item.icon, to: item.path }));

  const brand = <Link className="brand" to="/">{appName}</Link>;

  return (
    <div className="shell">
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

      {!narrow && (
        <aside className="sidebar">
          {brand}
          <Nav />
        </aside>
      )}

      <div className="shell-main">
        {pilot && (
          <p className="notice notice-pilot" role="note">
            <Icon name="info" size={16} />
            Pilot mode: use seed and test data only. Do not record live incident details, client health information or card data.
          </p>
        )}
        {mfaEnrollmentRequired && (
          <p className="notice notice-warn" role="note">
            <Icon name="shield" size={16} />
            <span>Your role requires a second sign-in factor. <Link to="/account/security">Set it up now.</Link></span>
          </p>
        )}

        <header className="topbar">
          {narrow && <IconButton icon="menu" label="Open navigation" onClick={() => setNavOpen(true)} />}
          <GlobalSearch />
          <div className="topbar-actions">
            {createItems.length > 0 && <Menu label="Create" icon="plus" variant="primary" align="end" items={createItems} />}
            <IconButton
              icon={theme === 'dark' ? 'sun' : 'moon'}
              label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={toggle}
            />
            <Menu
              label={narrow ? 'Account' : user?.displayName ?? 'Account'}
              icon="user"
              iconOnly={narrow}
              variant="ghost"
              align="end"
              items={[
                { label: 'Change password', icon: 'lock', onSelect: () => setChangingPassword(true) },
                { label: 'Sign out', icon: 'logout', separated: true, onSelect: () => void logout() },
              ]}
            />
          </div>
        </header>

        <main id="main" className="content" tabIndex={-1} ref={mainRef}>
          {children}
        </main>
      </div>

      <Drawer open={narrow && navOpen} side="left" size="sm" title={appName} onClose={() => setNavOpen(false)}>
        <Nav />
      </Drawer>
      <ChangePasswordDialog open={changingPassword} onClose={() => setChangingPassword(false)} />
    </div>
  );
}
