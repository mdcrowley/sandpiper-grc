import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { registerEquipment } from './equipment.ts';
import { CONDITION_VEHICLE_FIELDS, ensureFleetConditionLists } from './fields-condition.ts';
import { VEHICLE_MODEL_FIELDS } from './fields-models.ts';
import { registerFleetTaggables, VEHICLE_TAG_FIELDS } from './fields-tags.ts';
import { seedFleet } from './seed.ts';
import { registerServices } from './services.ts';
import { isRetired } from './shared.ts';
import { dayInZone } from '../../core/timezone.ts';

/**
 * Fleet: vehicles and the equipment installed on them, equipment coverage, services (routes
 * and lines) and the systems they depend on, and "what is affected" when a system fails.
 * Permission module `fleet`. Depots are inventory sites; equipment is inventory assets.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'fleet' };
  await ctx.lookups.ensure('vehicle_mode', [
    { value: 'bus', label: 'Bus', color: 'blue', sort: 10 },
    { value: 'trolleybus', label: 'Trolleybus', color: 'teal', sort: 20 },
    { value: 'light_rail', label: 'Light rail', color: 'purple', sort: 30 },
    { value: 'heavy_rail', label: 'Heavy rail', color: 'gray', sort: 40 },
    { value: 'paratransit', label: 'Paratransit / demand-responsive', color: 'orange', sort: 50 },
    { value: 'ferry', label: 'Ferry', color: 'green', sort: 60 },
  ], own);
  // meta.retired: the vehicle has left the fleet (no equipment, left out of coverage).
  await ctx.lookups.ensure('vehicle_status', [
    { value: 'in_service', label: 'In service', color: 'green', sort: 10 },
    { value: 'spare', label: 'Spare', color: 'blue', sort: 20 },
    { value: 'in_maintenance', label: 'In maintenance', color: 'amber', sort: 30 },
    { value: 'out_of_service', label: 'Out of service', color: 'red', sort: 40 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 50, meta: { retired: true } },
  ], own);
  await ctx.lookups.ensure('service_type', [
    { value: 'fixed_route', label: 'Fixed route', color: 'blue', sort: 10 },
    { value: 'express', label: 'Express', color: 'teal', sort: 20 },
    { value: 'demand_responsive', label: 'Demand-responsive', color: 'orange', sort: 30 },
    { value: 'rail_line', label: 'Rail line', color: 'purple', sort: 40 },
    { value: 'other', label: 'Other', color: 'gray', sort: 90 },
  ], own);
  await ctx.lookups.ensure('service_status', [
    { value: 'active', label: 'Running', color: 'green', sort: 10 },
    { value: 'planned', label: 'Planned', color: 'purple', sort: 20 },
    { value: 'suspended', label: 'Suspended', color: 'amber', sort: 30 },
    { value: 'discontinued', label: 'Discontinued', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('service_dependency', [
    { value: 'cad_avl', label: 'CAD/AVL', sort: 10 },
    { value: 'fare_collection', label: 'Fare collection', sort: 20 },
    { value: 'passenger_information', label: 'Passenger information', sort: 30 },
    { value: 'scheduling', label: 'Scheduling', sort: 40 },
    { value: 'radio', label: 'Radio', sort: 50 },
    { value: 'other', label: 'Other', sort: 90 },
  ], own);
  await ensureFleetConditionLists(ctx);
}

const fail = (ctx: ModuleContext, fields: Record<string, string>): never =>
  ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

async function register(ctx: ModuleContext) {
  ctx.defineResource({
    type: 'vehicle', table: 'vehicles', module: 'fleet', label: 'Vehicle', plural: 'Vehicles',
    path: '/api/vehicles', route: '/vehicles', titleField: 'fleet_number',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: 'depot_id' },
    searchable: ['fleet_number', 'make', 'model', 'registration', 'notes'],
    defaultSort: { field: 'fleet_number', dir: 'asc' },
    fields: {
      fleet_number: { label: 'Fleet number', type: 'text', required: true },
      mode: { label: 'Mode', type: 'lookup', list: 'vehicle_mode', required: true },
      status: { label: 'Status', type: 'lookup', list: 'vehicle_status', default: 'in_service' },
      make: { label: 'Make', type: 'text' },
      model: { label: 'Model', type: 'text' },
      // Stored as a whole number; declared as text so it is shown as "2016", not "2,016".
      model_year: { label: 'Model year', type: 'text' },
      registration: { label: 'Registration or vehicle number', type: 'text' },
      depot_id: { label: 'Depot or garage', type: 'ref', to: 'site' },
      in_service_date: { label: 'In service since', type: 'date' },
      capacity: { label: 'Passenger capacity', type: 'number' },
      funding_source: { label: 'Funding source', type: 'lookup', list: 'funding_source' },
      funder_interest: { label: 'Funder interest', type: 'boolean', default: false },
      funder_interest_pct: { label: 'Funder interest (%)', type: 'number' },
      notes: { label: 'Notes', type: 'longtext' },
      ...CONDITION_VEHICLE_FIELDS,
      ...VEHICLE_TAG_FIELDS,
      ...VEHICLE_MODEL_FIELDS,
    },
    hooks: {
      beforeCreate: async (_req, data) => { await checkVehicle(ctx, data, data, null); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkVehicle(ctx, { ...existing, ...patch }, patch, existing); return patch; },
    },
  });

  ctx.defineResource({
    type: 'service', table: 'services', module: 'fleet', label: 'Service', plural: 'Services',
    path: '/api/services', route: '/services', titleField: 'name',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: 'depot_id' },
    searchable: ['route_code', 'name', 'description'],
    defaultSort: { field: 'route_code', dir: 'asc' },
    fields: {
      route_code: { label: 'Route or line', type: 'text', required: true },
      name: { label: 'Name', type: 'text', required: true },
      mode: { label: 'Mode', type: 'lookup', list: 'vehicle_mode' },
      service_type: { label: 'Service type', type: 'lookup', list: 'service_type', default: 'fixed_route' },
      status: { label: 'Status', type: 'lookup', list: 'service_status', default: 'active' },
      depot_id: { label: 'Depot or garage', type: 'ref', to: 'site' },
      description: { label: 'Description', type: 'longtext' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: async (_req, data) => { await checkService(ctx, data, null); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkService(ctx, patch, existing); return patch; },
    },
  });

  registerEquipment(ctx);
  registerServices(ctx);
  registerFleetTaggables(ctx);
}

/** Unique fleet number, a sensible year and percentage, and no retiring a vehicle that still carries equipment. */
async function checkVehicle(ctx: ModuleContext, merged: Row, patch: Row, existing: Row | null) {
  if (typeof patch.fleet_number === 'string') {
    patch.fleet_number = patch.fleet_number.trim();
    const clash = await ctx.db.one<{ id: string }>(
      `select id from vehicles where lower(fleet_number) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)`,
      [patch.fleet_number, existing?.id ?? null]);
    if (clash) fail(ctx, { fleet_number: `Fleet number ${patch.fleet_number} is already in use.` });
  }
  if (patch.model_year === '') patch.model_year = null;
  const year = patch.model_year;
  if (year !== undefined && year !== null) {
    const n = Number(String(year).trim());
    if (!/^\d{4}$/.test(String(year).trim()) || n < 1900 || n > Number(dayInZone().slice(0, 4)) + 2) fail(ctx, { model_year: 'Enter a four-digit year.' });
    patch.model_year = n;
  }
  for (const f of ['capacity'] as const) {
    if (patch[f] !== undefined && patch[f] !== null && Number(patch[f]) < 0) fail(ctx, { [f]: 'Enter zero or more.' });
  }
  const pct = patch.funder_interest_pct;
  if (pct !== undefined && pct !== null && (Number(pct) < 0 || Number(pct) > 100)) {
    fail(ctx, { funder_interest_pct: 'Enter a percentage between 0 and 100.' });
  }
  if (existing && patch.status !== undefined && patch.status !== existing.status && await isRetired(ctx, merged.status)) {
    const on = await ctx.db.one<{ c: number }>(
      'select count(*)::int c from vehicle_equipment where vehicle_id = $1 and removed_on is null', [existing.id]);
    if (on && on.c > 0) {
      ctx.fail(409, 'equipment_installed', `Remove the ${on.c} piece(s) of equipment still installed on this vehicle before retiring it.`);
    }
  }
}

async function checkService(ctx: ModuleContext, patch: Row, existing: Row | null) {
  if (typeof patch.route_code === 'string') {
    patch.route_code = patch.route_code.trim();
    const clash = await ctx.db.one<{ id: string }>(
      `select id from services where lower(route_code) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)`,
      [patch.route_code, existing?.id ?? null]);
    if (clash) fail(ctx, { route_code: `Route or line ${patch.route_code} is already recorded.` });
  }
}

const mod: ModuleDef = {
  key: 'fleet',
  seedDefaults,
  register,
  seed: seedFleet,
};
export default mod;
