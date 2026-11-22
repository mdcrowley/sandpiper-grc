import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';

/**
 * The record types a control may cover (contract C7, relation `covers`), in the order the screens
 * list them. A type whose module is not loaded, or whose area is switched off, is simply left out.
 */
export const COVER_TYPES = ['risk', 'hazard', 'framework_outcome', 'obligation', 'policy', 'ot_zone'] as const;
export const COVERS = 'covers';

/** The types a failed test flags for review, with the field holding their next review date. */
export const REVIEW_FIELDS: Record<string, string[]> = { risk: ['review_on'], hazard: ['review_date'] };

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `ymd` plus `months` calendar months, kept within the month (Jan 31 + 1 month = Feb 28). */
export function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + months;
  const year = Math.floor(total / 12);
  const month = total % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** A covered type's definition, when it is loaded and `req`'s person may view that module. */
export function coverDef(ctx: ModuleContext, req: FastifyRequest | null, type: string): ResourceDef | undefined {
  if (!(COVER_TYPES as readonly string[]).includes(type)) return undefined;
  const def = ctx.resources.get(type);
  if (!def) return undefined;
  if (req && !ctx.can(req.user, `${def.module}.view`)) return undefined;
  return def;
}

/** The covered types this person may view, loaded now. */
export function coverDefs(ctx: ModuleContext, req: FastifyRequest | null): ResourceDef[] {
  return COVER_TYPES.map((t) => coverDef(ctx, req, t)).filter((d): d is ResourceDef => !!d);
}

/** A record's reference and title, as one short line. */
export function recordName(def: ResourceDef, row: Row): string {
  return [def.ref ? row[def.ref.field] : null, row[def.titleField]].filter(Boolean).join(' ');
}

/** Whether a covered record is closed: its status value is marked closed or final in its list. */
export async function isClosed(ctx: ModuleContext, def: ResourceDef, row: Row): Promise<boolean> {
  const list = def.fields.status?.list;
  if (!list || !row.status) return false;
  const v = (await ctx.lookups.values(list)).find((x) => x.value === row.status);
  return v?.meta?.closed === true || v?.meta?.final === true;
}

/** Whole number within a range, or null for empty; `undefined` for anything else. */
export function wholeNumber(v: unknown, min: number, max: number): number | null | undefined {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}
