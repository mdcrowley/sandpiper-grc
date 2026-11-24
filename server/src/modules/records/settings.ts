// Records request and privacy settings. No jurisdiction's deadline is built in: every request kind is
// due 20 days after it was received unless the organization sets its own days.
import type { ModuleContext } from '../../core/module.ts';
import { addWorkingDays, MONDAY_TO_FRIDAY, workingCalendar, type WorkingCalendar } from '../../core/working-days.ts';

export const SETTINGS = {
  dueDays: 'records.request_due_days',
  businessDays: 'records.business_days',
  amber: 'records.clock_amber_fraction',
  reviewReminderDays: 'privacy.review_reminder_days',
} as const;

export const DEFAULT_DUE_DAYS: Record<string, number> = { '*': 20 };
export const DEFAULT_AMBER = 0.25;
export const DEFAULT_REVIEW_REMINDER_DAYS = 30;

export interface RecordsSettings {
  /** Days to answer, by request kind; `*` is every kind not named. */
  dueDays: Record<string, number>;
  /** Count working days on the organization's working calendar (core/working-days.ts) instead of calendar days. */
  businessDays: boolean;
  /** The organization's working calendar (the service desk's business-hours calendar, E40-10). */
  calendar: WorkingCalendar;
  /** The clock turns amber when this fraction of the time to answer remains. */
  amberFraction: number;
  /** Days before a privacy assessment's review date that its owner is reminded. */
  reviewReminderDays: number;
}

const wholeDays = (v: unknown, min: number, max: number): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** The due days as stored, cleaned: positive whole numbers by kind, with `*` always present. */
export function cleanDueDays(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^(\*|[a-z0-9_]{1,60})$/.test(k)) return null;
    const n = wholeDays(v, 1, 365);
    if (n === null) return null;
    out[k] = n;
  }
  if (out['*'] === undefined) out['*'] = DEFAULT_DUE_DAYS['*'];
  return out;
}

export async function readSettings(ctx: ModuleContext): Promise<RecordsSettings> {
  const due = cleanDueDays(await ctx.settings.get<unknown>(SETTINGS.dueDays, DEFAULT_DUE_DAYS)) ?? { ...DEFAULT_DUE_DAYS };
  const amber = Number(await ctx.settings.get<unknown>(SETTINGS.amber, DEFAULT_AMBER));
  return {
    dueDays: due,
    businessDays: (await ctx.settings.get<unknown>(SETTINGS.businessDays, false)) === true,
    calendar: await workingCalendar(ctx.app),
    amberFraction: Number.isFinite(amber) && amber > 0 && amber < 1 ? amber : DEFAULT_AMBER,
    reviewReminderDays: wholeDays(await ctx.settings.get<unknown>(SETTINGS.reviewReminderDays, DEFAULT_REVIEW_REMINDER_DAYS), 0, 365) ?? DEFAULT_REVIEW_REMINDER_DAYS,
  };
}

/**
 * `YYYY-MM-DD` plus whole days; with `business`, only working days count: the weekdays the
 * organization's working calendar is open, less its holidays (E40-10; Monday to Friday when no
 * calendar is given). The first day counted is the day after `from`.
 */
export function addDays(from: string, days: number, business: boolean, calendar: WorkingCalendar = MONDAY_TO_FRIDAY): string {
  if (business && days <= 0) return from;
  return addWorkingDays(from, days, calendar, business);
}

/** The settings as the API shows them: the working calendar by name only. */
export function shownSettings(s: RecordsSettings) {
  const { calendar, ...rest } = s;
  return { ...rest, workingCalendar: calendar.name ?? null, holidays: calendar.holidays.length };
}

/** The due date of a request of a kind received on a day, from the settings. */
export function dueDateFor(s: RecordsSettings, kind: string, receivedOn: string): string {
  const days = s.dueDays[kind] ?? s.dueDays['*'] ?? DEFAULT_DUE_DAYS['*'];
  return addDays(receivedOn, days, s.businessDays, s.calendar);
}
