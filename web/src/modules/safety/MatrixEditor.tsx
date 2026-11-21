// Administration > Hazard matrix (E20-15): the safety hazard matrix changed from the Safety side, so it
// can be kept up to date whichever other parts of the application are switched on. Only what concerns
// hazards: the names and meanings of the levels, and the rating each cell gives. The rest of the scale
// is edited with the risk scales, which this page names only while that part is on.
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, Button, Card, ErrorState, errorMessage, Loading, PageHeader, TextField, useAuth, useToast } from '../../core';
import { useFetch } from '../../core';
import type { Level, Scale } from './shared';

type LevelList = 'likelihood_levels' | 'impact_levels';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const payload = (s: Scale) => ({ likelihood_levels: s.likelihood_levels, impact_levels: s.impact_levels, matrix: s.matrix });

function Levels({ title, hint, levels, error, onChange }: {
  title: string; hint: string; levels: Level[]; error?: string; onChange: (next: Level[]) => void;
}) {
  const patch = (value: number, change: Partial<Level>) => onChange(levels.map((l) => (l.value === value ? { ...l, ...change } : l)));
  return (
    <Card title={title}>
      <p className="muted sf-hint sf-hint-top">{hint}</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="table-wrap">
        <table className="table sf-level-table">
          <thead><tr><th scope="col" className="sf-col-num">Value</th><th scope="col">Name</th><th scope="col">What it means</th></tr></thead>
          <tbody>
            {[...levels].sort((a, b) => a.value - b.value).map((l) => (
              <tr key={l.value}>
                <td className="sf-col-num">{l.value}</td>
                <td><TextField hideLabel size="xs" required label={`Name of ${title.toLowerCase()} level ${l.value}`} value={l.label} onChange={(v) => patch(l.value, { label: v })} /></td>
                <td><TextField hideLabel size="xs" label={`Meaning of ${title.toLowerCase()} level ${l.value}`} value={l.description ?? ''} onChange={(v) => patch(l.value, { description: v })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function MatrixEditor() {
  const toast = useToast();
  const { can, areaOn } = useAuth();
  const { data: original, error, reload } = useFetch<Scale>('/api/safety/scale');
  const [draft, setDraft] = useState<Scale | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (original) { setDraft(structuredClone(original)); setFields({}); } }, [original]);

  const header = (
    <PageHeader
      title="Hazard matrix"
      subtitle="The matrix hazards are scored on: the names of its likelihood and severity levels, and the rating each pair of levels gives."
      breadcrumbs={[{ label: 'Hazard log', to: '/safety/hazards' }, { label: 'Hazard matrix' }]}
    />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!original || !draft) return <div className="stack">{header}<Loading /></div>;

  const dirty = !same(payload(draft), payload(original));
  const rows = [...draft.likelihood_levels].sort((a, b) => b.value - a.value);
  const cols = [...draft.impact_levels].sort((a, b) => a.value - b.value);
  const update = (change: Partial<Scale>) => setDraft((d) => (d ? { ...d, ...change } : d));
  const setCell = (l: number, s: number, rating: string) => update({ matrix: { ...draft.matrix, [l]: { ...(draft.matrix[String(l)] ?? {}), [s]: rating } } });
  const blank = [...draft.likelihood_levels, ...draft.impact_levels].some((l) => !l.label.trim());

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.patch<{ rerated: number }>('/api/safety/scale', payload(draft));
      toast.success(res.rerated ? `Hazard matrix saved. ${res.rerated} ${res.rerated === 1 ? 'hazard was' : 'hazards were'} re-rated.` : 'Hazard matrix saved.');
      setFields({});
      reload();
    } catch (err) {
      setFields(err instanceof ApiError && err.fields ? err.fields : { form: errorMessage(err) });
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {header}
      <p className="muted sf-hint sf-hint-top">
        Saving re-rates every hazard on the new matrix. The levels themselves (how many there are) and the ratings are fixed here.
        {areaOn('risks') && can('risks.administer') && <> The matrix is also a risk scale: change those under <Link to="/risks/scales">Risk scales</Link>.</>}
      </p>
      {fields.form && <p role="alert" className="form-error">{fields.form}</p>}

      <Card title="Matrix">
        <p className="muted sf-hint sf-hint-top">Choose the rating each pair of levels gives. {draft.likelihood_label} runs down the side, {draft.impact_label.toLowerCase()} along the bottom.</p>
        {fields.matrix && <p role="alert" className="form-error">{fields.matrix}</p>}
        <div className="table-wrap sf-matrix-edit-wrap">
          <table className="sf-matrix-edit">
            <tbody>
              {rows.map((l) => (
                <tr key={l.value}>
                  <th scope="row">{l.label || l.value}</th>
                  {cols.map((s) => {
                    const current = draft.matrix[String(l.value)]?.[String(s.value)] ?? '';
                    const rating = draft.ratings.find((r) => r.key === current);
                    const style = { '--sf-bg': `var(--c-${rating?.color ?? 'gray'}-bg)`, '--sf-fg': `var(--c-${rating?.color ?? 'gray'}-fg)` } as CSSProperties;
                    return (
                      <td key={s.value}>
                        <select className="sf-matrix-select" style={style} value={rating ? current : ''}
                          aria-label={`Rating for ${l.label || l.value} by ${s.label || s.value}`}
                          onChange={(e) => setCell(l.value, s.value, e.target.value)}>
                          {!rating && <option value="">Choose…</option>}
                          {draft.ratings.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td />{cols.map((s) => <th key={s.value} scope="col">{s.label || s.value}</th>)}</tr></tfoot>
          </table>
        </div>
      </Card>

      <div className="sf-grid">
        <Levels title={draft.likelihood_label || 'Likelihood'} hint="A higher value is more likely." levels={draft.likelihood_levels}
          error={fields.likelihood_levels} onChange={(next) => update({ likelihood_levels: next } as Pick<Scale, LevelList>)} />
        <Levels title={draft.impact_label || 'Severity'} hint="A higher value is worse." levels={draft.impact_levels}
          error={fields.impact_levels} onChange={(next) => update({ impact_levels: next } as Pick<Scale, LevelList>)} />
      </div>

      <div className="sf-savebar">
        <div className="sf-savebar-text" role="status">
          {dirty ? <strong>Unsaved changes.</strong> : <span className="muted">No unsaved changes.</span>}
          {blank && <span className="is-overdue"> Every level needs a name.</span>}
        </div>
        <Button variant="ghost" disabled={!dirty} onClick={() => { setDraft(structuredClone(original)); setFields({}); }}>Discard changes</Button>
        <Button variant="primary" loading={saving} disabled={!dirty || blank} onClick={save}>Save hazard matrix</Button>
      </div>
    </div>
  );
}
