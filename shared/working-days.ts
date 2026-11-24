// Working-day arithmetic (E40-10): the one definition of a "working day" for every deadline counted
// in days. The calendar itself (which weekdays are worked, and the holidays) is the organization's
// business-hours calendar kept under Service desk > Settings > Calendars; the server reads it with
// `workingCalendar()` in server/src/core/working-days.ts. These functions are pure, so the web
// application and the mobile app can show the same dates.
import { addDays, weekdayOf, ymdOf } from './dates.ts';

export interface WorkingCalendar {
  /** Days of the week that are worked: 0 = Sunday ... 6 = Saturday. */
  weekdays: number[];
  /** Days that are not worked although their weekday is, as `YYYY-MM-DD`. */
  holidays: string[];
  /** Where the calendar came from, for people: its name, or a note that the default is used. */
  name?: string;
}

/** Monday to Friday with no holidays: used when the organization has no calendar to read. */
export const MONDAY_TO_FRIDAY: WorkingCalendar = { weekdays: [1, 2, 3, 4, 5], holidays: [], name: 'Monday to Friday' };

const holidaySet = new WeakMap<WorkingCalendar, Set<string>>();
function holidaysOf(cal: WorkingCalendar): Set<string> {
  let s = holidaySet.get(cal);
  if (!s) { s = new Set(cal.holidays.map(ymdOf)); holidaySet.set(cal, s); }
  return s;
}

/** Whether a day is a working day on the calendar. A calendar with no working weekday counts every day. */
export function isWorkingDay(date: string, cal: WorkingCalendar = MONDAY_TO_FRIDAY): boolean {
  if (!cal.weekdays.length) return true;
  return cal.weekdays.includes(weekdayOf(date)) && !holidaysOf(cal).has(ymdOf(date));
}

/**
 * `from` plus a number of working days: the first day counted is the day after `from` (a request
 * received on a Friday with 1 working day is due on Monday). Zero answers `from` itself; a negative
 * number counts back. With `working` false, plain calendar days are added.
 */
export function addWorkingDays(from: string, days: number, cal: WorkingCalendar = MONDAY_TO_FRIDAY, working = true): string {
  const n = Math.round(days);
  if (!working) return addDays(from, n);
  const step = n < 0 ? -1 : 1;
  let left = Math.abs(n);
  let d = ymdOf(from);
  // At most ten years of searching, so a calendar with every day a holiday cannot loop for ever.
  for (let guard = 0; left > 0 && guard < 3660; guard += 1) {
    d = addDays(d, step);
    if (isWorkingDay(d, cal)) left -= 1;
  }
  return d;
}

/** Working days after `from` up to and including `to` (negative when `to` is earlier). */
export function workingDaysBetween(from: string, to: string, cal: WorkingCalendar = MONDAY_TO_FRIDAY): number {
  const a = ymdOf(from);
  const b = ymdOf(to);
  if (a === b) return 0;
  const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
  let n = 0;
  for (let d = addDays(lo, 1), guard = 0; d <= hi && guard < 36600; d = addDays(d, 1), guard += 1) if (isWorkingDay(d, cal)) n += 1;
  return n * sign;
}
