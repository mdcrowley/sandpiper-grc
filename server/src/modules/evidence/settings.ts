// The evidence library's one setting (Administration > Reminders): how many days before an evidence
// record's "valid until" date its owner is reminded. The largest step is also how far ahead evidence
// counts as "expiring" in lists and figures.
import type { ModuleContext } from '../../core/module.ts';

export const REMINDER_SETTING = 'evidence.reminder_days';
export const DEFAULT_REMINDER_STEPS = [30, 7, 0];

export async function reminderSteps(ctx: ModuleContext): Promise<number[]> {
  const raw = await ctx.settings.get<unknown>(REMINDER_SETTING, DEFAULT_REMINDER_STEPS);
  const list = (Array.isArray(raw) ? raw : [raw]).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
  const steps = [...new Set(list)].sort((a, b) => b - a);
  return steps.length ? steps : DEFAULT_REMINDER_STEPS;
}

/** How many days ahead evidence counts as expiring. */
export const expiringDays = async (ctx: ModuleContext) => Math.max(1, ...(await reminderSteps(ctx)));
