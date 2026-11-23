// The portal's own layout: a light header with the way home, "My requests" and the person's menu,
// and one centered column. No agent navigation. App.tsx renders this for every /portal address.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ActionIcon, Menu as MMenu, UnstyledButton } from '@mantine/core';
import {
  ChangePasswordDialog, ErrorState, Icon, Loading, modules, NotFound, useAuth, useFetch, useRouteFocus, useTheme,
} from '../../core';
import { Logo } from '../../core/Logo';
import { ConfigProvider, type PortalConfig } from './parts';
import { PortalHome } from './Home';
import { CatalogPage } from './CatalogPage';
import { RequestForm, ReportProblem } from './RequestForm';
import { MyRequests } from './MyRequests';
import { RequestDetail } from './RequestDetail';
import { ArticlePage } from './ArticlePage';
import { PolicyPage } from './PolicyPage';
import { SafetyReport } from './SafetyReport';
import './portal.css';

// The notification bell belongs to the notifications module: looked up, not imported.
const bellFiles = import.meta.glob<{ NotificationBell: ComponentType }>('../notifications/NotificationBell.tsx');
const loadBell = Object.values(bellFiles)[0] as (typeof bellFiles)[string] | undefined;
const NotificationBell = loadBell && modules.some((m) => m.key === 'notifications')
  ? lazy(() => loadBell().then((m) => ({ default: m.NotificationBell })))
  : null;

/** Anything in the sidebar besides the portal: such a person also has the full application. */
const agentPermissions = [...new Set(modules.flatMap((m) => m.nav ?? []).map((n) => n.permission)
  .filter((p): p is string => Boolean(p) && !p!.startsWith('portal.')))];

function Header({ config }: { config: PortalConfig | null }) {
  const { user, appName, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [pwOpen, setPwOpen] = useState(false);
  const agent = agentPermissions.some((p) => can(p));
  const initials = (user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <header className="pt-header">
      <div className="pt-header-inner">
        <Link to="/portal" className="pt-brand" aria-label={`${config?.title ?? 'Portal'} home`}>
          <Logo size={32} />
          <span className="pt-brand-text">
            <span className="pt-brand-title">{config?.title ?? 'Help and requests'}</span>
            <span className="pt-brand-sub">{appName}</span>
          </span>
        </Link>
        <nav className="pt-nav" aria-label="Portal">
          <NavLink to="/portal" end className="pt-nav-link"><Icon name="home" size={18} /><span>Home</span></NavLink>
          <NavLink to="/portal/requests" className="pt-nav-link"><Icon name="ticket" size={18} /><span>My requests</span></NavLink>
        </nav>
        <div className="pt-tools">
          {NotificationBell && <Suspense fallback={null}><NotificationBell /></Suspense>}
          <ActionIcon size={44} variant="subtle" color="gray" onClick={toggle} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
          </ActionIcon>
          <MMenu position="bottom-end" width={240} withinPortal>
            <MMenu.Target>
              <UnstyledButton className="pt-avatar" aria-label={`Account menu for ${user?.displayName ?? ''}`}>{initials}</UnstyledButton>
            </MMenu.Target>
            <MMenu.Dropdown>
              <MMenu.Label>{user?.displayName}</MMenu.Label>
              <MMenu.Item leftSection={<Icon name="key" size={16} />} onClick={() => setPwOpen(true)}>Change password</MMenu.Item>
              <MMenu.Item leftSection={<Icon name="lock" size={16} />} component={Link} to="/account/security">Sign-in security</MMenu.Item>
              {agent && <MMenu.Item leftSection={<Icon name="external" size={16} />} component={Link} to="/">Open the full application</MMenu.Item>}
              <MMenu.Divider />
              <MMenu.Item leftSection={<Icon name="logout" size={16} />} onClick={() => void logout()}>Sign out</MMenu.Item>
            </MMenu.Dropdown>
          </MMenu>
        </div>
      </div>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  );
}

function Off({ config }: { config: PortalConfig }) {
  const { can } = useAuth();
  return (
    <div className="pt-empty-page">
      <Icon name="info" size={32} />
      <h1>{config.enabled ? 'The portal is not available to you' : 'The self-service portal is switched off'}</h1>
      <p className="muted">
        {config.enabled
          ? 'Your account does not include the portal. Ask the service desk to give you the Requester role.'
          : can('admin.administer')
            ? 'Switch it on under Service desk settings, Self-service portal.'
            : 'Contact the service desk by phone or in person instead.'}
      </p>
      {agentPermissions.some((p) => can(p)) && <Link className="btn btn-primary" to="/">Back to the application</Link>}
    </div>
  );
}

export function PortalApp() {
  const { data: config, error, reload } = useFetch<PortalConfig>('/api/portal/config');
  const { pathname } = useLocation();
  // Each page starts at the top, as a phone user expects.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // ...and its heading takes the focus, so a screen reader says where it is (E16-15).
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  useEffect(() => { document.documentElement.classList.add('pt-doc'); return () => document.documentElement.classList.remove('pt-doc'); }, []);

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!config) body = <Loading lines={6} label="Loading the portal" />;
  else if (!config.enabled || !config.allowed) body = <Off config={config} />;
  else {
    body = (
      <ConfigProvider value={config}>
        <Routes>
          <Route path="/portal" element={<PortalHome />} />
          <Route path="/portal/catalog" element={<CatalogPage />} />
          <Route path="/portal/new/:itemId" element={<RequestForm />} />
          <Route path="/portal/report" element={<ReportProblem />} />
          <Route path="/portal/requests" element={<MyRequests />} />
          <Route path="/portal/requests/:id" element={<RequestDetail />} />
          <Route path="/portal/knowledge/:id" element={<ArticlePage />} />
          <Route path="/portal/policies/:ackId" element={<PolicyPage />} />
          <Route path="/portal/safety" element={config.has.safety ? <SafetyReport /> : <NotFound />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </ConfigProvider>
    );
  }
  return (
    <div className="pt-app">
      <a href="#pt-main" className="pt-skip">Skip to content</a>
      <Header config={config?.enabled && config.allowed ? config : null} />
      <main id="pt-main" className="pt-main" ref={mainRef}>{body}</main>
      <footer className="pt-footer muted">
        Something urgent for safety? Follow your local safety procedure first, then report it here.
      </footer>
    </div>
  );
}
