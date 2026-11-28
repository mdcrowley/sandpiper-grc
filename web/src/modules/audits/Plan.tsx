// The risk-ranked audit plan (E45-13): the audit universe ranked by risk score for a plan year, the areas
// proposed (the highest-scoring up to the yearly capacity) beside those due by their cycle, the
// weights an administrator gives the risk factors, and the saved versions of the year's plan with their
// approval.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, LookupChip, NumberField, PageHeader,
  RecordPicker, Select, TableWrap, TextArea, todayInZone, useFetch, useMeta, useToast, useUnsavedChanges,
} from '../../core';
import { AuditTabs } from './shared';

type Factor = 'residual' | 'time' | 'result' | 'change' | 'significance';
const FACTORS: { key: Factor; label: string; hint: string }[] = [
  { key: 'residual', label: 'Residual risk', hint: 'The highest residual rating of the risks linked to the area (its own risk level when none is linked).' },
  { key: 'time', label: 'Time since the last audit', hint: 'Months since the last audit, as a share of the area\'s cycle.' },
  { key: 'result', label: 'Last audit result', hint: 'The opinion of the area\'s last closed audit.' },
  { key: 'change', label: 'Change', hint: 'How much the area has changed since its last audit.' },
  { key: 'significance', label: 'Significance', hint: 'How much the area matters to the organization.' },
];
interface Settings { weights: Record<Factor, number>; capacity: number | null; threshold: number; default_cycle_months: number }
interface Area {
  id: string; name: string; category: string | null; score: number; rank: number; factors: Record<Factor, number>;
  linked_risks: number; highest_residual: { score: number; max: number } | null; last_opinion: string | null;
  last_audited_on: string | null; next_due_on: string | null; cycle_months: number | null;
  due_by_cycle: boolean; never_audited: boolean; proposed: boolean; reasons: string[];
  audits: { id: string | null; ref: string | null; title: string; status: string }[];
}
interface Version {
  id: string; plan_year: number; version: number; status: 'draft' | 'approved' | 'superseded'; note: string | null; included: number;
  prepared_by_name: string | null; prepared_at: string; approved_by_name: string | null; approved_on: string | null; approval_note: string | null; approval_reference?: string | null;
  entries: { area_id: string; included: boolean }[];
}
interface PlanData {
  year: number; today: string; settings: Settings; areas: Area[]; proposed: number; versions: Version[];
  can_save: boolean; can_approve: boolean; can_administer: boolean;
}

const VERSION_STATUS: Record<Version['status'], { label: string; color: 'gray' | 'green' | 'blue' }> = {
  draft: { label: 'Draft', color: 'blue' }, approved: { label: 'Approved', color: 'green' }, superseded: { label: 'Superseded', color: 'gray' },
};

function Score({ value }: { value: number }) {
  return (
    <span className="au-score">
      <span className={`au-score-bar${value >= 70 ? ' is-high' : value >= 45 ? ' is-mid' : ''}`} aria-hidden="true"><span style={{ width: `${Math.min(100, value)}%` }} /></span>
      <strong>{value}</strong>
    </span>
  );
}

function Weights({ settings, canChange, onSaved }: { settings: Settings; canChange: boolean; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings); }, [settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const unsaved = useUnsavedChanges(dirty);
  const total = FACTORS.reduce((t, f) => t + (Number(form.weights[f.key]) || 0), 0);
  const save = async () => {
    setBusy(true);
    try { await api.put('/api/audits/plan/settings', form); unsaved.release(); toast.success('Scoring saved; every area was scored again.'); onSaved(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="How areas are scored">
      <div className="stack">
        <p className="muted">Each factor scores an area from 0 to 1; the weights say how much each counts (only their proportions matter). The plan proposes the highest-scoring areas up to the capacity, or every area at or above the threshold when no capacity is set.</p>
        <div className="au-weights">
          {FACTORS.map((f) => (
            <NumberField key={f.key} label={`${f.label} (${total ? Math.round((Number(form.weights[f.key]) || 0) * 100 / total) : 0}%)`} hint={f.hint}
              value={form.weights[f.key]} min={0} max={100} step={1} disabled={!canChange}
              onChange={(v) => setForm({ ...form, weights: { ...form.weights, [f.key]: v ?? 0 } })} />
          ))}
          <NumberField label="Audits a year (capacity)" hint="Leave empty to propose by threshold." value={form.capacity} min={0} max={500} step={1} disabled={!canChange}
            onChange={(v) => setForm({ ...form, capacity: v })} />
          <NumberField label="Threshold score" value={form.threshold} min={0} max={100} disabled={!canChange || form.capacity !== null}
            onChange={(v) => setForm({ ...form, threshold: v ?? 0 })} />
        </div>
        {canChange
          ? <div><Button variant="primary" disabled={!dirty || total === 0} loading={busy} onClick={save}>Save scoring</Button></div>
          : <p className="muted au-meta">Someone who administers audits changes the scoring.</p>}
      </div>
    </Card>
  );
}

function Versions({ data, onChanged }: { data: PlanData; onChanged: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [decision, setDecision] = useState<string | null>(null);
  const { resources } = useMeta();
  const newest = data.versions[0];
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await fn(); toast.success(done); setNote(''); onChanged(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <Card title={`Versions of the ${data.year} plan`}>
      {data.versions.length === 0 ? <p className="muted">No version saved yet. Choose the areas below and save a version for approval.</p> : (
        <ul className="au-versions">
          {data.versions.map((v) => (
            <li key={v.id}>
              <div>
                <strong>Version {v.version}</strong> <Badge color={VERSION_STATUS[v.status].color}>{VERSION_STATUS[v.status].label}</Badge>
                <div className="muted au-meta">
                  {v.included} areas · prepared by {v.prepared_by_name ?? 'someone'}, {formatDateTime(v.prepared_at)}
                  {v.approved_on ? ` · approved by ${v.approved_by_name ?? 'someone'} on ${formatDate(v.approved_on)}` : ''}
                  {v.approval_reference ? ` (${v.approval_reference})` : ''}
                </div>
                {(v.note || v.approval_note) && <div className="au-meta">{[v.note, v.approval_note].filter(Boolean).join(' · ')}</div>}
              </div>
              <div className="au-wp-actions">
                {v.status === 'approved' && data.can_save && (
                  <Button size="sm" loading={busy === `make-${v.id}`} onClick={() => act(`make-${v.id}`, () => api.post(`/api/audits/plans/${v.id}/create-audits`, {}), 'Planned audits created for the areas without one.')}>Create the planned audits</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {newest?.status === 'draft' && data.can_approve && (
        <div className="au-note">
          <TextArea label="Approval note (optional)" rows={1} value={note} onChange={setNote} hint="Someone other than the person who prepared it approves the plan." />
          {/* E45-64: the audit committee's decision as the approval. */}
          {resources.meeting_decision && (
            <RecordPicker label="Approved by a committee decision (optional)" type="meeting_decision" value={decision} onChange={(id) => setDecision(id)}
              hint="A carried decision of a committee meeting: the committee becomes the approver and the meeting's date the approval date." />
          )}
          <Button variant="primary" loading={busy === 'approve'} onClick={() => act('approve', () => api.post(`/api/audits/plans/${newest.id}/approve`, { note, ...(decision ? { decision_id: decision } : {}) }), `Version ${newest.version} approved.`)}>Approve version {newest.version}</Button>
        </div>
      )}
    </Card>
  );
}

export function AuditPlan() {
  const toast = useToast();
  const today = todayInZone();
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(String(thisYear + (Number(today.slice(5, 7)) >= 10 ? 1 : 0)));
  const { data, error, reload } = useFetch<PlanData>(`/api/audits/plan?year=${year}`);
  const settings = useFetch<{ settings: Settings; can_change: boolean }>('/api/audits/plan/settings');
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setChosen(null); }, [year, data?.versions.length]);
  const included = useMemo(() => {
    if (chosen) return chosen;
    const draft = data?.versions[0];
    if (draft) return new Set(draft.entries.filter((e) => e.included).map((e) => e.area_id));
    return new Set((data?.areas ?? []).filter((a) => a.proposed).map((a) => a.id));
  }, [chosen, data]);
  const header = (
    <>
      <PageHeader title="Audit plan" subtitle="The audit universe ranked by risk, the areas proposed for the year, and the approved plan." />
      <AuditTabs active="plan" />
    </>
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the audit plan" /></div>;
  const toggle = (id: string) => { const next = new Set(included); if (next.has(id)) next.delete(id); else next.add(id); setChosen(next); };
  const save = async () => {
    setBusy(true);
    try { await api.post('/api/audits/plans', { year: data.year, included: [...included], note }); toast.success('A new version of the plan was saved.'); setNote(''); setChosen(null); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2].map((y) => ({ value: String(y), label: String(y) }));
  return (
    <div className="stack">
      {header}
      <div className="au-grid">
        <Versions data={data} onChanged={reload} />
        {settings.data && <Weights settings={settings.data.settings} canChange={settings.data.can_change} onSaved={() => { settings.reload(); reload(); }} />}
      </div>
      <Card title={`Areas ranked by risk for ${data.year}`} flush actions={(
        <div className="au-years"><Select label="Plan year" hideLabel required size="xs" value={year} onChange={(v) => setYear(v || year)} options={years} /></div>
      )}>
        {data.areas.length === 0 ? (
          <EmptyState icon="clipboard" title="No audit universe yet" message="List the areas that need auditing first; link each to the risks it covers from its Related tab."
            action={<Link className="btn btn-primary" to="/audits/areas?new=1">Add an area</Link>} />
        ) : (
          <TableWrap fit label="Audit areas ranked by risk score" className="au-plan">
            <table className="table">
              <caption className="sr-only">Audit areas ranked by risk score, with the factors behind each score and whether the area is in the plan</caption>
              <thead>
                <tr>
                  <th scope="col" data-priority={1}>In plan</th>
                  <th scope="col" data-priority={1}>Rank</th>
                  <th scope="col" data-priority={1}>Area</th>
                  <th scope="col" data-priority={1}>Score</th>
                  <th scope="col" data-priority={1}>Why</th>
                  <th scope="col" data-priority={3}>Factors</th>
                  <th scope="col" data-priority={3}>Last audited</th>
                  <th scope="col" data-priority={2}>Audits in {data.year}</th>
                </tr>
              </thead>
              <tbody>
                {data.areas.map((a) => (
                  <tr key={a.id}>
                    <td><input type="checkbox" className="au-check" aria-label={`Include ${a.name} in the plan`} checked={included.has(a.id)} disabled={!data.can_save} onChange={() => toggle(a.id)} /></td>
                    <td>{a.rank}</td>
                    <th scope="row">
                      <Link className="row-title" to={`/audits/areas/${a.id}`}>{a.name}</Link>
                      <div className="au-flags">
                        {a.proposed && <Badge color="blue">Proposed</Badge>}
                        {a.due_by_cycle && !a.never_audited && <Badge color="amber">Due by cycle</Badge>}
                        {a.never_audited && <Badge color="gray">Never audited</Badge>}
                      </div>
                    </th>
                    <td><Score value={a.score} /></td>
                    <td className="au-wrap">{a.reasons.join('; ') || <span className="muted">Below the line</span>}</td>
                    <td className="au-wrap">
                      <ul className="au-factors">
                        <li>Residual risk {Math.round(a.factors.residual * 100)}%{a.linked_risks ? ` (${a.linked_risks} linked${a.highest_residual ? `, highest ${a.highest_residual.score} of ${a.highest_residual.max}` : ''})` : ' (area\'s own level)'}</li>
                        <li>Time {Math.round(a.factors.time * 100)}% · result {Math.round(a.factors.result * 100)}%</li>
                        <li>Change {Math.round(a.factors.change * 100)}% · significance {Math.round(a.factors.significance * 100)}%</li>
                      </ul>
                    </td>
                    <td>{a.last_audited_on ? formatDate(a.last_audited_on) : '—'}{a.last_opinion && <div><LookupChip list="audit_opinion" value={a.last_opinion} /></div>}</td>
                    <td>{a.audits.length ? a.audits.map((x, i) => (
                      <div key={x.id ?? `r${i}`} className="au-cov-entry">
                        {x.id ? <Link to={`/audits/engagements/${x.id}`}><span className="ref">{x.ref}</span></Link> : <span className="muted">{x.title}</span>} <LookupChip list="audit_status" value={x.status} />
                      </div>
                    )) : <span className="muted">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {data.can_save && data.areas.length > 0 && (
        <Card title="Save a version for approval">
          <div className="au-note">
            <TextArea label="Note (optional)" rows={1} value={note} onChange={setNote} hint={`${included.size} of ${data.areas.length} areas included.`} />
            <Button variant="primary" loading={busy} onClick={save}>Save version</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
