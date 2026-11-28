// The strategy area's settings (Strategy > Settings, strategy.administer), and the organization's
// fiscal year (E46-58): the month it starts and which calendar year names it. The fiscal year is an
// organization setting (`organization.fiscal_year_*`), so other areas can follow it too.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { CALENDAR_YEAR, describeFiscalYear, type FiscalYear } from './periods.ts';

export const REMINDER_KEY = 'strategy.submission_reminder_days';
export const DUE_SOON_KEY = 'strategy.due_soon_days';
export const FY_START_KEY = 'organization.fiscal_year_start_month';
export const FY_NAMED_KEY = 'organization.fiscal_year_named_for';
export const DEFAULT_REMINDER_DAYS = [30, 7, 0];
export const DEFAULT_DUE_SOON_DAYS = 30;

const steps = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 365).sort((a, b) => b - a);
  return out.length === v.length && out.length > 0 && out.length <= 6 ? out : null;
};

/** The organization's fiscal year; the calendar year until it is set. */
export async function readFiscalYear(ctx: Pick<ModuleContext, 'settings'>): Promise<FiscalYear> {
  const start = Number(await ctx.settings.get<unknown>(FY_START_KEY, 1));
  const named = await ctx.settings.get<unknown>(FY_NAMED_KEY, 'end');
  return Number.isInteger(start) && start >= 1 && start <= 12 ? { startMonth: start, namedFor: named === 'start' ? 'start' : 'end' } : CALENDAR_YEAR;
}

/** Values, statistics and updates kept on fiscal periods (FY keys): while there are any, the fiscal year cannot change under them. */
async function fiscalPeriodsInUse(ctx: ModuleContext): Promise<number> {
  const r = await ctx.db.one<Row>(
    `select (select count(*) from strategy_measure_values where deleted_at is null and period like 'FY%')
          + (select count(*) from strategy_stat_values where deleted_at is null and period like 'FY%')
          + (select count(*) from strategy_updates where deleted_at is null and period like 'FY%') as n`);
  return Number(r?.n ?? 0);
}

export async function readSettings(ctx: ModuleContext) {
  const reminder = steps(await ctx.settings.get<unknown>(REMINDER_KEY, DEFAULT_REMINDER_DAYS)) ?? DEFAULT_REMINDER_DAYS;
  const soon = Number(await ctx.settings.get<unknown>(DUE_SOON_KEY, DEFAULT_DUE_SOON_DAYS));
  const fy = await readFiscalYear(ctx);
  return {
    submission_reminder_days: reminder, due_soon_days: Number.isInteger(soon) && soon >= 1 && soon <= 365 ? soon : DEFAULT_DUE_SOON_DAYS,
    fiscal_year_start_month: fy.startMonth, fiscal_year_named_for: fy.namedFor, fiscal_year_text: describeFiscalYear(fy),
    fiscal_periods_in_use: await fiscalPeriodsInUse(ctx),
  };
}

export async function writeSettings(ctx: ModuleContext, req: FastifyRequest, body: Row) {
  const errors: Record<string, string> = {};
  const s = body.submission_reminder_days === undefined ? undefined : steps(body.submission_reminder_days);
  if (s === null) errors.submission_reminder_days = 'Give one to six whole numbers of days from 0 to 365, each once.';
  const n = body.due_soon_days === undefined ? undefined : Number(body.due_soon_days);
  if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 365)) errors.due_soon_days = 'Give a whole number of days from 1 to 365.';
  const start = body.fiscal_year_start_month === undefined ? undefined : Number(body.fiscal_year_start_month);
  if (start !== undefined && !(Number.isInteger(start) && start >= 1 && start <= 12)) errors.fiscal_year_start_month = 'Choose the month the fiscal year starts.';
  const named = body.fiscal_year_named_for;
  if (named !== undefined && named !== 'end' && named !== 'start') errors.fiscal_year_named_for = 'Choose the year it ends in or the year it starts in.';
  const before = await readFiscalYear(ctx);
  const after: FiscalYear = { startMonth: start ?? before.startMonth, namedFor: (named as FiscalYear['namedFor'] | undefined) ?? before.namedFor };
  // A start in January is the calendar year, whichever year names it.
  const same = after.startMonth === before.startMonth && (after.startMonth === 1 || after.namedFor === before.namedFor);
  if (!same && !errors.fiscal_year_start_month) {
    const used = await fiscalPeriodsInUse(ctx);
    if (used) {
      errors[start !== undefined && start !== before.startMonth ? 'fiscal_year_start_month' : 'fiscal_year_named_for']
        = `Measure values, statistics or updates (${used}) are kept on periods of the current fiscal year, so it cannot change under them. Periods entered on the calendar year are never affected.`;
    }
  }
  if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
  if (s) await ctx.settings.set(REMINDER_KEY, s, req);
  if (n !== undefined) await ctx.settings.set(DUE_SOON_KEY, n, req);
  if (start !== undefined && start !== before.startMonth) await ctx.settings.set(FY_START_KEY, start, req);
  if (named !== undefined && named !== before.namedFor) await ctx.settings.set(FY_NAMED_KEY, named, req);
  return readSettings(ctx);
}
