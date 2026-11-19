import { Text, Tooltip } from '@mantine/core';
import { formatDate } from '../../core';
import { RAG_DIMENSIONS, RAG_LABEL, type TrendPoint } from './types';

const LEVEL: Record<string, number> = { green: 0, amber: 1, red: 2 };
const MAX_POINTS = 12;

/**
 * The four ratings over time, one line each: green at the top of a lane, amber in the middle,
 * red at the bottom. Each point carries the letter of its rating, so the chart reads without color.
 */
export function StatusTrend({ points }: { points: TrendPoint[] }) {
  const shown = points.slice(-MAX_POINTS);
  const n = shown.length;
  if (!n) return <Text size="sm" c="dimmed">No status reports yet.</Text>;
  const every = Math.max(1, Math.ceil(n / 6));
  const left = (i: number) => `${((i + 0.5) / n) * 100}%`;
  const summary = RAG_DIMENSIONS.map((d) => `${d.label}: ${shown.map((p) => RAG_LABEL[p[d.key]] ?? p[d.key]).join(', ')}`).join('. ');

  return (
    <div className="prj-trendchart" role="img" aria-label={`Ratings over the last ${n} ${n === 1 ? 'report' : 'reports'}, oldest first. ${summary}.`}>
      {RAG_DIMENSIONS.map((d) => (
        <div key={d.key} className="prj-lane">
          <div className="prj-lane-label">
            <Text size="sm" fw={600}>{d.label}</Text>
            <Text size="xs" c="dimmed">{RAG_LABEL[shown[n - 1][d.key]] ?? '—'} now</Text>
          </div>
          <div className="prj-lane-plot">
            <span className="prj-lane-guide" style={{ top: '20%' }} />
            <span className="prj-lane-guide" style={{ top: '50%' }} />
            <span className="prj-lane-guide" style={{ top: '80%' }} />
            {n > 1 && (
              <svg className="prj-lane-line" viewBox={`0 0 ${n} 10`} preserveAspectRatio="none" aria-hidden="true">
                <polyline points={shown.map((p, i) => `${i + 0.5},${2 + (LEVEL[p[d.key]] ?? 1) * 3}`).join(' ')} vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            {shown.map((p, i) => {
              const value = p[d.key];
              return (
                <Tooltip key={p.period_end + i} label={`${d.label}: ${RAG_LABEL[value] ?? value}, period ending ${formatDate(p.period_end)}`}>
                  <span className={`prj-lane-dot prj-rag-${value}`} style={{ left: left(i), top: `${20 + (LEVEL[value] ?? 1) * 30}%` }}>
                    {(RAG_LABEL[value] ?? '?').charAt(0)}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      ))}
      <div className="prj-lane prj-lane-axis" aria-hidden="true">
        <div className="prj-lane-label" />
        <div className="prj-lane-plot">
          {shown.map((p, i) => ((n - 1 - i) % every === 0) && (
            <span key={p.period_end + i} className="prj-lane-tick" style={{ left: left(i) }}>{formatDate(p.period_end).replace(/ \d{4}$/, '')}</span>
          ))}
        </div>
      </div>
      <Text size="xs" c="dimmed" mt={4}>G green: on track · A amber: needs attention · R red: needs a decision or help</Text>
    </div>
  );
}
