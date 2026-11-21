// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings throughout; a day is a day in the organization's time zone.
import { displayDate, todayInZone } from '../../core/timezone.ts';

/** Kept here too for the vendor module's own callers; the one definition is in core (BW-08). */
export { displayDate };

const DAY = 86_400_000;

/** The calendar date in the organization's time zone at the given instant. */
export function localDate(now: Date = new Date()): string {
  return todayInZone(now);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Notice date = end date minus the notice period. No notice period recorded counts as zero days. */
export function noticeDate(endDate: string | null | undefined, noticeDays: number | null | undefined): string | null {
  if (!endDate) return null;
  return addDays(String(endDate).slice(0, 10), -(Number(noticeDays) || 0));
}
