// The strategy area's settings (Strategy > Settings, strategy.administer).
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';

export const REMINDER_KEY = 'strategy.submission_reminder_days';
export const DUE_SOON_KEY = 'strategy.due_soon_days';
export const DEFAULT_REMINDER_DAYS = [30, 7, 0];
export const DEFAULT_DUE_SOON_DAYS = 30;

const steps = (v: unknown): number[] | null => {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.map(Number))].filter((n) => Number.isInteger(n) && n >= 0 && n <= 365).sort((a, b) => b - a);
  return out.length === v.length && out.length > 0 && out.length <= 6 ? out : null;
};

export async function readSettings(ctx: ModuleContext) {
  const reminder = steps(await ctx.settings.get<unknown>(REMINDER_KEY, DEFAULT_REMINDER_DAYS)) ?? DEFAULT_REMINDER_DAYS;
  const soon = Number(await ctx.settings.get<unknown>(DUE_SOON_KEY, DEFAULT_DUE_SOON_DAYS));
  return { submission_reminder_days: reminder, due_soon_days: Number.isInteger(soon) && soon >= 1 && soon <= 365 ? soon : DEFAULT_DUE_SOON_DAYS };
}

export async function writeSettings(ctx: ModuleContext, req: FastifyRequest, body: Row) {
  const errors: Record<string, string> = {};
  const s = body.submission_reminder_days === undefined ? undefined : steps(body.submission_reminder_days);
  if (s === null) errors.submission_reminder_days = 'Give one to six whole numbers of days from 0 to 365, each once.';
  const n = body.due_soon_days === undefined ? undefined : Number(body.due_soon_days);
  if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 365)) errors.due_soon_days = 'Give a whole number of days from 1 to 365.';
  if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
  if (s) await ctx.settings.set(REMINDER_KEY, s, req);
  if (n !== undefined) await ctx.settings.set(DUE_SOON_KEY, n, req);
  return readSettings(ctx);
}
