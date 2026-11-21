import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { LookupValue, ModuleContext, Row } from '../../core/module.ts';

/** Small helpers shared by the funding module's files. */

export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const validDate = (v: unknown) => typeof v === 'string' && DATE.test(v) && !Number.isNaN(Date.parse(v));

/** A route parameter that must be a record id (404 otherwise, never a database error). */
export function idParam(ctx: ModuleContext, req: FastifyRequest, name = 'id'): string {
  const v = String((req.params as Row)[name] ?? '');
  if (!UUID_RE.test(v)) ctx.fail(404, 'not_found', 'Record not found.');
  return v;
}

/** Text from a request body: trimmed, cut to `max`, null when empty. */
export function cleanText(v: unknown, max = 4000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Values of a list that carry `meta[flag]` (for example the closed statuses). */
export async function flagged(ctx: ModuleContext, list: string, flag: string, fallback: string[]): Promise<string[]> {
  const values = await ctx.lookups.values(list);
  const out = values.filter((v) => (v.meta as Row | undefined)?.[flag]).map((v) => v.value);
  return out.length ? out : fallback;
}

/** A user id that names an active person, or a validation error on `field`. */
export async function activeUser(ctx: ModuleContext, id: unknown, field: string): Promise<string | null> {
  if (id === null || id === undefined || id === '') return null;
  const s = String(id);
  const ok = UUID_RE.test(s) && await ctx.db.one(`select 1 from users where id = $1 and status = 'active' and deleted_at is null`, [s]);
  if (!ok) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: 'Choose an active person.' });
  return s;
}

export const label = (values: LookupValue[], value: string | null | undefined) => values.find((v) => v.value === value)?.label ?? value ?? '';
