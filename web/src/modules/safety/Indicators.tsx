// Safety performance indicators: the list, one indicator's trend against its target, the form
// that defines what an indicator counts, and the exposure the rates divide by.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, Chart, Checkbox, EmptyState, errorMessage, ErrorState, formatNumber, Loading, LookupChoices, LookupSelect, Modal, NumberField,
  PageHeader, ResourceList, Select, Stat, StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useLookup, useRecord, useToast, HistoryPanel, Tabs,
} from '../../core';
import type { ChartOption, Row } from '../../core';
import { TargetsTab, ValuesTab } from './IndicatorTabs';
import { SafetyTabs } from './shared';

/** Measures that count safety events: the event filters apply to them. */
const EVENT_MEASURES = ['count', 'rate'];
export const MEASURE_OPTIONS = [
  { value: 'count', label: 'Number of events in the month' },
  { value: 'rate', label: 'Rate: events per amount of exposure' },
  { value: 'manual', label: 'Entered by hand each month' },
  { value: 'computed', label: 'Computed from another part of the application' },
  { value: 'distance_between', label: 'Revenue miles between major failures' },
];
interface Metric { key: string; label: string; unit: string; description: string }

export interface Point { period: string; events: number | null; exposure: number | null; value: number | null; target: number | null; direction?: string; met: boolean | null; /** The current month: month to date, not judged (E18-79). */ partial?: boolean }

const nextMonth = (p: string) => { const [y, m] = p.split('-').map(Number); return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`; };
const monthLabel = (p: string) => new Date(`${p}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** What the value means, in words: "per 100,000 vehicle-miles" or "events". */
export function unitText(ind: { measure: string; exposure: string | null; per_units: number | null }, exposures: { value: string; label: string }[]) {
  if (ind.measure === 'manual') return 'entered each month';
  if (ind.measure === 'computed') return 'computed each month';
  if (ind.measure === 'distance_between') return 'revenue miles per major failure';
  if (ind.measure !== 'rate') return 'events a month';
  const label = exposures.find((e) => e.value === ind.exposure)?.label.toLowerCase() ?? ind.exposure;
  return `per ${formatNumber(ind.per_units)} ${label}`;
}

export function targetText(ind: { target: number | null; target_direction: string }) {
  if (ind.target === null || ind.target === undefined) return 'No target';
  return `${ind.target_direction === 'at_least' ? 'At least' : 'At most'} ${formatNumber(ind.target)}`;
}

export function MetChip({ met, partial }: { met: boolean | null | undefined; partial?: boolean }) {
  if (partial) return <StatusChip color="gray" label="Month to date" />;
  if (met === null || met === undefined) return <StatusChip color="gray" label="No figure" />;
  return met ? <StatusChip color="green" label="On target" /> : <StatusChip color="red" label="Off target" />;
}

/** The trend: the indicator as a line, the target as a dashed reference line on the same axis. */
export function TrendChart({ points, name, unit, height = 260 }: { points: Point[]; name: string; unit: string; height?: number }) {
  const option = useMemo<ChartOption>(() => {
    const target = points.find((p) => p.target !== null)?.target ?? null;
    return {
      tooltip: { trigger: 'axis' },
      legend: target !== null ? {} : undefined,
      grid: { top: target !== null ? 36 : 16, right: 16, bottom: 32, left: 48 },
      xAxis: { type: 'category', data: points.map((p) => monthLabel(p.period)), boundaryGap: false },
      yAxis: { type: 'value', minInterval: unit === 'events a month' ? 1 : undefined },
      series: [
        { name, type: 'line', data: points.map((p) => p.value), connectNulls: false, color: 'var(--series-1)' },
        ...(target !== null ? [{ name: 'Target', type: 'line', data: points.map(() => target), symbol: 'none', color: 'var(--text-muted)', lineStyle: { type: 'dashed', width: 1.5 } }] : []),
      ],
    } as ChartOption;
  }, [points, name, unit]);
  return <Chart label={`${name}, ${unit}, by month`} option={option} height={height} empty={points.every((p) => p.value === null)}
    emptyMessage={unit === 'entered each month' ? 'No values entered yet' : unit.startsWith('per ') || unit.startsWith('revenue') ? 'No figures yet: this needs the exposure for the month' : 'No figures yet'} />;
}

/** Where one indicator stands (GET /api/safety/indicator-status, wave 26). */
interface IndicatorStatus {
  id: string;
  latest: Point | null;
  previous: { period: string; value: number | null } | null;
  direction: 'better' | 'worse' | 'same' | null;
  month_to_date: { period: string; value: number | null } | null;
  spark: (number | null)[];
}

/** The last twelve complete months as a small line, with the target as a dashed line; the words carry the meaning. */
function Sparkline({ values, target }: { values: (number | null)[]; target: number | null }) {
  const known = values.filter((v): v is number => v !== null);
  if (known.length < 2) return null;
  const all = target === null ? known : [...known, target];
  const min = Math.min(...all);
  const span = Math.max(...all) - min || 1;
  const w = 88;
  const h = 26;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  const segments: string[] = [];
  let run: string[] = [];
  values.forEach((v, i) => {
    if (v === null) { if (run.length) segments.push(run.join(' ')); run = []; } else run.push(`${x(i)},${y(v)}`);
  });
  if (run.length) segments.push(run.join(' '));
  const lastIndex = values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).at(-1)!;
  return (
    <svg className="sf-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      {target !== null && <line x1="0" x2={w} y1={y(target)} y2={y(target)} className="sf-spark-target" />}
      {segments.map((pts) => <polyline key={pts} points={pts} className="sf-spark-line" />)}
      <circle cx={x(lastIndex)} cy={y(values[lastIndex]!)} r="2.5" className="sf-spark-dot" />
    </svg>
  );
}

const TREND_WORDS = { better: 'Better than the month before', worse: 'Worse than the month before', same: 'Same as the month before' } as const;

export function IndicatorList() {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const exposures = useLookup('safety_exposure_measure');
  // Where each indicator stands: the latest complete month (never the month to date) against its target.
  const { data: status } = useFetch<{ rows: IndicatorStatus[]; off_target: number; on_target: number }>('/api/safety/indicator-status');
  const byId = useMemo(() => new Map((status?.rows ?? []).map((r) => [r.id, r])), [status]);
  const latestCell = (r: Row) => {
    const s = byId.get(String(r.id));
    if (!status) return <span className="muted">…</span>;
    if (!s?.latest) return <span className="muted">No figure yet</span>;
    return <span className="sf-latest"><strong>{formatNumber(s.latest.value)}</strong> <span className="muted">{monthLabel(s.latest.period)}</span></span>;
  };
  return (
    <div className="stack">
      <PageHeader title="Safety indicators" subtitle="Named measures of safety performance, worked out each month from the safety events, with a target. Each is judged on its latest complete month."
        actions={can('safety.create') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>New indicator</Button>} />
      <SafetyTabs active="indicators" />
      {status && status.rows.length > 0 && (
        <div className="grid-stats">
          <Stat label="Off target" value={status.off_target} icon="target" color={status.off_target ? 'red' : undefined} hint="In the latest complete month" />
          <Stat label="On target" value={status.on_target} icon="check" color={status.on_target ? 'green' : undefined} hint="In the latest complete month" />
          <Stat label="No figure or no target" value={status.rows.length - status.off_target - status.on_target} icon="chart" />
        </div>
      )}
      <ResourceList type="safety_indicator" urlState filters={['active']} bulkFields={[]}
        columns={[
          'name',
          { field: 'latest', label: 'Latest', render: latestCell, priority: 1 },
          { field: 'against', label: 'Against target', priority: 1, render: (r) => {
            const s = byId.get(String(r.id));
            return status ? <MetChip met={s?.latest?.met ?? null} /> : null;
          } },
          { field: 'trend', label: 'Trend, 12 months', render: (r) => {
            const s = byId.get(String(r.id));
            if (!s) return null;
            const target = s.latest?.target ?? (r.target === null || r.target === undefined ? null : Number(r.target));
            return (
              <span className="sf-trend">
                <Sparkline values={s.spark} target={target} />
                {s.direction && <span className={`sf-trend-word is-${s.direction}`}>{TREND_WORDS[s.direction]}</span>}
              </span>
            );
          } },
          { field: 'measure', label: 'Measure', render: (r) => unitText(r as never, exposures) },
          { field: 'target', label: 'Target', render: (r) => targetText(r as never) },
          { field: 'active', label: 'On the dashboard', hidden: true },
        ]} />
      <IndicatorDialog open={adding} onClose={() => setAdding(false)} onSaved={(row) => { setAdding(false); navigate(`/safety/indicators/${row.id}`); }} />
    </div>
  );
}

export function IndicatorDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const exposures = useLookup('safety_exposure_measure');
  const { row, error, reload } = useRecord('safety_indicator', id);
  const [months, setMonths] = useState('12');
  const [search, setSearch] = useSearchParams();
  const tab = search.get('tab') ?? 'trend';
  const setTab = (key: string) => setSearch((p) => { p.set('tab', key); return p; }, { replace: true });
  const { data, error: trendError, reload: reloadTrend } = useFetch<{ points: Point[] }>(row ? `/api/safety-indicators/${id}/trend?months=${months}` : null, { keepPrevious: true });
  const { data: metrics } = useFetch<{ metrics: Metric[] }>(row?.measure === 'computed' ? '/api/metrics' : null);
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorState title="The indicator could not be loaded" error={error} onRetry={reload} />;
  if (!row) return <Loading lines={8} label="Loading the indicator" />;
  const unit = unitText(row as never, exposures);
  const points = data?.points ?? [];
  // The latest complete month with a figure; the month to date only when there is none (E18-79).
  const latest = [...points].reverse().find((p) => p.value !== null && !p.partial) ?? [...points].reverse().find((p) => p.value !== null);
  const counts = EVENT_MEASURES.includes(row.measure ?? 'count');
  const metric = metrics?.metrics.find((m) => m.key === row.metric_key);
  return (
    <div className="stack">
      <PageHeader title={row.name} breadcrumbs={[{ label: 'Safety indicators', to: '/safety/indicators' }, { label: row.name }]}
        subtitle={row.description || (row.measure === 'computed' ? `Computed from: ${metric?.label ?? row.metric_key}.` : `Worked out as ${unit}. Target: ${targetText(row as never).toLowerCase()}.`)}
        actions={can('safety.edit') && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>} />
      <div className="grid-stats">
        <Stat label="Latest" value={latest ? formatNumber(latest.value) : '—'} icon="chart" hint={latest ? `${monthLabel(latest.period)}${latest.partial ? ' (month to date)' : ''} · ${unit}` : unit} />
        <Stat label="Target" value={latest && latest.target !== null ? targetText({ target: latest.target, target_direction: latest.direction ?? row.target_direction }) : targetText(row as never)} icon="target"
          color={latest?.met === false ? 'red' : latest?.met ? 'green' : undefined}
          hint={latest?.partial ? 'Month to date: judged when the month is over' : latest?.met === null || latest?.met === undefined ? 'No figure yet' : latest.met ? 'On target in the latest month' : 'Off target in the latest month'} />
      </div>
      <Tabs label="Indicator" active={tab} onChange={setTab} tabs={[
        {
          key: 'trend', label: 'Trend', content: (
            <Card title="Month by month" actions={<Select label="Months" hideLabel required size="xs" value={months} onChange={setMonths}
              options={[{ value: '6', label: 'Last 6 months' }, { value: '12', label: 'Last 12 months' }, { value: '24', label: 'Last 24 months' }]} />}>
              {trendError && !data ? <ErrorState error={trendError} onRetry={reloadTrend} /> : !data ? <Loading lines={6} /> : (
                <div className="stack">
                  <TrendChart points={points} name={row.name} unit={unit} />
                  <TableWrap label={`${row.name} by month`}>
                    <table className="table">
                      <caption className="sr-only">{row.name} by month</caption>
                      <thead><tr><th scope="col">Month</th>{counts && <th scope="col" className="num">Events</th>}{row.measure === 'distance_between' && <><th scope="col" className="num">Revenue miles</th><th scope="col" className="num">Major failures</th></>}{row.measure === 'rate' && <th scope="col" className="num">Exposure</th>}<th scope="col" className="num">Value</th><th scope="col" className="num">Target</th><th scope="col">Against target</th></tr></thead>
                      <tbody>
                        {[...points].reverse().map((p) => (
                          <tr key={p.period}>
                            <td>{monthLabel(p.period)}</td>
                            {counts && <td className="num"><Link to={`/safety/events?f.occurred_at.gt=${p.period}-01&f.occurred_at.lt=${nextMonth(p.period)}`}>{p.events}</Link></td>}
                            {row.measure === 'distance_between' && <>
                              <td className="num">{p.exposure === null ? <Link to="/safety/exposure">Enter</Link> : formatNumber(p.exposure)}</td>
                              <td className="num">{p.events === null ? '—' : formatNumber(p.events)}</td>
                            </>}
                            {row.measure === 'rate' && <td className="num">{p.exposure === null ? <Link to="/safety/exposure">Enter</Link> : formatNumber(p.exposure)}</td>}
                            <td className="num">{p.value === null ? '—' : formatNumber(p.value)}</td>
                            <td className="num">{p.target === null ? '—' : formatNumber(p.target)}</td>
                            <td><MetChip met={p.met} partial={p.partial} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </TableWrap>
                  {counts && <p className="muted sf-hint">Counts every safety event, restricted ones included, so everyone sees the same figures; the event list shows only those you may see.</p>}
                  {row.measure === 'computed' && <p className="muted sf-hint">{metric ? metric.description : 'The figure this indicator is computed from is not available on this installation (its part of the application may be switched off).'}</p>}
                </div>
              )}
            </Card>
          ),
        },
        ...(row.measure === 'manual' ? [{ key: 'values', label: 'Values', content: <ValuesTab indicatorId={id} periods={points.length ? points.map((p) => p.period) : []} onSaved={reloadTrend} /> }] : []),
        { key: 'targets', label: 'Yearly targets', content: <TargetsTab indicatorId={id} defaultDirection={row.target_direction ?? 'at_most'} onChanged={reloadTrend} /> },
        { key: 'history', label: 'History', content: <HistoryPanel type="safety_indicator" id={id} row={row} /> },
      ]} />
      <IndicatorDialog open={editing} initial={row} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); reloadTrend(); }} />
    </div>
  );
}

export function IndicatorDialog({ open, initial, onClose, onSaved }: { open: boolean; initial?: Row; onClose: () => void; onSaved: (row: Row) => void }) {
  const toast = useToast();
  const blank = { name: '', description: '', event_types: [] as string[], severities: [] as string[], modes: [] as string[], measure: 'count', metric_key: '', exposure: 'vehicle_miles', per_units: 100000 as number | null, target: null as number | null, target_direction: 'at_most', active: true };
  const { data: metrics } = useFetch<{ metrics: Metric[] }>(open ? '/api/metrics' : null);
  const [f, setF] = useState(blank);
  const [start, setStart] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setErrors({});
      const opened = initial ? {
        name: initial.name ?? '', description: initial.description ?? '', event_types: initial.event_types ?? [], severities: initial.severities ?? [], modes: initial.modes ?? [],
        measure: initial.measure ?? 'count', metric_key: initial.metric_key ?? '', exposure: initial.exposure ?? 'vehicle_miles', per_units: initial.per_units === null ? null : Number(initial.per_units ?? 100000),
        target: initial.target === null || initial.target === undefined ? null : Number(initial.target), target_direction: initial.target_direction ?? 'at_most', active: initial.active !== false,
      } : blank;
      setF(opened); setStart(opened);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    if (!f.name.trim()) { setErrors({ name: 'Name is required.' }); return; }
    setBusy(true); setErrors({});
    const events = EVENT_MEASURES.includes(f.measure);
    const body = {
      ...f, exposure: f.measure === 'rate' ? f.exposure : null, per_units: f.measure === 'rate' ? f.per_units : null,
      metric_key: f.measure === 'computed' ? f.metric_key || null : null,
      event_types: events ? f.event_types : [], severities: events ? f.severities : [], modes: events || f.measure === 'distance_between' ? f.modes : [],
    };
    try {
      const row = initial ? await api.patch<Row>(`/api/safety-indicators/${initial.id}`, body) : await api.post<Row>('/api/safety-indicators', body);
      toast.success(initial ? 'Indicator saved.' : 'Indicator added.');
      onSaved(row);
    } catch (err) {
      const e = err as { fields?: Record<string, string> };
      if (e.fields) setErrors(e.fields); else toast.error(errorMessage(err));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} title={initial ? 'Edit indicator' : 'New indicator'} size="lg" onClose={onClose}
      dirty={JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>{initial ? 'Save changes' : 'Add indicator'}</Button></>}>
      <div className="form">
        <div className="form-grid">
          <div className="form-cell-wide"><TextField label="Name" required value={f.name} onChange={(v) => set('name', v)} error={errors.name} placeholder="For example: Collisions per 100,000 vehicle-miles" /></div>
          <div className="form-cell-wide"><TextArea label="Description" value={f.description} onChange={(v) => set('description', v)} rows={2} /></div>
          <div className="form-cell-wide"><Select label="Measure" value={f.measure} onChange={(v) => set('measure', v || 'count')} error={errors.measure} options={MEASURE_OPTIONS} /></div>
          {EVENT_MEASURES.includes(f.measure) && <>
            <LookupChoices label="Event types counted" list="safety_event_type" value={f.event_types} onChange={(v) => set('event_types', v)} error={errors.event_types} hint="Leave empty for every type." />
            <LookupChoices label="Severities counted" list="safety_event_severity" value={f.severities} onChange={(v) => set('severities', v)} error={errors.severities} hint="Leave empty for every severity." />
          </>}
          {(EVENT_MEASURES.includes(f.measure) || f.measure === 'distance_between') && (
            <LookupChoices label={f.measure === 'distance_between' ? 'Modes' : 'Modes counted'} list="vehicle_mode" value={f.modes} onChange={(v) => set('modes', v)} error={errors.modes}
              hint={f.measure === 'distance_between' ? 'Adds up the exposure entered for these modes. Leave empty for the whole operation.' : 'By the event\'s vehicle or service. Leave empty for all.'} />
          )}
          {f.measure === 'computed' && (
            <div className="form-cell-wide">
              <Select label="Computed from" required value={f.metric_key} onChange={(v) => set('metric_key', v ?? '')} error={errors.metric_key}
                options={(metrics?.metrics ?? []).map((m) => ({ value: m.key, label: m.label }))}
                hint={(metrics?.metrics ?? []).find((m) => m.key === f.metric_key)?.description ?? (metrics && !metrics.metrics.length ? 'No figures are offered on this installation yet.' : 'The figures other parts of the application offer, worked out each month.')} />
            </div>
          )}
          {f.measure === 'manual' && <p className="muted sf-hint form-cell-wide">Enter the value each month on the indicator's Values tab.</p>}
          {f.measure === 'distance_between' && <p className="muted sf-hint form-cell-wide">Revenue miles divided by major failures, both entered each month on the Exposure page.</p>}
          {f.measure === 'rate' && (
            <>
              <LookupSelect label="Per" list="safety_exposure_measure" required value={f.exposure ?? ''} onChange={(v) => set('exposure', v)} error={errors.exposure} />
              <NumberField label="Per how many" required value={f.per_units} onChange={(v) => set('per_units', v)} thousands error={errors.per_units} hint="For example 100,000 vehicle-miles." />
            </>
          )}
          <Select label="Target is" value={f.target_direction} onChange={(v) => set('target_direction', v || 'at_most')}
            options={[{ value: 'at_most', label: 'At most (lower is better)' }, { value: 'at_least', label: 'At least (higher is better)' }]} />
          <NumberField label="Target" value={f.target} onChange={(v) => set('target', v)} error={errors.target} decimals={2} />
          <div className="form-cell-wide"><Checkbox label="Shown on the safety dashboard" checked={f.active} onChange={(v) => set('active', v)} /></div>
        </div>
      </div>
    </Modal>
  );
}

// ---------- exposure ----------

interface Exposure { periods: string[]; rows: { period: string; mode: string; vehicle_miles: number | null; vehicle_hours: number | null; boardings: number | null; revenue_miles: number | null; major_failures: number | null }[] }
const FIELDS = [['vehicle_miles', 'Vehicle-miles'], ['vehicle_hours', 'Vehicle-hours'], ['boardings', 'Boardings'], ['revenue_miles', 'Revenue miles'], ['major_failures', 'Major failures']] as const;

export function ExposurePage() {
  const { can } = useAuth();
  const modes = useLookup('vehicle_mode');
  const { data, error, reload } = useFetch<Exposure>('/api/safety/exposure?months=12');
  const [mode, setMode] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, number | null>>({});
  const [opened, setOpened] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);
  const rowFor = (p: string) => data?.rows.find((r) => r.period === p && r.mode === mode);
  const start = (p: string) => { const r = rowFor(p); const values = Object.fromEntries(FIELDS.map(([k]) => [k, r?.[k] ?? null])); setDraft(values); setOpened(values); setEditing(p); };
  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try { await api.put('/api/safety/exposure', { period: editing, mode, ...draft }); toast.success('Exposure saved.'); setEditing(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHeader title="Exposure" subtitle="Vehicle-miles, vehicle-hours and boardings each month, what the indicator rates divide by; and revenue miles and major failures, for distance between failures." />
      <SafetyTabs active="exposure" />
      <Card actions={<Select label="Mode" hideLabel size="xs" value={mode} onChange={setMode} options={[{ value: '', label: 'Whole operation' }, ...modes.map((m) => ({ value: m.value, label: m.label }))]} />}
        title={mode ? modes.find((m) => m.value === mode)?.label ?? mode : 'Whole operation'} flush>
        {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="sf-pad"><Loading lines={8} /></div> : (
          <>
            {mode === '' && <p className="muted sf-pad sf-hint">When no figure is entered for the whole operation, a rate adds up the figures entered for each mode.</p>}
            <TableWrap label="Exposure by month">
              <table className="table">
                <caption className="sr-only">Exposure by month</caption>
                <thead><tr><th scope="col">Month</th>{FIELDS.map(([, l]) => <th key={l} scope="col" className="num">{l}</th>)}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {[...data.periods].reverse().map((p) => {
                    const r = rowFor(p);
                    return (
                      <tr key={p}>
                        <th scope="row">{monthLabel(p)}</th>
                        {FIELDS.map(([k]) => <td key={k} className="num">{r?.[k] === null || r?.[k] === undefined ? <span className="muted">—</span> : formatNumber(r[k])}</td>)}
                        <td className="sf-actions">{can('safety.edit') && <Button size="sm" variant="ghost" onClick={() => start(p)}>{r ? 'Edit' : 'Enter'}</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </>
        )}
      </Card>
      {data && data.rows.length === 0 && <EmptyState icon="chart" title="No exposure entered yet" message="Enter each month's figures so that rate indicators can be worked out." />}
      <Modal open={!!editing} size="sm" title={`Exposure for ${editing ? monthLabel(editing) : ''}${mode ? ` (${modes.find((m) => m.value === mode)?.label})` : ''}`} onClose={() => setEditing(null)}
        dirty={JSON.stringify(draft) !== JSON.stringify(opened)}
        footer={<><Button onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
        <div className="form">
          {FIELDS.map(([k, l]) => <NumberField key={k} label={l} value={draft[k] ?? null} min={0} thousands onChange={(v) => setDraft((d) => ({ ...d, [k]: v }))} />)}
        </div>
      </Modal>
    </div>
  );
}
