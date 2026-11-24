// Portfolio scoring of projects (E40-12): the one rule, used by the server when it saves a project's
// priority score (server/src/modules/projects/rules.ts) and by the web page's preview
// (web/src/modules/projects/ScoringTab.tsx), so the preview is always what will be saved.

/** Each criterion is scored from 0 to this. */
export const MAX_SCORE = 5;

export interface ScoringCriterion { key: string; label?: string; weight: number }

export interface ScoreLine<C extends ScoringCriterion = ScoringCriterion> {
  criterion: C;
  /** The score as counted (a whole number from 0 to the maximum), or null when not scored. */
  score: number | null;
  /** The criterion's share of 100, from its weight (0 for a weight of 0 or less). */
  share: number;
  /** Points it contributes out of 100. */
  points: number;
}

/**
 * The scoring worked out line by line, and the weighted result from 0 to 100 (one decimal), or null
 * when nothing with a weight has been scored. A missing, null or empty score is "not scored" and
 * counts as zero toward the result; a score is clamped to 0..max; keys that are no longer criteria
 * are ignored; criteria with no positive weight count for nothing.
 */
export function scoreProject<C extends ScoringCriterion>(
  scoring: Record<string, unknown> | null | undefined, criteria: C[], maxScore: number = MAX_SCORE,
): { lines: ScoreLine<C>[]; totalWeight: number; result: number | null } {
  const scores = scoring && typeof scoring === 'object' ? scoring : {};
  const totalWeight = criteria.reduce((n, c) => n + (Number(c.weight) > 0 ? Number(c.weight) : 0), 0);
  let scored = 0;
  let sum = 0;
  const lines = criteria.map((c) => {
    const weight = Number(c.weight) > 0 ? Number(c.weight) : 0;
    const raw = (scores as Record<string, unknown>)[c.key];
    const has = raw !== null && raw !== undefined && raw !== '';
    const score = has ? Math.min(maxScore, Math.max(0, Number(raw) || 0)) : null;
    const share = totalWeight && weight ? (weight / totalWeight) * 100 : 0;
    if (score !== null && weight) {
      scored += 1;
      sum += weight * (score / maxScore);
    }
    return { criterion: c, score, share, points: score !== null ? share * (score / maxScore) : 0 };
  });
  const result = scored && totalWeight && scoring && typeof scoring === 'object' ? Math.round((sum / totalWeight) * 1000) / 10 : null;
  return { lines, totalWeight, result };
}
