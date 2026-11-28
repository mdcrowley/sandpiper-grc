// The insurance area's settings: when owners are reminded. Changed on Insurance > Settings (and, once
// listed there, under Administration > Reminders); read with the same fallbacks everywhere.
import type { ModuleContext } from '../../core/module.ts';

export const SETTINGS = {
  renewal: { key: 'insurance.renewal_reminder_days', default: [90, 60, 30], label: 'Remind policy owners before a policy expires', max: 365 },
  application: { key: 'insurance.application_reminder_days', default: [14, 3, 0], label: 'Remind policy owners before the renewal application is due', max: 180 },
  certificate: { key: 'insurance.certificate_reminder_days', default: [30, 0], label: 'Remind certificate owners before a certificate of insurance expires', max: 180 },
} as const;
export type SettingName = keyof typeof SETTINGS;

/** Days before the date, largest first, from 0 to the setting's maximum; the default when nothing usable is stored. */
export function cleanSteps(raw: unknown, max: number): number[] {
  const list = (Array.isArray(raw) ? raw : [raw]).map((n) => Math.round(Number(n))).filter((n) => Number.isFinite(n) && n >= 0 && n <= max);
  return [...new Set(list)].sort((a, b) => b - a);
}

export async function stepsOf(ctx: ModuleContext, name: SettingName): Promise<number[]> {
  const s = SETTINGS[name];
  const steps = cleanSteps(await ctx.settings.get<unknown>(s.key, s.default), s.max);
  return steps.length ? steps : [...s.default];
}

/** How far ahead a policy counts as "expiring soon" in the figures (fixed, so figures compare month to month). */
export const EXPIRING_DAYS = 90;
