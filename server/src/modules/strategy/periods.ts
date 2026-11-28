// Periods of measures and statistics: a year, a quarter or a month. Pure functions, no database.
//
// Years and quarters follow the organization's fiscal year (E46-58, `FiscalYear`, read by
// settings.ts). On the calendar year (the fiscal year starts in January) they are written YYYY and
// YYYY-Qn. On a fiscal year that starts in another month they are written FYYYYY and FYYYYY-Qn, so a
// period entered before the fiscal year was set keeps its calendar meaning for ever: a key always
// says which kind of year it is on. Months (YYYY-MM) are months either way.

export type Frequency = 'monthly' | 'quarterly' | 'yearly';
export const FREQUENCIES: Frequency[] = ['monthly', 'quarterly', 'yearly'];

/** The organization's fiscal year: the month it starts (1 = January, the calendar year), and which calendar year names it. */
export interface FiscalYear { startMonth: number; namedFor: 'end' | 'start' }
export const CALENDAR_YEAR: FiscalYear = { startMonth: 1, namedFor: 'end' };

const YEAR = /^(\d{4})$/;
const QUARTER = /^(\d{4})-?Q([1-4])$/i;
const FY_YEAR = /^FY\s*-?\s*(\d{4})$/i;
const FY_QUARTER = /^(?:FY\s*-?\s*(\d{4})\s*[-\s]?\s*Q([1-4])|Q([1-4])\s*[-\s]?\s*FY\s*-?\s*(\d{4}))$/i;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})/;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fiscal = (fy?: FiscalYear | null) => Boolean(fy && fy.startMonth > 1 && fy.startMonth <= 12);

/** The month a quarter (1 to 4) of a fiscal year begins, as calendar year and month. */
function quarterStart(fy: FiscalYear | null | undefined, year: number, quarter: number): { y: number; m: number } {
  if (!fiscal(fy)) return { y: year, m: (quarter - 1) * 3 + 1 };
  // The calendar year the fiscal year starts in.
  const first = fy!.namedFor === 'start' ? year : year - 1;
  const months = fy!.startMonth - 1 + (quarter - 1) * 3; // months after January of `first`
  return { y: first + Math.floor(months / 12), m: (months % 12) + 1 };
}

/** The fiscal year (its name) and quarter a calendar month falls in. */
function fiscalOf(fy: FiscalYear | null | undefined, y: number, m: number): { year: number; quarter: number } {
  if (!fiscal(fy)) return { year: y, quarter: Math.floor((m - 1) / 3) + 1 };
  const first = m >= fy!.startMonth ? y : y - 1;
  return { year: fy!.namedFor === 'start' ? first : first + 1, quarter: Math.floor(((m - fy!.startMonth + 12) % 12) / 3) + 1 };
}

const yearKey = (fy: FiscalYear | null | undefined, year: number) => (fiscal(fy) ? `FY${year}` : String(year));
const quarterKey = (fy: FiscalYear | null | undefined, year: number, q: number) => (fiscal(fy) ? `FY${year}-Q${q}` : `${year}-Q${q}`);

/** The kind of a period key, or null when it is not one. */
export function frequencyOf(period: string): Frequency | null {
  if (YEAR.test(period) || FY_YEAR.test(period)) return 'yearly';
  if (QUARTER.test(period) || FY_QUARTER.test(period)) return 'quarterly';
  if (MONTH.test(period)) return 'monthly';
  return null;
}

/** True for a period key written on a fiscal year (FY...). */
export const isFiscalKey = (period: string) => /^FY/i.test(period);

/**
 * The period of the given frequency that `value` names, on the organization's fiscal year: a year
 * or quarter as written ("2026-q1", "FY2027 Q1", "Q1 FY2027"; on a fiscal year a plain "2027-Q1" is
 * that fiscal year's quarter), or a date or month inside it. null when it is not one.
 */
export function normalizePeriod(frequency: string, value: unknown, fy?: FiscalYear | null): string | null {
  const v = String(value ?? '').trim();
  const fq = FY_QUARTER.exec(v);
  const q = QUARTER.exec(v);
  const fyy = FY_YEAR.exec(v);
  if (fq || q) {
    if (frequency !== 'quarterly') return null;
    const year = Number(fq ? fq[1] ?? fq[4] : q![1]); const n = Number(fq ? fq[2] ?? fq[3] : q![2]);
    return quarterKey(fy, year, n);
  }
  if (fyy || YEAR.test(v)) return frequency === 'yearly' ? yearKey(fy, Number(fyy ? fyy[1] : v)) : null;
  const d = MONTH.exec(v) ?? DAY.exec(v);
  if (!d) return null;
  const y = Number(d[1]); const m = Number(d[2]);
  if (frequency === 'monthly') return `${y}-${pad(m)}`;
  const f = fiscalOf(fy, y, m);
  if (frequency === 'yearly') return yearKey(fy, f.year);
  if (frequency === 'quarterly') return quarterKey(fy, f.year, f.quarter);
  return null;
}

const span = (from: { y: number; m: number }, months: number) => {
  const endMonths = from.m - 1 + months - 1;
  const ey = from.y + Math.floor(endMonths / 12); const em = (endMonths % 12) + 1;
  return { start: `${from.y}-${pad(from.m)}-01`, end: `${ey}-${pad(em)}-${pad(lastDay(ey, em))}` };
};

/** First and last day of a period. Keys without FY are calendar periods; FY keys follow `fy`. */
export function periodRange(period: string, fy?: FiscalYear | null): { start: string; end: string } | null {
  let r = YEAR.exec(period);
  if (r) return { start: `${r[1]}-01-01`, end: `${r[1]}-12-31` };
  r = QUARTER.exec(period);
  if (r) return span(quarterStart(null, Number(r[1]), Number(r[2])), 3);
  r = MONTH.exec(period);
  if (r) return { start: `${r[1]}-${r[2]}-01`, end: `${r[1]}-${r[2]}-${pad(lastDay(Number(r[1]), Number(r[2])))}` };
  const fyFor = fiscal(fy) ? fy : CALENDAR_YEAR;
  r = FY_YEAR.exec(period);
  if (r) return span(quarterStart(fyFor, Number(r[1]), 1), 12);
  r = FY_QUARTER.exec(period);
  if (r) return span(quarterStart(fyFor, Number(r[1] ?? r[4]), Number(r[2] ?? r[3])), 3);
  return null;
}

/** The quarter a date falls in, on the fiscal year. */
export const quarterOf = (date: string, fy?: FiscalYear | null): string => normalizePeriod('quarterly', date.slice(0, 10), fy)!;

/** The quarters (on the fiscal year) between two dates, at most 40. */
export function quartersBetween(from: string, to: string, fy?: FiscalYear | null): string[] {
  const out: string[] = [];
  const end = quarterOf(to, fy);
  let key = quarterOf(from, fy);
  for (let i = 0; i < 40; i++) {
    out.push(key);
    if (key === end) break;
    key = quarterOf(addOneDay(periodRange(key, fy)!.end), fy);
  }
  return out;
}

/** The years (on the fiscal year) between two dates, at most 20. */
export function yearsBetween(from: string, to: string, fy?: FiscalYear | null): string[] {
  const out: string[] = [];
  const end = normalizePeriod('yearly', to.slice(0, 10), fy)!;
  let key = normalizePeriod('yearly', from.slice(0, 10), fy)!;
  for (let i = 0; i < 20; i++) {
    out.push(key);
    if (key === end) break;
    key = normalizePeriod('yearly', addOneDay(periodRange(key, fy)!.end), fy)!;
  }
  return out;
}

/** The quarters of a year key (YYYY or FYYYYY). */
export function quartersOf(year: string): string[] {
  return [1, 2, 3, 4].map((q) => `${year}-Q${q}`);
}

function addOneDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

/** "2026 Q1", "FY2027 Q1", "March 2026", "2026", "FY2027". */
export function periodLabel(period: string): string {
  const fq = FY_QUARTER.exec(period);
  if (fq) return `FY${fq[1] ?? fq[4]} Q${fq[2] ?? fq[3]}`;
  const fyy = FY_YEAR.exec(period);
  if (fyy) return `FY${fyy[1]}`;
  const q = QUARTER.exec(period);
  if (q) return `${q[1]} Q${q[2]}`;
  const m = MONTH.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}

/** The months a quarter or year covers, in words: "July to September 2026", "July 2026 to June 2027". */
export function periodSpan(period: string, fy?: FiscalYear | null): string | null {
  const r = periodRange(period, fy);
  if (!r || MONTH.test(period)) return null;
  const sy = r.start.slice(0, 4); const ey = r.end.slice(0, 4);
  const sm = MONTHS[Number(r.start.slice(5, 7)) - 1]; const em = MONTHS[Number(r.end.slice(5, 7)) - 1];
  return sy === ey ? `${sm} to ${em} ${ey}` : `${sm} ${sy} to ${em} ${ey}`;
}

/** The fiscal year in words, for settings and help: "July to June, named after the year it ends in". */
export function describeFiscalYear(fy: FiscalYear): string {
  if (!fiscal(fy)) return 'The calendar year, January to December.';
  const before = MONTHS[(fy.startMonth + 10) % 12];
  const now = Number(new Date().toISOString().slice(0, 4));
  const key = yearKey(fy, now + 1);
  return `${MONTHS[fy.startMonth - 1]} to ${before}, named after the calendar year it ${fy.namedFor === 'start' ? 'starts' : 'ends'} in: ${periodLabel(key)} runs ${periodSpan(key, fy)}, and its Q1 is ${periodSpan(`${key}-Q1`, fy)}.`;
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
