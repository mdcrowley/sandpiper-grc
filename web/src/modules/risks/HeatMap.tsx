import { Badge, EmptyState, ErrorState, Loading, useFetch } from '../../core';
import type { ColorName } from '../../core';
import type { Scale } from './scales';

export interface HeatCell {
  likelihood: number;
  impact: number;
  rating: string | null;
  color: string;
  count: number;
  risk_ids: string[];
}

interface HeatMapData {
  scale: Scale;
  basis: 'residual' | 'inherent';
  cells: HeatCell[];
  totals: { rating: string; label: string; color: string; count: number }[];
  total: number;
  unscored: number;
}

interface Props {
  scaleKey: string;
  basis: 'residual' | 'inherent';
  selected: HeatCell | null;
  onSelect: (cell: HeatCell | null, label: string) => void;
}

/** The scale's matrix as a table of buttons: each cell shows its rating and how many risks sit in it. */
export function HeatMap({ scaleKey, basis, selected, onSelect }: Props) {
  const { data, error, reload } = useFetch<HeatMapData>(`/api/risks/heatmap?scale=${encodeURIComponent(scaleKey)}&basis=${basis}`);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={6} label="Loading heat map" />;

  const { scale } = data;
  const rows = [...scale.likelihood_levels].sort((a, b) => b.value - a.value); // worst at the top
  const cols = scale.impact_levels; // worst on the right
  const cellAt = (l: number, i: number) => data.cells.find((c) => c.likelihood === l && c.impact === i);
  const ratingLabel = (key: string | null) => scale.ratings.find((r) => r.key === key)?.label ?? 'Not rated';

  return (
    <div className="stack">
      <table className="heatmap">
        <caption>
          {basis === 'residual' ? 'Residual' : 'Inherent'} risk on the {scale.name} scale. {scale.likelihood_label} runs down the side,{' '}
          {scale.impact_label.toLowerCase()} along the top. Choose a cell to list its risks.
        </caption>
        <thead>
          <tr>
            <td />
            {cols.map((c) => <th key={c.value} scope="col" title={c.description}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.value}>
              <th scope="row" title={l.description}>{l.label}</th>
              {cols.map((i) => {
                const cell = cellAt(l.value, i.value);
                if (!cell) return <td key={i.value} />;
                const isSelected = selected?.likelihood === cell.likelihood && selected?.impact === cell.impact;
                const name = `${l.label} by ${i.label}`;
                return (
                  <td key={i.value}>
                    <button
                      type="button"
                      className={`heatmap-cell${cell.count === 0 ? ' is-empty' : ''}`}
                      style={{ background: `var(--c-${cell.color}-bg)`, color: `var(--c-${cell.color}-fg)` }}
                      disabled={cell.count === 0}
                      aria-pressed={isSelected}
                      aria-label={`${name}: rated ${ratingLabel(cell.rating)}, ${cell.count} ${cell.count === 1 ? 'risk' : 'risks'}`}
                      onClick={() => onSelect(isSelected ? null : cell, name)}
                    >
                      <span className="heatmap-count">{cell.count}</span>
                      <span className="heatmap-rating">{ratingLabel(cell.rating)}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        {data.totals.map((t) => <Badge key={t.rating} color={t.color as ColorName}>{t.label}: {t.count}</Badge>)}
        {data.unscored > 0 && <span className="muted">{data.unscored} not yet scored</span>}
      </div>
      {data.total === 0 && (
        <EmptyState title="No open risks on this scale" message="Risks appear here once they are scored." icon="shield" />
      )}
    </div>
  );
}
