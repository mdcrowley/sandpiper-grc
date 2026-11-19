// Overview: the landing page. A greeting, the person's own work, then the dashboard widgets
// their role allows, in the order and selection they chose under Customize.
//
// The page takes its shape from the person (E12-07): someone who only looks (no permission to
// change anything) sees the figures first, a way into each area they may open, and their personal
// lists last. A chosen home dashboard, or for people who only look the board summary until they
// choose one, is shown in the Dashboard section, with the Overview's own figures one click away.
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import { Button, Icon, Loading, cx, formatDateTime, moduleOn, modules, useAuth, useFetch, useMeta, useToast } from '../../core';
import { CustomizeDialog, type CustomizeResult } from './CustomizeDialog';
import { areasFor, loadView, saveView, type DashboardView, type OverviewMode } from './layoutChoice';
import { fetchLayout, loadLayout, resolveOrder, storeLayout } from './layoutStore';
import { WorkTally } from './parts';
import { DASHBOARD_PERMISSION, DEFAULT_ORDER, availableWidgets } from './registry';
import { SourcesProvider } from './sources';
import type { SourceKey, WidgetCtx, WidgetDef } from './types';
import './home.css';

// The reports module's dashboard grid, loaded only when there is a home dashboard to show.
const EmbeddedDashboard = lazy(() => import('../reports/EmbeddedDashboard'));

interface HomeChoice {
  dashboard: { id: string; name: string } | null;
  route: string | null;
  suggested?: { id: string; name: string; route: string } | null;
  readOnly?: boolean;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const { user, can, areaOn } = useAuth();
  const { resources } = useMeta();
  const toast = useToast();
  const userId = user?.id ?? '';
  const [printedAt, setPrintedAt] = useState(() => new Date().toISOString());

  const ctx = useMemo<WidgetCtx>(() => ({
    userId,
    can: (permission) => can(permission),
    sees: (type) => {
      const resource = resources[type];
      return Boolean(resource) && can(`${resource.module}.view`);
    },
    // A module of a switched-off area (Administration > Features) counts as absent.
    hasModule: (key) => modules.some((m) => m.key === key) && moduleOn(key, areaOn),
  }), [userId, can, areaOn, resources]);

  // This browser's copy draws the page at once; the server's copy (which follows the person
  // between browsers) replaces it when it arrives.
  const [layout, setLayout] = useState(() => loadLayout(userId));
  useEffect(() => {
    let live = true;
    setLayout(loadLayout(userId));
    if (userId) void fetchLayout(userId).then((saved) => { if (live && saved) setLayout(saved); });
    return () => { live = false; };
  }, [userId]);
  const [customizing, setCustomizing] = useState(false);
  const [view, setView] = useState<DashboardView>(() => loadView(userId));

  useEffect(() => {
    const before = document.title;
    document.title = `Overview · ${before.split(' · ').pop()}`;
    return () => { document.title = before; };
  }, []);
  // A printed Overview says when its figures were taken.
  useEffect(() => {
    const stamp = () => setPrintedAt(new Date().toISOString());
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);

  const dashboards = can(DASHBOARD_PERMISSION);
  const reports = modules.some((m) => m.key === 'reports');
  // Answers for everyone (never refused): the chosen home dashboard, a suggestion, and whether the person only looks.
  const homeDash = useFetch<HomeChoice>(reports ? '/api/dashboards/home' : null);
  const mode: OverviewMode = homeDash.data?.readOnly ? 'look' : 'work';
  const chosen = homeDash.data?.dashboard && homeDash.data.route ? { id: homeDash.data.dashboard.id, name: homeDash.data.dashboard.name, to: homeDash.data.route, suggested: false } : null;
  const suggested = homeDash.data?.suggested ? { id: homeDash.data.suggested.id, name: homeDash.data.suggested.name, to: homeDash.data.suggested.route, suggested: true } : null;
  const home = chosen ?? suggested;
  const showHome = Boolean(home) && view === 'home';

  const available = availableWidgets(ctx);
  const byId = new Map(available.map((w) => [w.id, w]));
  const fullOrder = resolveOrder(layout.order, DEFAULT_ORDER);
  const ordered = fullOrder.filter((id) => byId.has(id)).map((id) => byId.get(id) as WidgetDef);
  const shown = ordered.filter((w) => !layout.hidden.includes(w.id));
  const myWork = shown.filter((w) => w.group === 'mywork');
  // The Overview's own figures are not asked for while the home dashboard is shown in their place.
  const dashboard = showHome ? [] : shown.filter((w) => w.group === 'dashboard');
  const neededKey = [...new Set([...myWork, ...dashboard].flatMap((w) => w.sources ?? []))].sort().join(',');
  const needed = useMemo(() => new Set(neededKey ? (neededKey.split(',') as SourceKey[]) : []), [neededKey]);
  const areas = useMemo(() => (mode === 'look' ? areasFor(modules.flatMap((m) => m.nav ?? []), can) : []), [mode, can]);

  // How many items each personal list holds (null or missing while unknown).
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const report = useCallback((id: string, count: number | null) => {
    setCounts((prev) => (prev[id] === count || (count === null && !(id in prev)) ? prev : { ...prev, [id]: count }));
  }, []);
  const known = myWork.map((w) => counts[w.id]);
  const allCounted = myWork.length > 0 && known.every((n) => typeof n === 'number');
  const waiting = known.reduce<number>((sum, n) => sum + (n ?? 0), 0);

  function save(result: CustomizeResult) {
    // Widgets this person cannot have keep their saved place, in case their role changes.
    const queue = [...result.order];
    const order = fullOrder.map((id) => (byId.has(id) ? queue.shift() ?? id : id));
    const hidden = [...layout.hidden.filter((id) => !byId.has(id)), ...result.hidden];
    const next = { order, hidden };
    const isDefault = hidden.length === 0 && order.join('|') === DEFAULT_ORDER.join('|');
    setLayout(next);
    setCustomizing(false);
    void storeLayout(userId, isDefault ? null : next).then((where) => {
      if (where === 'server') toast.success('Overview layout saved.');
      else if (where === 'browser') toast.success('Overview layout saved in this browser only.');
      else toast.error('The layout could not be saved. It will last until you leave the page.');
    });
  }
  const pickView = (v: DashboardView) => { setView(v); saveView(userId, v); };

  const today = new Intl.DateTimeFormat('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const firstName = user?.displayName.trim().split(/\s+/)[0];
  const cell = (w: WidgetDef) => (
    <div key={w.id} className={cx('home-cell', w.wide && 'home-cell-wide')} data-widget={w.id}>{w.render()}</div>
  );

  const myWorkSection = (
    <section className="home-section" aria-labelledby="home-mywork" key="mywork">
      <h2 className="home-section-title" id="home-mywork">{mode === 'look' ? 'For you' : 'My work'}</h2>
      {allCounted && waiting === 0 && (
        <p className="home-clear">
          <Icon name="check-circle" size={20} />
          <span><strong>You are up to date.</strong> Nothing is waiting for you in the lists below.</span>
        </p>
      )}
      {myWork.length > 0 ? (
        <WorkTally.Provider value={report}>
          <div className="home-work-grid">{myWork.map(cell)}</div>
        </WorkTally.Provider>
      ) : (
        <p className="notice">
          {ordered.some((w) => w.group === 'mywork')
            ? 'Every list in My work is switched off. Select Customize to bring one back.'
            : 'Your role does not include any of the areas that give people work here, so there is nothing to list.'}
        </p>
      )}
    </section>
  );

  let dashboardBody: ReactNode;
  if (!dashboards) {
    dashboardBody = (
      <p className="notice" data-overview="no-dashboards">
        Your role does not include dashboards, so this page shows your own work only. Ask an administrator if you need to see the figures for the whole organization.
      </p>
    );
  } else if (showHome && home) {
    dashboardBody = (
      <Suspense fallback={<Loading lines={6} label="Loading the dashboard" />}>
        <EmbeddedDashboard id={home.id} />
      </Suspense>
    );
  } else if (dashboard.length > 0) {
    dashboardBody = <div className="home-grid">{dashboard.map(cell)}</div>;
  } else {
    dashboardBody = (
      <p className="notice">
        {ordered.some((w) => w.group === 'dashboard')
          ? 'Every dashboard widget is switched off. Select Customize to bring one back.'
          : 'There are no dashboard widgets for the areas your role can see.'}
      </p>
    );
  }
  const dashboardSection = (
    <section className="home-section" aria-labelledby="home-dashboard" key="dashboard">
      <div className="home-section-head">
        <h2 className="home-section-title" id="home-dashboard">
          {showHome && home ? <>{home.suggested ? 'Suggested for you' : 'Your dashboard'}: {home.name}</> : mode === 'look' ? 'At a glance' : 'Dashboard'}
        </h2>
        {dashboards && home && (
          <div className="home-section-tools no-print">
            <SegmentedControl size="xs" aria-label="What the dashboard section shows" value={view} onChange={(v) => pickView(v as DashboardView)}
              data={[{ value: 'home', label: home.suggested ? 'Board summary' : 'My dashboard' }, { value: 'overview', label: 'Overview figures' }]} />
            {showHome && <Link to={home.to} className="home-section-link">Open in full <Icon name="arrow-right" size={14} /></Link>}
          </div>
        )}
      </div>
      {showHome && home?.suggested && (
        <p className="muted home-section-note no-print">Shown because your role is for looking rather than changing records. Open any dashboard and choose “Set as my home dashboard” to show that one here instead.</p>
      )}
      {dashboardBody}
    </section>
  );

  const areasSection = areas.length > 0 && (
    <section className="home-section no-print" aria-labelledby="home-areas" key="areas">
      <h2 className="home-section-title" id="home-areas">Where to look</h2>
      <ul className="home-areas">
        {areas.map((a) => (
          <li key={a.path}>
            <Link to={a.path} className="home-area">
              <span className="home-area-name">{a.label}</span>
              <span className="home-area-group">{a.group}</span>
              <Icon name="arrow-right" size={16} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <SourcesProvider ctx={ctx} needed={needed}>
      <div className={cx('home stack', mode === 'look' && 'home-look')} data-overview-mode={mode}>
        <header className="home-hero">
          <div>
            <p className="home-date">{today}</p>
            <h1 className="page-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
            <p className="muted home-hero-note">
              {mode === 'look'
                ? 'Here is where things stand. Every figure is the same for everyone who sees it.'
                : allCounted && waiting > 0
                  ? `${waiting} ${waiting === 1 ? 'item is' : 'items are'} waiting for you.`
                  : 'Here is where things stand.'}
            </p>
            <p className="print-only home-print-asat">Overview as at {formatDateTime(printedAt)}</p>
          </div>
          <div className="home-hero-actions">
            <p className="home-tagline">Governance, risk and compliance for transit organizations</p>
            <div className="home-hero-buttons">
              {chosen && view !== 'home' && (
                <Link to={chosen.to} className="btn btn-primary home-mydash" title={`Open your home dashboard: ${chosen.name}`}>
                  <Icon name="chart" size={16} />
                  <span>Your dashboard: {chosen.name}</span>
                </Link>
              )}
              <Button icon="file-text" variant="ghost" onClick={() => window.print()}>Print</Button>
              <Button icon="settings" onClick={() => setCustomizing(true)} disabled={available.length === 0}>Customize</Button>
            </div>
          </div>
        </header>

        {mode === 'look'
          // Without dashboards there are no figures to lead with: the areas to look at come first.
          ? dashboards ? [dashboardSection, areasSection, myWorkSection] : [areasSection, myWorkSection]
          : [myWorkSection, dashboardSection]}

        <CustomizeDialog
          open={customizing}
          widgets={available}
          order={ordered.map((w) => w.id)}
          hidden={layout.hidden.filter((id) => byId.has(id))}
          onSave={save}
          onClose={() => setCustomizing(false)}
        />
      </div>
    </SourcesProvider>
  );
}
