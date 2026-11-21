import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { seedPilotEstate } from '../inventory/seed.ts';

/**
 * Pilot profile (E19-13): the organization's own vehicles and services from two optional files in
 * the private seed folder, `vehicles.psv` and `services.psv` (headers in docs/installation.md). Rows
 * are matched by fleet number and by route, so a second run updates rather than duplicates, and an
 * empty cell never clears a value. A row that cannot be loaded is skipped and named in the summary.
 * Depots, and the systems a service depends on, are found by name among the sites and systems, so
 * the inventory's own pilot files are loaded first (that load is idempotent, and the inventory runs
 * it again after this module).
 */
export const VEHICLE_COLUMNS = ['Fleet number', 'Mode', 'Status', 'Make', 'Model', 'Model year', 'Registration', 'Depot', 'In service since', 'Capacity', 'Funding source', 'Funder interest (%)', 'Notes'];
export const SERVICE_COLUMNS = ['Route', 'Name', 'Mode', 'Service type', 'Status', 'Depot', 'Description', 'Systems', 'Notes'];
const FILES = ['vehicles.psv', 'services.psv'];

const cell = (r: Row, k: string): string | null => {
  const s = String(r[k] ?? '').trim();
  return s === '' ? null : s;
};
const anything = (r: Row) => Object.values(r).some((v) => String(v ?? '').trim() !== '');
const reason = (err: unknown) => {
  const fields = (err as { fields?: Record<string, string> }).fields;
  return fields && Object.keys(fields).length ? Object.values(fields).join(' ') : (err as Error).message;
};

export async function seedFleetPilot(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const present = FILES.filter((f) => existsSync(join(opts.seedDir, f)));
  if (!present.length) return `nothing to load: ${FILES.join(' and ')} are not in the seed folder`;
  if (!ctx.resources.get('site') || !ctx.resources.get('system')) return 'skipped: the inventory module is not loaded';
  await seedPilotEstate(ctx, opts);

  const lists = new Map<string, { value: string; label: string }[]>();
  /** A list value from its value or its label, ignoring case: null for an empty cell, false when unknown. */
  const pick = async (list: string, text: string | null): Promise<string | null | false> => {
    if (!text) return null;
    if (!lists.has(list)) lists.set(list, await ctx.lookups.values(list));
    const t = text.toLowerCase();
    return lists.get(list)!.find((v) => v.value.toLowerCase() === t || v.label.toLowerCase() === t)?.value ?? false;
  };
  const idOf = async (table: string, name: string) =>
    (await ctx.db.one<{ id: string }>(`select id from ${table} where lower(name) = lower($1) and deleted_at is null`, [name]))?.id ?? null;
  const skipped: string[] = [];
  const notFound = new Set<string>();
  /** The values given, limited to the fields the record type has now (an option switched off hides some). */
  const known = (type: string, data: Row) => {
    const fields = ctx.resources.get(type)!.fields;
    return Object.fromEntries(Object.entries(data).filter(([k, v]) => v !== null && v !== undefined && k in fields));
  };
  /** Creates the record, or updates the one with the same key (ignoring case). True when created. */
  const upsert = async (type: string, table: string, keyField: string, data: Row): Promise<{ id: string; created: boolean }> => {
    const found = await ctx.db.one<{ id: string }>(`select id from ${table} where lower(${keyField}) = lower($1) and deleted_at is null`, [data[keyField]]);
    if (found) { await ctx.resources.update(type, found.id, known(type, data)); return { id: found.id, created: false }; }
    const row = await ctx.resources.create(type, known(type, data));
    return { id: row.id, created: true };
  };
  const depotOf = async (r: Row) => {
    const depot = cell(r, 'Depot');
    const id = depot ? await idOf('sites', depot) : null;
    if (depot && !id) notFound.add(`depot "${depot}"`);
    return id;
  };

  let vehicles = 0;
  let vehiclesNew = 0;
  if (present.includes('vehicles.psv')) {
    for (const [i, r] of ctx.readSeed(opts, 'vehicles.psv', '|').entries()) {
      const line = `vehicles.psv line ${i + 2}`;
      const fleetNumber = cell(r, 'Fleet number');
      if (!fleetNumber) { if (anything(r)) skipped.push(`${line} (no fleet number)`); continue; }
      try {
        const mode = await pick('vehicle_mode', cell(r, 'Mode'));
        if (!mode) { skipped.push(`${line} (${mode === null ? 'no mode' : `unknown mode "${cell(r, 'Mode')}"`})`); continue; }
        const status = await pick('vehicle_status', cell(r, 'Status'));
        if (status === false) { skipped.push(`${line} (unknown status "${cell(r, 'Status')}")`); continue; }
        const funding = await pick('funding_source', cell(r, 'Funding source'));
        if (funding === false) { skipped.push(`${line} (unknown funding source "${cell(r, 'Funding source')}")`); continue; }
        const since = cell(r, 'In service since');
        if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) { skipped.push(`${line} (In service since must be a date such as 2019-03-01)`); continue; }
        const number = (k: string) => { const s = cell(r, k); return s === null ? null : Number(s.replace(/[%,\s]/g, '')); };
        const capacity = number('Capacity');
        const pct = number('Funder interest (%)');
        if ([capacity, pct].some((n) => n !== null && !Number.isFinite(n))) { skipped.push(`${line} (Capacity and Funder interest (%) must be numbers)`); continue; }
        const { created } = await upsert('vehicle', 'vehicles', 'fleet_number', {
          fleet_number: fleetNumber, mode, status, make: cell(r, 'Make'), model: cell(r, 'Model'), model_year: cell(r, 'Model year'),
          registration: cell(r, 'Registration'), depot_id: await depotOf(r), in_service_date: since, capacity, funding_source: funding,
          funder_interest: pct === null ? null : pct > 0, funder_interest_pct: pct, notes: cell(r, 'Notes'),
        });
        vehicles++;
        if (created) vehiclesNew++;
      } catch (err) {
        skipped.push(`${line} (${reason(err)})`);
      }
    }
  }

  let services = 0;
  let servicesNew = 0;
  let links = 0;
  if (present.includes('services.psv')) {
    for (const [i, r] of ctx.readSeed(opts, 'services.psv', '|').entries()) {
      const line = `services.psv line ${i + 2}`;
      const route = cell(r, 'Route');
      const name = cell(r, 'Name');
      if (!route || !name) { if (anything(r)) skipped.push(`${line} (Route and Name are both needed)`); continue; }
      try {
        const values: Row = {};
        let bad = '';
        for (const [column, list, field] of [['Mode', 'vehicle_mode', 'mode'], ['Service type', 'service_type', 'service_type'], ['Status', 'service_status', 'status']] as const) {
          const v = await pick(list, cell(r, column));
          if (v === false) { bad = `unknown ${column.toLowerCase()} "${cell(r, column)}"`; break; }
          values[field] = v;
        }
        if (bad) { skipped.push(`${line} (${bad})`); continue; }
        const { id, created } = await upsert('service', 'services', 'route_code', {
          route_code: route, name, ...values, depot_id: await depotOf(r), description: cell(r, 'Description'), notes: cell(r, 'Notes'),
        });
        services++;
        if (created) servicesNew++;
        // "System name" or "System name (dependency)", separated by semicolons.
        for (const part of (cell(r, 'Systems') ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
          const m = /^(.*?)\s*\(([^()]*)\)$/.exec(part);
          const systemName = (m ? m[1] : part).trim();
          const dependency = m ? await pick('service_dependency', m[2].trim()) : null;
          if (dependency === false) notFound.add(`dependency "${m![2].trim()}" (recorded as other)`);
          const systemId = await idOf('systems', systemName);
          if (!systemId) { notFound.add(`system "${systemName}"`); continue; }
          const linked = await ctx.db.one(
            'insert into service_systems (service_id, system_id, dependency) values ($1,$2,$3) on conflict do nothing returning system_id',
            [id, systemId, dependency || 'other']);
          if (linked) links++;
        }
      } catch (err) {
        skipped.push(`${line} (${reason(err)})`);
      }
    }
  }
  const absent = FILES.filter((f) => !present.includes(f));
  return [
    `vehicles ${vehicles} (${vehiclesNew} new), services ${services} (${servicesNew} new), new links to systems ${links}`,
    ...(absent.length ? [`not in the seed folder and skipped: ${absent.join(', ')}`] : []),
    ...(notFound.size ? [`not found, left empty: ${[...notFound].join(', ')}`] : []),
    ...(skipped.length ? [`rows skipped: ${skipped.join('; ')}`] : []),
  ].join('; ');
}
