// Dashboards: the gallery, one dashboard to look at (filters, refresh, wall mode, home choice)
// and the same page in edit mode (add, move, resize and change widgets; undo; save).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, Forbidden, Icon, Loading, LookupChip, Menu, Modal, NotFound, NumberField,
  PageHeader, Select, TextArea, TextField, api, errorMessage, formatDateTime, relativeTime, useAuth, useCustomFieldInputs, useFetch, useToast,
  CustomFieldsCard, SwitchedOff, type CustomFieldInputs,
} from '../../core';
import { CustomFieldsLink, customValues, fieldMessages } from './custom';
import type { ApiError, ListResult } from '../../core';
import { useUndo } from './BuilderParts';
import { DashboardGrid } from './DashboardGrid';
import { downloadFile, fileName, openDocument, useCatalog } from './data';
import { ScheduleDialog, ShareDialog, useCanChange } from './dialogs';
import { FilterBar, readGlobals, writeGlobals } from './FilterBar';
import { readingOrder, settle } from './layout';
import type { Dashboard, GlobalFilterDef, GlobalKind, Globals, Widget } from './types';
import { WidgetBody } from './Widget';
import { dashboardOff, useOffTypes, widgetOff } from './offTypes';
import { WidgetEditor, WidgetLibrary, newWidget } from './WidgetEditor';

interface Home { dashboard: { id: string; name: string } | null }

// ---------- gallery ----------

export function DashboardsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const list = useFetch<ListResult<Dashboard>>('/api/dashboards?pageSize=200&sort=name');
  const off = useOffTypes();
  const home = useFetch<Home>('/api/dashboards/home');
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const nameRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const creating = params.get('new') === '1' && can('dashboards.create');
  // An administrator's custom fields on dashboards, asked when one is created (E18-45).
  const custom = useCustomFieldInputs('dashboard', { resetKey: creating ? 'open' : 'closed' });
  const close = () => { const p = new URLSearchParams(params); p.delete('new'); setParams(p, { replace: true }); setName(''); setNameError(''); };

  async function create() {
    // The message sits under the field, and focus goes back to it, so nobody misses it (E18-37).
    const refuse = (message: string) => { setNameError(message); nameRef.current?.querySelector('input')?.focus(); };
    const extra = custom.collect();
    if (!name.trim()) return refuse('Give the dashboard a name.');
    if (!extra) return; // a required custom field is empty: the message is beside it
    setBusy(true);
    try {
      const d = await api.post<Dashboard>('/api/dashboards', { name: name.trim(), widgets: [], filters: [{ kind: 'date', label: 'Dates' }], ...extra });
      navigate(`/dashboards/${d.id}?edit=1`);
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields?.name) refuse(fields.name);
      else if (!custom.showErrors(fields)) toast.error(errorMessage(err));
    } finally { setBusy(false); }
  }

  const rows = (list.data?.rows ?? []).filter((d) => `${d.name} ${d.description ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()));
  // A standard dashboard about switched-off areas only is not listed; on one that is partly about
  // them, the description (which may name them) gives way to the number of widgets shown.
  const shown = (d: Dashboard) => (off ? d.widgets.filter((w) => !widgetOff(w, off)) : d.widgets);
  const standard = rows.filter((d) => d.key && !(off && dashboardOff(d.widgets, off)));
  const others = rows.filter((d) => !d.key);
  const card = (d: Dashboard) => (
    <li key={d.id}>
      <Link to={`/dashboards/${d.id}`} className="rp-dash-card">
        <span className="rp-dash-card-head">
          <strong>{d.name}</strong>
          {home.data?.dashboard?.id === d.id && <Badge color="teal">Your home</Badge>}
        </span>
        <span className="rp-dash-card-desc">{(d.key && shown(d).length < d.widgets.length ? '' : d.description) || `${shown(d).length} widgets`}</span>
        <span className="rp-dash-card-meta">
          <LookupChip list="report_sharing" value={d.sharing} />
          <span className="muted">{d._display?.owner_id ?? 'Standard'} · updated {relativeTime(d.updated_at)}</span>
        </span>
        <DashThumb widgets={shown(d)} />
      </Link>
    </li>
  );

  return (
    <div className="stack">
      <PageHeader title="Dashboards" subtitle="Figures at a glance, the same for everyone who may see them. Lists of records show what your role allows."
        actions={(
          <>
            <CustomFieldsLink type="dashboard" />
            {can('dashboards.create') && <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New dashboard</Button>}
          </>
        )} />
      {list.error ? <ErrorState title="Dashboards could not be loaded" error={list.error} onRetry={list.reload} />
        : !list.data || !off ? <Loading lines={6} label="Loading dashboards" />
        : (
          <>
            <div className="rp-dash-search"><TextField label="Search dashboards" hideLabel type="search" value={q} onChange={setQ} placeholder="Search dashboards" leftSection={<Icon name="search" size={16} />} /></div>
            {rows.length === 0 && (
              <EmptyState icon="chart" title={q ? 'No dashboard matches' : 'No dashboards yet'}
                message={q ? 'Try another word.' : 'Build one from charts, figures and lists, or ask an administrator to load the standard dashboards.'}
                action={!q && can('dashboards.create') ? <Button variant="primary" icon="plus" onClick={() => setParams({ new: '1' })}>New dashboard</Button> : undefined} />
            )}
            {standard.length > 0 && <><h2 className="rp-h2">Standard dashboards</h2><ul className="rp-dash-grid">{standard.map(card)}</ul></>}
            {others.length > 0 && <><h2 className="rp-h2">Built by people here</h2><ul className="rp-dash-grid">{others.map(card)}</ul></>}
          </>
        )}
      <Modal open={creating} title="New dashboard" onClose={close} size="sm"
        footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" loading={busy} onClick={create}>Create and add widgets</Button></>}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <div ref={nameRef}>
            <TextField label="Name" required value={name} error={nameError} onChange={(v) => { setName(v); if (nameError) setNameError(''); }} placeholder="For example: Depot technology" autoFocus />
          </div>
          <p className="muted">It starts empty and private to you. Add widgets, then share it when it is ready.</p>
          {custom.inputs}
        </form>
      </Modal>
    </div>
  );
}

/** A small drawing of the layout, so dashboards can be told apart at a glance. */
function DashThumb({ widgets }: { widgets: Widget[] }) {
  const rows = Math.max(4, ...widgets.map((w) => w.y + w.h));
  return (
    <svg className="rp-dash-thumb" viewBox={`0 0 120 ${Math.min(60, rows * 4)}`} preserveAspectRatio="xMidYMin meet" aria-hidden="true">
      {widgets.map((w) => <rect key={w.id} x={w.x * 10 + 0.5} y={w.y * 4 + 0.5} width={w.w * 10 - 1.5} height={w.h * 4 - 1.5} rx="1.5" />)}
    </svg>
  );
}

// ---------- one dashboard ----------

const GLOBAL_CHOICES: { kind: GlobalKind; label: string }[] = [
  { kind: 'date', label: 'Dates' }, { kind: 'department', label: 'Department' }, { kind: 'site', label: 'Site' },
  { kind: 'system', label: 'System' }, { kind: 'owner', label: 'Owner' },
];
const REFRESH = [
  { value: '', label: 'Only when I ask' }, { value: '60', label: 'Every minute' }, { value: '300', label: 'Every 5 minutes' },
  { value: '900', label: 'Every 15 minutes' }, { value: '3600', label: 'Every hour' },
];

interface Draft { name: string; description: string; widgets: Widget[]; filters: GlobalFilterDef[]; refresh_seconds: number | null }

export function DashboardPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const dash = useFetch<Dashboard>(`/api/dashboards/${id}`);
  const off = useOffTypes();
  const home = useFetch<Home>('/api/dashboards/home');
  const canChange = useCanChange(dash.data, 'dashboards');
  const editing = params.get('edit') === '1' && canChange;
  const globals = useMemo(() => readGlobals(params), [params]);
  const [tick, setTick] = useState(0);
  const [lastRun, setLastRun] = useState(() => new Date());
  const [dialog, setDialog] = useState<'share' | 'schedule' | 'delete' | 'settings' | 'library' | 'discard' | null>(null);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [saving, setSaving] = useState(false);
  const [wall, setWall] = useState(false);
  const wallRef = useRef<HTMLDivElement>(null);
  const draft = useUndo<Draft>({ name: '', description: '', widgets: [], filters: [], refresh_seconds: null });
  const { types } = useCatalog();
  // An administrator's custom fields on dashboards: asked in the settings while editing, starting
  // again from the saved values each time editing starts (E18-45).
  const custom = useCustomFieldInputs('dashboard', { initial: dash.data, resetKey: editing && dash.data ? `${dash.data.id}:${dash.data.updated_at}` : 'view' });

  // Each time edit mode starts, the draft starts from the saved dashboard.
  useEffect(() => {
    if (editing && dash.data) {
      const d = dash.data;
      draft.reset({ name: d.name, description: d.description ?? '', widgets: d.widgets, filters: d.filters ?? [], refresh_seconds: d.refresh_seconds });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, dash.data?.id, dash.data?.updated_at]);

  // Auto-refresh while looking (never while editing). Wall mode refreshes at least every 5 minutes.
  const every = wall ? Math.min(dash.data?.refresh_seconds ?? 300, 300) : dash.data?.refresh_seconds;
  const refresh = useCallback(() => { setTick((n) => n + 1); setLastRun(new Date()); }, []);
  useEffect(() => {
    if (editing || !every) return;
    const t = setInterval(refresh, every * 1000);
    return () => clearInterval(t);
  }, [editing, every, refresh]);

  useEffect(() => {
    const onFs = () => setWall(document.fullscreenElement === wallRef.current && Boolean(wallRef.current));
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  async function toggleWall() {
    if (wall) { if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined); setWall(false); return; }
    try { await wallRef.current?.requestFullscreen(); } catch { setWall(true); }
    setWall(true);
  }

  const status = (dash.error as ApiError | undefined)?.status;
  if (status === 404) return <NotFound />;
  if (status === 403) return <Forbidden />;
  if (dash.error) return <ErrorState title="This dashboard could not be opened" error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <><PageHeader title="Dashboard" /><Loading lines={8} label="Loading the dashboard" /></>;
  const d = dash.data;
  // Widgets about switched-off areas are left out while looking (kept, and shown, while editing).
  const offHere = !editing && off ? d.widgets.filter((w) => widgetOff(w, off)).length : 0;
  const view: Draft = editing ? draft.value : { name: d.name, description: d.description ?? '', widgets: offHere ? d.widgets.filter((w) => !widgetOff(w, off!)) : d.widgets, filters: d.filters ?? [], refresh_seconds: d.refresh_seconds };
  if (!editing && d.key && off && dashboardOff(d.widgets, off)) return <SwitchedOff />;
  const isHome = home.data?.dashboard?.id === d.id;

  const setGlobals = (g: Globals) => setParams(writeGlobals(params, g), { replace: false });
  const setEdit = (on: boolean) => { const p = new URLSearchParams(params); if (on) p.set('edit', '1'); else p.delete('edit'); setParams(p); };
  const setWidgets = (widgets: Widget[]) => draft.set((p) => ({ ...p, widgets }));

  async function save() {
    const extra = custom.collect();
    if (!draft.value.name.trim() || !extra) { setDialog('settings'); return; }
    setSaving(true);
    try {
      const v = draft.value;
      await api.patch(`/api/dashboards/${d.id}`, { name: v.name.trim(), description: v.description, widgets: readingOrder(v.widgets), filters: v.filters, refresh_seconds: v.refresh_seconds, ...extra });
      toast.success('Dashboard saved.');
      dash.reload();
      setEdit(false);
    } catch (err) {
      if (custom.showErrors((err as { fields?: Record<string, string> }).fields)) setDialog('settings');
      else toast.error(errorMessage(err));
    } finally { setSaving(false); }
  }
  async function setAsHome(on: boolean) {
    try {
      await api.post('/api/dashboards/home', { dashboard_id: on ? d.id : null });
      toast.success(on ? 'This is now your home dashboard.' : 'Home dashboard cleared.');
      home.reload();
    } catch (err) { toast.error(errorMessage(err)); }
  }
  async function copy() {
    try {
      const c = await api.post<Dashboard>('/api/dashboards', { name: `${d.name} (copy)`, description: d.description, widgets: d.widgets, filters: d.filters, refresh_seconds: d.refresh_seconds, ...customValues(d) });
      toast.success('Copy saved. It is yours to change.');
      navigate(`/dashboards/${c.id}?edit=1`);
    } catch (err) { toast.error(fieldMessages(err) ?? errorMessage(err)); }
  }
  async function remove() {
    try { await api.del(`/api/dashboards/${d.id}`); toast.success('Dashboard deleted.'); navigate('/dashboards'); } catch (err) { toast.error(errorMessage(err)); }
  }
  const exportAs = (format: 'pdf' | 'xlsx' | 'html') => {
    const q = new URLSearchParams({ format });
    for (const [k, v] of Object.entries(globals)) if (v) q.set(`g.${k}`, v);
    const url = `/api/dashboards/${d.id}/export?${q}`;
    (format === 'html' ? openDocument('GET', url) : downloadFile(fileName(d.name, format), 'GET', url)).catch((err) => toast.error(errorMessage(err)));
  };

  function addWidget(kind: Widget['kind'], report?: { id: string; name: string }) {
    const w = newWidget(kind, draft.value.widgets, report ? { title: report.name, w: 6, h: 5, config: { reportId: report.id } } : {});
    setWidgets(settle([...draft.value.widgets, w], w.id));
    setDialog(null);
    if (!report) setEditingWidget(w);
  }

  const viewActions = (
    <>
      <Button variant="ghost" icon="refresh" onClick={refresh} title={`Figures as at ${formatDateTime(lastRun.toISOString())}`}>Refresh</Button>
      {can('dashboards.export') && (
        <Menu label="Export" icon="download" align="end" items={[
          { label: 'PDF', icon: 'file-text', onSelect: () => exportAs('pdf') },
          { label: 'Excel (XLSX)', icon: 'download', onSelect: () => exportAs('xlsx') },
          { label: 'Print-ready page', icon: 'external', onSelect: () => exportAs('html'), separated: true },
        ]} />
      )}
      <Button icon="eye" onClick={toggleWall}>Wall mode</Button>
      {canChange && <Button variant="primary" icon="edit" onClick={() => setEdit(true)}>Edit</Button>}
      <Menu label="More" icon="more" iconOnly align="end" items={[
        ...(can('dashboards.view') ? [isHome
          ? { label: 'Stop using as my home', icon: 'home' as const, onSelect: () => setAsHome(false) }
          : { label: 'Set as my home dashboard', icon: 'home' as const, onSelect: () => setAsHome(true) }] : []),
        ...(canChange ? [{ label: 'Share…', icon: 'users' as const, onSelect: () => setDialog('share') }] : []),
        ...(can('reports.create') ? [{ label: 'Schedule…', icon: 'calendar' as const, onSelect: () => setDialog('schedule') }] : []),
        { label: 'Print this page', icon: 'file-text' as const, onSelect: () => window.print() },
        ...(can('dashboards.create') ? [{ label: 'Save a copy', icon: 'plus' as const, onSelect: copy }] : []),
        ...(canChange && can('dashboards.delete') ? [{ label: 'Delete', icon: 'trash' as const, danger: true, separated: true, onSelect: () => setDialog('delete') }] : []),
      ]} />
    </>
  );
  const editActions = (
    <>
      <Button variant="ghost" icon="history" disabled={!draft.canUndo} onClick={draft.undo} title="Undo (Ctrl+Z)">Undo</Button>
      <Button variant="ghost" disabled={!draft.canRedo} onClick={draft.redo} title="Redo (Ctrl+Y)">Redo</Button>
      <Button icon="settings" onClick={() => setDialog('settings')}>Settings</Button>
      <Button icon="plus" onClick={() => setDialog('library')}>Add a widget</Button>
      <Button onClick={() => (draft.dirty ? setDialog('discard') : setEdit(false))}>Cancel</Button>
      <Button variant="primary" icon="check" loading={saving} onClick={save}>Save</Button>
    </>
  );

  return (
    <div ref={wallRef} className={wall ? 'rp-dash rp-wall' : 'rp-dash'}>
      {wall ? (
        <div className="rp-wall-head">
          <h1>{d.name}</h1>
          <span className="muted">As at {formatDateTime(lastRun.toISOString())} · refreshes every {Math.round((every ?? 300) / 60)} min</span>
          <Button size="sm" variant="ghost" icon="x" onClick={toggleWall}>Leave wall mode</Button>
        </div>
      ) : (
        <PageHeader
          title={editing ? `Editing: ${view.name || 'Dashboard'}` : d.name}
          breadcrumbs={[{ label: 'Dashboards', to: '/dashboards' }, { label: d.name }]}
          subtitle={editing ? 'Drag a widget by its handle to move it and by its corner to resize it, or use the arrow keys on the handle.' : (d.key && offHere ? undefined : d.description) || undefined}
          status={!editing ? <>{isHome && <Badge color="teal">Your home</Badge>} <LookupChip list="report_sharing" value={d.sharing} /></> : undefined}
          actions={editing ? editActions : viewActions}
        />
      )}

      {!editing && <FilterBar defs={view.filters} value={globals} onChange={setGlobals} />}
      <p className="print-only rp-print-asat">{d.name} · as at {formatDateTime(lastRun.toISOString())}</p>

      {view.widgets.length === 0 ? (
        <EmptyState icon="chart" title="This dashboard is empty"
          message={canChange ? 'Add figures, charts, lists and notes. Figures are the same for everyone; lists of records show each viewer what their role allows.' : 'Nothing has been added yet.'}
          action={canChange ? <Button variant="primary" icon="plus" onClick={() => { if (!editing) setEdit(true); setDialog('library'); }}>Add a widget</Button> : undefined} />
      ) : (
        <DashboardGrid
          widgets={view.widgets}
          editing={editing}
          onChange={setWidgets}
          renderBody={(w, height) => <WidgetBody widget={w} dashboardId={d.id} globals={editing ? {} : globals} tick={tick} height={height} />}
          headerActions={(w) => (w.kind === 'report' && w.config?.reportId ? <Link className="rp-w-open no-print" to={`/reports/${w.config.reportId}`} aria-label={`Open the report ${w.title}`}>Open report <Icon name="arrow-right" size={14} /></Link> : null)}
          onEdit={(w) => setEditingWidget(w)}
          onDuplicate={(w) => { const c = newWidget(w.kind, draft.value.widgets, { title: `${w.title} (copy)`, w: w.w, h: w.h, config: w.config }); setWidgets(settle([...draft.value.widgets, c], c.id)); }}
          onRemove={(w) => setWidgets(draft.value.widgets.filter((x) => x.id !== w.id))}
        />
      )}
      {!editing && !wall && <CustomFieldsCard type="dashboard" row={d} onSaved={dash.reload} />}
      {!editing && !wall && <p className="rp-dash-foot muted no-print">Figures as at {formatDateTime(lastRun.toISOString())}{every ? `; refreshed every ${every >= 60 ? `${Math.round(every / 60)} min` : `${every} s`}` : ''}. Select any figure or chart segment to see the records behind it.</p>}

      <WidgetLibrary open={dialog === 'library'} onClose={() => setDialog(null)} onAdd={addWidget} />
      <WidgetEditor widget={editingWidget} types={types ?? []} onClose={() => setEditingWidget(null)}
        onSave={(w) => { setWidgets(draft.value.widgets.map((x) => (x.id === w.id ? w : x))); setEditingWidget(null); }} />
      <SettingsDialog open={dialog === 'settings'} value={draft.value} custom={custom} onClose={() => setDialog(null)}
        onChange={(patch) => draft.set((p) => ({ ...p, ...patch }))} />
      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} path="/api/dashboards" item={d} what="dashboard" onSaved={dash.reload} />
      <ScheduleDialog open={dialog === 'schedule'} onClose={() => setDialog(null)} target={{ type: 'dashboard', id: d.id, name: d.name }} />
      <ConfirmDialog open={dialog === 'delete'} danger title="Delete this dashboard?" confirmLabel="Delete dashboard"
        message="People it is shared with lose it, and anyone who chose it as home goes back to the Overview. Saved reports on it are kept." onConfirm={remove} onCancel={() => setDialog(null)} />
      <ConfirmDialog open={dialog === 'discard'} danger title="Discard your changes?" confirmLabel="Discard changes"
        message="The dashboard goes back to how it was when you last saved it." onConfirm={() => { setDialog(null); setEdit(false); }} onCancel={() => setDialog(null)} />
    </div>
  );
}

function SettingsDialog({ open, value, custom, onClose, onChange }: { open: boolean; value: Draft; custom: CustomFieldInputs; onClose: () => void; onChange: (p: Partial<Draft>) => void }) {
  const has = (k: GlobalKind) => value.filters.some((f) => f.kind === k);
  const toggle = (k: GlobalKind, on: boolean) => onChange({
    filters: on ? GLOBAL_CHOICES.filter((c) => c.kind === k || has(c.kind)).map((c) => value.filters.find((f) => f.kind === c.kind) ?? { kind: c.kind, label: c.label }) : value.filters.filter((f) => f.kind !== k),
  });
  return (
    <Modal open={open} title="Dashboard settings" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onClose(); }}>
        <TextField label="Name" required value={value.name} error={value.name.trim() ? undefined : 'Give the dashboard a name.'} onChange={(name) => onChange({ name })} />
        <TextArea label="Description" rows={2} value={value.description} onChange={(description) => onChange({ description })} />
        <fieldset className="rp-fieldset">
          <legend className="field-label">Filters across the whole dashboard</legend>
          <p className="field-hint">Shown above the widgets. Each filter narrows every widget whose records have that field; the others say they are not narrowed.</p>
          {GLOBAL_CHOICES.map((c) => <Checkbox key={c.kind} label={c.label} checked={has(c.kind)} onChange={(on) => toggle(c.kind, on)} />)}
        </fieldset>
        <Select label="Refresh the figures" value={value.refresh_seconds ? String(value.refresh_seconds) : ''} options={REFRESH}
          onChange={(v) => onChange({ refresh_seconds: v ? Number(v) : null })} hint="Useful for a screen on the wall. Wall mode refreshes at least every 5 minutes." />
        <NumberField label="Or every (seconds)" min={30} max={3600} value={value.refresh_seconds} onChange={(v) => onChange({ refresh_seconds: v })} hint="Between 30 and 3,600." />
        {custom.inputs}
      </form>
    </Modal>
  );
}
