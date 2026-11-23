import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Button, Card, DateField, EmptyState, ErrorState, errorMessage, Loading, NumberField, PageHeader, Select, StatusChip,
  TextArea, TextField, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import { RiskTabs } from './RiskTabs';

// Risk appetite by category (E30-06), under Administration beside Risk scales. Each category states
// how much risk the organization accepts and the highest residual rating it tolerates; a risk above
// it is flagged "Above appetite" in the register, outlined on the heat map and listed in the report.

export interface AppetiteCategory {
  category: string; label: string; color: string; scale_key: string | null; scale_name: string | null;
  ratings: { key: string; label: string; color: string; sort: number }[];
  statement: string | null; max_rating: string | null; max_score: number | null;
  approved_on: string | null; approved_by_name: string | null; reference: string | null;
  open: number; breaches: number;
}
export interface AppetiteData { categories: AppetiteCategory[] }

type Draft = Pick<AppetiteCategory, 'category' | 'statement' | 'max_rating' | 'max_score' | 'approved_on' | 'approved_by_name' | 'reference'>;
const draftOf = (c: AppetiteCategory): Draft => ({
  category: c.category, statement: c.statement, max_rating: c.max_rating, max_score: c.max_score,
  approved_on: c.approved_on, approved_by_name: c.approved_by_name, reference: c.reference,
});

export function Appetite() {
  const { can } = useAuth();
  const toast = useToast();
  const allowed = can('security.view');
  const { data, error, reload } = useFetch<AppetiteData>(allowed ? '/api/risks/appetite' : null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data) setDrafts(data.categories.map(draftOf)); }, [data]);
  const dirty = !!data && JSON.stringify(drafts) !== JSON.stringify(data.categories.map(draftOf));
  const unsaved = useUnsavedChanges(dirty);

  const header = (
    <>
      <PageHeader
        title="Risk appetite"
        subtitle="How much risk the organization is willing to accept in each category. Risks rated above the appetite are flagged in the register, on the heat map and in the risk report."
      />
      <RiskTabs active="appetite" />
    </>
  );
  if (!allowed) {
    return <div className="stack">{header}<EmptyState icon="lock" title="Restricted" message="Risks are restricted records: setting the appetite needs access to security records as well." /></div>;
  }
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={8} label="Loading the risk appetite" /></div>;

  const set = (i: number, patch: Partial<Draft>) => setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      await api.put('/api/risks/appetite', { categories: drafts });
      unsaved.release();
      toast.success('Risk appetite saved. Every risk has been checked against it.');
      reload();
    } catch (err) {
      setErrors(err instanceof ApiError && err.fields ? err.fields : {});
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {header}
      {data.categories.map((c, i) => {
        const d = drafts[i] ?? draftOf(c);
        const err = (k: string) => errors[`categories.${i}.${k}`];
        return (
          <Card
            key={c.category}
            title={<span className="row"><StatusChip color={(c.color || 'gray') as ColorName} label={c.label} /><span className="muted rk-appetite-scale">{c.scale_name}</span></span>}
            actions={(
              <span className="row">
                <Link to={`/risks?f.category=${encodeURIComponent(c.category)}`} className="muted">{c.open} open</Link>
                {c.breaches > 0
                  ? <Link className="chip chip-red" to={`/risks?f.category=${encodeURIComponent(c.category)}&f.appetite_breach=true`}>{c.breaches} above appetite</Link>
                  : d.max_rating && <span className="chip chip-green">None above appetite</span>}
              </span>
            )}
          >
            <div className="form">
              <TextArea label="Appetite statement" rows={2} value={d.statement ?? ''} onChange={(v) => set(i, { statement: v || null })} error={err('statement')} hint="In plain words: how much of this kind of risk is acceptable." />
              <div className="form-grid">
                <Select
                  label="Highest acceptable rating" value={d.max_rating ?? ''} error={err('max_rating')}
                  options={[{ value: '', label: 'No limit' }, ...c.ratings.map((r) => ({ value: r.key, label: r.label }))]}
                  onChange={(v) => set(i, { max_rating: v || null })}
                  hint="Residual rating, or inherent while a risk has no residual score."
                />
                <NumberField label="Highest acceptable score" value={d.max_score} min={0} step={1} onChange={(v) => set(i, { max_score: v })} error={err('max_score')} hint="Optional, on the register's score." />
                <DateField label="Approved on" value={d.approved_on ?? ''} onChange={(v) => set(i, { approved_on: v || null })} error={err('approved_on')} />
                <TextField label="Approved by" value={d.approved_by_name ?? ''} onChange={(v) => set(i, { approved_by_name: v || null })} error={err('approved_by_name')} hint="For example the board or a committee." />
                <TextField label="Reference" value={d.reference ?? ''} onChange={(v) => set(i, { reference: v || null })} error={err('reference')} hint="A resolution or minute." />
              </div>
            </div>
          </Card>
        );
      })}
      <div className="form-actions rk-appetite-actions">
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || !can('risks.administer')}>Save appetite</Button>
        {dirty && <Button onClick={() => setDrafts(data.categories.map(draftOf))}>Discard changes</Button>}
      </div>
    </div>
  );
}
