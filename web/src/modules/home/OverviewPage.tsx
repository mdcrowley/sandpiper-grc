// Overview: the landing page. A greeting, the person's own work, then the dashboard widgets
// their role allows, in the order and selection they chose under Customize.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Icon, cx, modules, useAuth, useFetch, useMeta, useToast } from '../../core';
import { CustomizeDialog, type CustomizeResult } from './CustomizeDialog';
import { fetchLayout, loadLayout, resolveOrder, storeLayout } from './layoutStore';
import { WorkTally } from './parts';
import { DASHBOARD_PERMISSION, DEFAULT_ORDER, availableWidgets } from './registry';
import { SourcesProvider } from './sources';
import type { SourceKey, WidgetCtx, WidgetDef } from './types';
import './home.css';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

export function OverviewPage() {
  const { user, can } = useAuth();
  const { resources } = useMeta();
  const toast = useToast();
  const userId = user?.id ?? '';

  const ctx = useMemo<WidgetCtx>(() => ({
    userId,
    can: (permission) => can(permission),
    sees: (type) => {
      const resource = resources[type];
      return Boolean(resource) && can(`${resource.module}.view`);
    },
    hasModule: (key) => modules.some((m) => m.key === key),
  }), [userId, can, resources]);

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

  useEffect(() => {
    const before = document.title;
    document.title = `Overview · ${before.split(' · ').pop()}`;
    return () => { document.title = before; };
  }, []);

  const dashboards = can(DASHBOARD_PERMISSION);
  // A dashboard the person chose as their home (reports module): offered here; the Overview stays the landing page.
  const homeDash = useFetch<{ dashboard: { id: string; name: string } | null; route: string | null }>(
    dashboards && modules.some((m) => m.key === 'reports') ? '/api/dashboards/home' : null,
  );
  const myDashboard = homeDash.data?.dashboard && homeDash.data.route ? { name: homeDash.data.dashboard.name, to: homeDash.data.route } : null;
  const available = availableWidgets(ctx);
  const byId = new Map(available.map((w) => [w.id, w]));
  const fullOrder = resolveOrder(layout.order, DEFAULT_ORDER);
  const ordered = fullOrder.filter((id) => byId.has(id)).map((id) => byId.get(id) as WidgetDef);
  const shown = ordered.filter((w) => !layout.hidden.includes(w.id));
  const myWork = shown.filter((w) => w.group === 'mywork');
  const dashboard = shown.filter((w) => w.group === 'dashboard');
  const neededKey = [...new Set(shown.flatMap((w) => w.sources ?? []))].sort().join(',');
  const needed = useMemo(() => new Set(neededKey ? (neededKey.split(',') as SourceKey[]) : []), [neededKey]);

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

  const today = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const firstName = user?.displayName.trim().split(/\s+/)[0];
  const customize = (label: string) => (
    <Button icon="settings" onClick={() => setCustomizing(true)} disabled={available.length === 0}>{label}</Button>
  );
  const cell = (w: WidgetDef) => (
    <div key={w.id} className={cx('home-cell', w.wide && 'home-cell-wide')} data-widget={w.id}>{w.render()}</div>
  );

  return (
    <SourcesProvider ctx={ctx} needed={needed}>
      <div className="home stack">
        <header className="home-hero">
          <div>
            <p className="home-date">{today}</p>
            <h1 className="page-title">{greeting()}{firstName ? `, ${firstName}` : ''}</h1>
            <p className="muted home-hero-note">
              {allCounted && waiting > 0
                ? `${waiting} ${waiting === 1 ? 'item is' : 'items are'} waiting for you.`
                : 'Here is where things stand.'}
            </p>
          </div>
          <div className="home-hero-actions">
            <p className="home-tagline">Governance, risk and compliance for transit organizations</p>
            <div className="home-hero-buttons">
              {myDashboard && (
                <Link to={myDashboard.to} className="btn btn-primary home-mydash" title={`Open your home dashboard: ${myDashboard.name}`}>
                  <Icon name="chart" size={16} />
                  <span>Your dashboard: {myDashboard.name}</span>
                </Link>
              )}
              {customize('Customize')}
            </div>
          </div>
        </header>

        <section className="home-section" aria-labelledby="home-mywork">
          <h2 className="home-section-title" id="home-mywork">My work</h2>
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

        <section className="home-section" aria-labelledby="home-dashboard">
          <h2 className="home-section-title" id="home-dashboard">Dashboard</h2>
          {!dashboards ? (
            <p className="notice" data-overview="no-dashboards">
              Your role does not include dashboards, so this page shows your own work only.
              Ask an administrator if you need to see the figures for the whole organization.
            </p>
          ) : dashboard.length > 0 ? (
            <div className="home-grid">{dashboard.map(cell)}</div>
          ) : (
            <p className="notice">
              {ordered.some((w) => w.group === 'dashboard')
                ? 'Every dashboard widget is switched off. Select Customize to bring one back.'
                : 'There are no dashboard widgets for the areas your role can see.'}
            </p>
          )}
        </section>

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
