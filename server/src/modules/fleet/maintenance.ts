// Planned maintenance (wave 27, E46-71): service intervals by miles, engine hours or days for each
// vehicle model or asset class, the odometer and hour-meter readings of each vehicle (its mileage
// history), the services done, and when each vehicle is next due. Three record types, all in the
// fleet area (permission `fleet`):
//
// - `maintenance_interval`: what is done how often, for the vehicles of one model or one asset class.
// - `vehicle_reading`: an odometer and/or hour-meter reading on a day. The latest odometer reading is
//   the vehicle's own odometer; a person who changes the odometer on the vehicle adds a reading. A
//   reading may not go backwards: it must be at least every earlier one and at most every later one.
// - `maintenance_record`: a service done on a day (with the odometer and hours then, which also make a
//   reading). The next service of that interval is due from the latest one.
//
// When is next due: from the latest service of the interval on that vehicle (or, with none, from zero
// miles and hours and the day it entered service), the interval's miles, hours and days added; the
// first one reached counts. Overdue once any is passed; due soon within the warning (10% of the
// interval unless the interval says). The date is projected from the rate the vehicle runs at (its
// readings over the last year). Due and overdue work is a list (GET /api/fleet/maintenance/due), the
// vehicle's Maintenance tab, and a calendar source for My work and the compliance calendar (the
// interval's owner). All three record types work in data load mode (historical readings and services).
import type { FastifyRequest } from 'fastify';
import { defineCalendarSource, whoFor } from '../../core/calendar.ts';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import type { FieldDef, ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, daysBetween } from '../../../../shared/dates.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The warning before an interval is due, as a share of the interval, when the interval gives none. */
export const DEFAULT_WARN_SHARE = 0.1;
/** Readings this far back give the rate a vehicle runs at. */
const RATE_DAYS = 365;

const iso = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const fail = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

export type DueState = 'overdue' | 'due_soon' | 'ok';
export interface DueRow {
  vehicle_id: string; fleet_number: string; depot_id: string | null; depot: string | null; model_id: string | null; model: string | null;
  interval_id: string; interval_ref: string | null; interval: string; owner_id: string | null; owner: string | null;
  every_miles: number | null; every_hours: number | null; every_days: number | null;
  last_done_on: string | null; last_record_id: string | null; basis: 'service' | 'start';
  current_miles: number | null; current_hours: number | null; miles_read_on: string | null; hours_read_on: string | null;
  next_miles: number | null; next_hours: number | null; next_date: string | null;
  miles_left: number | null; hours_left: number | null; days_left: number | null;
  miles_per_day: number | null; hours_per_day: number | null;
  /** The day it falls due: the interval's date, or the day the miles or hours are expected to be reached, whichever is first. */
  due_on: string | null;
  state: DueState;
}

// ---------- the record types ----------

const INTERVAL_FIELDS: Record<string, FieldDef> = {
  ref: { label: 'Reference', type: 'text', readOnly: true },
  name: { label: 'Name', type: 'text', required: true, help: 'What is done, for example "A inspection" or "Brake overhaul".' },
  description: { label: 'What is done', type: 'longtext', personal: false, help: 'The checks and work the service includes, or where the task list is kept.' },
  model_id: { label: 'Vehicle model', type: 'ref', to: 'vehicle_model', help: 'The vehicles of this model get the interval. Give a vehicle model or an asset class, not both.' },
  asset_class_id: { label: 'Asset class', type: 'ref', to: 'asset_class', help: 'The vehicles of this asset class get the interval. Give a vehicle model or an asset class, not both.' },
  every_miles: { label: 'Every (miles)', type: 'number', help: 'Miles between services. Give miles, hours, days or any of them: the first one reached counts.' },
  every_hours: { label: 'Every (engine hours)', type: 'number', help: 'Engine or running hours between services.' },
  every_days: { label: 'Every (days)', type: 'number', help: 'Days between services, for example 90 for a quarterly inspection.' },
  warn_miles: { label: 'Due soon within (miles)', type: 'number', help: 'Show it as due soon this many miles before. Empty: a tenth of the interval.' },
  warn_hours: { label: 'Due soon within (hours)', type: 'number', help: 'Show it as due soon this many hours before. Empty: a tenth of the interval.' },
  warn_days: { label: 'Due soon within (days)', type: 'number', help: 'Show it as due soon this many days before. Empty: a tenth of the interval.' },
  owner_id: { label: 'Planner', type: 'user', help: 'Who plans the work: due and overdue services of this interval are in their My work.' },
  active: { label: 'Active', type: 'boolean', default: true, help: 'An inactive interval is kept for the record but no longer falls due.' },
};

const READING_FIELDS: Record<string, FieldDef> = {
  ref: { label: 'Reference', type: 'text', readOnly: true },
  vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle', required: true, help: 'The vehicle read (its fleet number).' },
  read_on: { label: 'Read on', type: 'date', required: true, help: 'The day of the reading.' },
  odometer_miles: { label: 'Odometer (miles)', type: 'number', help: 'The odometer then. Give the odometer, the hours or both.' },
  engine_hours: { label: 'Engine hours', type: 'number', help: 'The hour meter then.' },
  source: { label: 'Source', type: 'lookup', list: 'vehicle_reading_source', default: 'manual', help: 'Where the reading came from: entered by hand, fueling, telematics, an inspection, a service or the vehicle record.' },
  notes: { label: 'Notes', type: 'longtext', personal: false },
  recorded_by: { label: 'Recorded by', type: 'user', readOnly: true },
  recorded_by_name: { label: 'Recorded by (name)', type: 'text', readOnly: true, personal: true },
};

const RECORD_FIELDS: Record<string, FieldDef> = {
  ref: { label: 'Reference', type: 'text', readOnly: true },
  vehicle_id: { label: 'Vehicle', type: 'ref', to: 'vehicle', required: true, help: 'The vehicle serviced (its fleet number).' },
  interval_id: { label: 'Interval', type: 'ref', to: 'maintenance_interval', help: 'The planned service done; empty for unplanned work. The next service of that interval is due from this one.' },
  done_on: { label: 'Done on', type: 'date', required: true, help: 'The day the service was finished.' },
  odometer_miles: { label: 'Odometer (miles)', type: 'number', help: 'The odometer at the service; it is also kept as a reading.' },
  engine_hours: { label: 'Engine hours', type: 'number', help: 'The hour meter at the service; it is also kept as a reading.' },
  work_order: { label: 'Work order', type: 'text', help: 'The work order number in the maintenance shop\'s own system, if any.' },
  notes: { label: 'Notes', type: 'longtext', personal: false },
  recorded_by: { label: 'Recorded by', type: 'user', readOnly: true },
  recorded_by_name: { label: 'Recorded by (name)', type: 'text', readOnly: true, personal: true },
};

export async function ensureMaintenanceLists(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('vehicle_reading_source', [
    { value: 'manual', label: 'Entered by hand', color: 'gray', sort: 10 },
    { value: 'fueling', label: 'Fueling or charging', color: 'blue', sort: 20 },
    { value: 'telematics', label: 'Telematics', color: 'teal', sort: 30 },
    { value: 'inspection', label: 'Inspection', color: 'purple', sort: 40 },
    { value: 'maintenance', label: 'Service', color: 'green', sort: 50 },
    { value: 'vehicle_record', label: 'Vehicle record', color: 'gray', sort: 60 },
  ], { module: 'fleet' });
}

/** Whole positive number or empty, for each named field of the patch. */
function checkCounts(ctx: ModuleContext, patch: Row, names: string[], label: (f: string) => string, whole: boolean) {
  const fields: Record<string, string> = {};
  for (const f of names) {
    if (!(f in patch)) continue;
    if (patch[f] === '' || patch[f] === undefined) { patch[f] = null; continue; }
    if (patch[f] === null) continue;
    const n = Number(patch[f]);
    if (!Number.isFinite(n) || n < 0 || (whole && !Number.isInteger(n)) || n > 10_000_000) fields[f] = `${label(f)} must be ${whole ? 'a whole number' : 'a number'} of zero or more.`;
    else patch[f] = n;
  }
  if (Object.keys(fields).length) fail(ctx, fields);
}

function actorFields(req: FastifyRequest | null, data: Row) {
  if (!req) return;
  const who = actorOf(req);
  data.recorded_by = who.id;
  data.recorded_by_name = who.name;
}

export function registerMaintenance(ctx: ModuleContext) {
  const { db } = ctx;

  // ----- intervals -----
  async function checkInterval(merged: Row, patch: Row) {
    checkCounts(ctx, patch, ['every_miles', 'every_hours', 'warn_miles', 'warn_hours'], (f) => INTERVAL_FIELDS[f].label, false);
    checkCounts(ctx, patch, ['every_days', 'warn_days'], (f) => INTERVAL_FIELDS[f].label, true);
    const m = { ...merged, ...patch };
    const fields: Record<string, string> = {};
    if (m.model_id && m.asset_class_id) fields.asset_class_id = 'Give a vehicle model or an asset class, not both.';
    if (!m.model_id && !m.asset_class_id) fields.model_id = 'Choose the vehicle model (or the asset class) the interval is for.';
    if (!(Number(m.every_miles) > 0) && !(Number(m.every_hours) > 0) && !(Number(m.every_days) > 0)) {
      fields.every_miles = 'Give the miles, engine hours or days between services.';
    }
    if (typeof patch.name === 'string') patch.name = patch.name.trim();
    if (Object.keys(fields).length) fail(ctx, fields);
  }
  ctx.defineResource({
    type: 'maintenance_interval', table: 'maintenance_intervals', module: 'fleet', label: 'Maintenance interval', plural: 'Maintenance intervals',
    path: '/api/maintenance-intervals', route: '/fleet/maintenance/intervals', titleField: 'name', ref: { field: 'ref', prefix: 'PMI-' },
    searchable: ['name', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: INTERVAL_FIELDS,
    hooks: {
      beforeCreate: async (_req, data) => { await checkInterval({}, data); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkInterval(existing, patch); return patch; },
    },
  });

  // ----- readings -----
  /** A reading never goes backwards: at least every earlier reading (and any other of the same day), at most every later one. */
  async function checkReading(merged: Row, patch: Row, id: string | null) {
    checkCounts(ctx, patch, ['odometer_miles', 'engine_hours'], (f) => READING_FIELDS[f].label, false);
    const m = { ...merged, ...patch };
    const fields: Record<string, string> = {};
    if (num(m.odometer_miles) === null && num(m.engine_hours) === null) fields.odometer_miles = 'Give the odometer, the engine hours or both.';
    const day = iso(m.read_on);
    if (day && day > dayInZone()) fields.read_on = 'A reading cannot be in the future.';
    if (!Object.keys(fields).length && day && m.vehicle_id) {
      for (const [col, label, unit] of [['odometer_miles', 'odometer', 'miles'], ['engine_hours', 'engine hours', 'hours']] as const) {
        const v = num(m[col]);
        if (v === null) continue;
        const near = await db.one<Row>(
          `select (select max(${col}) from vehicle_readings where vehicle_id = $1 and deleted_at is null and read_on <= $2::date and ($3::uuid is null or id <> $3::uuid)) as before_max,
                  (select min(${col}) from vehicle_readings where vehicle_id = $1 and deleted_at is null and read_on > $2::date and ($3::uuid is null or id <> $3::uuid)) as after_min`,
          [m.vehicle_id, day, id]);
        const before = num(near?.before_max);
        const after = num(near?.after_min);
        if (before !== null && v < before) fields[col] = `The ${label} cannot be lower than an earlier reading (${before.toLocaleString('en-US')} ${unit}).`;
        else if (after !== null && v > after) fields[col] = `The ${label} cannot be higher than a later reading (${after.toLocaleString('en-US')} ${unit}).`;
      }
    }
    if (Object.keys(fields).length) fail(ctx, fields);
  }
  ctx.defineResource({
    type: 'vehicle_reading', table: 'vehicle_readings', module: 'fleet', label: 'Vehicle reading', plural: 'Vehicle readings',
    path: '/api/vehicle-readings', route: '/fleet/readings', titleField: 'ref', ref: { field: 'ref', prefix: 'RDG-' },
    // Role grants scoped to sites see the readings of their depots' vehicles (E41-01).
    scope: { site: (col) => `(select v.depot_id from vehicles v where v.id = ${col('vehicle_id')})` },
    searchable: ['notes'],
    defaultSort: { field: 'read_on', dir: 'desc' },
    fields: READING_FIELDS,
    hooks: {
      beforeCreate: async (req, data) => { await checkReading({}, data, null); actorFields(req, data); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkReading(existing, patch, existing.id); return patch; },
      afterCreate: async (_req, row) => { await syncOdometer(row.vehicle_id, row.ref); },
      afterUpdate: async (_req, before, after) => {
        await syncOdometer(after.vehicle_id, after.ref);
        if (before.vehicle_id !== after.vehicle_id) await syncOdometer(before.vehicle_id, after.ref);
      },
    },
  });

  // ----- services done -----
  async function checkRecord(merged: Row, patch: Row) {
    checkCounts(ctx, patch, ['odometer_miles', 'engine_hours'], (f) => RECORD_FIELDS[f].label, false);
    const m = { ...merged, ...patch };
    const fields: Record<string, string> = {};
    const day = iso(m.done_on);
    if (day && day > dayInZone()) fields.done_on = 'A service cannot be recorded as done in the future.';
    if (m.interval_id && m.vehicle_id && ('interval_id' in patch || 'vehicle_id' in patch)) {
      const fits = await db.one(
        `select 1 from maintenance_intervals i join vehicles v on v.id = $2
         where i.id = $1 and i.deleted_at is null and ((i.model_id is not null and i.model_id = v.model_id) or (i.asset_class_id is not null and i.asset_class_id = v.asset_class_id))`,
        [m.interval_id, m.vehicle_id]);
      if (!fits) fields.interval_id = 'That interval is not for this vehicle\'s model or asset class.';
    }
    if (Object.keys(fields).length) fail(ctx, fields);
  }
  ctx.defineResource({
    type: 'maintenance_record', table: 'maintenance_records', module: 'fleet', label: 'Maintenance record', plural: 'Maintenance records',
    path: '/api/maintenance-records', route: '/fleet/maintenance/records', titleField: 'ref', ref: { field: 'ref', prefix: 'PMR-' },
    scope: { site: (col) => `(select v.depot_id from vehicles v where v.id = ${col('vehicle_id')})` },
    searchable: ['work_order', 'notes'],
    defaultSort: { field: 'done_on', dir: 'desc' },
    fields: RECORD_FIELDS,
    hooks: {
      beforeCreate: async (req, data) => { await checkRecord({}, data); actorFields(req, data); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkRecord(existing, patch); return patch; },
      // The odometer and hours at the service are a reading too.
      afterCreate: async (req, row) => { await readingFromService(req, row); },
      afterUpdate: async (req, before, after) => {
        if (num(before.odometer_miles) !== num(after.odometer_miles) || num(before.engine_hours) !== num(after.engine_hours) || iso(before.done_on) !== iso(after.done_on)) {
          await readingFromService(req, after);
        }
      },
    },
  });

  async function readingFromService(req: FastifyRequest | null, row: Row) {
    const miles = num(row.odometer_miles);
    const hours = num(row.engine_hours);
    if (miles === null && hours === null) return;
    const day = iso(row.done_on)!;
    const same = await db.one(
      `select 1 from vehicle_readings where vehicle_id = $1 and read_on = $2::date and deleted_at is null
         and odometer_miles is not distinct from $3::numeric and engine_hours is not distinct from $4::numeric`, [row.vehicle_id, day, miles, hours]);
    if (same) return;
    await ctx.resources.create('vehicle_reading', {
      vehicle_id: row.vehicle_id, read_on: day, odometer_miles: miles, engine_hours: hours, source: 'maintenance',
      notes: `At service ${row.ref ?? ''}`.trim(),
      ...(isDataLoad(req) && row.created_at ? { created_at: row.created_at } : {}),
    }, req);
  }

  /** The vehicle's own odometer is its latest odometer reading (system work: audited "from reading ..."). */
  async function syncOdometer(vehicleId: string, via: string | null) {
    const latest = await db.one<Row>(
      `select odometer_miles, read_on from vehicle_readings where vehicle_id = $1 and deleted_at is null and odometer_miles is not null
       order by read_on desc, odometer_miles desc limit 1`, [vehicleId]);
    if (!latest) return;
    const v = await db.one<Row>('select odometer_miles from vehicles where id = $1 and deleted_at is null', [vehicleId]);
    if (!v || num(v.odometer_miles) === num(latest.odometer_miles)) return;
    const def = ctx.resources.get('vehicle');
    if (def?.fields.odometer_miles) {
      await ctx.resources.update('vehicle', vehicleId, { odometer_miles: num(latest.odometer_miles) }, null, { via: `reading ${via ?? ''}`.trim() });
      // The condition rules date a changed odometer today; it was read on the reading's day (the useful life follows nightly).
      await db.query('update vehicles set odometer_read_on = $2 where id = $1 and odometer_read_on is distinct from $2::date', [vehicleId, iso(latest.read_on)]);
    } else {
      // The odometer field is hidden (asset condition is off): keep the copy without the condition rules.
      await db.query('update vehicles set odometer_miles = $2, odometer_read_on = $3 where id = $1', [vehicleId, num(latest.odometer_miles), iso(latest.read_on)]);
    }
  }

  // A reading removed: the vehicle's odometer follows the latest one left.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (def.type === 'vehicle_reading' && action === 'delete') await syncOdometer(row.vehicle_id, row.ref);
  });

  registerDueRoutes(ctx);
  defineCalendarSource(ctx.app, {
    key: 'fleet.maintenance', label: 'Planned maintenance due', kind: 'Planned maintenance',
    recordType: 'vehicle', permission: 'fleet.view', work: true, anyone: true,
    async events(c, user, from, to, scope) {
      if (!c.resources.get('maintenance_interval')) return [];
      const who = whoFor(user, scope);
      const today = dayInZone();
      // An item falls on the day it is due (overdue ones on that day in the past); one with no date yet only while due soon or overdue.
      return (await dueRows(c, user, {}))
        .filter((r) => (who === null || r.owner_id === who) && (r.due_on !== null || r.state !== 'ok'))
        .map((r) => ({ r, start: r.due_on ?? today }))
        .filter(({ start }) => start >= from && start <= to)
        .map(({ r, start }) => ({
          uid: `fleet.maintenance:${r.vehicle_id}:${r.interval_id}:${r.last_record_id ?? 'start'}`,
          title: `${r.interval} due: vehicle ${r.fleet_number}`, start, allDay: true,
          url: `/vehicles/${r.vehicle_id}?tab=maintenance`, recordType: 'vehicle', recordId: r.vehicle_id,
          ref: r.interval_ref, personId: r.owner_id,
        }));
    },
  });
}

/** The vehicle hooks: a person who changes the odometer on the vehicle itself adds a reading (mileage history). */
export async function readingFromVehicle(ctx: ModuleContext, req: FastifyRequest | null, before: Row | null, after: Row): Promise<void> {
  if (!req?.user || !ctx.resources.get('vehicle_reading')) return; // system work (a reading's own sync) adds nothing
  const now = num(after.odometer_miles);
  if (now === null || now === num(before?.odometer_miles)) return;
  const load = isDataLoad(req);
  const day = (load && (iso(after.odometer_read_on) ?? iso(after.updated_at))) || dayInZone();
  const same = await ctx.db.one('select 1 from vehicle_readings where vehicle_id = $1 and deleted_at is null and odometer_miles = $2::numeric', [after.id, now]);
  if (same) return;
  await ctx.resources.create('vehicle_reading', { vehicle_id: after.id, read_on: day, odometer_miles: now, source: 'vehicle_record' }, req);
}

// ---------- when each vehicle is next due ----------

interface DueFilter { vehicleId?: string; intervalId?: string; depotId?: string; modelId?: string }

/**
 * Every active interval against every vehicle (not retired) of its model or asset class that `user`
 * may see, with the next due miles, hours and date. A list, not a figure: `visibleWhere` applies.
 */
export async function dueRows(ctx: ModuleContext, user: SessionUser | null, f: DueFilter): Promise<DueRow[]> {
  const retired = (await ctx.lookups.values('vehicle_status')).filter((v) => v.meta?.retired === true).map((v) => v.value);
  const classes = Boolean(ctx.resources.get('asset_class'));
  const params: unknown[] = [retired];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const where = [`v.deleted_at is null and not (coalesce(v.status, '') = any($1::text[]))`];
  if (user) where.push(ctx.resources.visibleWhere('vehicle', user, 'v'));
  if (f.vehicleId) where.push(`v.id = ${add(f.vehicleId)}::uuid`);
  if (f.intervalId) where.push(`i.id = ${add(f.intervalId)}::uuid`);
  if (f.depotId) where.push(`v.depot_id = ${add(f.depotId)}::uuid`);
  if (f.modelId) where.push(`v.model_id = ${add(f.modelId)}::uuid`);
  const rateFrom = add(addDays(dayInZone(), -RATE_DAYS));
  const rows = await ctx.db.query<Row>(
    `select v.id as vehicle_id, v.fleet_number, v.depot_id, s.name as depot, v.model_id, vm.name as model, v.odometer_miles as vehicle_miles,
            coalesce(v.in_service_date, v.created_at::date) as started_on,
            i.id as interval_id, i.ref as interval_ref, i.name as interval, i.owner_id, u.display_name as owner,
            i.every_miles, i.every_hours, i.every_days, i.warn_miles, i.warn_hours, i.warn_days,
            last.id as last_record_id, last.done_on as last_done_on, last.odometer_miles as last_miles, last.engine_hours as last_hours,
            (select r.odometer_miles from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null and r.odometer_miles is not null
               and r.read_on <= last.done_on order by r.read_on desc, r.odometer_miles desc limit 1) as last_read_miles,
            (select r.engine_hours from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null and r.engine_hours is not null
               and r.read_on <= last.done_on order by r.read_on desc, r.engine_hours desc limit 1) as last_read_hours,
            om.odometer_miles as cur_miles, om.read_on as miles_read_on, oh.engine_hours as cur_hours, oh.read_on as hours_read_on,
            rm.first_on as rm_first_on, rm.first_v as rm_first, rh.first_on as rh_first_on, rh.first_v as rh_first
     from vehicles v
     join maintenance_intervals i on i.deleted_at is null and i.active
       and ((i.model_id is not null and i.model_id = v.model_id) ${classes ? 'or (i.asset_class_id is not null and i.asset_class_id = v.asset_class_id)' : ''})
     left join sites s on s.id = v.depot_id
     ${ctx.resources.get('vehicle_model') ? 'left join vehicle_models vm on vm.id = v.model_id' : 'left join (select null::uuid as id, null::text as name) vm on false'}
     left join users u on u.id = i.owner_id
     left join lateral (select r.id, r.done_on, r.odometer_miles, r.engine_hours from maintenance_records r
                        where r.vehicle_id = v.id and r.interval_id = i.id and r.deleted_at is null
                        order by r.done_on desc, r.created_at desc limit 1) last on true
     left join lateral (select r.odometer_miles, r.read_on from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null and r.odometer_miles is not null
                        order by r.read_on desc, r.odometer_miles desc limit 1) om on true
     left join lateral (select r.engine_hours, r.read_on from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null and r.engine_hours is not null
                        order by r.read_on desc, r.engine_hours desc limit 1) oh on true
     left join lateral (select r.read_on as first_on, r.odometer_miles as first_v from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null
                        and r.odometer_miles is not null and r.read_on >= ${rateFrom}::date order by r.read_on, r.odometer_miles limit 1) rm on true
     left join lateral (select r.read_on as first_on, r.engine_hours as first_v from vehicle_readings r where r.vehicle_id = v.id and r.deleted_at is null
                        and r.engine_hours is not null and r.read_on >= ${rateFrom}::date order by r.read_on, r.engine_hours limit 1) rh on true
     where ${where.join(' and ')}
     order by v.fleet_number, i.name
     limit 20000`, params);
  const today = dayInZone();
  return rows.map((r) => computeDue(r, today));
}

/** One vehicle against one interval (exported for tests). */
export function computeDue(r: Row, today: string): DueRow {
  const hasLast = Boolean(r.last_record_id);
  const everyMiles = num(r.every_miles) && num(r.every_miles)! > 0 ? num(r.every_miles) : null;
  const everyHours = num(r.every_hours) && num(r.every_hours)! > 0 ? num(r.every_hours) : null;
  const everyDays = num(r.every_days) && num(r.every_days)! > 0 ? num(r.every_days) : null;
  const curMiles = num(r.cur_miles) ?? num(r.vehicle_miles);
  const curHours = num(r.cur_hours);
  // From the latest service (its own figures, else the reading before it), or from zero and the start.
  const baseMiles = hasLast ? num(r.last_miles) ?? num(r.last_read_miles) : 0;
  const baseHours = hasLast ? num(r.last_hours) ?? num(r.last_read_hours) : 0;
  const baseDate = hasLast ? iso(r.last_done_on) : iso(r.started_on);
  const nextMiles = everyMiles !== null && baseMiles !== null ? baseMiles + everyMiles : null;
  const nextHours = everyHours !== null && baseHours !== null ? baseHours + everyHours : null;
  const nextDate = everyDays !== null && baseDate ? addDays(baseDate, everyDays) : null;
  const milesLeft = nextMiles !== null && curMiles !== null ? nextMiles - curMiles : null;
  const hoursLeft = nextHours !== null && curHours !== null ? nextHours - curHours : null;
  const daysLeft = nextDate ? daysBetween(today, nextDate) : null;
  const rate = (first: unknown, firstOn: unknown, last: number | null, lastOn: unknown): number | null => {
    const a = num(first); const d0 = iso(firstOn); const d1 = iso(lastOn);
    if (a === null || last === null || !d0 || !d1) return null;
    const days = daysBetween(d0, d1);
    return days >= 7 && last > a ? (last - a) / days : null;
  };
  const milesPerDay = rate(r.rm_first, r.rm_first_on, num(r.cur_miles), r.miles_read_on);
  const hoursPerDay = rate(r.rh_first, r.rh_first_on, curHours, r.hours_read_on);
  // The day the miles or hours are expected to be reached, from the last reading and the rate.
  const projected = (left: number | null, perDay: number | null, readOn: unknown): string | null => {
    if (left === null) return null;
    if (left <= 0) return iso(readOn) && perDay ? addDays(iso(readOn)!, Math.floor(left / perDay)) : today;
    if (!perDay || !iso(readOn)) return null;
    return addDays(iso(readOn)!, Math.ceil(left / perDay));
  };
  const candidates = [nextDate, projected(milesLeft, milesPerDay, r.miles_read_on), projected(hoursLeft, hoursPerDay, r.hours_read_on)].filter(Boolean) as string[];
  const dueOn = candidates.length ? candidates.sort()[0] : null;
  const warn = (given: unknown, every: number | null) => (num(given) !== null ? num(given)! : every !== null ? Math.ceil(every * DEFAULT_WARN_SHARE) : 0);
  const overdue = (milesLeft !== null && milesLeft <= 0) || (hoursLeft !== null && hoursLeft <= 0) || (daysLeft !== null && daysLeft < 0);
  const wDays = warn(r.warn_days, everyDays);
  const soon = (milesLeft !== null && milesLeft <= warn(r.warn_miles, everyMiles)) || (hoursLeft !== null && hoursLeft <= warn(r.warn_hours, everyHours))
    || (daysLeft !== null && daysLeft <= wDays) || (dueOn !== null && daysBetween(today, dueOn) <= Math.max(wDays, 7));
  return {
    vehicle_id: r.vehicle_id, fleet_number: r.fleet_number, depot_id: r.depot_id ?? null, depot: r.depot ?? null, model_id: r.model_id ?? null, model: r.model ?? null,
    interval_id: r.interval_id, interval_ref: r.interval_ref ?? null, interval: r.interval, owner_id: r.owner_id ?? null, owner: r.owner ?? null,
    every_miles: everyMiles, every_hours: everyHours, every_days: everyDays,
    last_done_on: iso(r.last_done_on), last_record_id: r.last_record_id ?? null, basis: hasLast ? 'service' : 'start',
    current_miles: curMiles, current_hours: curHours, miles_read_on: iso(r.miles_read_on), hours_read_on: iso(r.hours_read_on),
    next_miles: nextMiles, next_hours: nextHours, next_date: nextDate,
    miles_left: milesLeft, hours_left: hoursLeft, days_left: daysLeft,
    miles_per_day: milesPerDay === null ? null : Math.round(milesPerDay * 10) / 10, hours_per_day: hoursPerDay === null ? null : Math.round(hoursPerDay * 100) / 100,
    due_on: dueOn, state: overdue ? 'overdue' : soon ? 'due_soon' : 'ok',
  };
}

const ORDER: Record<DueState, number> = { overdue: 0, due_soon: 1, ok: 2 };
const sortDue = (a: DueRow, b: DueRow) => ORDER[a.state] - ORDER[b.state] || (a.due_on ?? '9999').localeCompare(b.due_on ?? '9999') || a.fleet_number.localeCompare(b.fleet_number, 'en', { numeric: true });

function registerDueRoutes(ctx: ModuleContext) {
  const view = { preHandler: ctx.requirePerm('fleet.view') };
  const uuidOr = (v: unknown, name: string): string | undefined => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string' || !UUID.test(v)) ctx.fail(400, 'bad_filter', `That ${name} filter is not valid.`);
    return v as string;
  };

  ctx.app.get('/api/fleet/maintenance/due', view, async (req) => {
    const q = req.query as Record<string, unknown>;
    const state = typeof q.state === 'string' && q.state ? q.state : 'open';
    if (!['open', 'overdue', 'due_soon', 'ok', 'all'].includes(state)) ctx.fail(400, 'bad_filter', 'state must be open, overdue, due_soon, ok or all.');
    const rows = (await dueRows(ctx, req.user, {
      vehicleId: uuidOr(q.vehicle, 'vehicle'), intervalId: uuidOr(q.interval, 'interval'), depotId: uuidOr(q.depot, 'depot'), modelId: uuidOr(q.model, 'model'),
    })).sort(sortDue);
    const counts = { overdue: rows.filter((r) => r.state === 'overdue').length, due_soon: rows.filter((r) => r.state === 'due_soon').length, ok: rows.filter((r) => r.state === 'ok').length };
    const shown = state === 'all' ? rows : state === 'open' ? rows.filter((r) => r.state !== 'ok') : rows.filter((r) => r.state === state);
    return { today: dayInZone(), counts, total: shown.length, rows: shown.slice(0, 2000) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/fleet/maintenance/due', permission: 'fleet.view',
    summary: 'Planned maintenance due: every active interval against every vehicle of its model or asset class, with the next due miles, hours and date',
    description: 'From the latest service of the interval on the vehicle (or from zero and the day it entered service), the first of the miles, hours and days reached counts. '
      + '`state`: open (overdue and due soon, the default), overdue, due_soon, ok or all. Only vehicles you may see.',
    query: { state: 'open | overdue | due_soon | ok | all', vehicle: 'vehicle id', interval: 'interval id', depot: 'site id', model: 'vehicle model id' },
    response: '{ today, counts: { overdue, due_soon, ok }, total, rows: [{ vehicle_id, fleet_number, depot, model, interval_id, interval, owner, last_done_on, current_miles, current_hours, next_miles, next_hours, next_date, miles_left, hours_left, days_left, miles_per_day, due_on, state }] }',
  });

  ctx.app.get('/api/vehicles/:id/maintenance', view, async (req) => {
    const id = String((req.params as Row).id ?? '');
    const vehicle = UUID.test(id) ? await ctx.resources.find('vehicle', id, req.user) : undefined;
    if (!vehicle) ctx.fail(404, 'not_found', 'Vehicle not found.');
    const due = (await dueRows(ctx, req.user, { vehicleId: id })).sort(sortDue);
    const readings = await ctx.db.query<Row>(
      `select r.id, r.ref, r.read_on, r.odometer_miles, r.engine_hours, r.source, r.notes, coalesce(u.display_name, r.recorded_by_name) as recorded_by
       from vehicle_readings r left join users u on u.id = r.recorded_by
       where r.vehicle_id = $1 and r.deleted_at is null order by r.read_on desc, r.odometer_miles desc nulls last limit 500`, [id]);
    const services = await ctx.db.query<Row>(
      `select m.id, m.ref, m.done_on, m.odometer_miles, m.engine_hours, m.work_order, m.interval_id, i.name as interval, coalesce(u.display_name, m.recorded_by_name) as recorded_by
       from maintenance_records m left join maintenance_intervals i on i.id = m.interval_id left join users u on u.id = m.recorded_by
       where m.vehicle_id = $1 and m.deleted_at is null order by m.done_on desc, m.created_at desc limit 200`, [id]);
    const fix = (r: Row) => ({ ...r, read_on: iso(r.read_on), done_on: iso(r.done_on), odometer_miles: num(r.odometer_miles), engine_hours: num(r.engine_hours) });
    return { today: dayInZone(), due, readings: readings.map(fix), services: services.map(fix) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vehicles/:id/maintenance', permission: 'fleet.view',
    summary: 'One vehicle\'s planned maintenance: when each interval is next due, its readings (mileage history) and its services',
    response: '{ today, due: DueRow[], readings: [{ id, ref, read_on, odometer_miles, engine_hours, source, recorded_by }], services: [{ id, ref, done_on, interval, odometer_miles, engine_hours, work_order, recorded_by }] }',
  });
}

export type { DueFilter };
