// Shared pieces of the continuity module: date arithmetic on organization days, the dependency kinds
// and the record types they point at, and number checks for hours.
import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { addDays, addMonths } from '../../../../shared/dates.ts';
export { addDays, addMonths }; // one copy for every module (E40-12)

/** A date column read back as `YYYY-MM-DD` (drivers give strings or Date objects). */
export function ymd(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/** What a process may depend on, and the record type each kind points at. */
export const DEP_TYPES: Record<string, string> = {
  system: 'system', service: 'service', site: 'site', vendor: 'vendor', process: 'business_process', position: 'position',
};
export const DEP_KINDS = Object.keys(DEP_TYPES);
/** The relation of the mirrored record links (contract C7). */
export const DEPENDS_ON = 'depends_on';
export const EXERCISED_BY = 'exercised_by';

/** Dependency kinds whose record type is loaded and switched on now. */
export function liveDepKinds(ctx: ModuleContext): string[] {
  return DEP_KINDS.filter((k) => ctx.resources.get(DEP_TYPES[k]));
}

/** A number of hours from a form: null for empty, a validation message for anything else that is not 0 or more. */
export function checkHours(data: Row, fields: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const v = data[f];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) errors[f] = 'Give a number of hours, 0 or more.';
    else if (n > 100000) errors[f] = 'That is more hours than this application keeps.';
  }
  return errors;
}

export function invalid(ctx: ModuleContext, fields: Record<string, string>): never {
  return ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
}

/** The display name of the signed-in person. */
export async function nameOf(ctx: ModuleContext, req: FastifyRequest | null, userId?: string | null): Promise<string | null> {
  const id = userId ?? req?.user?.id;
  if (!id) return null;
  return (await ctx.db.one<{ display_name: string }>('select display_name from users where id = $1', [id]))?.display_name ?? null;
}

/** A short text from a request body: trimmed, cut to `max`, null when empty. */
export function text(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
}
