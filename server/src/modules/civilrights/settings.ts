// Complaint time limits and reminders. Each organization sets its own: the defaults are a starting
// point, not any jurisdiction's deadline. Each limit is counted in calendar days or in working days
// (E46-61): working days are those of the organization's working calendar (core/working-days.ts, the
// same calendar records requests count on: the business-hours calendar's open weekdays less its
// holidays; Monday to Friday when there is none). A change applies to complaints received from then
// on; dates already worked out stay as they were.
import type { FastifyInstance } from 'fastify';
import type { ModuleContext } from '../../core/module.ts';
import { dueAfter, workingCalendar, workingDaysBetween } from '../../core/working-days.ts';
import { daysBetween } from '../../../../shared/dates.ts';

export const SETTINGS = {
  ackDays: 'civilrights.ack_days',
  investigationDays: 'civilrights.investigation_days',
  appealDays: 'civilrights.appeal_days',
  reminderDays: 'civilrights.reminder_days',
  ackWorking: 'civilrights.ack_working_days',
  investigationWorking: 'civilrights.investigation_working_days',
  appealWorking: 'civilrights.appeal_working_days',
} as const;

export interface CivilRightsSettings {
  ackDays: number; investigationDays: number; appealDays: number; reminderDays: number;
  /** Whether each limit is counted in working days (true) or calendar days (false). */
  ackWorking: boolean; investigationWorking: boolean; appealWorking: boolean;
}

export const DEFAULTS: CivilRightsSettings = {
  ackDays: 10, investigationDays: 90, appealDays: 30, reminderDays: 7, ackWorking: false, investigationWorking: false, appealWorking: false,
};

/** The three limits: which days setting and which counting setting each uses. */
export const LIMITS = [
  { key: 'ack', days: 'ackDays', working: 'ackWorking' },
  { key: 'investigation', days: 'investigationDays', working: 'investigationWorking' },
  { key: 'appeal', days: 'appealDays', working: 'appealWorking' },
] as const;
export type LimitKey = typeof LIMITS[number]['key'];

const whole = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function readSettings(ctx: Pick<ModuleContext, 'settings'>): Promise<CivilRightsSettings> {
  const flag = async (key: string) => (await ctx.settings.get<unknown>(key, false)) === true;
  return {
    ackDays: whole(await ctx.settings.get(SETTINGS.ackDays, DEFAULTS.ackDays), DEFAULTS.ackDays, 1, 365),
    investigationDays: whole(await ctx.settings.get(SETTINGS.investigationDays, DEFAULTS.investigationDays), DEFAULTS.investigationDays, 1, 730),
    appealDays: whole(await ctx.settings.get(SETTINGS.appealDays, DEFAULTS.appealDays), DEFAULTS.appealDays, 1, 365),
    reminderDays: whole(await ctx.settings.get(SETTINGS.reminderDays, DEFAULTS.reminderDays), DEFAULTS.reminderDays, 0, 90),
    ackWorking: await flag(SETTINGS.ackWorking),
    investigationWorking: await flag(SETTINGS.investigationWorking),
    appealWorking: await flag(SETTINGS.appealWorking),
  };
}

/** The settings as the API shows them, with the working calendar by name and its number of holidays. */
export async function shownSettings(ctx: Pick<ModuleContext, 'settings' | 'app'>) {
  const s = await readSettings(ctx);
  const cal = await workingCalendar(ctx.app);
  return { ...s, workingCalendar: cal.name ?? null, holidays: cal.holidays.length };
}

/** Field errors for a settings change, keyed by the camelCase name; empty when it is fine. */
export function checkSettings(next: CivilRightsSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  const ok = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!ok(next.ackDays, 1, 365)) errors.ackDays = 'Give whole days from 1 to 365.';
  if (!ok(next.investigationDays, 1, 730)) errors.investigationDays = 'Give whole days from 1 to 730.';
  if (!ok(next.appealDays, 1, 365)) errors.appealDays = 'Give whole days from 1 to 365.';
  if (!ok(next.reminderDays, 0, 90)) errors.reminderDays = 'Give whole days from 0 to 90.';
  for (const l of LIMITS) if (typeof next[l.working] !== 'boolean') errors[l.working] = 'Send true (working days) or false (calendar days).';
  return errors;
}

/** The due date of one limit counted from a day, in working or calendar days by the settings. */
export async function limitDue(app: FastifyInstance, s: CivilRightsSettings, limit: LimitKey, from: string): Promise<string> {
  const l = LIMITS.find((x) => x.key === limit)!;
  return dueAfter(app, from, s[l.days], s[l.working]);
}

/** Days left until a due date: working days when the limit counts them, calendar days otherwise. */
export async function daysLeft(app: FastifyInstance, working: boolean, today: string, due: string): Promise<number> {
  return working ? workingDaysBetween(today, due, await workingCalendar(app)) : daysBetween(today, due);
}
