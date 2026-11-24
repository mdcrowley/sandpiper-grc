import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addMonths, addDays, daysBetween } from '../../../../shared/dates.ts';
export { addMonths, addDays, daysBetween }; // one copy for every module (E40-12)

/**
 * Asset condition (E32): what a rated record is, how its useful life is worked out, and how an
 * assessment reaches the record it rates. Assets and sites belong to inventory and vehicles to
 * fleet; their condition columns are written here through the resource engine as system work.
 */

export type TargetType = 'asset' | 'vehicle' | 'site';
export const TARGET_TYPES: TargetType[] = ['asset', 'vehicle', 'site'];

interface TargetInfo {
  table: string;
  /** Permission module of the record type. */
  module: string;
  /** The lookup field a class's `matches` suggests from. */
  matchKey: 'asset_type' | 'vehicle_mode' | 'site_kind';
  matchField: string;
  /** SQL for the record's display name (alias t). */
  label: string;
  /** SQL for the date its useful life counts from, as text (alias t). */
  base: string;
}

export const TARGETS: Record<TargetType, TargetInfo> = {
  asset: {
    table: 'assets', module: 'assets', matchKey: 'asset_type', matchField: 'asset_type',
    label: `coalesce(nullif(concat_ws(' ', t.tag, t.name), ''), t.name)`,
    base: `coalesce(t.in_service_date, t.purchase_date)::text`,
  },
  vehicle: {
    table: 'vehicles', module: 'fleet', matchKey: 'vehicle_mode', matchField: 'mode',
    label: `'Vehicle ' || t.fleet_number`,
    base: `coalesce(t.in_service_date, case when t.model_year between 1900 and 2200 then make_date(t.model_year, 1, 1) end)::text`,
  },
  site: {
    table: 'sites', module: 'sites', matchKey: 'site_kind', matchField: 'site_kind',
    label: 't.name',
    base: `case when t.built_year between 1800 and 2200 then make_date(t.built_year, 1, 1) end::text`,
  },
};

export const isTarget = (v: unknown): v is TargetType => typeof v === 'string' && (TARGET_TYPES as string[]).includes(v);
export const routeOf = (type: TargetType, id: string) => `/${type === 'asset' ? 'assets' : type === 'vehicle' ? 'vehicles' : 'sites'}/${id}`;

// ---------------------------------------------------------------- dates

/** Years (one decimal) from `from` to `to`. */
export const yearsBetween = (from: string, to: string) => Math.round((daysBetween(from, to) / 365.25) * 10) / 10;

const iso = (v: unknown): string | null => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

export interface ClassLife { useful_life_years?: unknown; useful_life_miles?: unknown }

/**
 * The end of a record's useful life: the date it counts from plus the class's years and, for a
 * vehicle, the date its mileage reaches the class's miles at the rate it has run so far (from the
 * odometer and the day it was read). The earlier of the two wins; null when neither can be worked out.
 */
export function usefulLifeEnd(base: string | null, cls: ClassLife | null, odometer?: unknown, readOn?: string | null): string | null {
  if (!base || !cls) return null;
  const years = Number(cls.useful_life_years);
  const miles = Number(cls.useful_life_miles);
  const ends: string[] = [];
  if (cls.useful_life_years !== null && cls.useful_life_years !== undefined && Number.isFinite(years) && years > 0) {
    ends.push(addMonths(base, Math.round(years * 12)));
  }
  const odo = Number(odometer);
  if (cls.useful_life_miles !== null && cls.useful_life_miles !== undefined && Number.isFinite(miles) && miles > 0
    && odometer !== null && odometer !== undefined && Number.isFinite(odo) && odo > 0 && readOn) {
    const run = daysBetween(base, readOn);
    if (run > 0) ends.push(addDays(base, (run * miles) / odo));
  }
  return ends.length ? ends.sort()[0] : null;
}

// ---------------------------------------------------------------- what counts

export interface Meanings {
  /** Vehicle statuses that mean it has left the fleet. */
  retiredVehicle: string[];
  /** Asset statuses that mean it is gone (disposed). */
  goneAsset: string[];
}

export async function meanings(ctx: ModuleContext): Promise<Meanings> {
  const vs = ctx.resources.get('vehicle') ? await ctx.lookups.values('vehicle_status') : [];
  const as = await ctx.lookups.values('asset_status');
  const gone = as.filter((v) => v.meta?.final === true).map((v) => v.value);
  return {
    retiredVehicle: vs.filter((v) => v.meta?.retired === true).map((v) => v.value),
    goneAsset: gone.length ? gone : ['disposed'],
  };
}

/** SQL: true for a record left out of every percentage (retired vehicle, disposed asset, site no longer in use). Alias t. */
export function excludedSql(type: TargetType, m: Meanings): string {
  const list = (vs: string[]) => (vs.length ? vs.map((v) => `'${v.replace(/'/g, "''")}'`).join(', ') : `''`);
  if (type === 'vehicle') return `coalesce(t.status, '') in (${list(m.retiredVehicle)})`;
  if (type === 'asset') return `coalesce(t.status, '') in (${list(m.goneAsset)})`;
  return `not coalesce(t.in_use, true)`;
}

/** The record types that can be rated now: loaded and switched on. */
export const loadedTargets = (ctx: ModuleContext): TargetType[] => TARGET_TYPES.filter((t) => ctx.resources.get(t));

export interface Member {
  type: TargetType;
  id: string;
  label: string;
  class_id: string;
  useful_life_end: string | null;
  condition_rating: string | null;
  condition_assessed_on: string | null;
  base: string | null;
  excluded: boolean;
  replacement_project_id: string | null;
  owner_id: string | null;
}

/**
 * The records that belong to a class (or to any class). Without `user` this is a figure and counts
 * every record; with `user` it is a list: only the types that person may view, and only the rows
 * they may see.
 */
export async function members(ctx: ModuleContext, opts: { classId?: string; user?: SessionUser | null; types?: TargetType[] } = {}): Promise<Member[]> {
  const m = await meanings(ctx);
  const out: Member[] = [];
  for (const type of opts.types ?? loadedTargets(ctx)) {
    if (!ctx.resources.get(type)) continue;
    const info = TARGETS[type];
    if (opts.user && !ctx.can(opts.user, `${info.module}.view`)) continue;
    const params: unknown[] = [];
    let where = 't.deleted_at is null and t.asset_class_id is not null';
    if (opts.classId) { params.push(opts.classId); where += ` and t.asset_class_id = $${params.length}::uuid`; }
    if (opts.user) where += ` and ${ctx.resources.visibleWhere(type, opts.user, 't')}`;
    const rows = await ctx.db.query<Row>(
      `select t.id, ${info.label} as label, t.asset_class_id as class_id, t.useful_life_end::text as useful_life_end,
              t.condition_rating, t.condition_assessed_on::text as condition_assessed_on, ${info.base} as base,
              (${excludedSql(type, m)}) as excluded, t.replacement_project_id,
              ${type === 'asset' ? 't.owner_id' : 'null::uuid'} as owner_id
       from ${info.table} t where ${where}`, params);
    for (const r of rows) out.push({ type, ...r, excluded: r.excluded === true } as Member);
  }
  return out;
}

// ---------------------------------------------------------------- writing to the rated records

/** The useful-life end a record should have now, from its class and dates. */
export async function expectedEnd(ctx: ModuleContext, type: TargetType, row: Row): Promise<string | null> {
  if (!row.asset_class_id) return null;
  const cls = await ctx.db.one<Row>('select useful_life_years, useful_life_miles from asset_classes where id = $1 and deleted_at is null', [row.asset_class_id]);
  if (!cls) return null;
  const base = type === 'asset' ? iso(row.in_service_date) ?? iso(row.purchase_date)
    : type === 'vehicle' ? iso(row.in_service_date) ?? (Number(row.model_year) >= 1900 ? `${Number(row.model_year)}-01-01` : null)
      : Number(row.built_year) >= 1800 ? `${Number(row.built_year)}-01-01` : null;
  return usefulLifeEnd(base, cls, type === 'vehicle' ? row.odometer_miles : null, iso(row.odometer_read_on));
}

/** Fields whose change moves the useful-life end. */
const LIFE_FIELDS = ['asset_class_id', 'in_service_date', 'purchase_date', 'model_year', 'built_year', 'odometer_miles', 'odometer_read_on'];

/** Recomputes the useful-life end of the members of one class (or every class). Returns how many changed. */
export async function recompute(ctx: ModuleContext, classId?: string): Promise<number> {
  let changed = 0;
  for (const type of loadedTargets(ctx)) {
    const info = TARGETS[type];
    // Members, and records that have an end but no longer a class.
    const rows = await ctx.db.query<Row>(
      `select * from ${info.table} where deleted_at is null and ${classId ? 'asset_class_id = $1::uuid' : '(asset_class_id is not null or useful_life_end is not null)'}`,
      classId ? [classId] : []);
    for (const row of rows) {
      const want = await expectedEnd(ctx, type, row);
      if (want === iso(row.useful_life_end)) continue;
      await ctx.resources.update(type, row.id, { useful_life_end: want });
      changed += 1;
    }
  }
  return changed;
}

/**
 * Puts the newest assessment of one record on the record (its rating and date), as system work.
 * Called after an assessment is saved or deleted, so only the newest one ever shows.
 */
export async function refreshRating(ctx: ModuleContext, type: string, id: string): Promise<void> {
  if (!isTarget(type) || !ctx.resources.get(type)) return;
  const row = await ctx.db.one<Row>(`select id, condition_rating, condition_assessed_on::text as on_ from ${TARGETS[type].table} where id = $1`, [id]);
  if (!row) return;
  const newest = await ctx.db.one<Row>(
    `select rating, assessed_on::text as assessed_on from condition_assessments
     where target_type = $1 and target_id = $2 and deleted_at is null order by assessed_on desc, created_at desc limit 1`, [type, id]);
  const rating = newest?.rating ?? null;
  const on = newest?.assessed_on ?? null;
  if (rating === (row.condition_rating ?? null) && on === (row.on_ ?? null)) return;
  await ctx.resources.update(type, id, { condition_rating: rating, condition_assessed_on: on });
}

/** Mirrors a record's replacement project as the record link `replaced_by` (contract C7). */
async function mirrorReplacement(ctx: ModuleContext, type: string, id: string, before: unknown, after: unknown, by: string | null) {
  if ((before ?? null) === (after ?? null)) return;
  if (before) {
    await ctx.db.query(`delete from record_links where from_type = $1 and from_id = $2 and to_type = 'project' and to_id = $3 and relation = 'replaced_by'`, [type, id, before]);
  }
  if (after && ctx.resources.get('project')) {
    await ctx.db.query(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1, $2, 'project', $3, 'replaced_by', $4)
       on conflict (from_type, from_id, to_type, to_id, relation) do nothing`, [type, id, after, by]);
  }
}

const fail = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

/**
 * The checks and derived values on a rated record's own save: the class must rate that kind of
 * record, the year built must be a year, the odometer's reading date follows the odometer, and the
 * useful-life end follows the class and dates. Runs inside the record's own update.
 */
async function beforeSave(ctx: ModuleContext, type: TargetType, existing: Row | null, patch: Row): Promise<void> {
  if (type === 'site' && 'built_year' in patch) {
    const raw = patch.built_year;
    if (raw === '' || raw === null || raw === undefined) patch.built_year = null;
    else {
      const s = String(raw).trim();
      const n = Number(s);
      if (!/^\d{4}$/.test(s) || n < 1800 || n > Number(dayInZone().slice(0, 4)) + 5) fail(ctx, { built_year: 'Enter a four-digit year.' });
      patch.built_year = n;
    }
  }
  if (type === 'vehicle' && 'odometer_miles' in patch) {
    const odo = patch.odometer_miles;
    const now = odo === null || odo === undefined || odo === '' ? null : Number(odo);
    if (now !== null && !(now >= 0)) fail(ctx, { odometer_miles: 'Enter zero or more.' });
    const was = existing?.odometer_miles === null || existing?.odometer_miles === undefined ? null : Number(existing.odometer_miles);
    if (now !== was) patch.odometer_read_on = now === null ? null : dayInZone();
  }
  if (!ctx.resources.get('asset_class')) return; // the condition area is off: nothing else to work out
  if (patch.asset_class_id) {
    const cls = await ctx.db.one<Row>('select applies_to, active from asset_classes where id = $1 and deleted_at is null', [patch.asset_class_id]);
    if (!cls) fail(ctx, { asset_class_id: 'Choose an asset class that exists.' });
    else if (cls.applies_to !== type) fail(ctx, { asset_class_id: `That class rates ${cls.applies_to}s, not ${type}s.` });
  }
  if (LIFE_FIELDS.some((f) => f in patch)) {
    patch.useful_life_end = await expectedEnd(ctx, type, { ...(existing ?? {}), ...patch });
  }
}

/**
 * Adds the condition rules to the asset, vehicle and site record types, whichever module defines
 * them: their own hooks run first (as the workflows module does with its after-hooks). Called once
 * every module has defined its types, and again by the nightly work (a type that was switched off
 * at start-up is picked up then).
 */
const wrapped = new WeakSet<ResourceDef>();
export function followTargets(ctx: ModuleContext): void {
  for (const type of TARGET_TYPES) {
    const def = ctx.resources.get(type);
    if (!def || wrapped.has(def)) continue;
    wrapped.add(def);
    const own = { ...(def.hooks ?? {}) };
    def.hooks = {
      ...own,
      beforeCreate: async (req: FastifyRequest | null, data: Row) => {
        const out = own.beforeCreate ? await own.beforeCreate(req, data) : data;
        await beforeSave(ctx, type, null, out);
        return out;
      },
      beforeUpdate: async (req: FastifyRequest | null, existing: Row, patch: Row) => {
        const out = own.beforeUpdate ? await own.beforeUpdate(req, existing, patch) : patch;
        await beforeSave(ctx, type, existing, out);
        return out;
      },
      afterCreate: async (req: FastifyRequest | null, row: Row) => {
        await own.afterCreate?.(req, row);
        await mirrorReplacement(ctx, type, row.id, null, row.replacement_project_id, req?.user?.id ?? null);
      },
      afterUpdate: async (req: FastifyRequest | null, before: Row, after: Row) => {
        await own.afterUpdate?.(req, before, after);
        await mirrorReplacement(ctx, type, after.id, before.replacement_project_id, after.replacement_project_id, req?.user?.id ?? null);
      },
    };
  }
}
