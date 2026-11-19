import { useElementSize } from '@mantine/hooks';
import type { Scale } from './scales';

export interface HeatCell {
  likelihood: number;
  impact: number;
  rating: string | null;
  color: string;
  count: number;
  risk_ids: string[];
}

export interface HeatRisk {
  id: string;
  ref: string;
  title: string;
  status: string;
  closed: boolean;
  owner_name: string | null;
  likelihood: number | null;
  impact: number | null;
  score: number | null;
  inherent: { likelihood: number; impact: number; rating: string | null } | null;
  residual: { likelihood: number; impact: number; rating: string | null } | null;
}

export interface HeatMovement {
  from: { likelihood: number; impact: number };
  to: { likelihood: number; impact: number };
  count: number;
  risk_ids: string[];
}

export interface HeatMapData {
  scale: Scale;
  basis: 'residual' | 'inherent';
  cells: HeatCell[];
  totals: { rating: string; label: string; color: string; count: number }[];
  total: number;
  unscored: number;
  include_closed: boolean;
  movements: HeatMovement[];
  risks: HeatRisk[];
}

interface Props {
  data: HeatMapData;
  /** The chosen cell as "likelihood.impact", or null. */
  selected: string | null;
  onSelect: (cell: HeatCell | null) => void;
  /** Draw an arrow from each risk's inherent cell to its residual cell. */
  showMovement: boolean;
}

export const cellKey = (c: { likelihood: number; impact: number }) => `${c.likelihood}.${c.impact}`;

/**
 * The scale's matrix: worst likelihood at the top, worst impact on the right. Each cell is a
 * button showing how many risks sit in it and the rating the cell gives, so color never carries
 * the rating alone. Arrow keys move between cells; Enter or Space chooses one.
 */
export function HeatMap({ data, selected, onSelect, showMovement }: Props) {
  const { scale } = data;
  const rows = [...scale.likelihood_levels].sort((a, b) => b.value - a.value);
  const cols = scale.impact_levels;
  const { ref, width, height } = useElementSize();
  const cellAt = (l: number, i: number) => data.cells.find((c) => c.likelihood === l && c.impact === i);
  const ratingLabel = (key: string | null) => scale.ratings.find((r) => r.key === key)?.label ?? 'Not rated';
  const basisWord = data.basis === 'residual' ? 'Residual' : 'Inherent';

  // Arrow keys move focus around the grid like a spreadsheet.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
    const at = (e.target as HTMLElement).dataset;
    if (!step || at.row === undefined) return;
    const next = e.currentTarget.querySelector<HTMLElement>(`[data-row="${Number(at.row) + step[0]}"][data-col="${Number(at.col) + step[1]}"]`);
    if (next) { e.preventDefault(); next.focus(); }
  };

  // Center of a cell in pixels, for the movement arrows drawn over the grid.
  const center = (p: { likelihood: number; impact: number }) => {
    const r = rows.findIndex((l) => l.value === p.likelihood);
    const c = cols.findIndex((i) => i.value === p.impact);
    return { x: ((c + 0.5) * width) / cols.length, y: ((r + 0.5) * height) / rows.length };
  };

  return (
    <div className="rk-heat">
      <div className="rk-heat-ytitle" aria-hidden="true"><span>{scale.likelihood_label}</span></div>
      <div className="rk-heat-main">
        <div
          className="rk-heat-table"
          role="group"
          aria-label={`${basisWord} risk on the ${scale.name} scale. ${scale.likelihood_label} down the side, ${scale.impact_label.toLowerCase()} along the bottom. Choose a cell to list its risks.`}
          style={{ gridTemplateColumns: `4.5rem repeat(${cols.length}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows.length}, 1fr) auto` }}
          onKeyDown={onKeyDown}
        >
          {rows.map((l, r) => (
            <div key={l.value} className="rk-heat-row" style={{ gridRow: r + 1 }}>
              <span className="rk-heat-rowlabel" title={l.description}>{l.label}</span>
            </div>
          ))}
          <div ref={ref} className={`rk-heat-cells${selected ? ' has-choice' : ''}`}style={{ gridColumn: `2 / span ${cols.length}`, gridRow: `1 / span ${rows.length}`, gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
            {rows.flatMap((l, r) => cols.map((i, c) => {
              const cell = cellAt(l.value, i.value);
              if (!cell) return <span key={`${l.value}.${i.value}`} />;
              const isSelected = selected === cellKey(cell);
              const name = `${l.label} by ${i.label}`;
              return (
                <button
                  key={cellKey(cell)}
                  type="button"
                  data-row={r}
                  data-col={c}
                  className={`rk-cell${cell.count === 0 ? ' is-empty' : ''}`}
                  style={{ background: `var(--c-${cell.color}-bg)`, color: `var(--c-${cell.color}-fg)`, ['--cell-solid' as string]: `var(--c-${cell.color}-solid)` }}
                  aria-disabled={cell.count === 0}
                  aria-pressed={isSelected}
                  title={`${name}: ${ratingLabel(cell.rating)}`}
                  onClick={() => { if (cell.count > 0) onSelect(isSelected ? null : cell); }}
                >
                  {/* The name is what the cell shows ("1 Medium") plus words for screen readers, so
                      speech users can say what they see: "1 Medium risk: Possible by Minor". */}
                  <span className="rk-cell-count">{cell.count > 0 ? cell.count : ''}</span>
                  {cell.count > 0 && <span className="sr-only"> </span>}
                  <span className="rk-cell-rating">{ratingLabel(cell.rating)}</span>
                  <span className="sr-only">{cell.count > 0 ? ` ${cell.count === 1 ? 'risk' : 'risks'}: ${name}` : `, no risks: ${name}`}</span>
                </button>
              );
            }))}
            {showMovement && width > 0 && data.movements.length > 0 && (
              <svg className="rk-heat-arrows" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
                <defs>
                  <marker id="rk-arrowhead" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9 z" />
                  </marker>
                </defs>
                {data.movements.map((m) => {
                  const a = center(m.from);
                  const b = center(m.to);
                  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
                  // Start and stop short of the cell centers so the counts stay readable.
                  const pad = Math.min(18, len / 4);
                  const ux = (b.x - a.x) / len;
                  const uy = (b.y - a.y) / len;
                  const x1 = a.x + ux * pad;
                  const y1 = a.y + uy * pad;
                  const x2 = b.x - ux * pad;
                  const y2 = b.y - uy * pad;
                  // A gentle bow keeps the line off the counts of the cells it passes over.
                  const bow = Math.min(26, len * 0.16);
                  const d = `M ${x1} ${y1} Q ${(x1 + x2) / 2 - uy * bow} ${(y1 + y2) / 2 + ux * bow} ${x2} ${y2}`;
                  return (
                    <g key={`${cellKey(m.from)}-${cellKey(m.to)}`}>
                      <path className="rk-arrow-halo" d={d} />
                      <path className="rk-arrow" d={d} markerEnd="url(#rk-arrowhead)" />
                      <circle className="rk-arrow-start" cx={x1} cy={y1} r={3.5} />
                    </g>
                  );
                })}
              </svg>
            )}
          </div>
          <span style={{ gridRow: rows.length + 1, gridColumn: 1 }} />
          {cols.map((i, c) => (
            <span key={i.value} className="rk-heat-collabel" title={i.description} style={{ gridRow: rows.length + 1, gridColumn: c + 2 }}>{i.label}</span>
          ))}
        </div>
        <div className="rk-heat-xtitle" aria-hidden="true">{scale.impact_label}</div>
      </div>

      <ul className="rk-legend" aria-label={`${basisWord} risks by rating`}>
        {data.totals.map((t) => (
          <li key={t.rating}>
            <span className="rk-swatch" style={{ background: `var(--c-${t.color}-bg)`, borderColor: `var(--c-${t.color}-solid)` }} aria-hidden="true" />
            {t.label} <strong className="num">{t.count}</strong>
          </li>
        ))}
        {data.unscored > 0 && <li className="muted">Not yet scored <strong className="num">{data.unscored}</strong></li>}
        {showMovement && (
          <li className="muted rk-legend-move">
            <svg width="34" height="10" viewBox="0 0 34 10" aria-hidden="true">
              <line className="rk-arrow" x1="5" y1="5" x2="27" y2="5" />
              <path className="rk-arrow-head" d="M 25 1.5 L 33 5 L 25 8.5 z" />
              <circle className="rk-arrow-start" cx="5" cy="5" r="3.5" />
            </svg>
            {data.movements.length > 0 ? 'Inherent to residual' : 'No risk moves between cells'}
          </li>
        )}
      </ul>
    </div>
  );
}
