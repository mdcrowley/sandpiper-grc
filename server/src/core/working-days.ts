import type { FastifyInstance } from 'fastify';
import { addWorkingDays, MONDAY_TO_FRIDAY, type WorkingCalendar } from '../../../shared/working-days.ts';

// One working-day calendar for every deadline counted in working days (E40-10). The arithmetic is
// shared/working-days.ts; the calendar is the organization's business-hours calendar, which the
// service desk keeps (Service desk > Settings > Calendars, the calendar with the key `business`:
// its open weekdays and its holidays). The tickets module offers it here with
// `setWorkingCalendarSource` in `register`, so a module that counts working days (records requests)
// never reads the service desk's tables. The source answers whether or not the service desk area is
// switched on (a deadline must not move because a part was switched off); with the tickets module
// not loaded at all, or the business calendar retired, Monday to Friday with no holidays is used.

export type { WorkingCalendar } from '../../../shared/working-days.ts';
export { addWorkingDays, isWorkingDay, workingDaysBetween, MONDAY_TO_FRIDAY } from '../../../shared/working-days.ts';

/** The calendar key the organization's working days are read from. */
export const WORKING_CALENDAR_KEY = 'business';

type Source = () => Promise<WorkingCalendar | null>;
const sources = new WeakMap<FastifyInstance, Source>();

/** Called once by the module that keeps the calendars (tickets). */
export function setWorkingCalendarSource(app: FastifyInstance, source: Source): void {
  sources.set(app, source);
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * A stored calendar (opening hours per weekday, "open 24 hours, 7 days", holidays) as working days:
 * a weekday with opening hours is worked; a calendar open all the time works every day and ignores
 * holidays, as its service-level clocks do.
 */
export function toWorkingCalendar(cal: { name?: string; always_open: boolean; hours: Partial<Record<string, unknown>>; holidays: string[] }): WorkingCalendar {
  if (cal.always_open) return { weekdays: [0, 1, 2, 3, 4, 5, 6], holidays: [], name: cal.name };
  const weekdays = DAY_KEYS.flatMap((k, i) => {
    const h = cal.hours?.[k];
    return Array.isArray(h) && h.length === 2 && h[0] !== h[1] ? [i] : [];
  });
  // A calendar with no open weekday cannot count working days: fall back rather than never be due.
  return weekdays.length ? { weekdays, holidays: cal.holidays.map((d) => String(d).slice(0, 10)), name: cal.name } : { ...MONDAY_TO_FRIDAY, holidays: cal.holidays };
}

/** The organization's working calendar now (read each time, so a holiday added today counts at once). */
export async function workingCalendar(app: FastifyInstance): Promise<WorkingCalendar> {
  const source = sources.get(app);
  if (!source) return MONDAY_TO_FRIDAY;
  try {
    return (await source()) ?? MONDAY_TO_FRIDAY;
  } catch {
    return MONDAY_TO_FRIDAY;
  }
}

/** `from` plus `days`, in working days on the organization's calendar when `working` is true. */
export async function dueAfter(app: FastifyInstance, from: string, days: number, working: boolean): Promise<string> {
  return addWorkingDays(from, days, working ? await workingCalendar(app) : MONDAY_TO_FRIDAY, working);
}
