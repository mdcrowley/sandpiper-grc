import { useEffect, useMemo, useState } from 'react';
import { Group, Progress, RingProgress, SegmentedControl, Stack, Text } from '@mantine/core';
import { Button, Card, errorMessage, ErrorState, Loading, useFetch, useToast } from '../../core';
import type { Row } from '../../core';
import type { ProjectSettings } from './types';
import { scoreProject } from '../../../../shared/project-scoring.ts';

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The server's own rule (shared/project-scoring.ts), so the preview is what will be saved. */
function work(scores: Record<string, number | null>, settings: ProjectSettings) {
  const { lines, totalWeight, result } = scoreProject(scores, settings.criteria, settings.maxScore);
  return { total: totalWeight, result, lines: lines.map((l) => ({ ...l.criterion, score: l.score, share: l.share, points: l.points })) };
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

  const { lines, result } = work(scores, settings);
  const levels = Array.from({ length: settings.maxScore + 1 }, (_, i) => String(i));

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
    <div className="prj-scoring">
      <Card title="Priority score">
        <Stack align="center" gap="xs">
          <RingProgress
            size={156}
            thickness={12}
            roundCaps
            sections={[{ value: result ?? 0, color: 'blue' }]}
            aria-label={result === null ? 'Not scored yet' : `Priority score ${result} out of 100`}
            label={(
              <div style={{ textAlign: 'center' }}>
                <Text className="prj-score-total">{result === null ? '—' : result}</Text>
                <Text size="xs" c="dimmed">out of 100</Text>
              </div>
            )}
          />
          <Text size="sm" c="dimmed" ta="center">
            {result === null ? 'Not scored yet.' : dirty ? 'Preview: not saved yet.' : 'Used to rank projects in the portfolio.'}
          </Text>
          {canEdit && (
            <Group gap="xs" justify="center">
              <Button variant="primary" loading={busy} disabled={!dirty} onClick={submit}>Save scores</Button>
              {dirty && <Button onClick={() => setScores({ ...(row.scoring ?? {}) })}>Discard changes</Button>}
            </Group>
          )}
        </Stack>
        <div className="prj-score-how">
          <Text size="sm" fw={600}>How the score is worked out</Text>
          <Text size="sm" c="dimmed">
            Each criterion is scored from 0 (none) to {settings.maxScore} (very strong). A criterion's weight is its share of the
            100 points; it earns that share multiplied by its score out of {settings.maxScore}. The priority score is the sum.
            A criterion left unscored earns nothing.
          </Text>
        </div>
      </Card>

      <Card title="Criteria">
        <ul className="prj-criteria">
          {lines.map((c) => (
            <li key={c.key}>
              <Group justify="space-between" align="flex-start" gap="sm" wrap="wrap">
                <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                  <Text fw={600} size="sm" id={`score-${c.key}`}>{c.label}</Text>
                  {c.description && <Text size="sm" c="dimmed">{c.description}</Text>}
                </div>
                <SegmentedControl
                  size="xs"
                  aria-labelledby={`score-${c.key}`}
                  disabled={!canEdit}
                  value={c.score === null ? '' : String(c.score)}
                  onChange={(v) => setScores((s) => ({ ...s, [c.key]: v === '' ? null : Number(v) }))}
                  data={[{ value: '', label: '–' }, ...levels.map((n) => ({ value: n, label: n }))]}
                />
              </Group>
              <Group gap="sm" mt={6} wrap="nowrap">
                <Progress value={c.share ? (c.points / c.share) * 100 : 0} size="sm" radius="xl" style={{ flex: 1 }} aria-hidden="true" />
                <Text size="xs" c="dimmed" className="num" style={{ whiteSpace: 'nowrap' }}>
                  {c.score === null
                    ? `Not scored · worth up to ${round1(c.share)} points`
                    : `${round1(c.share)} points × ${c.score}/${settings.maxScore} = ${round1(c.points)}`}
                </Text>
              </Group>
            </li>
          ))}
        </ul>
        <Group justify="space-between" className="prj-criteria-total">
          <Text size="sm" fw={600}>Priority score</Text>
          <Text size="sm" fw={600} className="num">{result === null ? '—' : `${result} of 100`}</Text>
        </Group>
      </Card>
    </div>
  );
}
