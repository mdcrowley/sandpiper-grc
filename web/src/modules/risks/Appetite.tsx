import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Badge, Button, Card, DateField, ErrorState, errorMessage, formatDate, formatDateTime, Loading, NumberField, PageHeader, Select,
  Notice, RecordPicker, StatusChip, Switch, TableWrap, TextArea, TextField, useAuth, useFetch, useMeta, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import { RiskTabs } from './RiskTabs';

// Risk appetite by category (E30-06): how much risk the organization accepts and the highest
// residual rating it tolerates; a risk above it is flagged "Above appetite" in the register,
// outlined on the heat map and listed in the report. E45-04: everyone who may see risks reads it; a
// change is a new version, recorded by someone who administers risks, with who approved it, when,
// in which body and why. Earlier versions are kept and listed under each category. E46-53: a change may
// instead be sent for approval through the "Risk appetite change" workflow; approval records it as the
// next version, and the card shows the request while it waits.

export interface AppetiteCategory {
  category: string; label: string; color: string; scale_key: string | null; scale_name: string | null;
  ratings: { key: string; label: string; color: string; sort: number }[];
  statement: string | null; max_rating: string | null; max_score: number | null;
  approved_on: string | null; approved_by_name: string | null; approval_body?: string | null; reference: string | null;
  version?: number | null; reason?: string | null; changed_at?: string | null; changed_by_name?: string | null; versions?: number;
  open: number; breaches: number;
  /** E46-53: the change of this category waiting for approval. */
  request?: AppetiteRequest | null;
}
export interface AppetiteRequest {
  id: string; ref: string; statement: string | null; max_rating: string | null; max_rating_label: string | null; max_score: number | null;
  remove_appetite: boolean; reason: string | null; requested_by: string | null; requested_by_name: string | null; requested_at: string; workflow: string | null;
}
export interface AppetiteData { categories: AppetiteCategory[]; workflow_available?: boolean }

interface AppetiteVersion {
  id: string; category: string; version: number; statement: string | null; max_rating: string | null; max_score: number | null;
  approved_on: string | null; approved_by_name: string | null; approval_body: string | null; reference: string | null;
  removed: boolean; reason: string | null; recorded_at: string; recorded_by_name: string | null;
}

/** "Approved by the chair (Board of directors), March 3, 2026 · version 2". */
export function approvalLine(c: Pick<AppetiteCategory, 'approved_by_name' | 'approval_body' | 'approved_on' | 'version'>): string {
  return `Approved by ${c.approved_by_name ?? 'no one named'}${c.approval_body ? ` (${c.approval_body})` : ''}${c.approved_on ? `, ${formatDate(c.approved_on)}` : ''}${c.version ? ` · version ${c.version}` : ''}`;
}

type Draft = {
  statement: string | null; max_rating: string | null; max_score: number | null; approved_on: string | null;
  approved_by_name: string | null; approval_body: string | null; reference: string | null; reason: string | null;
  /** E45-56: approved by a committee decision instead of the fields above. */
  decision_id?: string | null;
};
const draftOf = (c: AppetiteCategory): Draft => ({
  statement: c.statement, max_rating: c.max_rating, max_score: c.max_score,
  // A change is a new decision: its approval is given afresh.
  approved_on: null, approved_by_name: null, approval_body: null, reference: null, reason: null, decision_id: null,
});

/** The versions of one category's appetite, newest first. */
function History({ category, ratings }: { category: string; ratings: AppetiteCategory['ratings'] }) {
  const { data, error, reload } = useFetch<AppetiteVersion[]>(`/api/risks/appetite/versions?category=${encodeURIComponent(category)}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={2} label="Loading earlier versions" />;
  if (data.length === 0) return <p className="muted">No version has been recorded yet.</p>;
  const label = (key: string | null) => ratings.find((r) => r.key === key)?.label ?? key;
  return (
    <TableWrap label="Versions of the appetite">
      <table className="table rk-appetite-history">
        <caption className="sr-only">Versions of the appetite, newest first</caption>
        <thead><tr><th scope="col" className="num">Version</th><th scope="col">Appetite</th><th scope="col">Approved</th><th scope="col">Why it changed</th><th scope="col">Recorded</th></tr></thead>
        <tbody>
          {data.map((v, i) => (
            <tr key={v.id}>
              <td className="num">{v.version}{i === 0 && !v.removed && <> <Badge color="green">In force</Badge></>}</td>
              <td>{v.removed ? <span className="muted">Appetite removed</span> : (
                <span className="rk-two-line">
                  <span>{v.statement ?? <span className="muted">No statement</span>}</span>
                  <span className="muted">Highest acceptable: {v.max_rating ? label(v.max_rating) : 'no limit'}{v.max_score !== null ? `, score ${v.max_score}` : ''}</span>
                </span>
              )}</td>
              <td>{v.approved_by_name || v.approval_body || v.approved_on ? (
                <span className="rk-two-line">
                  <span>{[v.approved_by_name, v.approval_body].filter(Boolean).join(', ') || '—'}</span>
                  <span className="muted">{[v.approved_on ? formatDate(v.approved_on) : null, v.reference].filter(Boolean).join(' · ')}</span>
                </span>
              ) : <span className="muted">Not recorded</span>}</td>
              <td>{v.reason ?? <span className="muted">—</span>}</td>
              <td><span className="rk-two-line"><span>{v.recorded_by_name ?? <span className="muted">Unknown</span>}</span><span className="muted">{formatDateTime(v.recorded_at)}</span></span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

type Mode = 'workflow' | 'record';

/** "Highest acceptable: Medium, score 9", or the removal, for a change asked for. */
function proposalLine(r: AppetiteRequest): string {
  if (r.remove_appetite) return 'Remove the appetite';
  return `Highest acceptable: ${r.max_rating_label ?? 'no limit'}${r.max_score !== null ? `, score ${r.max_score}` : ''}`;
}

/** E46-53: the change of a category waiting for approval, with a way to withdraw it. */
function WaitingRequest({ r, onChanged }: { r: AppetiteRequest; onChanged: () => void }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const withdraw = async () => {
    setBusy(true);
    try {
      await api.post(`/api/risks/appetite/changes/${r.id}/withdraw`, {});
      toast.success(`${r.ref} withdrawn. The appetite stays as it is.`);
      onChanged();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Notice tone="warning" icon="clock" title={<>Change waiting for approval: <Link to={`/risks/appetite/changes/${r.id}`}>{r.ref}</Link></>}>
      <div className="stack rk-appetite-request">
        {r.statement && <span>{r.statement}</span>}
        <span>{proposalLine(r)}</span>
        <span className="muted">
          Asked for by {r.requested_by_name ?? 'someone'} on {formatDate(r.requested_at)}{r.workflow ? ` · ${r.workflow}` : ''}{r.reason ? ` · “${r.reason}”` : ''}
        </span>
        {(can('risks.administer') || r.requested_by === user?.id) && (
          <span className="row"><Button size="sm" variant="ghost" loading={busy} onClick={() => void withdraw()}>Withdraw the request</Button></span>
        )}
      </div>
    </Notice>
  );
}

/** One category: the appetite in force, its history, and (for administrators) a new version. */
function CategoryCard({ c, workflow, onSaved }: { c: AppetiteCategory; workflow: boolean; onSaved: () => void }) {
  const { can } = useAuth();
  const { resources } = useMeta();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);
  // E46-53: with an approval workflow, a change is sent for approval unless an approval given elsewhere is recorded.
  const [mode, setMode] = useState<Mode>('workflow');
  const unsaved = useUnsavedChanges(!!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(c)));
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const err = (k: string) => errors[`categories.0.${k}`] ?? errors[k];
  const max = c.ratings.find((r) => r.key === c.max_rating);
  const has = !!(c.statement || c.max_rating || c.max_score !== null);
  // Asking needs a workflow and no other request waiting for the category.
  const asking = workflow && !c.request && mode === 'workflow';

  const save = async (remove = false) => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      const { reason, ...rest } = draft;
      const { decision_id: decisionId, ...fields } = rest;
      if (asking) {
        const body = remove
          ? { category: c.category, remove_appetite: true, reason }
          : { category: c.category, statement: fields.statement, max_rating: fields.max_rating, max_score: fields.max_score, reason };
        const r = await api.post<{ ref: string }>('/api/risks/appetite/changes', body);
        unsaved.release();
        toast.success(`${r.ref} sent for approval. The appetite in force stays until it is approved.`);
      } else {
        const body = remove ? { category: c.category } : decisionId
          ? { category: c.category, statement: fields.statement, max_rating: fields.max_rating, max_score: fields.max_score, decision_id: decisionId }
          : { category: c.category, ...fields };
        await api.put('/api/risks/appetite', { reason, categories: [body] });
        unsaved.release();
        toast.success(remove ? 'Appetite removed. The change is kept as a version.' : 'New version recorded. Every risk has been checked against it.');
      }
      setDraft(null);
      onSaved();
    } catch (e) {
      setErrors(e instanceof ApiError && e.fields ? e.fields : {});
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      title={<span className="row"><StatusChip color={(c.color || 'gray') as ColorName} label={c.label} /><span className="muted rk-appetite-scale">{c.scale_name}</span></span>}
      actions={(
        <span className="row">
          <Link to={`/risks?f.category=${encodeURIComponent(c.category)}`} className="muted">{c.open} open</Link>
          {c.breaches > 0
            ? <Link className="chip chip-red" to={`/risks?f.category=${encodeURIComponent(c.category)}&f.appetite_breach=true`}>{c.breaches} above appetite</Link>
            : c.max_rating && <span className="chip chip-green">None above appetite</span>}
        </span>
      )}
    >
      {draft ? (
        <div className="form">
          {workflow && !c.request && (
            <SegmentedControl
              aria-label="How the change is approved" fullWidth value={mode} onChange={(v) => { setMode(v as Mode); setErrors({}); }}
              data={[{ value: 'workflow', label: 'Send for approval' }, { value: 'record', label: 'Record an approval given' }]}
            />
          )}
          {workflow && c.request && (
            <p className="field-hint" style={{ margin: 0 }}>A change of this category is waiting for approval ({c.request.ref}). A version recorded here overtakes it.</p>
          )}
          <TextArea label="Appetite statement" rows={2} value={draft.statement ?? ''} onChange={(v) => set({ statement: v || null })} error={err('statement')} hint="In plain words: how much of this kind of risk is acceptable." />
          <div className="form-grid">
            <Select
              label="Highest acceptable rating" value={draft.max_rating ?? ''} error={err('max_rating')}
              options={[{ value: '', label: 'No limit' }, ...c.ratings.map((r) => ({ value: r.key, label: r.label }))]}
              onChange={(v) => set({ max_rating: v || null })}
              hint="Residual rating, or inherent while a risk has no residual score."
            />
            <NumberField label="Highest acceptable score" value={draft.max_score} min={0} step={1} onChange={(v) => set({ max_score: v })} error={err('max_score')} hint="Optional, on the register's score." />
            {!asking && resources.meeting_decision && (
              <RecordPicker className="form-cell-wide" label="Approved by a committee decision (optional)" type="meeting_decision" value={draft.decision_id ?? null}
                onChange={(id) => set({ decision_id: id })} error={err('decision_id')}
                hint="A carried decision of a committee meeting: the committee becomes the approver, the meeting's date the approval date and its resolution the reference." />
            )}
            {!asking && !draft.decision_id && (
              <>
                <DateField label="Approved on" required value={draft.approved_on ?? ''} onChange={(v) => set({ approved_on: v || null })} error={err('approved_on')} />
                <TextField label="Approved by" required value={draft.approved_by_name ?? ''} onChange={(v) => set({ approved_by_name: v || null })} error={err('approved_by_name')} hint="The person who signed off, for example the chair." />
                <TextField label="Approving body" required value={draft.approval_body ?? ''} onChange={(v) => set({ approval_body: v || null })} error={err('approval_body')} hint="For example the board or a risk committee." />
                <TextField label="Reference" value={draft.reference ?? ''} onChange={(v) => set({ reference: v || null })} error={err('reference')} hint="A resolution or minute." />
              </>
            )}
          </div>
          {err('remove_appetite') && <p className="form-error" role="alert">{err('remove_appetite')}</p>}
          <TextArea label="Why it is changing" required rows={2} value={draft.reason ?? ''} onChange={(v) => set({ reason: v || null })} error={err('reason')}
            hint={asking ? 'The approvers see it; it is kept with the version once approved.' : 'Kept with the version, beside your name.'} />
          {asking && <p className="field-hint" style={{ margin: 0 }}>The approval workflow decides. Once approved, the approver, the date and the request's number are recorded with the version, and every risk is checked against it.</p>}
          <div className="form-actions">
            <Button variant="primary" loading={saving} onClick={() => void save()}>{asking ? 'Send for approval' : 'Record new version'}</Button>
            {has && <Button variant="danger" disabled={saving} onClick={() => void save(true)}>{asking ? 'Ask to remove the appetite' : 'Remove the appetite'}</Button>}
            <Button variant="ghost" disabled={saving} onClick={() => { setDraft(null); setErrors({}); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="stack rk-appetite-view">
          {has ? (
            <>
              <p className="prose" style={{ margin: 0 }}>{c.statement ?? <span className="muted">No statement</span>}</p>
              <p style={{ margin: 0 }}>
                <span className="muted">Highest acceptable rating: </span>
                {max ? <StatusChip color={max.color as ColorName} label={max.label} /> : <span>no limit</span>}
                {c.max_score !== null && <span className="muted"> · highest score {c.max_score}</span>}
              </p>
              <p className="muted" style={{ margin: 0 }}>
                {approvalLine(c)}{c.reference ? ` · ${c.reference}` : ''}
                {c.changed_by_name && <> · recorded by {c.changed_by_name}{c.changed_at ? ` on ${formatDate(c.changed_at)}` : ''}</>}
                {c.reason && <> · “{c.reason}”</>}
              </p>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>No appetite set for this category.</p>}
          {c.request && <WaitingRequest r={c.request} onChanged={onSaved} />}
          <div className="row">
            {can('risks.administer') && (
              <Button size="sm" icon="edit" onClick={() => { setDraft(draftOf(c)); setErrors({}); setMode(workflow && !c.request ? 'workflow' : 'record'); }}>
                {workflow && !c.request ? 'Change the appetite' : has ? 'Record a new version' : 'Set the appetite'}
              </Button>
            )}
            {(c.versions ?? 0) > 0 && (
              <Button size="sm" variant="ghost" icon={history ? 'chevron-up' : 'chevron-down'} aria-expanded={history} onClick={() => setHistory((h) => !h)}>
                {history ? 'Hide earlier versions' : `Versions (${c.versions})`}
              </Button>
            )}
          </div>
          {history && <History category={c.category} ratings={c.ratings} />}
        </div>
      )}
    </Card>
  );
}

interface ChangeRow { id: string; ref: string; title: string; status: string; created_at: string; decided_on: string | null; version: number | null; _display?: Record<string, string> }

/** E46-53: the latest changes asked for through the approval workflow, whatever became of them. */
function RecentRequests() {
  const { data } = useFetch<{ rows: ChangeRow[]; total: number }>('/api/risks/appetite/changes?pageSize=8&sort=created_at&dir=desc');
  const { lookups } = useMeta();
  if (!data || data.total === 0) return null;
  const status = (v: string) => (lookups.risk_appetite_change_status ?? []).find((s) => s.value === v);
  return (
    <Card title="Changes sent for approval" flush>
      <TableWrap label="Changes sent for approval">
        <table className="table">
          <thead><tr><th scope="col">Request</th><th scope="col">Asked on</th><th scope="col">Status</th><th scope="col">Decided</th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td><span className="rk-two-line"><Link to={`/risks/appetite/changes/${r.id}`}>{r.ref}</Link><span className="muted">{r.title}</span></span></td>
                <td>{formatDate(r.created_at)}</td>
                <td><StatusChip color={(status(r.status)?.color ?? 'gray') as ColorName} label={status(r.status)?.label ?? r._display?.status ?? r.status} /></td>
                <td>{r.decided_on ? `${formatDate(r.decided_on)}${r.version ? ` · version ${r.version}` : ''}` : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

export function Appetite() {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<AppetiteData>('/api/risks/appetite');
  const workflow = data?.workflow_available === true;
  const header = (
    <>
      <PageHeader
        title="Risk appetite"
        subtitle={can('risks.administer')
          ? workflow
            ? 'How much risk the organization is willing to accept in each category. Send a change for approval, or record one approved elsewhere; each approved change is a new version, and earlier versions are kept.'
            : 'How much risk the organization is willing to accept in each category. A change is recorded as a new version with its approval and reason; earlier versions are kept.'
          : 'How much risk the organization is willing to accept in each category, as approved. Risks rated above it are flagged in the register, on the heat map and in the risk report.'}
      />
      <RiskTabs active="appetite" />
    </>
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the risk appetite" /></div>;
  return (
    <div className="stack">
      {header}
      {data.categories.map((c) => <CategoryCard key={c.category} c={c} workflow={workflow} onSaved={reload} />)}
      <RecentRequests key={data.categories.map((c) => c.request?.id ?? '').join(',') + String(data.categories.map((c) => c.version).join(','))} />
      <CategoryRestriction />
    </div>
  );
}

interface RestrictionRow { category: string; label: string; color: string; restricted: boolean; risks: number; restricted_risks: number }

/** Which categories make their new risks restricted records (E45-57), for people who may change it. */
function CategoryRestriction() {
  const toast = useToast();
  const { data, error, reload } = useFetch<{ categories: RestrictionRow[]; can_change: boolean }>('/api/risks/categories');
  const [busy, setBusy] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || !data.can_change) return null;
  const change = async (c: RestrictionRow, restricted: boolean) => {
    setBusy(c.category);
    try {
      const r = await api.put<{ changed: number }>(`/api/risks/categories/${encodeURIComponent(c.category)}/restriction`, { restricted, apply_to_existing: existing });
      toast.success(`New ${c.label.toLowerCase()} risks are ${restricted ? 'restricted records' : 'no longer restricted'}${r.changed ? `; ${r.changed} existing risks changed` : ''}.`);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <Card title="Restricted categories" flush>
      <p className="muted" style={{ margin: 0, padding: 'var(--s-3) var(--s-4) 0' }}>
        New risks in a restricted category are restricted records: only people with access to restricted records see their details (counts stay the same for everyone).
      </p>
      <div style={{ padding: 'var(--s-3) var(--s-4) 0' }}>
        <Switch label="Also change the existing risks of a category" checked={existing} onChange={setExisting} />
      </div>
      <TableWrap label="Restricted categories">
        <table className="table">
          <thead><tr><th scope="col">Category</th><th scope="col" className="num">Risks</th><th scope="col" className="num">Restricted</th><th scope="col">New risks restricted</th></tr></thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.category}>
                <td><StatusChip color={(c.color || 'gray') as ColorName} label={c.label} /></td>
                <td className="num">{c.risks}</td>
                <td className="num">{c.restricted_risks}</td>
                <td><Switch label={c.restricted ? `Restricted (new ${c.label.toLowerCase()} risks)` : `Not restricted (new ${c.label.toLowerCase()} risks)`} checked={c.restricted} disabled={busy !== null} onChange={(v) => void change(c, v)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}
