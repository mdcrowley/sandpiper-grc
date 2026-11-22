import { useEffect, useMemo, useState } from 'react';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Button, Card, COLOR_NAMES, ErrorState, errorMessage, IconButton, Loading, Modal, NumberField, PageHeader, Select, TableWrap, TextArea, TextField,
  useDebounced, useLookup, useToast,
} from '../../core';
import { useScales, type Scale, type ScaleLevel, type ScaleRating } from './scales';

interface Preview { total: number | null; rerated: number | null; level_in_use: boolean | null }
type LevelList = 'likelihood_levels' | 'impact_levels';

const COLOR_OPTIONS = COLOR_NAMES.map((c) => ({ value: c, label: c.charAt(0).toUpperCase() + c.slice(1), color: c }));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keyFrom = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^[^a-z]+|_+$/g, '').slice(0, 30);

/** The part of a scale that is sent to the server, in a stable order, so drafts can be compared. */
const payload = (s: Scale) => ({
  name: s.name, description: s.description ?? '', likelihood_label: s.likelihood_label, impact_label: s.impact_label,
  likelihood_levels: s.likelihood_levels, impact_levels: s.impact_levels, ratings: s.ratings, matrix: s.matrix,
  acceptance_threshold: s.acceptance_threshold ?? null,
});

function LevelsTable({ title, hint, levels, error, onChange }: {
  title: string; hint: string; levels: ScaleLevel[]; error?: string; onChange: (next: ScaleLevel[]) => void;
}) {
  const patch = (index: number, change: Partial<ScaleLevel>) => onChange(levels.map((l, i) => (i === index ? { ...l, ...change } : l)));
  return (
    <div className="rk-scale-block">
      <h3 className="rk-report-h3">{title}</h3>
      <p className="muted rk-step-hint">{hint}</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <TableWrap label={`${title} levels`}>
        <table className="table rk-edit-table">
          <thead><tr><th scope="col" className="rk-col-num">Value</th><th scope="col" className="rk-col-label">Label</th><th scope="col">What it means</th><th scope="col" aria-label="Remove" /></tr></thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={i}>
                <td className="rk-col-num"><NumberField hideLabel size="xs" label={`Value of ${title} level ${i + 1}`} step={1} value={l.value} onChange={(v) => patch(i, { value: v ?? 0 })} /></td>
                <td><TextField hideLabel size="xs" label={`Label of ${title} level ${i + 1}`} value={l.label} onChange={(v) => patch(i, { label: v })} /></td>
                <td><TextField hideLabel size="xs" label={`Meaning of ${title} level ${i + 1}`} value={l.description ?? ''} onChange={(v) => patch(i, { description: v })} /></td>
                <td><IconButton size="sm" icon="trash" label={`Remove ${l.label || 'level'}`} disabled={levels.length <= 2} onClick={() => onChange(levels.filter((_, x) => x !== i))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <div>
        <Button size="sm" icon="plus" disabled={levels.length >= 10} onClick={() => onChange([...levels, { value: Math.max(0, ...levels.map((l) => l.value)) + 1, label: '', description: '' }])}>
          Add level
        </Button>
      </div>
    </div>
  );
}

/**
 * Edits one risk scale: its levels, its ratings, the matrix that turns a pair of levels into a
 * rating, and the rating from which acceptance needs an executive. Saving uses the scale routes,
 * and a preview says how many risks would be re-rated before anything is saved.
 */
export function ScaleEditor() {
  const toast = useToast();
  const { data: scales, error, reload } = useScales();
  const summaryLevels = useLookup('risk_summary_level');
  const [key, setKey] = useState('');
  const [draft, setDraft] = useState<Scale | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [adding, setAdding] = useState(false);
  const [fresh, setFresh] = useState({ key: '', name: '' });

  const original = scales?.find((s) => s.key === key) ?? scales?.[0];
  useEffect(() => {
    if (original) { setDraft(structuredClone(original)); setFields({}); setPreview(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [original?.key, scales]);

  const dirty = Boolean(draft && original && !same(payload(draft), payload(original)));
  const body = useMemo(() => (draft ? payload(draft) : null), [draft]);
  const settled = useDebounced(body, 500);

  // Ask the server what saving would do: its validation messages and the number of risks re-rated.
  useEffect(() => {
    if (!settled || !original || same(settled, payload(original))) { setPreview(null); return; }
    let live = true;
    api.post<Preview>(`/api/risks/scales/${original.key}/preview`, settled)
      .then((p) => { if (live) { setPreview(p); setFields({}); } })
      .catch((err) => { if (live) { setPreview(null); setFields(err instanceof ApiError && err.fields ? err.fields : { form: errorMessage(err) }); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled]);

  if (error) return <><PageHeader title="Risk scales" /><ErrorState error={error} onRetry={reload} /></>;
  if (!scales || !draft || !original) return <><PageHeader title="Risk scales" /><Loading /></>;

  const update = (change: Partial<Scale>) => setDraft((d) => (d ? { ...d, ...change } : d));
  const rows = [...draft.likelihood_levels].sort((a, b) => b.value - a.value);
  const cols = [...draft.impact_levels].sort((a, b) => a.value - b.value);
  const ratings = [...draft.ratings].sort((a, b) => a.sort - b.sort);
  const setCell = (l: number, i: number, rating: string) => update({ matrix: { ...draft.matrix, [l]: { ...(draft.matrix[String(l)] ?? {}), [i]: rating } } });
  const patchRating = (index: number, change: Partial<ScaleRating>) => update({ ratings: draft.ratings.map((r, x) => (x === index ? { ...r, ...change } : r)) });
  const isNewRating = (r: ScaleRating) => !original.ratings.some((o) => o.key === r.key);
  const unset = rows.some((l) => cols.some((i) => !draft.ratings.some((r) => r.key === draft.matrix[String(l.value)]?.[String(i.value)])));

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/api/risks/scales/${original.key}`, payload(draft));
      toast.success(preview?.rerated ? `Scale saved. ${preview.rerated} ${preview.rerated === 1 ? 'risk was' : 'risks were'} re-rated.` : 'Scale saved.');
      reload();
    } catch (err) {
      setFields(err instanceof ApiError && err.fields ? err.fields : { form: errorMessage(err) });
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const create = async () => {
    try {
      const made = await api.post<Scale>('/api/risks/scales', { ...payload(draft), key: fresh.key, name: fresh.name });
      toast.success(`Scale "${made.name}" added as a copy of ${original.name}.`);
      setAdding(false);
      setFresh({ key: '', name: '' });
      setKey(made.key);
      reload();
    } catch (err) {
      setFields(err instanceof ApiError && err.fields ? err.fields : { form: errorMessage(err) });
    }
  };

  const impact = !dirty ? null
    : Object.keys(fields).length > 0 ? null
    : !preview ? 'Checking what this change would do…'
    : preview.level_in_use ? 'A level that risks are scored on has been removed. Re-score those risks first, or put the level back.'
    : preview.rerated === null ? 'The change is valid. (You do not have access to risks, so the number that would be re-rated is not shown.)'
    : preview.rerated === 0 ? `Saving will not change the rating of any of the ${preview.total} risks on this scale.`
    : `Saving will re-rate ${preview.rerated} of the ${preview.total} risks on this scale.`;

  return (
    <div className="stack rk-scales">
      <PageHeader
        title="Risk scales"
        subtitle="The scales risks are scored on. A risk's category decides which scale it uses (Administration > Lists > risk_category)."
        breadcrumbs={[{ label: 'Risk register', to: '/risks' }, { label: 'Risk scales' }]}
        actions={<Button icon="plus" onClick={() => { setFields({}); setAdding(true); }}>Add scale</Button>}
      />
      {scales.length <= 4
        ? <SegmentedControl aria-label="Scale to edit" value={original.key} data={scales.map((s) => ({ value: s.key, label: s.name }))} onChange={setKey} className="rk-scale-pick" />
        : <Select label="Scale to edit" required value={original.key} options={scales.map((s) => ({ value: s.key, label: s.name }))} onChange={setKey} />}

      {fields.form && <p role="alert" className="form-error">{fields.form}</p>}

      <Card title="Name and axes">
        <div className="form-grid">
          <TextField className="form-cell-wide" label="Name" required value={draft.name} error={fields.name} onChange={(v) => update({ name: v })} />
          <TextArea className="form-cell-wide" label="Description" rows={2} value={draft.description ?? ''} onChange={(v) => update({ description: v })} />
          <TextField label="Name of the likelihood axis" value={draft.likelihood_label} onChange={(v) => update({ likelihood_label: v })} />
          <TextField label="Name of the impact axis" hint="For example Impact or Severity." value={draft.impact_label} onChange={(v) => update({ impact_label: v })} />
        </div>
      </Card>

      <Card title="Levels">
        <div className="grid-2">
          <LevelsTable
            title={draft.likelihood_label || 'Likelihood'} hint="A higher value is more likely." levels={draft.likelihood_levels}
            error={fields.likelihood_levels} onChange={(next) => update({ likelihood_levels: next } as Pick<Scale, LevelList>)}
          />
          <LevelsTable
            title={draft.impact_label || 'Impact'} hint="A higher value is worse." levels={draft.impact_levels}
            error={fields.impact_levels} onChange={(next) => update({ impact_levels: next } as Pick<Scale, LevelList>)}
          />
        </div>
      </Card>

      <Card title="Ratings">
        <p className="muted rk-step-hint">The order runs from least to most severe. Each rating maps to a common level so risks on different scales can be counted together.</p>
        {fields.ratings && <p role="alert" className="form-error">{fields.ratings}</p>}
        <TableWrap label="Ratings">
          <table className="table rk-edit-table">
            <thead><tr><th scope="col" className="rk-col-label">Label</th><th scope="col">Key</th><th scope="col">Color</th><th scope="col" className="rk-col-num">Order</th><th scope="col">Common level</th><th scope="col" aria-label="Remove" /></tr></thead>
            <tbody>
              {draft.ratings.map((r, i) => (
                <tr key={i}>
                  <td>
                    <TextField hideLabel size="xs" label={`Label of rating ${i + 1}`} value={r.label}
                      onChange={(v) => patchRating(i, isNewRating(r) ? { label: v, key: keyFrom(v) } : { label: v })} />
                  </td>
                  <td><code className="rk-key">{r.key || '—'}</code></td>
                  <td><Select hideLabel required size="xs" label={`Color of ${r.label || 'rating'}`} value={r.color} options={COLOR_OPTIONS} onChange={(v) => patchRating(i, { color: v || 'gray' })} /></td>
                  <td className="rk-col-num"><NumberField hideLabel size="xs" label={`Order of ${r.label || 'rating'}`} step={1} value={r.sort} onChange={(v) => patchRating(i, { sort: v ?? 0 })} /></td>
                  <td>
                    <Select hideLabel required size="xs" label={`Common level of ${r.label || 'rating'}`} value={r.summary_level}
                      options={summaryLevels.map((l) => ({ value: l.value, label: l.label, color: l.color }))} onChange={(v) => patchRating(i, { summary_level: v })} />
                  </td>
                  <td><IconButton size="sm" icon="trash" label={`Remove ${r.label || 'rating'}`} disabled={draft.ratings.length <= 1} onClick={() => update({ ratings: draft.ratings.filter((_, x) => x !== i) })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <div>
          <Button size="sm" icon="plus" onClick={() => update({ ratings: [...draft.ratings, { key: '', label: '', color: 'gray', sort: Math.max(0, ...draft.ratings.map((r) => r.sort)) + 10, summary_level: summaryLevels[0]?.value ?? 'low' }] })}>
            Add rating
          </Button>
        </div>
      </Card>

      <Card title="Matrix">
        <p className="muted rk-step-hint">Choose the rating each pair of levels gives. {draft.likelihood_label} runs down the side, {draft.impact_label.toLowerCase()} along the bottom.</p>
        {(fields.matrix || unset) && <p role="alert" className="form-error">{fields.matrix ?? 'Every cell of the matrix needs one of the ratings.'}</p>}
        <TableWrap label="Matrix" className="rk-matrix-wrap">
          <table className="rk-matrix-edit">
            <tbody>
              {rows.map((l) => (
                <tr key={l.value}>
                  <th scope="row">{l.label || l.value}</th>
                  {cols.map((i) => {
                    const current = draft.matrix[String(l.value)]?.[String(i.value)] ?? '';
                    const rating = draft.ratings.find((r) => r.key === current);
                    return (
                      <td key={i.value}>
                        <select
                          className="rk-matrix-select"
                          aria-label={`Rating for ${l.label || l.value} by ${i.label || i.value}`}
                          style={{ background: `var(--c-${rating?.color ?? 'gray'}-bg)`, color: `var(--c-${rating?.color ?? 'gray'}-fg)` }}
                          value={rating ? current : ''}
                          onChange={(e) => setCell(l.value, i.value, e.target.value)}
                        >
                          {!rating && <option value="">Choose…</option>}
                          {ratings.filter((r) => r.key).map((r) => <option key={r.key} value={r.key}>{r.label || r.key}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td />{cols.map((i) => <th key={i.value} scope="col">{i.label || i.value}</th>)}</tr>
            </tfoot>
          </table>
        </TableWrap>
      </Card>

      <Card title="Acceptance threshold">
        <div className="rk-threshold">
          <Select
            label="Executive approval is needed from" placeholder="Never: no executive approval needed" value={draft.acceptance_threshold ?? ''}
            options={ratings.filter((r) => r.key).map((r) => ({ value: r.key, label: `${r.label} and above`, color: r.color }))}
            error={fields.acceptance_threshold} onChange={(v) => update({ acceptance_threshold: v || null })}
            hint="A risk rated at or above this can be accepted only with a named executive approver, their title and a reference."
          />
        </div>
      </Card>

      <div className="rk-savebar">
        <div className="rk-savebar-text" role="status">
          {dirty ? <><strong>Unsaved changes.</strong> {impact}</> : <span className="muted">No unsaved changes.</span>}
          {Object.keys(fields).length > 0 && !fields.form && <span className="is-overdue"> Fix the problems marked above before saving.</span>}
        </div>
        <Button variant="ghost" disabled={!dirty} onClick={() => { setDraft(structuredClone(original)); setFields({}); }}>Discard changes</Button>
        <Button variant="primary" loading={saving} disabled={!dirty || unset || Boolean(preview?.level_in_use)} onClick={save}>Save scale</Button>
      </div>

      <Modal open={adding} title="Add scale" size="sm" onClose={() => setAdding(false)} dirty={adding && Boolean(fresh.name.trim() || fresh.key.trim())}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <p className="muted" style={{ margin: 0 }}>
            The new scale starts as a copy of “{original.name}” as it is on screen now. Edit it afterwards, then point a risk category at it.
          </p>
          <TextField label="Name" required value={fresh.name} error={fields.name} onChange={(v) => setFresh((f) => ({ name: v, key: f.key && f.key !== keyFrom(f.name) ? f.key : keyFrom(v) }))} />
          <TextField label="Key" required value={fresh.key} error={fields.key} hint="Lower-case letters, numbers and underscores. It cannot be changed later." onChange={(v) => setFresh((f) => ({ ...f, key: v }))} />
          <div className="form-actions">
            <Button variant="primary" type="submit" disabled={!fresh.name.trim() || !fresh.key.trim()}>Add scale</Button>
            <Button onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
