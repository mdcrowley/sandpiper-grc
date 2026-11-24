import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row } from '../../core/module.ts';
import { isRetired, todayIso } from './shared.ts';
import { assess, requirementsFor } from '../models/equipment.ts';

/**
 * Equipment installed on vehicles (assets from the inventory module, with install and removal
 * history), the equipment each mode of vehicle should carry, and the coverage view that shows
 * which vehicles lack working equipment.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const REQUIRED_SETTING = 'fleet.required_equipment';

/** Equipment each mode should carry, by asset type. Administrators change it on the coverage page. */
export const DEFAULT_REQUIRED: Record<string, string[]> = {
  bus: ['onboard_computer', 'cad_avl_unit', 'farebox', 'validator', 'vehicle_router', 'camera', 'radio'],
  trolleybus: ['onboard_computer', 'cad_avl_unit', 'validator', 'vehicle_router', 'camera', 'radio'],
  light_rail: ['cad_avl_unit', 'validator', 'camera', 'radio', 'passenger_info_display'],
  heavy_rail: ['camera', 'radio', 'passenger_info_display'],
  paratransit: ['cad_avl_unit', 'vehicle_router', 'camera', 'radio'],
  ferry: ['camera', 'radio'],
};
/** Asset status that counts as working equipment. */
const WORKING = 'in_use';

export function registerEquipment(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const needAssets = (req: FastifyRequest) => {
    if (!ctx.resources.get('asset')) ctx.fail(409, 'inventory_missing', 'Equipment needs the inventory module, which is not loaded.');
    if (!ctx.can(req.user, 'assets.view')) ctx.fail(403, 'forbidden', 'You need permission to see assets to work with installed equipment.');
  };
  const vehicleFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('vehicle', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Vehicle not found.');

  async function requirements(): Promise<Record<string, string[]>> {
    const v = await ctx.settings.get<Record<string, string[]>>(REQUIRED_SETTING, DEFAULT_REQUIRED);
    return v && typeof v === 'object' ? v : DEFAULT_REQUIRED;
  }

  /** Installations of one vehicle (or one asset), newest first, with the asset's name and state. */
  async function installations(where: string, id: string): Promise<Row[]> {
    const types = await ctx.lookups.values('asset_type');
    const statuses = await ctx.lookups.values('asset_status');
    const rows = await db.query<Row>(
      `select e.id, e.vehicle_id, e.asset_id, e.installed_on::text as installed_on, e.install_notes,
              e.removed_on::text as removed_on, e.removal_reason, e.created_at, e.removed_at,
              v.fleet_number, v.mode,
              a.tag, a.name as asset_name, a.asset_type, a.status as asset_status, a.system_id, a.serial, a.model_id as asset_model_id,
              cu.display_name as installed_by, ru.display_name as removed_by
       from vehicle_equipment e
       join vehicles v on v.id = e.vehicle_id
       left join assets a on a.id = e.asset_id
       left join users cu on cu.id = e.created_by
       left join users ru on ru.id = e.removed_by
       where e.${where} = $1
       order by (e.removed_on is null) desc, e.installed_on desc, e.created_at desc`, [id]);
    return rows.map((r) => ({
      ...r,
      current: r.removed_on === null,
      working: r.asset_status === WORKING,
      asset_type_label: types.find((t) => t.value === r.asset_type)?.label ?? r.asset_type,
      asset_status_label: statuses.find((s) => s.value === r.asset_status)?.label ?? r.asset_status,
      asset_status_color: statuses.find((s) => s.value === r.asset_status)?.color ?? 'gray',
    }));
  }

  app.get('/api/vehicles/:id/equipment', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    const vehicle = await vehicleFor(req);
    needAssets(req);
    const rows = await installations('vehicle_id', vehicle.id);
    // The mode's list, with what the vehicle's model adds on top (E39-04: kinds, counts, an asset model).
    const required = (await requirementsFor(ctx, await requirements(), [vehicle])).get(vehicle.id) ?? [];
    const types = await ctx.lookups.values('asset_type');
    const current = rows.filter((r) => r.current).map((r) => ({ asset_type: r.asset_type, status: r.asset_status, model_id: r.asset_model_id ?? null }));
    const named = required.map((r) => r.asset_model_id).filter((id): id is string => Boolean(id));
    const assetModels = named.length && ctx.resources.get('asset_model')
      ? new Map((await db.query<{ id: string; name: string }>('select id, name from asset_models where id = any($1::uuid[])', [named])).map((m) => [m.id, m.name]))
      : new Map<string, string>();
    return {
      installations: rows,
      required: required.map((r) => ({
        asset_type: r.asset_type, label: types.find((x) => x.value === r.asset_type)?.label ?? r.asset_type,
        count: r.count, source: r.source, asset_model_id: r.asset_model_id, asset_model_name: r.asset_model_id ? assetModels.get(r.asset_model_id) ?? null : null,
        ...assess(r, current, WORKING),
      })),
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/vehicles/:id/equipment', summary: 'Equipment installed on a vehicle, its history and the required equipment it lacks', permission: 'fleet.view' });

  app.get('/api/assets/:id/installations', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    needAssets(req);
    const asset = (await ctx.resources.find('asset', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Asset not found.');
    return installations('asset_id', asset.id);
  });
  ctx.describeRoute({ method: 'GET', path: '/api/assets/:id/installations', summary: 'The vehicles one asset has been installed on', permission: 'fleet.view' });

  /** Body: { asset_id, installed_on?, install_notes? } */
  app.post('/api/vehicles/:id/equipment', { preHandler: ctx.requirePerm('fleet.edit') }, async (req, reply) => {
    const vehicle = await vehicleFor(req);
    needAssets(req);
    const body = (req.body ?? {}) as Row;
    const assetId = String(body.asset_id ?? '');
    if (!UUID.test(assetId)) invalid({ asset_id: 'Choose the equipment to install.' });
    const asset = (await ctx.resources.find('asset', assetId, req.user)) ?? invalid({ asset_id: 'That asset does not exist.' });
    if (await isRetired(ctx, vehicle.status)) ctx.fail(409, 'vehicle_retired', 'Equipment cannot be installed on a retired vehicle.');
    if (['retired', 'disposed'].includes(asset.status)) invalid({ asset_id: 'Retired or disposed equipment cannot be installed.' });
    const on = body.installed_on ? String(body.installed_on) : todayIso();
    if (!DATE.test(on) || Number.isNaN(Date.parse(on))) invalid({ installed_on: 'Enter a date.' });
    if (on > todayIso()) invalid({ installed_on: 'The installation date cannot be in the future.' });
    const elsewhere = await db.one<Row>(
      `select v.id, v.fleet_number from vehicle_equipment e join vehicles v on v.id = e.vehicle_id
       where e.asset_id = $1 and e.removed_on is null`, [asset.id]);
    if (elsewhere) {
      ctx.fail(409, 'already_installed', elsewhere.id === vehicle.id
        ? 'That equipment is already installed on this vehicle.'
        : `That equipment is installed on vehicle ${elsewhere.fleet_number}. Remove it there first.`);
    }
    const notes = typeof body.install_notes === 'string' && body.install_notes.trim() ? body.install_notes.trim() : null;
    const row = (await db.one<Row>(
      `insert into vehicle_equipment (vehicle_id, asset_id, installed_on, install_notes, created_by) values ($1,$2,$3,$4,$5) returning id`,
      [vehicle.id, asset.id, on, notes, req.user!.id]))!;
    const label = `${asset.tag ? `${asset.tag} ` : ''}${asset.name}`;
    await ctx.audit(req, {
      action: 'vehicle.equipment_install', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Equipment installed on ${vehicle.fleet_number}: ${label}`, after: { asset_id: asset.id, installed_on: on, install_notes: notes },
    });
    await ctx.audit(req, {
      action: 'asset.vehicle_install', recordType: 'asset', recordId: asset.id,
      summary: `Installed on vehicle ${vehicle.fleet_number}`, after: { vehicle_id: vehicle.id, installed_on: on },
    });
    reply.code(201);
    return (await installations('vehicle_id', vehicle.id)).find((r) => r.id === row.id);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/vehicles/:id/equipment', summary: 'Install a piece of equipment (an asset) on a vehicle', permission: 'fleet.edit', body: '{ asset_id, installed_on?, install_notes? }' });

  /** Body: { removed_on?, removal_reason? } */
  app.post('/api/vehicles/:id/equipment/:installId/remove', { preHandler: ctx.requirePerm('fleet.edit') }, async (req) => {
    const vehicle = await vehicleFor(req);
    needAssets(req);
    const installId = (req.params as { installId: string }).installId;
    const row = UUID.test(installId)
      ? await db.one<Row>(`select *, installed_on::text as on_text from vehicle_equipment where id = $1 and vehicle_id = $2`, [installId, vehicle.id])
      : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Installation not found.');
    if (row!.removed_on) ctx.fail(409, 'already_removed', 'That equipment has already been removed.');
    const body = (req.body ?? {}) as Row;
    const off = body.removed_on ? String(body.removed_on) : todayIso();
    if (!DATE.test(off) || Number.isNaN(Date.parse(off))) invalid({ removed_on: 'Enter a date.' });
    if (off > todayIso()) invalid({ removed_on: 'The removal date cannot be in the future.' });
    if (off < row!.on_text) invalid({ removed_on: 'The removal date cannot be before the installation date.' });
    const reason = typeof body.removal_reason === 'string' && body.removal_reason.trim() ? body.removal_reason.trim() : null;
    await db.query(
      `update vehicle_equipment set removed_on = $2, removal_reason = $3, removed_at = now(), removed_by = $4 where id = $1`,
      [row!.id, off, reason, req.user!.id]);
    const label = (await ctx.resources.labelFor('asset', row!.asset_id)) ?? 'equipment';
    await ctx.audit(req, {
      action: 'vehicle.equipment_remove', recordType: 'vehicle', recordId: vehicle.id,
      summary: `Equipment removed from ${vehicle.fleet_number}: ${label}`, before: { asset_id: row!.asset_id }, after: { removed_on: off, removal_reason: reason },
    });
    await ctx.audit(req, {
      action: 'asset.vehicle_remove', recordType: 'asset', recordId: row!.asset_id,
      summary: `Removed from vehicle ${vehicle.fleet_number}`, after: { vehicle_id: vehicle.id, removed_on: off, removal_reason: reason },
    });
    return (await installations('vehicle_id', vehicle.id)).find((r) => r.id === row!.id);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/vehicles/:id/equipment/:installId/remove', summary: 'Record that equipment was taken off a vehicle', permission: 'fleet.edit', body: '{ removed_on?, removal_reason? }' });

  // ---------- required equipment ----------

  app.get('/api/fleet/requirements', { preHandler: ctx.requirePerm('fleet.view') }, async () => requirements());
  ctx.describeRoute({ method: 'GET', path: '/api/fleet/requirements', summary: 'Equipment (asset types) each vehicle mode should carry', permission: 'fleet.view' });

  app.put('/api/fleet/requirements', { preHandler: ctx.requirePerm('fleet.administer') }, async (req) => {
    const body = (req.body ?? {}) as Row;
    const modes = (await ctx.lookups.values('vehicle_mode')).map((m) => m.value);
    const types = (await ctx.lookups.values('asset_type')).map((t) => t.value);
    const out: Record<string, string[]> = {};
    const errors: Record<string, string> = {};
    if (typeof body !== 'object' || Array.isArray(body)) invalid({ requirements: 'Send { mode: [asset types] }.' });
    for (const [mode, list] of Object.entries(body)) {
      if (!modes.includes(mode)) { errors[mode] = `"${mode}" is not a vehicle mode.`; continue; }
      if (!Array.isArray(list)) { errors[mode] = 'Give a list of asset types.'; continue; }
      const bad = list.filter((t) => !types.includes(String(t)));
      if (bad.length) { errors[mode] = `Not an asset type: ${bad.join(', ')}.`; continue; }
      out[mode] = [...new Set(list.map(String))];
    }
    if (Object.keys(errors).length) invalid(errors);
    await ctx.settings.set(REQUIRED_SETTING, out, req);
    return out;
  });
  ctx.describeRoute({ method: 'PUT', path: '/api/fleet/requirements', summary: 'Set the equipment each vehicle mode should carry', permission: 'fleet.administer', body: '{ [mode]: [asset type, ...] }' });

  // ---------- coverage ----------

  /**
   * Every vehicle that has not been retired, with one cell per required asset type: `ok` (working
   * equipment of that type is installed), `not_working` (installed but not in use: in repair, say),
   * `missing`, or `not_required` for the vehicle's mode. Filters: mode, depot_id, status, gaps=true.
   */
  app.get('/api/fleet/coverage', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    needAssets(req);
    const q = req.query as Record<string, string>;
    const req_ = await requirements();
    const typeList = await ctx.lookups.values('asset_type');
    const modes = await ctx.lookups.values('vehicle_mode');
    const statuses = await ctx.lookups.values('vehicle_status');
    const retired = statuses.filter((s) => s.meta?.retired === true).map((s) => s.value);
    const params: unknown[] = [retired];
    const where = ['v.deleted_at is null', 'not (coalesce(v.status, \'\') = any($1::text[]))'];
    const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
    if (list(q.mode).length) { params.push(list(q.mode)); where.push(`v.mode = any($${params.length}::text[])`); }
    if (list(q.status).length) { params.push(list(q.status)); where.push(`v.status = any($${params.length}::text[])`); }
    if (list(q.depot_id).filter((s) => UUID.test(s)).length) { params.push(list(q.depot_id).filter((s) => UUID.test(s))); where.push(`v.depot_id = any($${params.length}::uuid[])`); }
    const vehicles = await db.query<Row>(
      `select v.id, v.fleet_number, v.mode, v.status, v.depot_id, v.model_id, s.name as depot_name
       from vehicles v left join sites s on s.id = v.depot_id
       where ${where.join(' and ')} order by v.fleet_number`, params);
    const fitted = await db.query<Row>(
      `select e.vehicle_id, a.asset_type, a.status, a.model_id from vehicle_equipment e
       join assets a on a.id = e.asset_id and a.deleted_at is null
       where e.removed_on is null and e.vehicle_id = any($1::uuid[])`, [vehicles.map((v) => v.id)]);
    const byVehicle = new Map<string, Row[]>();
    for (const f of fitted) (byVehicle.get(f.vehicle_id) ?? byVehicle.set(f.vehicle_id, []).get(f.vehicle_id)!).push(f);

    // Each vehicle's requirements: its mode's list with its model's equipment on top (E39-04).
    const needs = await requirementsFor(ctx, req_, vehicles);
    const columns = typeList.filter((t) => vehicles.some((v) => (needs.get(v.id) ?? []).some((n) => n.asset_type === t.value)));
    const totals: Record<string, { ok: number; not_working: number; missing: number }> = {};
    for (const c of columns) totals[c.value] = { ok: 0, not_working: 0, missing: 0 };

    let rows = vehicles.map((v) => {
      const need = needs.get(v.id) ?? [];
      const on = (byVehicle.get(v.id) ?? []).map((f) => ({ asset_type: f.asset_type, status: f.status, model_id: f.model_id ?? null }));
      const cells: Record<string, string> = {};
      // Per requirement: how many are needed, where that comes from, and the units counted.
      const detail: Record<string, Row> = {};
      let gaps = 0;
      for (const c of columns) {
        const n = need.find((x) => x.asset_type === c.value);
        if (!n) { cells[c.value] = 'not_required'; continue; }
        const a = assess(n, on, WORKING);
        cells[c.value] = a.state;
        detail[c.value] = { count: n.count, source: n.source, asset_model_id: n.asset_model_id, installed: a.installed, working: a.working, not_working: a.not_working, missing: a.missing };
        totals[c.value][a.state]++;
        if (a.state !== 'ok') gaps++;
      }
      return {
        id: v.id, fleet_number: v.fleet_number, mode: v.mode, status: v.status, depot_id: v.depot_id, depot_name: v.depot_name,
        mode_label: modes.find((m) => m.value === v.mode)?.label ?? v.mode,
        status_label: statuses.find((s) => s.value === v.status)?.label ?? v.status,
        status_color: statuses.find((s) => s.value === v.status)?.color ?? 'gray',
        cells, detail, gaps, model_id: v.model_id ?? null,
      };
    });
    const withGaps = rows.filter((r) => r.gaps > 0).length;
    if (q.gaps === 'true') rows = rows.filter((r) => r.gaps > 0);
    return {
      columns: columns.map((c) => ({ value: c.value, label: c.label, ...totals[c.value] })),
      vehicles: rows,
      summary: { vehicles: vehicles.length, with_gaps: withGaps, fully_equipped: vehicles.length - withGaps },
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/fleet/coverage', summary: 'Equipment coverage: which vehicles lack working required equipment', permission: 'fleet.view',
    query: { mode: 'Vehicle modes, comma-separated', depot_id: 'Depot site ids', status: 'Vehicle statuses', gaps: 'true: only vehicles with a gap' },
  });
}
