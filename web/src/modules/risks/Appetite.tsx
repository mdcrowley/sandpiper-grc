import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, DateField, ErrorState, errorMessage, formatDate, formatDateTime, Loading, NumberField, PageHeader, Select,
  StatusChip, TableWrap, TextArea, TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import { RiskTabs } from './RiskTabs';

// Risk appetite by category (E30-06): how much risk the organization accepts and the highest
// residual rating it tolerates; a risk above it is flagged "Above appetite" in the register,
// outlined on the heat map and listed in the report. E45-04: everyone who may see risks reads it; a
// change is a new version, recorded by someone who administers risks, with who approved it, when,
// in which body and why. Earlier versions are kept and listed under each category.

export interface AppetiteCategory {
  category: string; label: string; color: string; scale_key: string | null; scale_name: string | null;
  ratings: { key: string; label: string; color: string; sort: number }[];
  statement: string | null; max_rating: string | null; max_score: number | null;
  approved_on: string | null; approved_by_name: string | null; approval_body?: string | null; reference: string | null;
  version?: number | null; reason?: string | null; changed_at?: string | null; changed_by_name?: string | null; versions?: number;
  open: number; breaches: number;
}
export interface AppetiteData { categories: AppetiteCategory[] }

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
};
const draftOf = (c: AppetiteCategory): Draft => ({
  statement: c.statement, max_rating: c.max_rating, max_score: c.max_score,
  // A change is a new decision: its approval is given afresh.
  approved_on: null, approved_by_name: null, approval_body: null, reference: null, reason: null,
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

/** One category: the appetite in force, its history, and (for administrators) a new version. */
function CategoryCard({ c, onSaved }: { c: AppetiteCategory; onSaved: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState(false);
  const unsaved = useUnsavedChanges(!!draft && JSON.stringify(draft) !== JSON.stringify(draftOf(c)));
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const err = (k: string) => errors[`categories.0.${k}`] ?? errors[k];
  const max = c.ratings.find((r) => r.key === c.max_rating);
  const has = !!(c.statement || c.max_rating || c.max_score !== null);

  const save = async (remove = false) => {
    if (!draft) return;
    setSaving(true);
    setErrors({});
    try {
      const { reason, ...rest } = draft;
      const body = remove ? { category: c.category } : { category: c.category, ...rest };
      await api.put('/api/risks/appetite', { reason, categories: [body] });
      unsaved.release();
      toast.success(remove ? 'Appetite removed. The change is kept as a version.' : 'New version recorded. Every risk has been checked against it.');
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
          <TextArea label="Appetite statement" rows={2} value={draft.statement ?? ''} onChange={(v) => set({ statement: v || null })} error={err('statement')} hint="In plain words: how much of this kind of risk is acceptable." />
          <div className="form-grid">
            <Select
              label="Highest acceptable rating" value={draft.max_rating ?? ''} error={err('max_rating')}
              options={[{ value: '', label: 'No limit' }, ...c.ratings.map((r) => ({ value: r.key, label: r.label }))]}
              onChange={(v) => set({ max_rating: v || null })}
              hint="Residual rating, or inherent while a risk has no residual score."
            />
            <NumberField label="Highest acceptable score" value={draft.max_score} min={0} step={1} onChange={(v) => set({ max_score: v })} error={err('max_score')} hint="Optional, on the register's score." />
            <DateField label="Approved on" required value={draft.approved_on ?? ''} onChange={(v) => set({ approved_on: v || null })} error={err('approved_on')} />
            <TextField label="Approved by" required value={draft.approved_by_name ?? ''} onChange={(v) => set({ approved_by_name: v || null })} error={err('approved_by_name')} hint="The person who signed off, for example the chair." />
            <TextField label="Approving body" required value={draft.approval_body ?? ''} onChange={(v) => set({ approval_body: v || null })} error={err('approval_body')} hint="For example the board or a risk committee." />
            <TextField label="Reference" value={draft.reference ?? ''} onChange={(v) => set({ reference: v || null })} error={err('reference')} hint="A resolution or minute." />
          </div>
          <TextArea label="Why it is changing" required rows={2} value={draft.reason ?? ''} onChange={(v) => set({ reason: v || null })} error={err('reason')} hint="Kept with the version, beside your name." />
          <div className="form-actions">
            <Button variant="primary" loading={saving} onClick={() => void save()}>Record new version</Button>
            {has && <Button variant="danger" disabled={saving} onClick={() => void save(true)}>Remove the appetite</Button>}
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
          <div className="row">
            {can('risks.administer') && <Button size="sm" icon="edit" onClick={() => { setDraft(draftOf(c)); setErrors({}); }}>{has ? 'Record a new version' : 'Set the appetite'}</Button>}
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

export function Appetite() {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<AppetiteData>('/api/risks/appetite');
  const header = (
    <>
      <PageHeader
        title="Risk appetite"
        subtitle={can('risks.administer')
          ? 'How much risk the organization is willing to accept in each category. A change is recorded as a new version with its approval and reason; earlier versions are kept.'
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
      {data.categories.map((c) => <CategoryCard key={c.category} c={c} onSaved={reload} />)}
    </div>
  );
}
