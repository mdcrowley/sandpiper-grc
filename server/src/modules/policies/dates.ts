// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; a day is a day in the organization's time zone.
import { todayInZone } from '../../core/timezone.ts';
import { addDays, daysBetween } from '../../../../shared/dates.ts';
export { addDays, daysBetween }; // one copy for every module (E40-12)

export const localDate = (now: Date = new Date()): string => todayInZone(now);

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
