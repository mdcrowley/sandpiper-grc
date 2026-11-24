// Calendar-date arithmetic on `YYYY-MM-DD` strings, used by the server, the web application and the
// mobile app (E40-12). One copy, tested once: every module imports these instead of its own.
// Dates are calendar days with no time zone: build "today" in the organization's zone first
// (`todayInZone()` on the server, `todayInZone()` in web/src/core) and then do arithmetic here.

const DAY_MS = 86_400_000;

/** The `YYYY-MM-DD` part of a date or timestamp string. */
export const ymdOf = (date: string): string => date.slice(0, 10);

/** Whether a value is a real calendar date written `YYYY-MM-DD` (2026-02-30 is not). */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** `date` moved by whole days (negative goes back); a timestamp is read as its date part. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${ymdOf(date)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d.toISOString().slice(0, 10);
}

/** `date` moved by whole weeks. */
export const addWeeks = (date: string, weeks: number): string => addDays(date, weeks * 7);

/**
 * `date` moved by whole calendar months. A day that the target month does not have becomes that
 * month's last day: 31 January plus one month is 28 (or 29) February.
 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = ymdOf(date).split('-').map(Number);
  const total = y * 12 + (m - 1) + Math.round(months);
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** `date` moved by whole years; 29 February becomes 28 February in a common year. */
export const addYears = (date: string, years: number): string => addMonths(date, Math.round(years) * 12);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${ymdOf(to)}T00:00:00Z`) - Date.parse(`${ymdOf(from)}T00:00:00Z`)) / DAY_MS);
}

/** Day of the week of a date: 0 = Sunday ... 6 = Saturday. */
export const weekdayOf = (date: string): number => new Date(`${ymdOf(date)}T00:00:00Z`).getUTCDay();

/** The first day of the month `date` falls in. */
export const monthStartOf = (date: string): string => `${ymdOf(date).slice(0, 7)}-01`;

/** The last day of the month `date` falls in. */
export function monthEndOf(date: string): string {
  const [y, m] = ymdOf(date).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * An instant moved by whole calendar months in UTC, keeping its time of day, with the same
 * month-end rule as `addMonths` (for recurring windows stored as timestamps).
 */
export function addMonthsToInstant(at: Date, months: number): Date {
  const out = new Date(at);
  const day = out.getUTCDate();
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + Math.round(months));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, last));
  return out;
}
