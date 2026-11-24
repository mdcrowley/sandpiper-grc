import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// W19 security review of E39 (vehicle and asset models): each finding has a regression test here.
// Every name and value is invented.
let t: Awaited<ReturnType<typeof testApp>>;
type Row = Record<string, any>;
const ok = (res: { status: number; body: any }, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};
let depot = '';
let adminId = '';
let n = 0;
const vehicle = async (fields: Row) => ok(await t.api.post('/api/vehicles', { fleet_number: `SV-${++n}`, depot_id: depot, ...fields }), 201);
async function role(key: string, grants: string[]) {
  const r = await t.db.one<{ id: string }>('insert into roles (key, name, enabled) values ($1, $1, true) returning id', [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [r!.id, g]);
}

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  depot = ok(await t.api.post('/api/sites', { name: 'Invented Saltmarsh Depot' }), 201).id;
  // sites.view: a vehicle names its depot, and linking a record needs view on its area (E40-13).
  await role('w19_fleet_editor', ['fleet.view', 'fleet.edit', 'fleet.create', 'sites.view']);
  await role('w19_fleet_viewer', ['fleet.view']);
  await role('w19_assets_only', ['assets.view', 'assets.edit', 'assets.create']);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('asset models named in a vehicle model\'s equipment need assets.view', () => {
  let vm: Row; let am: Row;
  beforeAll(async () => {
    am = ok(await t.api.post('/api/asset-models', { name: 'Invented Coinwell F9', asset_type: 'farebox' }), 201);
    vm = ok(await t.api.post('/api/vehicle-models', { name: 'Invented Heron 10', mode: 'bus' }), 201);
    ok(await t.api.put(`/api/vehicle-models/${vm.id}/equipment`, { items: [{ asset_type: 'farebox', count: 1, asset_model_id: am.id }] }));
  });

  it('hides the asset model from someone who may not see assets, and shows only that one is named', async () => {
    const viewer = await t.as('w19_fleet_viewer');
    expect((await viewer.get(`/api/asset-models/${am.id}`)).status).toBe(403);
    const items = ok(await viewer.get(`/api/vehicle-models/${vm.id}/equipment`)).items;
    expect(items).toEqual([expect.objectContaining({ asset_type: 'farebox', asset_model_id: null, asset_model_name: null, asset_model_hidden: true })]);
    expect(JSON.stringify(items)).not.toContain('Coinwell');
    // An administrator still sees it.
    expect(ok(await t.api.get(`/api/vehicle-models/${vm.id}/equipment`)).items[0]).toMatchObject({ asset_model_id: am.id, asset_model_name: 'Invented Coinwell F9' });
  });

  it('refuses naming an asset model without assets.view, in words that name nothing, and keeps the one already named', async () => {
    const editor = await t.as('w19_fleet_editor');
    const wrongType = await editor.put(`/api/vehicle-models/${vm.id}/equipment`, { items: [{ asset_type: 'camera', count: 1, asset_model_id: am.id }] });
    expect(wrongType.status).toBe(400);
    expect(wrongType.body.error.fields['items.0.asset_model_id']).toBe('Choosing an asset model needs permission to see assets.');
    expect(JSON.stringify(wrongType.body)).not.toContain('Coinwell');
    expect((await editor.put(`/api/vehicle-models/${vm.id}/equipment`, { items: [{ asset_type: 'farebox', count: 1, asset_model_id: am.id }] })).status).toBe(400);
    // Saving the list as shown (no asset model) keeps the stored one.
    const saved = ok(await editor.put(`/api/vehicle-models/${vm.id}/equipment`, { items: [{ asset_type: 'farebox', count: 2, asset_model_id: null }, { asset_type: 'camera', count: 1 }] }));
    expect(saved.items.find((i: Row) => i.asset_type === 'farebox')).toMatchObject({ count: 2, asset_model_id: null, asset_model_hidden: true });
    const stored = ok(await t.api.get(`/api/vehicle-models/${vm.id}/equipment`)).items;
    expect(stored.find((i: Row) => i.asset_type === 'farebox')).toMatchObject({ count: 2, asset_model_id: am.id });
    expect(stored.find((i: Row) => i.asset_type === 'camera')).toMatchObject({ asset_model_id: null });
  });
});

describe('a background model change works as the person who saved the model', () => {
  const runJobs = () => t.app.jobs.runDue({ types: ['fleet.model_apply'] });
  let editor: Awaited<ReturnType<typeof t.as>>;
  let vm: Row;
  let members: Row[];
  beforeAll(async () => {
    await t.ctx.settings.set('models.background_after', 1);
    editor = await t.as('w19_fleet_editor');
    vm = ok(await editor.post('/api/vehicle-models', { name: 'Invented Egret 8', mode: 'bus', make: 'Egret Works' }), 201);
    members = [];
    for (let i = 0; i < 3; i++) members.push(ok(await editor.post('/api/vehicles', { fleet_number: `SV-BG-${i}`, depot_id: depot, model_id: vm.id }), 201));
  });
  afterAll(async () => { await t.ctx.settings.set('models.background_after', 200); });

  it('saves each member as that person: their name in the audit and as the last editor', async () => {
    const saved = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret Motor Works' }));
    expect(saved._model_change).toMatchObject({ status: 'queued', total: 3 });
    await runJobs();
    const change = ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved._model_change.id}`));
    expect(change).toMatchObject({ status: 'done', applied: 3 });
    const row = await t.db.one<Row>('select make, updated_by from vehicles where id = $1', [members[0].id]);
    expect(row).toMatchObject({ make: 'Egret Motor Works', updated_by: editor.userId });
    const audit = await t.db.one<Row>(`select actor_id, actor_name, summary from audit_events where record_type = 'vehicle' and record_id = $1 order by id desc limit 1`, [members[0].id]);
    expect(audit).toMatchObject({ actor_id: editor.userId });
    expect(audit!.actor_name).not.toBe('System');
    expect(audit!.summary).toMatch(/from vehicle model Invented Egret 8/);
  });

  it('applies the person\'s lifecycle rules to each member', async () => {
    const lc = t.ctx.resources.get('vehicle')!;
    const spy = vi.spyOn(t.app.lifecycles, 'check').mockImplementation(async (def, _existing, data, req) =>
      (def.type === lc.type && req?.user?.id === editor.userId && 'make' in data ? { make: 'An invented rule refuses this make.' } : {}) as Record<string, string>);
    try {
      const saved = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret Refused' }));
      await runJobs();
      const change = ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved._model_change.id}`));
      expect(change).toMatchObject({ status: 'done', applied: 0 });
      expect(change.refused).toHaveLength(3);
      expect(change.refused[0].message).toBe('An invented rule refuses this make.');
    } finally {
      spy.mockRestore();
    }
  });

  it('stops, changing nothing, when the person can no longer sign in', async () => {
    const saved = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret After Leaving' }));
    await t.db.query(`update users set status = 'disabled' where id = $1`, [editor.userId]);
    try {
      await runJobs();
      const change = ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved._model_change.id}`));
      expect(change).toMatchObject({ status: 'stopped', applied: 0 });
      expect(change.reason).toMatch(/can no longer sign in or edit/);
      expect((await t.db.one<Row>('select make from vehicles where id = $1', [members[0].id]))!.make).not.toBe('Egret After Leaving');
    } finally {
      await t.db.query(`update users set status = 'active' where id = $1`, [editor.userId]);
    }
  });

  it('stops when the person no longer holds fleet.edit', async () => {
    const saved = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret Without Edit' }));
    await t.db.query(`delete from role_permissions where permission = 'fleet.edit' and role_id = (select id from roles where key = 'w19_fleet_editor')`);
    try {
      await runJobs();
      expect(ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved._model_change.id}`))).toMatchObject({ status: 'stopped', applied: 0 });
    } finally {
      await t.db.query(`insert into role_permissions (role_id, permission) select id, 'fleet.edit' from roles where key = 'w19_fleet_editor'`);
    }
  });

  it('keeps one background change per model: a newer one replaces one still waiting and takes its fields', async () => {
    const first = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret One' }))._model_change;
    const second = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { capacity: 61 }))._model_change;
    expect(second).toMatchObject({ status: 'queued' });
    expect([...second.fields].sort()).toEqual(['capacity', 'make']);
    expect(ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${first.id}`))).toMatchObject({ status: 'superseded' });
    const jobs = await t.db.query<Row>(`select id from jobs where dedupe_key = $1 and status in ('queued', 'failed', 'running')`, [`vehicle_model:${vm.id}`]);
    expect(jobs).toHaveLength(1);
    await runJobs();
    expect(ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${second.id}`))).toMatchObject({ status: 'done', applied: 3 });
    expect(await t.db.one<Row>('select make, capacity from vehicles where id = $1', [members[1].id])).toMatchObject({ make: 'Egret One', capacity: 61 });
  });

  it('marks a change stopped when Fleet and services was switched off before it ran', async () => {
    const saved = ok(await editor.patch(`/api/vehicle-models/${vm.id}`, { make: 'Egret While Off' }))._model_change;
    ok(await t.api.patch('/api/admin/features', { features: { fleet: false } }));
    try {
      await runJobs();
    } finally {
      ok(await t.api.patch('/api/admin/features', { features: { fleet: true } }));
    }
    const change = ok(await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved.id}`));
    expect(change).toMatchObject({ status: 'stopped', applied: 0 });
    expect(change.reason).toMatch(/switched off/);
  });
});

describe('model ids and missing models', () => {
  it('answers a malformed model id with 400, not a server error', async () => {
    for (const bad of ['------------------------------------', 'gggggggg-gggg-gggg-gggg-gggggggggggg', '12345678-1234-1234-1234-12345678901']) {
      const res = await t.api.post('/api/assets', { name: 'Invented malformed', model_id: bad });
      expect(res.status, bad).toBe(400);
      expect(res.body.error.fields.model_id).toBeTruthy();
    }
    const v = await vehicle({ mode: 'bus' });
    expect((await t.api.patch(`/api/vehicles/${v.id}`, { model_id: '------------------------------------' })).status).toBe(400);
  });

  it('saves a member whose model is gone as one with no model, keeping its values', async () => {
    const am = ok(await t.api.post('/api/asset-models', { name: 'Invented Vanished V1', make: 'Vanished' }), 201);
    const a = ok(await t.api.post('/api/assets', { name: 'Invented orphan', model_id: am.id }), 201);
    await t.db.query('update asset_models set deleted_at = now() where id = $1', [am.id]);
    const saved = ok(await t.api.patch(`/api/assets/${a.id}`, { notes: 'Invented note' }));
    expect(saved).toMatchObject({ model_id: null, model_overrides: [], make: 'Vanished', notes: 'Invented note' });
    const b = ok(await t.api.post('/api/assets', { name: 'Invented orphan two', model_id: (await t.api.post('/api/asset-models', { name: 'Invented Vanished V2', make: 'Gone' })).body.id }), 201);
    await t.db.query('update asset_models set deleted_at = now() where id = $1', [b.model_id]);
    const sys = await t.ctx.resources.update('asset', b.id, { notes: 'System note' }, null);
    expect(sys).toMatchObject({ model_id: null, make: 'Gone' });
    // Naming a missing model is still refused.
    expect((await t.api.patch(`/api/assets/${a.id}`, { model_id: am.id })).body.error.fields.model_id).toMatch(/not found/);
  });

  it('after deleting a model, looks again: a member given it at the same moment is left with no model', async () => {
    const vm = ok(await t.api.post('/api/vehicle-models', { name: 'Invented Plover 4', mode: 'bus', make: 'Plover' }), 201);
    const v = await vehicle({ mode: 'bus' });
    // The member count before the delete misses a member given the model at the same moment.
    const realOne = t.db.one.bind(t.db);
    let raced = false;
    const spy = vi.spyOn(t.db, 'one').mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/select count\(\*\)::int c from vehicles where model_id = \$1/.test(sql)) {
        await t.db.query('update vehicles set model_id = $1 where id = $2', [vm.id, v.id]);
        raced = true;
        return { c: 0 } as any;
      }
      return realOne(sql, params);
    });
    try {
      ok(await t.api.del(`/api/vehicle-models/${vm.id}`));
    } finally {
      spy.mockRestore();
    }
    expect(raced).toBe(true);
    expect(await t.db.one<Row>('select model_id from vehicles where id = $1', [v.id])).toMatchObject({ model_id: null });
    const audit = await t.db.one<Row>(`select summary from audit_events where record_type = 'vehicle' and record_id = $1 order by id desc limit 1`, [v.id]);
    expect(audit!.summary).toMatch(/from the removal of vehicle model Invented Plover 4/);
  });

  it('refuses removing a model with members for good, and removes a vehicle model\'s equipment with it', async () => {
    const vm = ok(await t.api.post('/api/vehicle-models', { name: 'Invented Curlew 2', mode: 'bus' }), 201);
    ok(await t.api.put(`/api/vehicle-models/${vm.id}/equipment`, { items: [{ asset_type: 'camera', count: 2 }] }));
    const v = await vehicle({ model_id: vm.id });
    ok(await t.api.put('/api/admin/retention/vehicle_model', { periodMonths: 12, disposal: 'delete' }));
    const review = (await t.db.one<{ id: string }>(`insert into retention_reviews (record_type, record_id) values ('vehicle_model', $1) returning id`, [vm.id]))!;
    const confirm = () => t.db.query('update sessions set confirmed_at = now() where user_id = $1', [adminId]);
    await confirm();
    const url = `/api/admin/retention/reviews/${review.id}/delete`;
    const refused = await t.api.post(url, { reason: 'Invented schedule item.', confirm: true });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'model_in_use']);
    expect((await t.as('w19_fleet_editor').then((c) => c.post(url, { reason: 'x', confirm: true }))).status).toBe(403);
    ok(await t.api.patch(`/api/vehicles/${v.id}`, { model_id: null }));
    await confirm();
    ok(await t.api.post(url, { reason: 'Invented schedule item.', confirm: true }));
    expect(await t.db.one('select id from vehicle_models where id = $1', [vm.id])).toBeUndefined();
    expect(await t.db.query('select id from vehicle_model_equipment where vehicle_model_id = $1', [vm.id])).toHaveLength(0);
  });
});

describe('inherited custom values', () => {
  let num = ''; let risk = ''; let riskId = '';
  beforeAll(async () => {
    num = ok(await t.api.post('/api/admin/custom-fields', { record_type: 'asset', key: 'w19_voltage', label: 'Invented voltage', type: 'number' }), 201).key;
    risk = ok(await t.api.post('/api/admin/custom-fields', { record_type: 'asset', key: 'w19_risk', label: 'Invented linked risk', type: 'ref', to: 'risk' }), 201).key;
    ok(await t.api.put('/api/asset-models/inherited-fields', { custom: [num, risk] }));
    riskId = ok(await t.api.post('/api/risks', { title: 'Invented hidden risk' }), 201).id;
  });

  it('checks values sent as inherited_custom like those sent as cf_<key>, and drops fields that are not inherited', async () => {
    const bad = await t.api.post('/api/asset-models', { name: 'Invented Raw One', inherited_custom: { [num]: { evil: '<img src=x>' } } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields[`cf_${num}`]).toMatch(/must be a number/);
    const m = ok(await t.api.post('/api/asset-models', { name: 'Invented Raw Two', inherited_custom: { [num]: '24', junk: 'x'.repeat(100) } }), 201);
    expect(m.inherited_custom).toEqual({ [num]: 24 });
    ok(await t.api.post('/api/assets', { name: 'Invented raw member', model_id: m.id }), 201);
  });

  it('refuses a custom reference to a record the person cannot see, on a record and on a model', async () => {
    const u = await t.as('w19_assets_only');
    expect((await u.get(`/api/risks/${riskId}`)).status).toBe(403);
    const direct = await u.post('/api/assets', { name: 'Invented direct', [`cf_${risk}`]: riskId });
    expect([direct.status, direct.body.error.fields[`cf_${risk}`]]).toEqual([400, 'Risk not found.']);
    // The same answer as an id that does not exist.
    expect((await u.post('/api/assets', { name: 'Invented missing', [`cf_${risk}`]: '00000000-0000-4000-8000-000000000000' })).body.error.fields[`cf_${risk}`]).toBe('Risk not found.');
    const viaModel = await u.post('/api/asset-models', { name: 'Invented Risky', [`cf_${risk}`]: riskId });
    expect([viaModel.status, viaModel.body.error.fields[`cf_${risk}`]]).toEqual([400, 'Risk not found.']);
    const raw = await u.post('/api/asset-models', { name: 'Invented Risky Raw', inherited_custom: { [risk]: riskId } });
    expect([raw.status, raw.body.error.fields[`cf_${risk}`]]).toEqual([400, 'Risk not found.']);
    // Someone who can see it may link it; an unchanged value is not checked again.
    const a = ok(await t.api.post('/api/assets', { name: 'Invented linked', [`cf_${risk}`]: riskId }), 201);
    ok(await t.api.patch(`/api/assets/${a.id}`, { [`cf_${risk}`]: riskId, notes: 'Invented' }));
  });
});
