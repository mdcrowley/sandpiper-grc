import type { ScaleValue, Tally } from './types';

/**
 * One horizontal bar split by status, widths in proportion to the counts. Each segment
 * carries its own hover text; the legend (below) names the colours, so meaning is never
 * carried by colour alone.
 */
export function StatusBar({ tally, scale, label, showCounts }: {
  tally: Tally; scale: ScaleValue[]; label: string; showCounts?: boolean;
}) {
  const parts = scale.map((s) => ({ ...s, count: tally.counts[s.value] ?? 0 })).filter((p) => p.count > 0);
  const summary = scale.map((s) => `${s.label}: ${tally.counts[s.value] ?? 0}`).join(', ');
  return (
    <div className="fw-bar-wrap">
      <div className="fw-bar" role="img" aria-label={`${label}. ${summary}`}>
        {tally.total === 0 && <span className="fw-bar-empty" />}
        {parts.map((p) => (
          <span
            key={p.value}
            className="fw-bar-seg"
            style={{ flexGrow: p.count, background: `var(--c-${p.color}-solid)` }}
            title={`${p.label}: ${p.count} of ${tally.total}`}
          />
        ))}
      </div>
      {showCounts && (
        <div className="fw-bar-counts muted">
          {parts.length ? parts.map((p) => `${p.count} ${p.label.toLowerCase()}`).join(' · ') : 'No outcomes'}
        </div>
      )}
    </div>
  );
}

export function StatusLegend({ scale }: { scale: ScaleValue[] }) {
  return (
    <ul className="fw-legend" aria-label="Status colours">
      {scale.map((s) => (
        <li key={s.value}>
          <span className="fw-legend-swatch" style={{ background: `var(--c-${s.color}-solid)` }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
