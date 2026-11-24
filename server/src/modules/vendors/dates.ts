// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings throughout; a day is a day in the organization's time zone.
import { displayDate, todayInZone } from '../../core/timezone.ts';
import { addDays, daysBetween } from '../../../../shared/dates.ts';
export { addDays, daysBetween }; // one copy for every module (E40-12)

/** Kept here too for the vendor module's own callers; the one definition is in core (BW-08). */
export { displayDate };

/** The calendar date in the organization's time zone at the given instant. */
export function localDate(now: Date = new Date()): string {
  return todayInZone(now);
}

/** Notice date = end date minus the notice period. No notice period recorded counts as zero days. */
export function noticeDate(endDate: string | null | undefined, noticeDays: number | null | undefined): string | null {
  if (!endDate) return null;
  return addDays(String(endDate).slice(0, 10), -(Number(noticeDays) || 0));
}
