import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row } from '../../core/module.ts';

/** Small helpers shared by the procurement module's files. */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const isDate = (v: unknown): v is string => typeof v === 'string' && DATE_RE.test(v) && !Number.isNaN(Date.parse(v));
export const isInstant = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && !Number.isNaN(Date.parse(v));

/** A date column as `YYYY-MM-DD` (or null). */
export const day = (v: unknown): string | null => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));

/** A numeric column (strings from the driver) as a number, 0 when empty. */
export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
/** Rounded to cents. */
export const cents = (n: number): number => Math.round(n * 100) / 100;

/** A route parameter that must be a record id (404 otherwise). */
export function idParam(ctx: ModuleContext, req: FastifyRequest, name = 'id', what = 'Record'): string {
  const v = String((req.params as Row)[name] ?? '');
  if (!UUID_RE.test(v)) ctx.fail(404, 'not_found', `${what} not found.`);
  return v;
}

/** Text from a request body: trimmed, cut to `max`, null when empty. */
export function cleanText(v: unknown, max = 4000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export const body = (req: FastifyRequest): Row => (req.body && typeof req.body === 'object' ? req.body as Row : {});

export function invalid(ctx: ModuleContext, fields: Record<string, string>): never {
  return ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
}

/** An active person's id, or a field error. */
export async function activeUser(ctx: ModuleContext, id: unknown, field: string): Promise<string> {
  const s = String(id ?? '');
  const ok = UUID_RE.test(s) && await ctx.db.one(`select 1 from users where id = $1 and deleted_at is null`, [s]);
  if (!ok) invalid(ctx, { [field]: 'Choose a person who has an account.' });
  return s;
}
