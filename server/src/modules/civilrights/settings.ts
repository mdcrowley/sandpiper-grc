// Complaint time limits and reminders. Each organization sets its own: the defaults are a starting
// point, not any jurisdiction's deadline. A change applies to complaints received from then on; dates
// already worked out stay as they were.
import type { ModuleContext } from '../../core/module.ts';

export const SETTINGS = {
  ackDays: 'civilrights.ack_days',
  investigationDays: 'civilrights.investigation_days',
  appealDays: 'civilrights.appeal_days',
  reminderDays: 'civilrights.reminder_days',
} as const;

export interface CivilRightsSettings { ackDays: number; investigationDays: number; appealDays: number; reminderDays: number }

export const DEFAULTS: CivilRightsSettings = { ackDays: 10, investigationDays: 90, appealDays: 30, reminderDays: 7 };

const whole = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function readSettings(ctx: Pick<ModuleContext, 'settings'>): Promise<CivilRightsSettings> {
  return {
    ackDays: whole(await ctx.settings.get(SETTINGS.ackDays, DEFAULTS.ackDays), DEFAULTS.ackDays, 1, 365),
    investigationDays: whole(await ctx.settings.get(SETTINGS.investigationDays, DEFAULTS.investigationDays), DEFAULTS.investigationDays, 1, 730),
    appealDays: whole(await ctx.settings.get(SETTINGS.appealDays, DEFAULTS.appealDays), DEFAULTS.appealDays, 1, 365),
    reminderDays: whole(await ctx.settings.get(SETTINGS.reminderDays, DEFAULTS.reminderDays), DEFAULTS.reminderDays, 0, 90),
  };
}

/** Field errors for a settings change, keyed by the camelCase name; empty when it is fine. */
export function checkSettings(next: CivilRightsSettings): Record<string, string> {
  const errors: Record<string, string> = {};
  const ok = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
  if (!ok(next.ackDays, 1, 365)) errors.ackDays = 'Give whole days from 1 to 365.';
  if (!ok(next.investigationDays, 1, 730)) errors.investigationDays = 'Give whole days from 1 to 730.';
  if (!ok(next.appealDays, 1, 365)) errors.appealDays = 'Give whole days from 1 to 365.';
  if (!ok(next.reminderDays, 0, 90)) errors.reminderDays = 'Give whole days from 0 to 90.';
  return errors;
}
