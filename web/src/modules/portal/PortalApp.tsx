// The portal's own layout: a light header with the way home, "My requests" and the person's menu,
// and one centered column. No agent navigation. App.tsx renders this for every /portal address.
// The portal is shown in the person's language (E41-07): the header's language menu saves the choice
// on their account; texts are in web/src/core/i18n/locales.
import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ActionIcon, Menu as MMenu, UnstyledButton } from '@mantine/core';
import {
  ChangePasswordDialog, Icon, Loading, modules, useAuth, useFetch, useRouteFocus, useTheme,
} from '../../core';
import { appTitle } from '../../core/branding';
import { I18nProvider, LanguageMenu, useI18n, useLanguageChoice } from '../../core/i18n';
import { Logo } from '../../core/Logo';
import { ConfigProvider, PortalError, useServerText, type PortalConfig } from './parts';
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

function Header({ config, lang, setLang }: { config: PortalConfig | null; lang: string; setLang: (code: string) => void }) {
  const { user, appName, can, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  const [pwOpen, setPwOpen] = useState(false);
  const agent = agentPermissions.some((p) => can(p));
  const initials = (user?.displayName ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const text = useServerText();
  // The portal's name and welcome are the organization's own words; the default ones are translated.
  const title = config ? text('portal.title', config.title) : t('portal.title');
  return (
    <header className="pt-header">
      <div className="pt-header-inner">
        <Link to="/portal" className="pt-brand" aria-label={t('portal.header.home', { title })}>
          <Logo size={32} />
          <span className="pt-brand-text">
            <span className="pt-brand-title">{title}</span>
            <span className="pt-brand-sub">{appName}</span>
          </span>
        </Link>
        <nav className="pt-nav" aria-label={t('portal.header.nav')}>
          <NavLink to="/portal" end className="pt-nav-link"><Icon name="home" size={18} /><span>{t('portal.nav.home')}</span></NavLink>
          <NavLink to="/portal/requests" className="pt-nav-link"><Icon name="ticket" size={18} /><span>{t('portal.nav.requests')}</span></NavLink>
        </nav>
        <div className="pt-tools">
          {NotificationBell && <Suspense fallback={null}><NotificationBell /></Suspense>}
          <LanguageMenu value={lang} onChange={setLang} />
          <ActionIcon size={44} variant="subtle" color="gray" onClick={toggle} aria-label={theme === 'dark' ? t('portal.header.light') : t('portal.header.dark')}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
          </ActionIcon>
          <MMenu position="bottom-end" width={240} withinPortal>
            <MMenu.Target>
              <UnstyledButton className="pt-avatar" aria-label={t('portal.header.account', { name: user?.displayName ?? '' })}>{initials}</UnstyledButton>
            </MMenu.Target>
            <MMenu.Dropdown>
              <MMenu.Label>{user?.displayName}</MMenu.Label>
              <MMenu.Item leftSection={<Icon name="key" size={16} />} onClick={() => setPwOpen(true)}>{t('portal.header.password')}</MMenu.Item>
              <MMenu.Item leftSection={<Icon name="lock" size={16} />} component={Link} to="/account/security">{t('portal.header.security')}</MMenu.Item>
              {agent && <MMenu.Item leftSection={<Icon name="external" size={16} />} component={Link} to="/">{t('portal.header.fullApp')}</MMenu.Item>}
              <MMenu.Divider />
              <MMenu.Item leftSection={<Icon name="logout" size={16} />} onClick={() => void logout()}>{t('portal.header.signOut')}</MMenu.Item>
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
  const { t } = useI18n();
  const title = config.enabled ? t('portal.off.notYours') : t('portal.off.switchedOff');
  useEffect(() => {
    document.title = `${title} · ${appTitle()}`;
    return () => { document.title = appTitle(); };
  }, [title]);
  return (
    <div className="pt-empty-page">
      <Icon name="info" size={32} />
      <h1>{title}</h1>
      <p className="muted">
        {config.enabled
          ? t('portal.off.askRole')
          : can('admin.administer')
            ? t('portal.off.switchOn')
            : t('portal.off.contact')}
      </p>
      {agentPermissions.some((p) => can(p)) && <Link className="btn btn-primary" to="/">{t('portal.off.back')}</Link>}
    </div>
  );
}

function NotFoundPage() {
  const { t } = useI18n();
  usePageTitle(t('portal.notFound.title'));
  return (
    <div className="pt-empty-page">
      <h1>{t('portal.notFound.title')}</h1>
      <p className="muted"><Link to="/portal">{t('portal.back')}</Link></p>
    </div>
  );
}

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${appTitle()}`;
    return () => { document.title = appTitle(); };
  }, [title]);
}

function Portal({ lang, setLang }: { lang: string; setLang: (code: string) => void }) {
  const { data: config, error, reload } = useFetch<PortalConfig>('/api/portal/config');
  const { t } = useI18n();
  const { pathname } = useLocation();
  // Each page starts at the top, as a phone user expects.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  // ...and its heading takes the focus, so a screen reader says where it is (E16-15).
  const mainRef = useRef<HTMLElement>(null);
  useRouteFocus(mainRef);
  useEffect(() => { document.documentElement.classList.add('pt-doc'); return () => document.documentElement.classList.remove('pt-doc'); }, []);

  let body;
  if (error) body = <PortalError error={error} onRetry={reload} />;
  else if (!config) body = <Loading lines={6} label={t('portal.loading')} />;
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
          <Route path="/portal/safety" element={config.has.safety ? <SafetyReport /> : <NotFoundPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </ConfigProvider>
    );
  }
  return (
    <div className="pt-app">
      <a href="#pt-main" className="pt-skip">{t('portal.skip')}</a>
      <Header config={config?.enabled && config.allowed ? config : null} lang={lang} setLang={setLang} />
      <main id="pt-main" className="pt-main" ref={mainRef}>{body}</main>
      {/* Safety wording only while safety reporting is on: a switched-off area is named nowhere (E18-64). */}
      {config?.enabled && config.allowed && (
        <footer className="pt-footer muted">
          {config.has.safety
            ? <>{t('portal.footer.safety')} <Link to="/portal/safety">{t('portal.footer.safetyLink')}</Link>.</>
            : <>{t('portal.footer.other')} <Link to="/portal/report">{t('portal.footer.otherLink')}</Link>.</>}
        </footer>
      )}
    </div>
  );
}

export function PortalApp() {
  const [lang, setLang] = useLanguageChoice();
  return <I18nProvider lang={lang}><Portal lang={lang} setLang={setLang} /></I18nProvider>;
}
