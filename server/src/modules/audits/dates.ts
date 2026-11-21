// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; a day is a day in the organization's time zone.
const DAY = 86_400_000;

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Adds calendar months; the 31st plus one month lands on the last day of the next month. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** The first day of the month after the one that starts on `monthStart`. */
export const nextMonthStart = (monthStart: string) => addMonths(monthStart.slice(0, 7) + '-01', 1);

/** The next due date after `from` for a frequency value's meta (`{ days }` or `{ months }`). */
export function advance(from: string, meta: Record<string, unknown> | undefined): string {
  const days = Number(meta?.days);
  if (Number.isFinite(days) && days > 0) return addDays(from, Math.round(days));
  const months = Number(meta?.months);
  return addMonths(from, Number.isFinite(months) && months > 0 ? Math.round(months) : 1);
}
