import { useEffect, useState } from 'react';
import { ApiError, Button, Card, errorMessage, Select, useToast } from '../../core';
import type { RecordContext } from '../../core';
import { RatingChip, ratingFor, type Scale, type ScaleLevel } from './scales';

type Scores = Record<'inherent_likelihood' | 'inherent_impact' | 'residual_likelihood' | 'residual_impact', number | null>;
const FIELDS = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'] as const;

const read = (row: Record<string, unknown>): Scores =>
  Object.fromEntries(FIELDS.map((f) => [f, row[f] === null || row[f] === undefined ? null : Number(row[f])])) as Scores;

const options = (levels: ScaleLevel[]) =>
  [...levels].sort((a, b) => b.value - a.value).map((l) => ({ value: String(l.value), label: l.description ? `${l.label} (${l.description})` : l.label }));

/** Inherent and residual scoring, using the level names of the scale the risk is scored on. */
export function ScoringPanel({ rec, scale }: { rec: RecordContext; scale: Scale | undefined }) {
  const toast = useToast();
  const [scores, setScores] = useState<Scores>(() => read(rec.row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setScores(read(rec.row)); setErrors({}); }, [rec.row]);

  if (!scale) return <Card title="Scoring"><p className="muted">The scale this risk was scored on ({String(rec.row.scale_key)}) no longer exists.</p></Card>;

  const dirty = FIELDS.some((f) => scores[f] !== read(rec.row)[f]);
  const set = (field: keyof Scores, v: string) => setScores((s) => ({ ...s, [field]: v === '' ? null : Number(v) }));

  const save = async () => {
    const found: Record<string, string> = {};
    for (const basis of ['inherent', 'residual'] as const) {
      const l = scores[`${basis}_likelihood`];
      const i = scores[`${basis}_impact`];
      if ((l === null) !== (i === null)) {
        found[l === null ? `${basis}_likelihood` : `${basis}_impact`] =
          `Give both ${scale.likelihood_label.toLowerCase()} and ${scale.impact_label.toLowerCase()}, or neither.`;
      }
    }
    setErrors(found);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      await rec.save(Object.fromEntries(FIELDS.filter((f) => scores[f] !== read(rec.row)[f]).map((f) => [f, scores[f]])));
      toast.success('Scores saved.');
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const block = (basis: 'inherent' | 'residual', title: string, hint: string) => (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend><strong>{title}</strong> <span className="muted">{hint}</span></legend>
      <div className="form-grid">
        <Select
          label={scale.likelihood_label} placeholder="Not scored" disabled={!rec.canEdit}
          options={options(scale.likelihood_levels)} error={errors[`${basis}_likelihood`]}
          value={scores[`${basis}_likelihood`] === null ? '' : String(scores[`${basis}_likelihood`])}
          onChange={(v) => set(`${basis}_likelihood`, v)}
        />
        <Select
          label={scale.impact_label} placeholder="Not scored" disabled={!rec.canEdit}
          options={options(scale.impact_levels)} error={errors[`${basis}_impact`]}
          value={scores[`${basis}_impact`] === null ? '' : String(scores[`${basis}_impact`])}
          onChange={(v) => set(`${basis}_impact`, v)}
        />
      </div>
      <div className="score-result">
        <span className="muted">Rating:</span>
        <RatingChip scale={scale} rating={ratingFor(scale, scores[`${basis}_likelihood`], scores[`${basis}_impact`])?.key} />
      </div>
    </fieldset>
  );

  return (
    <Card title={`Scoring: ${scale.name}`}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          The scale follows the risk's category. Ratings are worked out from the scale's matrix and cannot be typed in.
        </p>
        <div className="grid-2">
          {block('inherent', 'Inherent risk', 'before existing controls')}
          {block('residual', 'Residual risk', 'with existing controls in place')}
        </div>
        {rec.canEdit && (
          <div className="form-actions">
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save scores</Button>
            {dirty && <Button variant="ghost" onClick={() => { setScores(read(rec.row)); setErrors({}); }}>Reset</Button>}
          </div>
        )}
      </div>
    </Card>
  );
}
