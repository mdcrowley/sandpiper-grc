// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings throughout; a day is a day in the organization's time zone.
import { todayInZone } from '../../core/timezone.ts';

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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2 Oct 2030" for a 'YYYY-MM-DD' date, for text that people read (notifications). */
export function displayDate(date: string): string {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return MONTHS[m - 1] ? `${MONTHS[m - 1]} ${d}, ${y}` : String(date);
}

/** Notice date = end date minus the notice period. No notice period recorded counts as zero days. */
export function noticeDate(endDate: string | null | undefined, noticeDays: number | null | undefined): string | null {
  if (!endDate) return null;
  return addDays(String(endDate).slice(0, 10), -(Number(noticeDays) || 0));
}
