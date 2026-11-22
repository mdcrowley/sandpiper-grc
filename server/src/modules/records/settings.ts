// Records request and privacy settings. No jurisdiction's deadline is built in: every request kind is
// due 20 days after it was received unless the organization sets its own days.
import type { ModuleContext } from '../../core/module.ts';

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
  /** Count working days (Monday to Friday) instead of calendar days. */
  businessDays: boolean;
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
    amberFraction: Number.isFinite(amber) && amber > 0 && amber < 1 ? amber : DEFAULT_AMBER,
    reviewReminderDays: wholeDays(await ctx.settings.get<unknown>(SETTINGS.reviewReminderDays, DEFAULT_REVIEW_REMINDER_DAYS), 0, 365) ?? DEFAULT_REVIEW_REMINDER_DAYS,
  };
}

/** `YYYY-MM-DD` plus whole days; with `business`, only Monday to Friday count (weekends are skipped, nothing else). */
export function addDays(from: string, days: number, business: boolean): string {
  const d = new Date(`${from}T00:00:00Z`);
  if (!business) {
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return d.toISOString().slice(0, 10);
}

/** The due date of a request of a kind received on a day, from the settings. */
export function dueDateFor(s: RecordsSettings, kind: string, receivedOn: string): string {
  const days = s.dueDays[kind] ?? s.dueDays['*'] ?? DEFAULT_DUE_DAYS['*'];
  return addDays(receivedOn, days, s.businessDays);
}
