import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { assess, mergeRequirements } from './equipment.ts';
import { same } from './engine.ts';

// E39: vehicle and asset models. Every name and value is invented.
let t: Awaited<ReturnType<typeof testApp>>;
type Row = Record<string, any>;
const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
let depot = '';
let n = 0;
const vehicle = async (fields: Row) => ok(await t.api.post('/api/vehicles', { fleet_number: `MV-${++n}`, depot_id: depot, ...fields }), 201);

beforeAll(async () => {
  t = await testApp();
  depot = ok(await t.api.post('/api/sites', { name: 'Invented Lanternfield Depot' }), 201).id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('the shared pieces', () => {
  it('compares values the way people see them', () => {
    expect(same(2016, '2016')).toBe(true);
    expect(same('', null)).toBe(true);
    expect(same(' Coachline ', 'Coachline')).toBe(true);
    expect(same(['b', 'a'], ['a', 'b'])).toBe(true);
    expect(same(40, 41)).toBe(false);
  });

  it('adds a model\'s equipment to its mode\'s, raising counts', () => {
    const r = mergeRequirements(['camera', 'radio'], [{ asset_type: 'camera', count: 2, asset_model_id: null }, { asset_type: 'farebox', count: 1, asset_model_id: 'm1' }]);
    expect(r).toEqual([
      { asset_type: 'camera', count: 2, asset_model_id: null, source: 'mode_and_model' },
      { asset_type: 'radio', count: 1, asset_model_id: null, source: 'mode' },
      { asset_type: 'farebox', count: 1, asset_model_id: 'm1', source: 'model' },
    ]);
    const cam = r[0];
    expect(assess(cam, [{ asset_type: 'camera', status: 'in_use', model_id: null }])).toMatchObject({ state: 'missing', working: 1, missing: 1 });
    expect(assess(cam, [{ asset_type: 'camera', status: 'in_use', model_id: null }, { asset_type: 'camera', status: 'in_repair', model_id: null }]))
      .toMatchObject({ state: 'not_working', working: 1, not_working: 1, missing: 0 });
    // Only assets of the named model count as working.
    expect(assess(r[2], [{ asset_type: 'farebox', status: 'in_use', model_id: 'other' }])).toMatchObject({ state: 'not_working', installed: 1, working: 0 });
    expect(assess(r[2], [{ asset_type: 'farebox', status: 'in_use', model_id: 'm1' }])).toMatchObject({ state: 'ok' });
  });
});

describe('vehicle models', () => {
  let model: Row;
  let a: Row; let b: Row; let c: Row;

  it('is a record type in the fleet area with the shared fields', async () => {
    const meta = (await t.api.get('/api/meta')).body.resources;
    expect(meta.vehicle_model).toMatchObject({ module: 'fleet', path: '/api/vehicle-models' });
    expect(Object.keys(meta.vehicle_model.fields)).toEqual(expect.arrayContaining(['name', 'mode', 'make', 'model', 'model_year', 'capacity', 'asset_class_id', 'funding_source', 'description', 'active']));
    expect(meta.vehicle.fields.model_id).toMatchObject({ type: 'ref', to: 'vehicle_model' });
    model = ok(await t.api.post('/api/vehicle-models', { name: 'Invented Tidewater 12', mode: 'bus', make: 'Tidewater Coachline', model: 'TW-12', model_year: '2022', capacity: 80, funding_source: 'grant' }), 201);
    expect(model.model_year).toBe(2022);
    expect((await t.api.post('/api/vehicle-models', { name: 'invented tidewater 12' })).body.error.fields.name).toMatch(/already exists/);
    const inherited = ok(await t.api.get('/api/vehicle-models/inherited-fields'));
    expect(inherited.fields.map((f: Row) => f.field)).toEqual(['mode', 'make', 'model', 'model_year', 'capacity', 'asset_class_id', 'funding_source']);
  });

  it('fills a new vehicle from its model, mode included', async () => {
    a = await vehicle({ model_id: model.id });
    expect(a).toMatchObject({ mode: 'bus', make: 'Tidewater Coachline', model: 'TW-12', model_year: 2022, capacity: 80, funding_source: 'grant', model_overrides: [] });
    expect(a._display.model_id).toBe('Invented Tidewater 12');
    // A value other than the model's becomes an override.
    b = await vehicle({ model_id: model.id, capacity: 70 });
    expect(b).toMatchObject({ capacity: 70, make: 'Tidewater Coachline', model_overrides: ['capacity'] });
    c = await vehicle({ model_id: model.id });
  });

  it('makes an override when an inherited field is edited, and clears it on request', async () => {
    const edited = ok(await t.api.patch(`/api/vehicles/${a.id}`, { make: 'Tidewater (rebuilt)' }));
    expect(edited.model_overrides).toEqual(['make']);
    const cleared = ok(await t.api.patch(`/api/vehicles/${a.id}`, { model_overrides: [] }));
    expect(cleared).toMatchObject({ make: 'Tidewater Coachline', model_overrides: [] });
    // Typing the model's own value is not an override.
    expect(ok(await t.api.patch(`/api/vehicles/${a.id}`, { capacity: '80' })).model_overrides).toEqual([]);
  });

  it('previews a model change, applies it to every member without an override, and records where it came from', async () => {
    await t.ctx.settings.set('integrations.outbound_enabled', true);
    const hook = ok(await t.api.post('/api/admin/webhooks', { name: 'Invented vehicle feed', url: 'https://hooks.example.test/in', events: ['vehicle.*'] }), 201);
    const preview = ok(await t.api.post(`/api/vehicle-models/${model.id}/preview`, { changes: { capacity: 84, make: 'Tidewater Coachline' } }));
    expect(preview).toMatchObject({ members: 3, changing: 2, keepingTotal: 1, background: false });
    expect(preview.fields).toEqual([{ field: 'capacity', label: 'Passenger capacity', changes: 2, keeps: 1 }]);
    expect(preview.keeping[0]).toMatchObject({ id: b.id, fields: ['Passenger capacity'] });

    const saved = ok(await t.api.patch(`/api/vehicle-models/${model.id}`, { capacity: 84 }));
    expect(saved._model_change).toMatchObject({ status: 'done', total: 2, applied: 2, kept: 1, refused: [] });
    expect((await t.api.get(`/api/vehicles/${a.id}`)).body.capacity).toBe(84);
    expect((await t.api.get(`/api/vehicles/${c.id}`)).body.capacity).toBe(84);
    expect((await t.api.get(`/api/vehicles/${b.id}`)).body.capacity).toBe(70);
    const history = ok(await t.api.get(`/api/history?record_type=vehicle&record_id=${a.id}`));
    expect(history.some((h: Row) => /Passenger capacity.*from vehicle model Invented Tidewater 12/.test(h.summary))).toBe(true);
    // Webhooks fire once per member that changed.
    const deliveries = await t.db.query<Row>(`select record_id from webhook_deliveries where webhook_id = $1 and event = 'vehicle.update'`, [hook.id]);
    expect(deliveries.map((d) => d.record_id).sort()).toEqual([a.id, c.id].sort());
    const summary = ok(await t.api.get(`/api/vehicle-models/${model.id}/summary`));
    expect(summary).toMatchObject({ members: 3, overridden: [{ field: 'capacity', count: 1 }] });
    expect(summary.by_status[0]).toMatchObject({ value: 'in_service', count: 3 });
  });

  it('lists a member whose own rules refuse the change and leaves it unchanged', async () => {
    const def = t.ctx.resources.get('vehicle')!;
    const own = def.hooks!.beforeUpdate!;
    def.hooks!.beforeUpdate = async (req, existing, patch) => {
      if (existing.id === c.id && 'make' in patch) t.ctx.fail(400, 'validation', 'Check the highlighted fields.', { make: 'This vehicle is under an invented rule.' });
      return own(req, existing, patch);
    };
    try {
      const saved = ok(await t.api.patch(`/api/vehicle-models/${model.id}`, { make: 'Tidewater Motors' }));
      expect(saved._model_change).toMatchObject({ applied: 2, refused: [{ id: c.id, message: 'This vehicle is under an invented rule.' }] });
      expect((await t.api.get(`/api/vehicles/${c.id}`)).body.make).toBe('Tidewater Coachline');
      expect((await t.api.get(`/api/vehicles/${a.id}`)).body.make).toBe('Tidewater Motors');
    } finally {
      def.hooks!.beforeUpdate = own;
    }
  });

  it('runs a large change as a background job with progress', async () => {
    await t.ctx.settings.set('models.background_after', 1);
    try {
      const saved = ok(await t.api.patch(`/api/vehicle-models/${model.id}`, { funding_source: 'capital' }));
      expect(saved._model_change).toMatchObject({ status: 'queued', total: 3, applied: 0 });
      expect((await t.api.get(`/api/vehicles/${a.id}`)).body.funding_source).toBe('grant');
      await t.app.jobs.runDue({ types: ['fleet.model_apply'] });
      const change = ok(await t.api.get(`/api/vehicle-models/${model.id}/changes/${saved._model_change.id}`));
      expect(change).toMatchObject({ status: 'done', applied: 3 });
      expect((await t.api.get(`/api/vehicles/${a.id}`)).body.funding_source).toBe('capital');
      const audit = await t.db.one<Row>(`select actor_name, summary from audit_events where record_type = 'vehicle' and record_id = $1 order by id desc limit 1`, [a.id]);
      expect(audit!.summary).toMatch(/Funding source.*from vehicle model Invented Tidewater 12/);
    } finally {
      await t.ctx.settings.set('models.background_after', 200);
    }
  });

  it('keeps the values when the model is removed, and refuses an inactive model for a new member', async () => {
    const off = ok(await t.api.patch(`/api/vehicles/${c.id}`, { model_id: null }));
    // The vehicle that refused the make earlier took it at its next save (the background change), as any member does.
    expect(off).toMatchObject({ model_id: null, model_overrides: [], make: 'Tidewater Motors', capacity: 84 });
    const old = ok(await t.api.post('/api/vehicle-models', { name: 'Invented Tidewater 9', mode: 'bus', active: false }), 201);
    expect((await t.api.patch(`/api/vehicles/${c.id}`, { model_id: old.id })).body.error.fields.model_id).toMatch(/inactive/);
    const picker = ok(await t.api.get('/api/records/lookup?type=vehicle_model&q=Invented Tidewater'));
    expect(picker.map((r: Row) => r.label)).toEqual(['Invented Tidewater 12']);
    // A model with members cannot be deleted; one without can.
    const del = await t.api.del(`/api/vehicle-models/${model.id}`);
    expect([del.status, del.body.error.code]).toEqual([409, 'model_in_use']);
    expect((await t.api.del(`/api/vehicle-models/${old.id}`)).status).toBe(200);
  });

  it('assigns a model to selected vehicles, keeping only the differences the person chose', async () => {
    const d = await vehicle({ mode: 'bus', make: 'Tidewater Motors', model: 'TW-12', model_year: 2022, capacity: 76 });
    const e = await vehicle({ mode: 'bus', make: 'Tidewater Motors', model: 'TW-12', model_year: 2022, capacity: 84 });
    const sugg = ok(await t.api.get('/api/vehicle-models/suggestions'));
    expect(sugg.find((s: Row) => s.model_id === model.id)?.ids).toEqual(expect.arrayContaining([d.id, e.id, c.id]));
    const preview = ok(await t.api.post(`/api/vehicle-models/${model.id}/assign/preview`, { ids: [d.id, e.id, a.id] }));
    expect(preview).toMatchObject({ selected: 3, already: 1 });
    expect(preview.fields.find((f: Row) => f.field === 'capacity')).toMatchObject({ differ: 1, examples: [{ id: d.id, value: 76 }] });
    expect(preview.fields.find((f: Row) => f.field === 'funding_source').differ).toBe(2);
    const done = ok(await t.api.post(`/api/vehicle-models/${model.id}/assign`, { ids: [d.id, e.id, a.id], keep: ['capacity'] }));
    expect(done).toMatchObject({ applied: 2, already: 1, refused: [] });
    expect((await t.api.get(`/api/vehicles/${d.id}`)).body).toMatchObject({ model_id: model.id, capacity: 76, model_overrides: ['capacity'], funding_source: 'capital' });
    expect((await t.api.get(`/api/vehicles/${e.id}`)).body).toMatchObject({ model_id: model.id, capacity: 84, model_overrides: [] });
  });

  it('imports vehicles naming their model', async () => {
    const csv = 'Fleet number,Vehicle model\nMV-IMP-1,Invented Tidewater 12\n';
    const res = ok(await t.api.post('/api/import/vehicle', {
      fileName: 'vehicles.csv', content: Buffer.from(csv).toString('base64'),
      mapping: { 'Fleet number': 'fleet_number', 'Vehicle model': 'model_id' }, mode: 'create', matchKey: 'fleet_number', dryRun: false,
    }));
    expect(res.created, JSON.stringify(res.rows)).toBe(1);
    const made = (await t.api.get('/api/vehicles?q=MV-IMP-1')).body.rows[0];
    expect(made).toMatchObject({ model_id: model.id, mode: 'bus', make: 'Tidewater Motors' });
  });

  it('adds the model\'s equipment to the mode\'s in coverage and on the vehicle', async () => {
    const cam = ok(await t.api.post('/api/asset-models', { name: 'Invented Brightlens C2', asset_type: 'camera', make: 'Brightlens', model: 'C2' }), 201);
    expect((await t.api.put(`/api/vehicle-models/${model.id}/equipment`, { items: [{ asset_type: 'camera', count: 2, asset_model_id: cam.id }, { asset_type: 'camera', count: 1 }] })).body.error.fields)
      .toHaveProperty('items.1.asset_type');
    expect((await t.api.put(`/api/vehicle-models/${model.id}/equipment`, { items: [{ asset_type: 'radio', count: 1, asset_model_id: cam.id }] })).body.error.fields)
      .toHaveProperty('items.0.asset_model_id');
    const saved = ok(await t.api.put(`/api/vehicle-models/${model.id}/equipment`, { items: [{ asset_type: 'camera', count: 2, asset_model_id: cam.id }, { asset_type: 'farebox', count: 1 }] }));
    expect(saved.items.map((i: Row) => [i.asset_type, i.count, i.asset_model_name])).toEqual([['camera', 2, 'Invented Brightlens C2'], ['farebox', 1, null]]);

    const one = ok(await t.api.post('/api/assets', { name: 'Invented camera one', asset_type: 'camera', status: 'in_use', model_id: cam.id }), 201);
    const other = ok(await t.api.post('/api/assets', { name: 'Invented camera other', asset_type: 'camera', status: 'in_use', make: 'Elsewhere' }), 201);
    ok(await t.api.post(`/api/vehicles/${a.id}/equipment`, { asset_id: one.id }), 201);
    ok(await t.api.post(`/api/vehicles/${a.id}/equipment`, { asset_id: other.id }), 201);
    const eq = ok(await t.api.get(`/api/vehicles/${a.id}/equipment`));
    const camera = eq.required.find((r: Row) => r.asset_type === 'camera');
    expect(camera).toMatchObject({ count: 2, source: 'mode_and_model', asset_model_name: 'Invented Brightlens C2', installed: 2, working: 1, state: 'not_working' });
    expect(eq.required.find((r: Row) => r.asset_type === 'farebox')).toMatchObject({ source: 'mode_and_model', state: 'missing' });
    const cov = ok(await t.api.get('/api/fleet/coverage?mode=bus'));
    const row = cov.vehicles.find((v: Row) => v.id === a.id);
    expect(row.cells.camera).toBe('not_working');
    expect(row.detail.camera).toMatchObject({ count: 2, working: 1, installed: 2, source: 'mode_and_model' });
  });
});

describe('asset models and inherited custom fields', () => {
  it('inherits type, make, model, funding and support end, and a custom field marked as inherited', async () => {
    const cf = ok(await t.api.post('/api/admin/custom-fields', { record_type: 'asset', label: 'Firmware line', type: 'text' }), 201);
    ok(await t.api.put('/api/asset-models/inherited-fields', { custom: [cf.key] }));
    const fields = ok(await t.api.get('/api/asset-models/inherited-fields')).fields.map((f: Row) => f.field);
    expect(fields).toEqual(['asset_type', 'make', 'model', 'vendor_id', 'asset_class_id', 'funding_source', 'support_end', `cf_${cf.key}`]);
    const m = ok(await t.api.post('/api/asset-models', { name: 'Invented Quaytap V7', asset_type: 'validator', make: 'Quaytap', model: 'V7', support_end: '2030-06-30', [`cf_${cf.key}`]: 'QT-7.x' }), 201);
    expect(m.inherited_custom).toEqual({ [cf.key]: 'QT-7.x' });
    const asset = ok(await t.api.post('/api/assets', { name: 'Invented validator door 1', model_id: m.id }), 201);
    expect(asset).toMatchObject({ asset_type: 'validator', make: 'Quaytap', support_end: '2030-06-30', [`cf_${cf.key}`]: 'QT-7.x' });
    const changed = ok(await t.api.patch(`/api/asset-models/${m.id}`, { [`cf_${cf.key}`]: 'QT-8.x' }));
    expect(changed._model_change).toMatchObject({ applied: 1 });
    expect((await t.api.get(`/api/assets/${asset.id}`)).body[`cf_${cf.key}`]).toBe('QT-8.x');
    // Overriding the custom value keeps it through the next change.
    expect(ok(await t.api.patch(`/api/assets/${asset.id}`, { [`cf_${cf.key}`]: 'QT-8.1 special' })).model_overrides).toEqual([`cf_${cf.key}`]);
    ok(await t.api.patch(`/api/asset-models/${m.id}`, { [`cf_${cf.key}`]: 'QT-9.x' }));
    expect((await t.api.get(`/api/assets/${asset.id}`)).body[`cf_${cf.key}`]).toBe('QT-8.1 special');
  });
});

describe('switched off', () => {
  const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });
  it('hides vehicle models with Fleet and services, and the asset class with Asset condition', async () => {
    ok(await setFeatures({ fleet: false }));
    try {
      const meta = (await t.api.get('/api/meta')).body.resources;
      expect(meta.vehicle_model).toBeUndefined();
      expect(meta.asset_model).toBeDefined();
      const res = await t.api.get('/api/vehicle-models');
      expect([res.status, res.body.error.code]).toEqual([404, 'switched_off']);
      expect((await t.api.get('/api/vehicle-models/suggestions')).status).toBe(404);
      expect((await t.api.get('/api/search?q=Invented Tidewater')).body.some((r: Row) => r.type === 'vehicle_model')).toBe(false);
    } finally {
      ok(await setFeatures({ fleet: true }));
    }
    ok(await setFeatures({ condition: false }));
    try {
      expect(ok(await t.api.get('/api/asset-models/inherited-fields')).fields.map((f: Row) => f.field)).not.toContain('asset_class_id');
      expect((await t.api.get('/api/meta')).body.resources.asset_model.fields.asset_class_id).toBeUndefined();
    } finally {
      ok(await setFeatures({ condition: true }));
    }
  });
});
