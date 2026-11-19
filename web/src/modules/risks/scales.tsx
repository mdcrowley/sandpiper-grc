import { Badge, todayInZone, useFetch } from '../../core';
import type { ColorName } from '../../core';

export interface ScaleLevel { value: number; label: string; description?: string }
export interface ScaleRating { key: string; label: string; color: string; sort: number; summary_level: string }
export interface Scale {
  key: string;
  name: string;
  description: string | null;
  likelihood_label: string;
  impact_label: string;
  likelihood_levels: ScaleLevel[];
  impact_levels: ScaleLevel[];
  matrix: Record<string, Record<string, string>>;
  ratings: ScaleRating[];
  acceptance_threshold: string | null;
}

/** Risk scales are data held by the server; every risk screen reads them from here. */
export function useScales() {
  return useFetch<Scale[]>('/api/risks/scales');
}

export function ratingOf(scale: Scale | undefined, key: string | null | undefined): ScaleRating | undefined {
  return scale?.ratings.find((r) => r.key === key);
}

/** Rating for a likelihood/impact pair, worked out from the scale's matrix. */
export function ratingFor(scale: Scale | undefined, likelihood: number | null, impact: number | null): ScaleRating | undefined {
  if (!scale || likelihood === null || impact === null) return undefined;
  return ratingOf(scale, scale.matrix[String(likelihood)]?.[String(impact)]);
}

export function RatingChip({ scale, rating, prefix }: { scale: Scale | undefined; rating: string | null | undefined; prefix?: string }) {
  const r = ratingOf(scale, rating);
  if (!r) return <span className="muted">{prefix ? `${prefix}: not scored` : 'Not scored'}</span>;
  return <Badge color={r.color as ColorName}>{prefix ? `${prefix}: ${r.label}` : r.label}</Badge>;
}

/** A rating chip from a label and colour the server has already worked out. */
export function RatedChip({ label, color }: { label: string | null | undefined; color?: string | null }) {
  if (!label) return <span className="muted">Not scored</span>;
  return <Badge color={(color ?? 'gray') as ColorName}>{label}</Badge>;
}

export interface Position { likelihood: number; impact: number }

/**
 * The scale's matrix in miniature, marking where one risk sits: "I" for inherent, "R" for
 * residual (one "I R" cell when they coincide). Purely a picture: the same facts are given in
 * words by `label`, which screen readers get instead of the grid.
 */
export function MiniMatrix({ scale, inherent, residual, label }: { scale: Scale; inherent: Position | null; residual: Position | null; label: string }) {
  const rows = [...scale.likelihood_levels].sort((a, b) => b.value - a.value);
  const cols = scale.impact_levels;
  const at = (p: Position | null, l: number, i: number) => p !== null && p.likelihood === l && p.impact === i;
  return (
    <figure className="rk-mini" role="img" aria-label={label}>
      <div className="rk-mini-grid" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }} aria-hidden="true">
        {rows.flatMap((l) => cols.map((i) => {
          const rating = ratingFor(scale, l.value, i.value);
          const isI = at(inherent, l.value, i.value);
          const isR = at(residual, l.value, i.value);
          return (
            <span
              key={`${l.value}.${i.value}`}
              className={`rk-mini-cell${isI || isR ? ' is-marked' : ''}${isR ? ' is-residual' : ''}`}
              style={{ background: `var(--c-${rating?.color ?? 'gray'}-bg)`, color: `var(--c-${rating?.color ?? 'gray'}-fg)` }}
              title={`${l.label} by ${i.label}: ${rating?.label ?? 'not rated'}`}
            >
              {isI && isR ? 'I·R' : isI ? 'I' : isR ? 'R' : ''}
            </span>
          );
        }))}
      </div>
      <figcaption className="rk-mini-caption" aria-hidden="true">
        <span>{scale.likelihood_label} ↑</span>
        <span>{scale.impact_label} →</span>
      </figcaption>
    </figure>
  );
}

/** Whole days from today (organisation time zone) to a `YYYY-MM-DD` date; negative when past. */
export function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - Date.parse(`${todayInZone()}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "in 12 days", "today", "3 days ago": a date as a distance, for due dates and expiries. */
export function dayDistance(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${plural(days, 'day')}` : `${plural(-days, 'day')} ago`;
}

/**
 * A due date as a countdown chip: red once past ("Overdue by 3 days"), amber inside the warning
 * window, green beyond it. `done` shows a quiet grey chip instead.
 */
export function DueChip({ date, warnDays = 14, done, overdueWord = 'Overdue by' }: { date: string | null | undefined; warnDays?: number; done?: boolean; overdueWord?: string }) {
  const days = daysUntil(date);
  if (days === null) return <span className="muted">No date</span>;
  if (done) return <Badge color="gray">Done</Badge>;
  if (days < 0) return <Badge color="red">{overdueWord} {plural(-days, 'day')}</Badge>;
  if (days === 0) return <Badge color="amber">Due today</Badge>;
  return <Badge color={days <= warnDays ? 'amber' : 'green'}>{plural(days, 'day')} left</Badge>;
}
