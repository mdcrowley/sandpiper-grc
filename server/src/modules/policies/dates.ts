// Calendar-date helpers. Dates are 'YYYY-MM-DD' strings; a day is a day in the organization's time zone.
import { todayInZone } from '../../core/timezone.ts';

const DAY = 86_400_000;

export const localDate = (now: Date = new Date()): string => todayInZone(now);

export const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

export const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
