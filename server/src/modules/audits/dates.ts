// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; a day is a day in the organization's time zone.
import { addDays, addMonths } from '../../../../shared/dates.ts';
export { addDays, addMonths }; // one copy for every module (E40-12)

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));

/** The first day of the month after the one that starts on `monthStart`. */
export const nextMonthStart = (monthStart: string) => addMonths(monthStart.slice(0, 7) + '-01', 1);

/** The next due date after `from` for a frequency value's meta (`{ days }` or `{ months }`). */
export function advance(from: string, meta: Record<string, unknown> | undefined): string {
  const days = Number(meta?.days);
  if (Number.isFinite(days) && days > 0) return addDays(from, Math.round(days));
  const months = Number(meta?.months);
  return addMonths(from, Number.isFinite(months) && months > 0 ? Math.round(months) : 1);
}
