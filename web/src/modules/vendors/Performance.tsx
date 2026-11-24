// Contractor performance reviews (E41-11): the contract's "Performance" tab (measures with targets,
// periodic scores with comments, met or below, and the trend) and the review across contracts.
import { Fragment, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, Chart, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDate, Icon, IconButton, Loading, Modal,
  NumberField, PageHeader, Select, Stat, StatusChip, Switch, TableWrap, TextArea, TextField, todayInZone, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';

/* ---------- types ---------- */

type Frequency = 'monthly' | 'quarterly' | 'yearly';
type Direction = 'higher' | 'lower';
type Trend = 'improving' | 'worsening' | 'steady';
interface Score {
  id: string; period: string; period_label: string; period_end: string; value: number; met: boolean;
  comment: string | null; recorded_by_name: string | null; updated_at: string;
}
interface Measure {
  id: string; name: string; description: string | null; unit: string | null; target: number; direction: Direction; frequency: Frequency;
  active: boolean; sort: number; scores: Score[]; latest: Score | null; met_count: number; trend: Trend | null;
  due_period: string | null; due_period_label: string | null;
}
interface PerformanceData {
  today: string;
  measures: Measure[];
  summary: { measures: number; met: number; below: number; due: number };
  can_edit: boolean;
}
interface ReviewRow {
  id: string; ref: string | null; title: string; status: string | null; vendor_id: string | null; vendor_name: string | null; owner_name: string | null;
  measures: number; met: number; below: number; not_scored: number; due: number; worsening: number; below_names: string[];
}

const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
const TREND: Record<Trend, { label: string; color: ColorName; icon: 'arrow-up' | 'arrow-down' | 'arrow-right' }> = {
  improving: { label: 'Improving', color: 'green', icon: 'arrow-up' },
  worsening: { label: 'Worsening', color: 'red', icon: 'arrow-down' },
  steady: { label: 'Steady', color: 'gray', icon: 'arrow-right' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The periods a score can be recorded for, newest first: the current one and those before it. */
export function recentPeriods(today: string, frequency: Frequency, count = 12): { value: string; label: string }[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: { value: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    if (frequency === 'yearly') out.push({ value: String(y - i), label: String(y - i) });
    else if (frequency === 'quarterly') {
      const q0 = Math.ceil(m / 3) - 1 - i;
      const year = y + Math.floor(q0 / 4);
      const q = ((q0 % 4) + 4) % 4 + 1;
      out.push({ value: `${year}-Q${q}`, label: `Q${q} ${year}` });
    } else {
      const m0 = m - 1 - i;
      const year = y + Math.floor(m0 / 12);
      const month = ((m0 % 12) + 12) % 12;
      out.push({ value: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${MONTHS[month]} ${year}` });
    }
  }
  return out;
}

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
const withUnit = (n: number, unit: string | null) => `${fmt(n)}${unit ? (unit === '%' ? '%' : ` ${unit}`) : ''}`;
const targetText = (m: Pick<Measure, 'direction' | 'target' | 'unit'>) => `${m.direction === 'lower' ? 'At most' : 'At least'} ${withUnit(m.target, m.unit)}`;

export function TrendChip({ trend }: { trend: Trend | null }) {
  if (!trend) return <span className="muted">Too few scores</span>;
  const t = TREND[trend];
  return <span className={`vnd-trend vnd-trend-${trend}`}><Icon name={t.icon} size={14} /> {t.label}</span>;
}

/** A small line of the scores, oldest to newest, with the target as a dashed line. Its words are in the table beside it. */
function Sparkline({ measure }: { measure: Measure }) {
  const values = measure.scores.slice(-12).map((s) => s.value);
  if (values.length < 2) return null;
  const all = [...values, measure.target];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 96;
  const h = 28;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 3 - ((v - min) / span) * (h - 6);
  return (
    <svg className="vnd-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" focusable="false">
      <line x1="0" x2={w} y1={y(measure.target)} y2={y(measure.target)} className="vnd-spark-target" />
      <polyline points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} className="vnd-spark-line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.5" className="vnd-spark-dot" />
    </svg>
  );
}

/* ---------- forms ---------- */

function MeasureForm({ contractId, measure, onDone, onCancel }: { contractId: string; measure: Measure | null; onDone: () => void; onCancel: () => void }) {
  const toast = useToast();
  const start = {
    name: measure?.name ?? '', description: measure?.description ?? '', unit: measure?.unit ?? '', target: measure?.target ?? null as number | null,
    direction: measure?.direction ?? 'higher', frequency: measure?.frequency ?? 'monthly', active: measure?.active ?? true,
  };
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);
  const unsaved = useUnsavedChanges(dirty);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.name.trim()) found.name = 'Name the measure.';
    if (v.target === null) found.target = 'Enter the target.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (measure) await api.patch(`/api/contracts/${contractId}/measures/${measure.id}`, v);
      else await api.post(`/api/contracts/${contractId}/measures`, v);
      unsaved.release();
      toast.success(measure ? 'Measure saved.' : 'Measure added.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={measure ? 'Change the measure' : 'Add a performance measure'} onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <div className="form-error" role="alert">{message}</div>}
        <TextField label="Measure" required hint="For example: shelters cleaned on schedule, or hours to repair a fault." value={v.name} error={errors.name} onChange={(name) => setV({ ...v, name })} />
        <div className="form-grid">
          <NumberField label="Target" required value={v.target} error={errors.target} onChange={(target) => setV({ ...v, target })} />
          <TextField label="Unit" hint="%, hours, count..." value={v.unit} error={errors.unit} onChange={(unit) => setV({ ...v, unit })} />
          <Select
            label="Better when" required value={v.direction} error={errors.direction}
            options={[{ value: 'higher', label: 'Higher (the target is a minimum)' }, { value: 'lower', label: 'Lower (the target is a maximum)' }]}
            onChange={(direction) => setV({ ...v, direction: direction as Direction })}
          />
          <Select
            label="Scored" required value={v.frequency} error={errors.frequency}
            disabled={Boolean(measure && measure.scores.length)}
            hint={measure && measure.scores.length ? 'Fixed once a score is recorded.' : undefined}
            options={(['monthly', 'quarterly', 'yearly'] as Frequency[]).map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
            onChange={(frequency) => setV({ ...v, frequency: frequency as Frequency })}
          />
        </div>
        <TextArea label="How it is measured" rows={2} value={v.description} error={errors.description} onChange={(description) => setV({ ...v, description })} />
        {measure && <Switch label="Still scored" hint="Switch off to stop asking for scores but keep the history." checked={v.active} onChange={(active) => setV({ ...v, active })} />}
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{measure ? 'Save' : 'Add the measure'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function ScoreForm({ contractId, measure, score, onDone, onCancel }: {
  contractId: string; measure: Measure; score: Score | null; onDone: () => void; onCancel: () => void;
}) {
  const toast = useToast();
  const taken = new Set(measure.scores.map((s) => s.period));
  const periods = recentPeriods(todayInZone(), measure.frequency).filter((p) => !taken.has(p.value));
  const current = recentPeriods(todayInZone(), measure.frequency, 1)[0].value;
  const start = {
    // The score due, else the newest ended period after the latest score, else the period under way.
    period: score?.period ?? measure.due_period
      ?? periods.find((p) => p.value !== current && (!measure.latest || p.value > measure.latest.period))?.value
      ?? (taken.has(current) ? periods[0]?.value : current) ?? '',
    value: score?.value ?? null as number | null,
    comment: score?.comment ?? '',
  };
  const [v, setV] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(v) !== JSON.stringify(start);
  const unsaved = useUnsavedChanges(dirty);
  const met = v.value === null ? null : measure.direction === 'lower' ? v.value <= measure.target : v.value >= measure.target;

  async function submit(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!v.period) found.period = 'Choose the period scored.';
    if (v.value === null) found.value = 'Enter the score.';
    setErrors(found);
    setMessage(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      if (score) await api.patch(`/api/contracts/${contractId}/scores/${score.id}`, { value: v.value, comment: v.comment, updated_at: score.updated_at });
      else await api.post(`/api/contracts/${contractId}/measures/${measure.id}/scores`, v);
      unsaved.release();
      toast.success(score ? 'Score corrected.' : 'Score recorded.');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else setMessage(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={score ? `Correct the score for ${score.period_label}` : `Score: ${measure.name}`} onClose={onCancel} dirty={dirty}>
      <form className="form" onSubmit={submit} noValidate>
        {message && <div className="form-error" role="alert">{message}</div>}
        <p className="muted">Target: {targetText(measure)}.</p>
        <div className="form-grid">
          {score
            ? <TextField label="Period" value={score.period_label} disabled onChange={() => undefined} />
            : <Select label="Period" required value={v.period} error={errors.period} options={periods} onChange={(period) => setV({ ...v, period })} />}
          <NumberField label={`Score${measure.unit ? ` (${measure.unit})` : ''}`} required value={v.value} error={errors.value} onChange={(value) => setV({ ...v, value })} />
        </div>
        {met !== null && (
          <p aria-live="polite"><StatusChip color={met ? 'green' : 'red'} label={met ? 'Meets the target' : 'Below the target'} /></p>
        )}
        <TextArea label="Comment" hint="What happened in the period, and what was agreed with the contractor." rows={3} value={v.comment} error={errors.comment} onChange={(comment) => setV({ ...v, comment })} />
        <div className="form-actions">
          <Button type="button" variant="secondary" onClick={unsaved.guard(onCancel)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving}>{score ? 'Save the correction' : 'Record the score'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- one measure's history ---------- */

function History({ contractId, measure, canEdit, onChanged }: { contractId: string; measure: Measure; canEdit: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState<Score | null>(null);
  const [removing, setRemoving] = useState<Score | null>(null);
  const [busy, setBusy] = useState(false);
  const scores = [...measure.scores].reverse();
  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/contracts/${contractId}/scores/${removing.id}`);
      toast.success('Score removed.');
      setRemoving(null);
      onChanged();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="vnd-perf-history">
      {measure.scores.length >= 2 && (
        <Chart
          label={`${measure.name}: scores against the target`}
          description={`Target ${targetText(measure).toLowerCase()}. ${measure.scores.map((s) => `${s.period_label}: ${withUnit(s.value, measure.unit)}`).join('; ')}.`}
          height={200}
          option={{
            grid: { left: 48, right: 16, top: 16, bottom: 32 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: measure.scores.map((s) => s.period_label) },
            yAxis: { type: 'value', scale: true },
            series: [{
              type: 'line', name: measure.name, data: measure.scores.map((s) => s.value), symbolSize: 7, lineStyle: { color: 'var(--c-blue-solid)' },
              itemStyle: { color: 'var(--c-blue-solid)' },
              markLine: { symbol: 'none', label: { formatter: 'Target' }, lineStyle: { type: 'dashed', color: 'var(--text-muted)' }, data: [{ yAxis: measure.target }] },
            }],
          }}
        />
      )}
      {measure.description && <p className="muted vnd-wrap">{measure.description}</p>}
      {scores.length === 0 ? (
        <p className="muted">No scores yet.</p>
      ) : (
        <TableWrap label={`Scores of ${measure.name}, newest first`}>
          <table className="table">
            <caption className="sr-only">Scores of {measure.name}, newest first</caption>
            <thead>
              <tr><th scope="col">Period</th><th scope="col">Score</th><th scope="col">Against target</th><th scope="col">Comment</th><th scope="col">By</th>{canEdit && <th scope="col"><span className="sr-only">Actions</span></th>}</tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.id}>
                  <td className="vnd-intake-name">{s.period_label}</td>
                  <td>{withUnit(s.value, measure.unit)}</td>
                  <td><StatusChip color={s.met ? 'green' : 'red'} label={s.met ? 'Met' : 'Below'} /></td>
                  <td className="vnd-wrap">{s.comment || <span className="muted">—</span>}</td>
                  <td>{s.recorded_by_name || <span className="muted">—</span>}</td>
                  {canEdit && (
                    <td className="vnd-intake-act">
                      <IconButton icon="edit" size="sm" label={`Correct the score for ${s.period_label}`} onClick={() => setEditing(s)} />
                      <IconButton icon="trash" size="sm" label={`Remove the score for ${s.period_label}`} onClick={() => setRemoving(s)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      {editing && <ScoreForm contractId={contractId} measure={measure} score={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); onChanged(); }} />}
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove this score?"
        message="Remove it only when it was recorded in error. The removal is kept in the contract's history."
        confirmLabel="Remove" onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/* ---------- the contract's tab ---------- */

export function PerformanceTab({ contractId }: { contractId: string }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<PerformanceData>(`/api/contracts/${contractId}/performance`);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Measure | null>(null);
  const [scoring, setScoring] = useState<Measure | null>(null);
  const [removing, setRemoving] = useState<Measure | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading the performance measures" />;

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/contracts/${contractId}/measures/${removing.id}`);
      toast.success('Measure removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const add = data.can_edit ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add a measure</Button> : undefined;
  const s = data.summary;
  return (
    <div className="stack">
      {data.measures.length > 0 && (
        <div className="vnd-perf-stats">
          <Stat size="sm" label="Measures scored" value={s.measures} icon="target" />
          <Stat size="sm" label="Met the target last time" value={s.met} color="green" />
          <Stat size="sm" label="Below the target last time" value={s.below} color={s.below ? 'red' : undefined} />
          <Stat size="sm" label="Scores due" value={s.due} color={s.due ? 'amber' : undefined} />
        </div>
      )}
      <Card title="Performance measures" actions={data.measures.length ? add : undefined} flush={data.measures.length > 0}>
        {data.measures.length === 0 ? (
          <EmptyState
            icon="target" title="No measures yet"
            message="Add the measures this contractor is held to, each with a target, and record a score each month, quarter or year."
            action={add}
          />
        ) : (
          <TableWrap label="Performance measures">
            <table className="table vnd-perf-table">
              <caption className="sr-only">Performance measures with their targets, latest scores and trends</caption>
              <thead>
                <tr>
                  <th scope="col">Measure</th><th scope="col">Target</th><th scope="col">Latest score</th><th scope="col">Trend</th>
                  <th scope="col">Met</th><th scope="col">Next</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.measures.map((m) => (
                  <Fragment key={m.id}>
                    <tr className={m.active ? undefined : 'vnd-perf-inactive'}>
                      <td className="vnd-perf-name">
                        <button type="button" className="vnd-perf-toggle" aria-expanded={open === m.id} onClick={() => setOpen(open === m.id ? null : m.id)}>
                          <Icon name={open === m.id ? 'chevron-down' : 'chevron-right'} size={14} /> {m.name}
                        </button>
                        <div className="muted">{FREQUENCY_LABEL[m.frequency]}{m.active ? '' : ' · no longer scored'}</div>
                      </td>
                      <td>{targetText(m)}</td>
                      <td>
                        {m.latest ? (
                          <>
                            <StatusChip color={m.latest.met ? 'green' : 'red'} label={withUnit(m.latest.value, m.unit)} />
                            <div className="muted">{m.latest.period_label}</div>
                          </>
                        ) : <span className="muted">Not scored yet</span>}
                      </td>
                      <td><span className="vnd-perf-trend"><Sparkline measure={m} /><TrendChip trend={m.trend} /></span></td>
                      <td>{m.scores.length ? `${m.met_count} of ${m.scores.length}` : <span className="muted">—</span>}</td>
                      <td>{m.due_period_label ? <StatusChip color="amber" label={`Due: ${m.due_period_label}`} /> : <span className="muted">—</span>}</td>
                      <td className="vnd-intake-act">
                        {data.can_edit && m.active && <Button size="sm" variant="secondary" onClick={() => setScoring(m)} aria-label={`Record a score for ${m.name}`}>Score</Button>}
                        {data.can_edit && <IconButton icon="edit" size="sm" label={`Change ${m.name}`} onClick={() => setEditing(m)} />}
                        {data.can_edit && <IconButton icon="trash" size="sm" label={`Remove ${m.name}`} onClick={() => setRemoving(m)} />}
                      </td>
                    </tr>
                    {open === m.id && (
                      <tr className="vnd-perf-detail">
                        <td colSpan={7}><History contractId={contractId} measure={m} canEdit={data.can_edit} onChanged={reload} /></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <p className="muted"><Link to="/contracts/performance">Performance across all contracts</Link></p>
      {adding && <MeasureForm contractId={contractId} measure={null} onCancel={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
      {editing && <MeasureForm contractId={contractId} measure={editing} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); reload(); }} />}
      {scoring && <ScoreForm contractId={contractId} measure={scoring} score={null} onCancel={() => setScoring(null)} onDone={() => { setOpen(scoring.id); setScoring(null); reload(); }} />}
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title={`Remove ${removing?.name ?? 'this measure'}?`}
        message={removing?.scores.length
          ? `Its ${removing.scores.length} score${removing.scores.length === 1 ? '' : 's'} go with it. To stop scoring but keep the history, change the measure and switch off "Still scored".`
          : 'It has no scores yet.'}
        confirmLabel="Remove" onConfirm={() => void remove()} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

/* ---------- across contracts ---------- */

export function PerformanceReview() {
  const { data, error, reload } = useFetch<{ today: string; rows: ReviewRow[] }>('/api/contracts/performance');
  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading contractor performance" />;
  else if (!data.rows.length) {
    body = <EmptyState icon="target" title="No measures yet" message="Open a contract and add measures on its Performance tab to review the contractor here." />;
  } else {
    const rows = [...data.rows].sort((a, b) => b.below - a.below || b.worsening - a.worsening || b.due - a.due || a.title.localeCompare(b.title));
    body = (
      <Card flush>
        <TableWrap label="Contractor performance">
          <table className="table">
            <caption className="sr-only">Contracts with performance measures, those below target first</caption>
            <thead>
              <tr>
                <th scope="col">Contract</th><th scope="col">Vendor</th><th scope="col">Measures</th><th scope="col">Met last time</th>
                <th scope="col">Below target</th><th scope="col">Worsening</th><th scope="col">Scores due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="vnd-perf-name">
                    <Link to={`/contracts/${r.id}?tab=performance`}>{r.title}</Link>
                    {r.ref && <div className="muted">{r.ref}</div>}
                  </td>
                  <td>{r.vendor_name ? <Link to={`/vendors/${r.vendor_id}`}>{r.vendor_name}</Link> : <span className="muted">—</span>}</td>
                  <td>{r.measures}{r.not_scored ? <div className="muted">{r.not_scored} not scored yet</div> : null}</td>
                  <td>{r.met}</td>
                  <td>
                    {r.below ? <StatusChip color="red" label={String(r.below)} /> : <span className="muted">0</span>}
                    {r.below_names.length > 0 && <div className="muted vnd-wrap">{r.below_names.join(', ')}</div>}
                  </td>
                  <td>{r.worsening ? <StatusChip color="amber" label={String(r.worsening)} /> : <span className="muted">0</span>}</td>
                  <td>{r.due ? <StatusChip color="amber" label={String(r.due)} /> : <span className="muted">0</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    );
  }
  return (
    <div className="stack">
      <PageHeader
        title="Contractor performance"
        subtitle="Every contract with performance measures: how many met their target at the latest score, how many fell below, and which scores are due."
        breadcrumbs={[{ label: 'Contracts', to: '/contracts' }, { label: 'Contractor performance' }]}
        actions={<Link className="btn btn-secondary" to="/contracts">Contracts</Link>}
      />
      {body}
      {data && <p className="muted">As of {formatDate(data.today)}.</p>}
    </div>
  );
}
