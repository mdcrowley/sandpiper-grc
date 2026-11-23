import { useEffect, useRef, useState } from 'react';
import { ApiError, Button, Card, errorMessage, Select, useToast } from '../../core';
import type { RecordContext } from '../../core';
import { MiniMatrix, RatingChip, ratingFor, type Position, type Scale, type ScaleLevel } from './scales';

type Scores = Record<'inherent_likelihood' | 'inherent_impact' | 'residual_likelihood' | 'residual_impact', number | null>;
const FIELDS = ['inherent_likelihood', 'inherent_impact', 'residual_likelihood', 'residual_impact'] as const;

const read = (row: Record<string, unknown>): Scores =>
  Object.fromEntries(FIELDS.map((f) => [f, row[f] === null || row[f] === undefined ? null : Number(row[f])])) as Scores;

const options = (levels: ScaleLevel[]) =>
  [...levels].sort((a, b) => b.value - a.value).map((l) => ({ value: String(l.value), label: l.description ? `${l.label} (${l.description})` : l.label }));

const levelName = (levels: ScaleLevel[], v: number | null) => levels.find((l) => l.value === v)?.label ?? null;
const position = (s: Scores, basis: 'inherent' | 'residual'): Position | null => {
  const likelihood = s[`${basis}_likelihood`];
  const impact = s[`${basis}_impact`];
  return likelihood === null || impact === null ? null : { likelihood, impact };
};

/**
 * The assessment, read left to right: the inherent risk, the controls that reduce it, the residual
 * risk that is left, and a small matrix showing where the risk sits. "Change scores" turns the two
 * ends into pickers; the rating and the matrix follow each choice before anything is saved.
 */
export function ScoringPanel({ rec, scale }: { rec: RecordContext; scale: Scale | undefined }) {
  const toast = useToast();
  const [scores, setScores] = useState<Scores>(() => read(rec.row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setScores(read(rec.row)); setErrors({}); }, [rec.row]);
  // The button that was used goes away: the focus goes to the first picker, and back to "Change
  // scores" when the scores are saved or the change is canceled, rather than to nowhere (E16-15).
  const wasEditing = useRef(editing);
  useEffect(() => {
    if (wasEditing.current === editing) return;
    wasEditing.current = editing;
    const card = document.getElementById('risk-assessment');
    const target = editing ? card?.querySelector<HTMLElement>('.rk-assess input') : card?.querySelector<HTMLElement>('.card-actions button');
    target?.focus();
  }, [editing]);

  if (!scale) return <Card title="Assessment"><p className="muted">The scale this risk was scored on ({String(rec.row.scale_key)}) no longer exists.</p></Card>;

  const saved = read(rec.row);
  const dirty = FIELDS.some((f) => scores[f] !== saved[f]);
  const set = (field: keyof Scores, v: string) => setScores((s) => ({ ...s, [field]: v === '' ? null : Number(v) }));
  const cancel = () => { setScores(saved); setErrors({}); setEditing(false); };

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
    if (Object.keys(found).length) {
      // The message is beside the picker: take the focus there, so a screen reader reads it (E16-15).
      requestAnimationFrame(() => document.querySelector<HTMLElement>('#risk-assessment input[aria-invalid="true"]')?.focus());
      return;
    }
    setSaving(true);
    try {
      await rec.save(Object.fromEntries(FIELDS.filter((f) => scores[f] !== saved[f]).map((f) => [f, scores[f]])));
      toast.success('Scores saved.');
      setEditing(false);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const describe = (basis: 'inherent' | 'residual') => {
    const p = position(scores, basis);
    if (!p) return `${basis} risk not scored`;
    return `${basis} risk ${levelName(scale.likelihood_levels, p.likelihood)} by ${levelName(scale.impact_levels, p.impact)}, rated ${ratingFor(scale, p.likelihood, p.impact)?.label ?? 'nothing'}`;
  };

  const block = (basis: 'inherent' | 'residual', title: string, hint: string) => {
    const l = scores[`${basis}_likelihood`];
    const i = scores[`${basis}_impact`];
    return (
      <div className={`rk-assess-step rk-assess-${basis}`}>
        <p className="rk-step-label">{title}</p>
        <div className="rk-assess-rating">
          <RatingChip scale={scale} rating={ratingFor(scale, l, i)?.key} />
        </div>
        {editing ? (
          <div className="stack">
            <Select
              label={scale.likelihood_label} placeholder="Not scored" size="xs"
              options={options(scale.likelihood_levels)} error={errors[`${basis}_likelihood`]}
              value={l === null ? '' : String(l)} onChange={(v) => set(`${basis}_likelihood`, v)}
            />
            <Select
              label={scale.impact_label} placeholder="Not scored" size="xs"
              options={options(scale.impact_levels)} error={errors[`${basis}_impact`]}
              value={i === null ? '' : String(i)} onChange={(v) => set(`${basis}_impact`, v)}
            />
          </div>
        ) : l !== null && i !== null ? (
          <dl className="rk-levels">
            <div><dt>{scale.likelihood_label}</dt><dd>{levelName(scale.likelihood_levels, l)}</dd></div>
            <div><dt>{scale.impact_label}</dt><dd>{levelName(scale.impact_levels, i)}</dd></div>
          </dl>
        ) : null}
        <p className="muted rk-step-hint">{hint}</p>
      </div>
    );
  };

  return (
    <Card
      id="risk-assessment"
      title="Assessment"
      actions={rec.canEdit && !editing && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Change scores</Button>}
    >
      <div className="rk-assess">
        <div className="rk-assess-flow">
          {block('inherent', 'Inherent risk', 'Before existing controls')}
          <span className="rk-flow-arrow" aria-hidden="true">→</span>
          <div className="rk-assess-step rk-assess-controls">
            <p className="rk-step-label">Existing controls</p>
            {rec.row.existing_controls
              ? <p className="prose">{rec.row.existing_controls}</p>
              : <p className="muted">None recorded. Add them with “Edit details”.</p>}
          </div>
          <span className="rk-flow-arrow" aria-hidden="true">→</span>
          {block('residual', 'Residual risk', 'With existing controls in place')}
        </div>
        <div className="rk-assess-matrix">
          <MiniMatrix
            scale={scale} inherent={position(scores, 'inherent')} residual={position(scores, 'residual')}
            label={`Position on the ${scale.name} matrix: ${describe('inherent')}; ${describe('residual')}.`}
          />
          <p className="muted rk-step-hint">I = inherent, R = residual · {scale.name}</p>
        </div>
      </div>
      {editing && (
        <div className="form-actions">
          <Button variant="primary" loading={saving} disabled={!dirty} onClick={save}>Save scores</Button>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
          <span className="muted">Ratings are worked out from the scale and cannot be typed in.</span>
        </div>
      )}
    </Card>
  );
}
