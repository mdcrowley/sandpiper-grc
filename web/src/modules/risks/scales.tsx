import { Badge, useFetch } from '../../core';
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
