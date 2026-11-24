// Calendar arithmetic for the compliance calendar (E41-03), on `YYYY-MM-DD` strings.
import { addDays, addMonths, daysBetween, monthEndOf, monthStartOf, weekdayOf } from '../../../../shared/dates.ts';

export { addDays, addMonths, monthEndOf, monthStartOf };

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The Monday on or before a day. */
export function weekStart(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

/** The days of a month grid: whole weeks from the Monday on or before the 1st to the Sunday on or after the last day. */
export function monthGrid(day: string): string[] {
  const first = weekStart(monthStartOf(day));
  const lastDay = monthEndOf(day);
  const last = addDays(weekStart(lastDay), 6);
  return Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => addDays(first, i));
}

/** "November 2026". */
export function monthLabel(day: string): string {
  return new Date(`${monthStartOf(day)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The day an item falls on: its date, or the date part of its time. */
export const dayOfItem = (start: string): string => start.slice(0, 10);
