import { formatDate } from '../../core';
import { RAG_COLOR, RAG_DIMENSIONS, RAG_LABEL, type TrendPoint } from './types';

/**
 * The four ratings over time: one row per rating, one column per reporting period, oldest
 * first. Each cell carries the first letter of the rating so it reads without colour.
 */
export function StatusTrend({ points }: { points: TrendPoint[] }) {
  if (!points.length) return <p className="muted">The trend appears once the first status report is added.</p>;
  const shown = points.slice(-12);
  return (
    <div
      className="prj-trend-grid"
      style={{ ['--cols' as string]: shown.length }}
      role="table"
      aria-label="Status ratings over time"
    >
      <div role="row" style={{ display: 'contents' }}>
        <span role="columnheader"><span className="sr-only">Rating</span></span>
        {shown.map((p, i) => (
          <span key={i} role="columnheader" className="prj-trend-head">{formatDate(p.period_end).replace(/ \d{4}$/, '')}</span>
        ))}
      </div>
      {RAG_DIMENSIONS.map((dim) => (
        <div key={dim.key} role="row" style={{ display: 'contents' }}>
          <span role="rowheader" className="prj-trend-row">{dim.label}</span>
          {shown.map((p, i) => {
            const value = p[dim.key];
            const label = RAG_LABEL[value] ?? value;
            return (
              <span
                key={i}
                role="cell"
                className="prj-trend-cell"
                style={{ background: `var(--c-${RAG_COLOR[value] ?? 'gray'}-solid)` }}
                title={`${dim.label}, ${formatDate(p.period_end)}: ${label}`}
              >
                <span aria-hidden="true">{label.charAt(0)}</span>
                <span className="sr-only">{label}</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
