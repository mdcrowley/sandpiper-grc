import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import type { Queryable } from '../../core/db.ts';

/**
 * Equipment a vehicle model adds to the equipment its mode requires (E39-04). The mode's list
 * (setting `fleet.required_equipment`) is the base: each kind there is needed once. The model adds
 * kinds and counts on top: a kind it lists with a higher count raises the count, and a kind it lists
 * with an asset model means only assets of that model count as working. Equipment coverage
 * (`fleet/equipment.ts`) and the vehicle's Equipment tab read the result through `requirementsFor`.
 */

export interface ModelEquipmentItem { id?: string; asset_type: string; count: number; asset_model_id: string | null }

export interface Requirement {
  asset_type: string;
  count: number;
  /** Only assets of this asset model count as working. */
  asset_model_id: string | null;
  /** Where the requirement comes from. */
  source: 'mode' | 'model' | 'mode_and_model';
}

/** The equipment lists of some vehicle models, by model id. */
export async function equipmentOfModels(db: Queryable, modelIds: string[]): Promise<Map<string, ModelEquipmentItem[]>> {
  const out = new Map<string, ModelEquipmentItem[]>();
  const ids = [...new Set(modelIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await db.query<Row>(
    `select e.id, e.vehicle_model_id, e.asset_type, e.count, e.asset_model_id from vehicle_model_equipment e
     join vehicle_models m on m.id = e.vehicle_model_id and m.deleted_at is null
     where e.vehicle_model_id = any($1::uuid[]) order by e.position, e.asset_type`, [ids]);
  for (const r of rows) {
    (out.get(r.vehicle_model_id) ?? out.set(r.vehicle_model_id, []).get(r.vehicle_model_id)!)
      .push({ id: r.id, asset_type: r.asset_type, count: Number(r.count), asset_model_id: r.asset_model_id ?? null });
  }
  return out;
}

/** The mode's list with the model's equipment added on top. */
export function mergeRequirements(modeList: string[], modelItems: ModelEquipmentItem[] = []): Requirement[] {
  const out = new Map<string, Requirement>();
  for (const t of modeList) out.set(t, { asset_type: t, count: 1, asset_model_id: null, source: 'mode' });
  for (const i of modelItems) {
    const had = out.get(i.asset_type);
    if (had) out.set(i.asset_type, { asset_type: i.asset_type, count: Math.max(had.count, i.count), asset_model_id: i.asset_model_id ?? had.asset_model_id, source: 'mode_and_model' });
    else out.set(i.asset_type, { asset_type: i.asset_type, count: i.count, asset_model_id: i.asset_model_id, source: 'model' });
  }
  return [...out.values()];
}

/** One requirement against the equipment installed on a vehicle: working, not working and missing units. */
export function assess(req: Requirement, fitted: { asset_type: string; status: string; model_id: string | null }[], working = 'in_use') {
  const ofType = fitted.filter((f) => f.asset_type === req.asset_type);
  const counts = (f: { status: string; model_id: string | null }) => f.status === working && (!req.asset_model_id || f.model_id === req.asset_model_id);
  const installed = ofType.length;
  const workingUnits = ofType.filter(counts).length;
  const state = workingUnits >= req.count ? 'ok' : installed >= req.count ? 'not_working' : 'missing';
  return {
    state: state as 'ok' | 'not_working' | 'missing',
    installed, working: Math.min(workingUnits, req.count),
    not_working: Math.max(0, Math.min(installed, req.count) - Math.min(workingUnits, req.count)),
    missing: Math.max(0, req.count - installed),
  };
}

/** The requirements of several vehicles (`{ id, mode, model_id }`), by vehicle id. */
export async function requirementsFor(ctx: ModuleContext, byMode: Record<string, string[]>, vehicles: Row[]): Promise<Map<string, Requirement[]>> {
  const models = ctx.resources.get('vehicle_model') ? await equipmentOfModels(ctx.db, vehicles.map((v) => v.model_id).filter(Boolean)) : new Map();
  return new Map(vehicles.map((v) => [v.id, mergeRequirements(byMode[v.mode] ?? [], v.model_id ? models.get(v.model_id) : [])]));
}

export function registerModelEquipment(ctx: ModuleContext) {
  const { app, db } = ctx;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  async function listFor(modelId: string) {
    const types = await ctx.lookups.values('asset_type');
    const items = (await equipmentOfModels(db, [modelId])).get(modelId) ?? [];
    const assetModels = items.some((i) => i.asset_model_id) && ctx.resources.get('asset_model')
      ? new Map((await db.query<{ id: string; name: string }>('select id, name from asset_models where id = any($1::uuid[])', [items.map((i) => i.asset_model_id).filter(Boolean)])).map((r) => [r.id, r.name]))
      : new Map<string, string>();
    return items.map((i) => ({
      ...i,
      asset_type_label: types.find((t) => t.value === i.asset_type)?.label ?? i.asset_type,
      asset_model_name: i.asset_model_id ? assetModels.get(i.asset_model_id) ?? null : null,
    }));
  }

  const modelFor = async (id: string, user: SessionUser | null) =>
    (await ctx.resources.find('vehicle_model', id, user)) ?? ctx.fail(404, 'not_found', 'Vehicle model not found.');

  app.get('/api/vehicle-models/:id/equipment', { preHandler: ctx.requirePerm('fleet.view') }, async (req) => {
    const model = await modelFor((req.params as { id: string }).id, req.user);
    return { items: await listFor(model.id) };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/vehicle-models/:id/equipment', summary: 'Equipment a vehicle model adds to its mode\'s required equipment', permission: 'fleet.view' });

  app.put('/api/vehicle-models/:id/equipment', { preHandler: ctx.requirePerm('fleet.edit') }, async (req) => {
    const model = await modelFor((req.params as { id: string }).id, req.user);
    const body = (req.body ?? {}) as Row;
    const list = Array.isArray(body.items) ? body.items : null;
    if (!list) ctx.fail(400, 'validation', 'Send { items: [{ asset_type, count, asset_model_id? }] }.');
    if (list!.length > 40) ctx.fail(400, 'validation', 'A vehicle model lists at most 40 kinds of equipment.');
    const types = (await ctx.lookups.values('asset_type')).map((t) => t.value);
    const errors: Record<string, string> = {};
    const items: ModelEquipmentItem[] = [];
    for (const [i, raw] of list!.entries()) {
      const r = (raw ?? {}) as Row;
      const type = String(r.asset_type ?? '');
      const count = r.count === undefined || r.count === null || r.count === '' ? 1 : Number(r.count);
      const am = r.asset_model_id ? String(r.asset_model_id) : null;
      if (!types.includes(type)) { errors[`items.${i}.asset_type`] = 'Choose a kind of equipment (an asset type).'; continue; }
      if (items.some((x) => x.asset_type === type)) { errors[`items.${i}.asset_type`] = 'Each kind of equipment is listed once; set its count instead.'; continue; }
      if (!Number.isInteger(count) || count < 1 || count > 50) { errors[`items.${i}.count`] = 'Enter a whole number from 1 to 50.'; continue; }
      if (am) {
        const asset = UUID.test(am) && ctx.resources.get('asset_model') ? await ctx.resources.find('asset_model', am, req.user) : undefined;
        if (!asset) { errors[`items.${i}.asset_model_id`] = 'That asset model was not found.'; continue; }
        if (asset.asset_type && asset.asset_type !== type) { errors[`items.${i}.asset_model_id`] = `Asset model ${asset.name} is not of this kind of equipment.`; continue; }
      }
      items.push({ asset_type: type, count, asset_model_id: am });
    }
    if (Object.keys(errors).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', errors);
    const before = await listFor(model.id);
    await db.tx(async (tx) => {
      await tx.query('delete from vehicle_model_equipment where vehicle_model_id = $1', [model.id]);
      for (const [i, it] of items.entries()) {
        await tx.query(
          'insert into vehicle_model_equipment (vehicle_model_id, asset_type, count, asset_model_id, position, created_by) values ($1,$2,$3,$4,$5,$6)',
          [model.id, it.asset_type, it.count, it.asset_model_id, i, req.user!.id]);
      }
    });
    const after = await listFor(model.id);
    const line = (l: typeof after) => l.map((i) => `${i.count} x ${i.asset_type_label}${i.asset_model_name ? ` (${i.asset_model_name})` : ''}`).join(', ') || 'none';
    await ctx.audit(req, {
      action: 'vehicle_model.equipment', recordType: 'vehicle_model', recordId: model.id,
      summary: `Equipment of vehicle model ${model.name}: ${line(after)}`,
      before: { equipment: before.map(({ asset_type, count, asset_model_id }) => ({ asset_type, count, asset_model_id })) },
      after: { equipment: after.map(({ asset_type, count, asset_model_id }) => ({ asset_type, count, asset_model_id })) },
    });
    return { items: after };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vehicle-models/:id/equipment', summary: 'Set the equipment a vehicle model adds to its mode\'s required equipment', permission: 'fleet.edit',
    body: '{ items: [{ asset_type, count (1-50), asset_model_id? }] }',
  });
}
