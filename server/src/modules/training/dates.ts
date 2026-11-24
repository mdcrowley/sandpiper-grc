// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; a day is a day in the organization's time zone.
import { todayInZone } from '../../core/timezone.ts';
import { addDays, addMonths } from '../../../../shared/dates.ts';
export { addDays, addMonths }; // one copy for every module (E40-12)

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function localDate(now: Date = new Date()): string {
  return todayInZone(now);
}

/** Last day of the month that `date` falls in. */
export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export const text = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
