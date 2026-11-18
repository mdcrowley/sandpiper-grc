import { useEffect, useMemo, useState } from 'react';
import { Button, Card, errorMessage, ErrorState, Loading, useFetch, useToast } from '../../core';
import type { Row } from '../../core';
import type { ProjectSettings } from './types';

/** Mirrors the server rule so the preview matches what will be saved. */
function preview(scores: Record<string, number | null>, settings: ProjectSettings): number | null {
  let total = 0;
  let sum = 0;
  let scored = 0;
  for (const c of settings.criteria) {
    if (!(c.weight > 0)) continue;
    total += c.weight;
    const s = scores[c.key];
    if (s === null || s === undefined) continue;
    scored += 1;
    sum += c.weight * (s / settings.maxScore);
  }
  return scored && total ? Math.round((sum / total) * 1000) / 10 : null;
}

/** Portfolio scoring: a score per weighted criterion gives the project's priority score out of 100. */
export function ScoringTab({ row, save, canEdit }: { row: Row; save: (patch: Record<string, unknown>) => Promise<unknown>; canEdit: boolean }) {
  const toast = useToast();
  const { data: settings, error, reload } = useFetch<ProjectSettings>('/api/projects/settings');
  const [scores, setScores] = useState<Record<string, number | null>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => { setScores({ ...(row.scoring ?? {}) }); }, [row.scoring]);

  const dirty = useMemo(() => JSON.stringify(scores) !== JSON.stringify(row.scoring ?? {}), [scores, row.scoring]);

  if (error) return <ErrorState title="The scoring criteria could not be loaded" error={error} onRetry={reload} />;
  if (!settings) return <Loading />;

  const totalWeight = settings.criteria.reduce((n, c) => n + (c.weight > 0 ? c.weight : 0), 0);
  const result = preview(scores, settings);
  const levels = Array.from({ length: settings.maxScore + 1 }, (_, i) => i);

  async function submit() {
    setBusy(true);
    try {
      await save({ scoring: scores });
      toast.success('Scores saved.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card title="Priority score">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <span className="prj-score-total">{result === null ? '—' : result}</span>
            <span className="muted"> out of 100{dirty ? ' (not saved yet)' : ''}</span>
          </div>
          {canEdit && (
            <div className="row">
              {dirty && <Button onClick={() => setScores({ ...(row.scoring ?? {}) })}>Discard changes</Button>}
              <Button variant="primary" loading={busy} disabled={!dirty} onClick={submit}>Save scores</Button>
            </div>
          )}
        </div>
        <p className="muted">
          Score each criterion from 0 (none) to {settings.maxScore} (very strong). The score is the weighted average,
          shown out of 100. Criteria left blank count as zero. Administrators set the criteria and weights.
        </p>
      </Card>
      <Card title="Criteria">
        {settings.criteria.map((c) => {
          const value = scores[c.key] ?? null;
          return (
            <div key={c.key} className="prj-score">
              <div>
                <strong id={`score-${c.key}`}>{c.label}</strong>
                {c.description && <div className="muted">{c.description}</div>}
              </div>
              <div className="prj-score-buttons" role="group" aria-labelledby={`score-${c.key}`}>
                {levels.map((n) => (
                  <button
                    key={n}
                    type="button"
                    aria-pressed={value === n}
                    aria-label={`${n} out of ${settings.maxScore}`}
                    disabled={!canEdit}
                    onClick={() => setScores((s) => ({ ...s, [c.key]: s[c.key] === n ? null : n }))}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="muted">
                Weight {c.weight}{totalWeight ? ` (${Math.round((c.weight / totalWeight) * 100)}%)` : ''}
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
