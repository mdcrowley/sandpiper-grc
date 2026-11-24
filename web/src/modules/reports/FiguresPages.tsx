// Figures over time (E41-04): the figures an organization follows month by month (open risks by
// level, overdue actions, open audit findings...), recorded at each month end and on demand, the
// same for everyone. One page lists them with a small chart each; one page shows a figure in full,
// to export or to put on a dashboard or in a board pack.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, ConfirmDialog, Drawer, EmptyState, ErrorState, Forbidden, Icon, Loading, Menu, NotFound, PageHeader, Select, Switch, TextArea, TextField,
  api, errorMessage, formatDateTime, formatNumber, useAuth, useFetch, useToast,
} from '../../core';
import type { ApiError } from '../../core';
import { downloadFile, fileName, openDocument, useCatalog } from './data';
import { completeFilters } from './FilterEditor';
import { ResultView } from './ResultView';
import { FiltersSection, Section } from './SpecEditor';
import type { ChartKind, FigureDetail, FilterGroup, TrackedFigure } from './types';

interface Metric { key: string; label: string; unit: 'count' | 'percent' | 'number'; description: string; recordType: string | null }

const MONTH_CHOICES = [6, 12, 24, 36].map((n) => ({ value: String(n), label: `Last ${n} months` }));

/** A figure's value as a person reads it. */
export function figureValue(v: number | null | undefined, unit: TrackedFigure['unit']): string {
  if (v === null || v === undefined) return 'Not worked out';
  return unit === 'percent' ? `${formatNumber(v)}%` : formatNumber(v);
}

const monthName = (period: string) => new Date(`${period}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Latest({ f }: { f: TrackedFigure }) {
  if (!f.latest) return <p className="muted">Nothing recorded yet.</p>;
  const l = f.latest;
  return (
    <p className="rp-fig-latest">
      <strong>{figureValue(l.value, f.unit)}</strong>
      <span className="muted"> {l.kind === 'month_end' ? `at the end of ${monthName(l.period)}` : `in ${monthName(l.period)} so far, recorded ${formatDateTime(l.recorded_at)}`}</span>
    </p>
  );
}

export function FiguresPage() {
  const { can } = useAuth();
  const toast = useToast();
  const list = useFetch<TrackedFigure[]>('/api/figures?months=12');
  const [editing, setEditing] = useState<TrackedFigure | 'new' | null>(null);
  const [busy, setBusy] = useState(false);

  async function recordNow() {
    setBusy(true);
    try {
      const r = await api.post<{ recorded: number }>('/api/figures/record', {});
      toast.success(r.recorded === 1 ? 'One figure recorded for this month so far.' : `${r.recorded} figures recorded for this month so far.`);
      list.reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <PageHeader
        title="Figures over time"
        subtitle="Figures recorded at the end of every month, the same for everyone, to chart in reports, dashboards and board packs."
        actions={(
          <>
            {can('reports.edit') && <Button icon="refresh" loading={busy} onClick={recordNow}>Record figures now</Button>}
            {can('reports.create') && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add figure</Button>}
          </>
        )}
      />
      {list.error ? <ErrorState title="The figures could not be loaded" error={list.error} onRetry={list.reload} />
        : !list.data ? <Loading lines={6} label="Loading the figures" />
        : list.data.length === 0 ? (
          <EmptyState icon="chart" title="No figures are recorded yet"
            message={can('reports.create') ? 'Add a figure to follow, such as open risks by level or overdue actions. It is recorded at the end of every month.' : 'Figures appear here once someone who manages reports chooses what to follow.'} />
        ) : (
          <ul className="rp-fig-grid">
            {list.data.map((f) => (
              <li key={f.id}>
                <Card title={<Link to={`/reports/figures/${f.id}`}>{f.name}</Link>}
                  actions={!f.active ? <span className="muted rp-fig-paused"><Icon name="clock" size={14} /> Not recorded</span> : undefined}>
                  <Latest f={f} />
                  {f.result && f.result.rows.length > 1
                    ? <ResultView result={f.result} chart={{ kind: 'line' }} label={f.name} height={f.group_field ? 260 : 220} />
                    : <p className="rp-empty-hint">The chart appears once two months are recorded.</p>}
                  <p className="rp-fig-what muted">{f.description || f.what}</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      <FigureEditor figure={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
    </div>
  );
}

export function FigurePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [months, setMonths] = useState('12');
  const [kind, setKind] = useState<ChartKind>('line');
  const fig = useFetch<FigureDetail>(`/api/figures/${id}?months=${months}`);
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const status = (fig.error as ApiError | undefined)?.status;
  if (status === 404) return <NotFound />;
  if (status === 403) return <Forbidden />;
  if (fig.error) return <ErrorState title="This figure could not be opened" error={fig.error} onRetry={fig.reload} />;
  if (!fig.data) return <><PageHeader title="Figure over time" /><Loading lines={8} label="Loading the figure" /></>;
  const f = fig.data;
  const grouped = Boolean(f.group_field);

  const exportAs = (format: 'csv' | 'xlsx' | 'pdf' | 'html') => (format === 'html'
    ? openDocument('GET', `/api/figures/${f.id}/export?format=html&months=${months}`)
    : downloadFile(fileName(f.name, format), 'GET', `/api/figures/${f.id}/export?format=${format}&months=${months}`)).catch((err) => toast.error(errorMessage(err)));

  async function recordNow() {
    setBusy(true);
    try { await api.post('/api/figures/record', { ids: [f.id] }); toast.success('Recorded for this month so far.'); fig.reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.del(`/api/figures/${f.id}`); toast.success('Figure removed.'); navigate('/reports/figures'); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setDialog(null); }
  }

  return (
    <div className="stack">
      <PageHeader
        title={f.name}
        breadcrumbs={[{ label: 'Figures over time', to: '/reports/figures' }, { label: f.name }]}
        subtitle={f.description || f.what}
        actions={(
          <>
            {can('reports.export') && (
              <Menu label="Export" icon="download" align="end" items={[
                { label: 'PDF', icon: 'file-text', onSelect: () => exportAs('pdf') },
                { label: 'Excel (XLSX)', icon: 'download', onSelect: () => exportAs('xlsx') },
                { label: 'CSV', icon: 'download', onSelect: () => exportAs('csv') },
                { label: 'Print-ready page', icon: 'external', onSelect: () => exportAs('html'), separated: true },
              ]} />
            )}
            {can('reports.edit') && <Button icon="refresh" loading={busy} onClick={recordNow}>Record now</Button>}
            {can('reports.edit') && <Button variant="primary" icon="edit" onClick={() => setDialog('edit')}>Edit</Button>}
            {can('reports.delete') && (
              <Menu label="More" icon="more" iconOnly align="end" items={[{ label: 'Remove', icon: 'trash', danger: true, onSelect: () => setDialog('delete') }]} />
            )}
          </>
        )}
      />
      <Card>
        <div className="rp-fig-tools">
          <Latest f={f} />
          <div className="rp-fig-pick">
            <Select label="Period" value={months} onChange={setMonths} options={MONTH_CHOICES} />
            <Select label="Show as" value={kind} onChange={(k) => setKind(k as ChartKind)}
              options={[{ value: 'line', label: 'Lines' }, { value: grouped ? 'stacked' : 'bar', label: grouped ? 'Stacked bars' : 'Bars' }, { value: 'table', label: 'Table only' }]} />
          </div>
        </div>
        {f.result.rows.length === 0
          ? <EmptyState icon="chart" title="Nothing recorded yet" message={`This figure is recorded at the end of every month${can('reports.edit') ? '. Use "Record now" to keep a value for this month so far' : ''}.`} />
          : <ResultView result={f.result} chart={{ kind }} label={f.name} height={320} withTable />}
        <ul className="rp-fig-notes muted">
          {f.filters_text.map((t) => <li key={t}>Filters: {t}</li>)}
          <li>{f.active ? 'Recorded at the end of every month.' : 'Not recorded at month ends at the moment.'} The figure counts every record, restricted ones included, and is the same for everyone.</li>
          <li>A month without a month-end value shows the latest value recorded on demand; the current month shows the value so far.</li>
        </ul>
      </Card>
      <FigureEditor figure={dialog === 'edit' ? f : null} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); fig.reload(); }} />
      <ConfirmDialog open={dialog === 'delete'} danger busy={busy} title="Remove this figure?" confirmLabel="Remove figure"
        message="It is no longer recorded or shown. Dashboards and packs that use it will say it has been removed." onConfirm={remove} onCancel={() => setDialog(null)} />
    </div>
  );
}

interface Draft { name: string; description: string; source: 'count' | 'metric'; metric_key: string; record_type: string; filters?: FilterGroup; group_field: string; active: boolean }

const draftOf = (f: TrackedFigure | null): Draft => ({
  name: f?.name ?? '', description: f?.description ?? '', source: f?.source ?? 'count', metric_key: f?.metric_key ?? '',
  record_type: f?.record_type ?? '', filters: f?.filters ?? undefined, group_field: f?.group_field ?? '', active: f?.active ?? true,
});

/** Adds or changes a figure: what it counts (records with filters and a breakdown, or a metric), its name and whether it is recorded. */
function FigureEditor({ figure, onClose, onSaved }: { figure: TrackedFigure | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const open = figure !== null;
  const existing = figure && figure !== 'new' ? figure : null;
  const [d, setD] = useState<Draft>(draftOf(existing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const catalog = useCatalog();
  const metrics = useFetch<{ metrics: Metric[] }>(open ? '/api/metrics' : null);
  useEffect(() => { setD(draftOf(existing)); setErrors({}); }, [figure]); // eslint-disable-line react-hooks/exhaustive-deps

  const types = catalog.types ?? [];
  const type = types.find((t) => t.type === d.record_type);
  const lists = (type?.fields ?? []).filter((fl) => fl.type === 'lookup' && !fl.via && !fl.path.includes('.'));
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });

  async function save() {
    setBusy(true);
    setErrors({});
    const body = {
      name: d.name.trim(), description: d.description.trim() || null, source: d.source, active: d.active,
      ...(d.source === 'metric' ? { metric_key: d.metric_key } : { record_type: d.record_type, group_field: d.group_field || null, filters: type ? completeFilters(d.filters, type.fields) ?? null : null }),
    };
    try {
      if (existing) await api.patch(`/api/figures/${existing.id}`, body);
      else await api.post('/api/figures', body);
      toast.success(existing ? 'Figure saved.' : 'Figure added. It is recorded at the end of every month; use "Record figures now" to start today.');
      onSaved();
    } catch (err) {
      const fields = (err as { fields?: Record<string, string> }).fields;
      if (fields) setErrors(fields);
      toast.error(errorMessage(err));
    } finally { setBusy(false); }
  }

  return (
    <Drawer open={open} title={existing ? `Edit: ${existing.name}` : 'Add a figure to follow'} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{existing ? 'Save' : 'Add figure'}</Button></>}>
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Name" required value={d.name} onChange={(name) => set({ name })} error={errors.name} placeholder="For example: Open risks by level" />
        <TextArea label="Description" rows={2} value={d.description} onChange={(description) => set({ description })} hint="Optional. Shown under the chart, and in board packs." />
        <Select label="What it measures" required value={d.source} onChange={(source) => set({ source: source as Draft['source'] })} error={errors.source}
          options={[{ value: 'count', label: 'A count of records' }, { value: 'metric', label: 'A metric the application works out' }]} />
        {d.source === 'metric' ? (
          <Select label="Metric" required searchable value={d.metric_key} onChange={(metric_key) => set({ metric_key, name: d.name || (metrics.data?.metrics.find((m) => m.key === metric_key)?.label ?? '') })}
            error={errors.metric_key} placeholder="Choose a metric…"
            options={(metrics.data?.metrics ?? []).map((m) => ({ value: m.key, label: m.label }))}
            hint={metrics.data?.metrics.find((m) => m.key === d.metric_key)?.description} />
        ) : (
          <>
            <Select label="Records to count" required searchable value={d.record_type} placeholder="Choose the records…" error={errors.record_type}
              onChange={(record_type) => set({ record_type, filters: undefined, group_field: '', name: d.name || (types.find((t) => t.type === record_type)?.plural ?? '') })}
              options={types.map((t) => ({ value: t.type, label: t.plural }))} />
            {type && (
              <>
                <Select label="Break down by" value={d.group_field} onChange={(group_field) => set({ group_field })} error={errors.group_field}
                  options={[{ value: '', label: 'No breakdown: one number' }, ...lists.map((fl) => ({ value: fl.path, label: fl.label }))]}
                  hint="A list field, such as a level, rating or status: the chart draws one line for each value." />
                <Section title="Filters" hint="Only the records that match are counted. The figure counts every record, restricted ones included, so it is the same for everyone.">
                  <FiltersSection type={type} spec={{ type: type.type, filters: d.filters }} onChange={(spec) => set({ filters: spec.filters })} />
                  {errors.filters && <p className="field-error" role="alert">{errors.filters}</p>}
                </Section>
              </>
            )}
          </>
        )}
        <Switch label="Record at the end of every month" checked={d.active} onChange={(active) => set({ active })} />
      </form>
    </Drawer>
  );
}
