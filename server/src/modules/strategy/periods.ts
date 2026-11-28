// Periods of measures and statistics: a year (YYYY), a quarter (YYYY-Qn) or a month (YYYY-MM), on the
// calendar year. Pure functions, no database.

export type Frequency = 'monthly' | 'quarterly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'yearly'];

const YEAR = /^(\d{4})$/;
const QUARTER = /^(\d{4})-?Q([1-4])$/i;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})/;

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The kind of a period key, or null when it is not one. */
export function frequencyOf(period: string): Frequency | null {
  if (YEAR.test(period)) return 'yearly';
  if (QUARTER.test(period)) return 'quarterly';
  if (MONTH.test(period)) return 'monthly';
  return null;
}

/**
 * The period of the given frequency that `value` names: a period key of that frequency as written
 * ("2026-q1" becomes "2026-Q1"), or a date or month inside it. null when it is not one.
 */
export function normalizePeriod(frequency: string, value: unknown): string | null {
  const v = String(value ?? '').trim();
  let y: number; let m: number;
  const q = QUARTER.exec(v);
  if (YEAR.test(v)) {
    return frequency === 'yearly' ? v : null;
  } else if (q) {
    if (frequency === 'quarterly') return `${q[1]}-Q${q[2]}`;
    if (frequency === 'yearly') return null;
    return null;
  } else {
    const d = MONTH.exec(v) ?? DAY.exec(v);
    if (!d) return null;
    y = Number(d[1]); m = Number(d[2]);
  }
  if (frequency === 'yearly') return String(y);
  if (frequency === 'quarterly') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (frequency === 'monthly') return `${y}-${pad(m)}`;
  return null;
}

/** First and last day of a period. */
export function periodRange(period: string): { start: string; end: string } | null {
  let r = YEAR.exec(period);
  if (r) return { start: `${r[1]}-01-01`, end: `${r[1]}-12-31` };
  r = QUARTER.exec(period);
  if (r) {
    const y = Number(r[1]); const first = (Number(r[2]) - 1) * 3 + 1; const last = first + 2;
    return { start: `${y}-${pad(first)}-01`, end: `${y}-${pad(last)}-${pad(lastDay(y, last))}` };
  }
  r = MONTH.exec(period);
  if (r) return { start: `${r[1]}-${r[2]}-01`, end: `${r[1]}-${r[2]}-${pad(lastDay(Number(r[1]), Number(r[2])))}` };
  return null;
}

/** The quarter (YYYY-Qn) a date falls in. */
export const quarterOf = (date: string): string => normalizePeriod('quarterly', date.slice(0, 10))!;

/** The quarters of a year, or of the quarters between two dates (at most 40). */
export function quartersBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4)); let q = Math.floor((Number(from.slice(5, 7)) - 1) / 3) + 1;
  const end = quarterOf(to);
  for (let i = 0; i < 40; i++) {
    const key = `${y}-Q${q}`;
    out.push(key);
    if (key === end) break;
    q += 1; if (q > 4) { q = 1; y += 1; }
  }
  return out;
}

/** "2026 Q1", "March 2026", "2026". */
export function periodLabel(period: string): string {
  const q = QUARTER.exec(period);
  if (q) return `${q[1]} Q${q[2]}`;
  const m = MONTH.exec(period);
  if (m) return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

export type MeasureState = 'met' | 'near' | 'missed' | 'no_target';

/**
 * How an actual compares with its target. `increase`: at or above the target is met; `decrease`: at or
 * below; `maintain`: within the tolerance either way. Short of the target by no more than the tolerance
 * (a percentage of the target, 5 by default) is near.
 */
export function measureState(direction: string | null | undefined, target: number | null | undefined, actual: number | null | undefined, tolerancePct?: number | null): MeasureState | null {
  if (actual === null || actual === undefined || !Number.isFinite(Number(actual))) return null;
  if (target === null || target === undefined || !Number.isFinite(Number(target))) return 'no_target';
  const t = Number(target); const a = Number(actual);
  const tol = Math.abs(t) * (tolerancePct === null || tolerancePct === undefined || !Number.isFinite(Number(tolerancePct)) ? 5 : Number(tolerancePct)) / 100;
  if (direction === 'decrease') return a <= t ? 'met' : a - t <= tol ? 'near' : 'missed';
  if (direction === 'maintain') return Math.abs(a - t) <= tol ? 'met' : Math.abs(a - t) <= 2 * tol ? 'near' : 'missed';
  return a >= t ? 'met' : t - a <= tol ? 'near' : 'missed';
}
