import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Invented data only.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

const history = async (type: string, id: string) =>
  (await t.api.get(`/api/history?record_type=${type}&record_id=${id}`)).body.map((h: any) => h.action);

describe('default lists', () => {
  it('include vehicle equipment types and on-vehicle hosting, added to an older install without duplicates', async () => {
    const inventory = (await import('./index.ts')).default;
    // An install from before these values existed.
    await t.db.query(`delete from lookups where list_key = 'asset_type' and value in ('farebox', 'onboard_computer')`);
    await t.db.query(`delete from lookups where list_key = 'hosting_type' and value = 'on_vehicle'`);
    await inventory.seedDefaults!(t.ctx);
    await inventory.seedDefaults!(t.ctx);
    const values = async (list: string) => (await t.db.query<{ value: string }>('select value from lookups where list_key = $1 order by sort, value', [list])).map((r) => r.value);
    const types = await values('asset_type');
    for (const v of ['onboard_computer', 'farebox', 'validator', 'cad_avl_unit', 'vehicle_router', 'camera', 'radio', 'passenger_info_display']) expect(types).toContain(v);
    expect(new Set(types).size).toBe(types.length);
    expect(types.at(-1)).toBe('other');
    expect(await values('hosting_type')).toContain('on_vehicle');
  });
});

describe('create, read, update, delete with audit', () => {
  const cases: [string, string, Record<string, unknown>, Record<string, unknown>][] = [
    ['site', '/api/sites', { name: 'Test Yard', address: '9 Nowhere Lane' }, { function: 'Storage' }],
    ['data_category', '/api/data-categories', { name: 'Test survey answers', sensitivity_level: 'internal' }, { custodian: 'Test custodian' }],
    ['system', '/api/systems', { name: 'Test Ledger', vendor_name: 'Imaginary Ltd', rto_hours: 8 }, { criticality_tier: 'tier_2' }],
    ['asset', '/api/assets', { name: 'Test laptop', asset_type: 'workstation', serial: 'T-CRUD-1' }, { location: 'Shelf 2' }],
  ];
  for (const [type, path, body, patch] of cases) {
    it(`${type}`, async () => {
      const made = await t.api.post(path, body);
      expect(made.status).toBe(201);
      const id = made.body.id;
      expect((await t.api.get(`${path}/${id}`)).body.name).toBe(body.name);
      const changed = await t.api.patch(`${path}/${id}`, patch);
      expect(changed.body).toMatchObject(patch);
      expect((await t.api.get(`${path}?q=Test`)).body.total).toBeGreaterThan(0);
      expect((await t.api.del(`${path}/${id}`)).status).toBe(200);
      expect((await t.api.get(`${path}/${id}`)).status).toBe(404);
      const actions = await t.db.query<{ action: string }>(
        'select action from audit_events where record_type = $1 and record_id = $2 order by id', [type, id],
      );
      expect(actions.map((a) => a.action)).toEqual([`${type}.create`, `${type}.update`, `${type}.delete`]);
    });
  }

  it('numbers systems and assets, and applies defaults', async () => {
    const system = await t.api.post('/api/systems', { name: 'Numbered system' });
    expect(system.body.ref).toMatch(/^SYS-\d{5}$/);
    expect(system.body.status).toBe('in_use');
    expect(system.body.mfa_status).toBe('unknown');
    const asset = await t.api.post('/api/assets', { name: 'Numbered asset' });
    expect(asset.body.tag).toMatch(/^AST-\d{5}$/);
    expect(asset.body.status).toBe('in_stock');
    expect(asset.body.funder_interest).toBe(false);
  });

  it('validates lookups, tags and percentages', async () => {
    expect((await t.api.post('/api/assets', { name: 'Bad type', asset_type: 'spaceship' })).body.error.fields.asset_type).toBeTruthy();
    await t.api.post('/api/assets', { name: 'Tagged', tag: 'CUSTOM-1' });
    expect((await t.api.post('/api/assets', { name: 'Tagged again', tag: 'custom-1' })).body.error.fields.tag).toMatch(/already in use/);
    expect((await t.api.post('/api/assets', { name: 'Too much', funder_interest_pct: 140 })).body.error.fields.funder_interest_pct).toBeTruthy();
    expect((await t.api.post('/api/systems', { name: 'Negative', rto_hours: -1 })).body.error.fields.rto_hours).toBeTruthy();
  });

  it('respects permissions', async () => {
    const pm = await t.as('project_manager');
    expect((await pm.get('/api/systems')).status).toBe(200);
    expect((await pm.post('/api/systems', { name: 'No' })).status).toBe(403);
    expect((await pm.get('/api/assets')).status).toBe(403);
    expect((await pm.get('/api/sites')).status).toBe(403);
  });
});

describe('disposal', () => {
  it('is blocked by the funder interest flag until an approval reference is entered', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Grant-funded switch', funder_interest: true, funder_interest_pct: 80, status: 'retired' })).body;
    const approval = { disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-01' };

    const blocked = await t.api.post(`/api/assets/${asset.id}/dispose`, approval);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('funder_interest_block');
    expect(blocked.body.error.fields.disposal_approval_ref).toBeTruthy();
    // The generic update route is held to the same rule.
    const patched = await t.api.patch(`/api/assets/${asset.id}`, { status: 'disposed', ...approval });
    expect(patched.status).toBe(409);
    expect((await t.api.get(`/api/assets/${asset.id}`)).body.status).toBe('retired');

    const done = await t.api.post(`/api/assets/${asset.id}/dispose`, { ...approval, disposal_approval_ref: 'LETTER-2026-17' });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'disposed', disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-01', disposal_approval_ref: 'LETTER-2026-17' });
    expect(done.body.disposed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const actions = await history('asset', asset.id);
    expect(actions).toContain('asset.dispose_blocked');
    expect(actions).toContain('asset.dispose');
    expect((await t.api.post(`/api/assets/${asset.id}/dispose`, approval)).status).toBe(409);
  });

  it('always needs a recorded approval, with or without funder interest', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Locally funded printer' })).body;
    const none = await t.api.post(`/api/assets/${asset.id}/dispose`, {});
    expect(none.status).toBe(400);
    expect(Object.keys(none.body.error.fields).sort()).toEqual(['disposal_approved_by', 'disposal_approved_on']);
    expect((await t.api.post('/api/assets', { name: 'Born disposed', status: 'disposed' })).status).toBe(400);
    const ok = await t.api.post(`/api/assets/${asset.id}/dispose`, { disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-02' });
    expect(ok.body.status).toBe('disposed');
  });
});

describe('assignment history', () => {
  it('checks an asset out and in, keeping the history', async () => {
    const asset = (await t.api.post('/api/assets', { name: 'Pool tablet' })).body;
    expect((await t.api.post(`/api/assets/${asset.id}/check-out`, {})).body.error.fields.assignee_name).toBeTruthy();
    expect((await t.api.post(`/api/assets/${asset.id}/check-in`, {})).status).toBe(409);

    const out = await t.api.post(`/api/assets/${asset.id}/check-out`, { assignee_name: 'Sam Invented', department: 'Planning', due_back_on: '2027-01-10' });
    expect(out.status).toBe(201);
    expect((await t.api.get(`/api/assets/${asset.id}`)).body).toMatchObject({ status: 'in_use', assigned_to_name: 'Sam Invented', department: 'Planning' });
    expect((await t.api.post(`/api/assets/${asset.id}/check-out`, { assignee_name: 'Someone else' })).status).toBe(409);

    // A status that is not in the list is refused before anything is written: the asset stays checked out.
    expect((await t.api.post(`/api/assets/${asset.id}/check-in`, { status: 'made_up' })).status).toBe(400);
    expect((await t.api.get(`/api/assets/${asset.id}/assignments`)).body[0].open).toBe(true);
    // A check-out to a site that does not exist is refused.
    const other = (await t.api.post('/api/assets', { name: 'Pool phone' })).body;
    const noSite = await t.api.post(`/api/assets/${other.id}/check-out`, { assignee_name: 'Sam Invented', site_id: '00000000-0000-4000-8000-000000000000' });
    expect(noSite.status).toBe(400);
    expect(noSite.body.error.fields.site_id).toBeTruthy();

    expect((await t.api.post(`/api/assets/${asset.id}/check-in`, { notes: 'Screen scratched' })).status).toBe(200);
    expect((await t.api.get(`/api/assets/${asset.id}`)).body).toMatchObject({ status: 'in_stock', assigned_to_name: null });

    const agent = await t.as('agent');
    await t.api.post(`/api/assets/${asset.id}/check-out`, { user_id: agent.userId });
    const rows = (await t.api.get(`/api/assets/${asset.id}/assignments`)).body;
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({ open: true, user_id: agent.userId });
    expect(rows[0].assignee).toMatch(/^Test agent/);
    expect(rows[1]).toMatchObject({ open: false, assignee: 'Sam Invented', check_in_notes: 'Screen scratched' });
    const actions = await history('asset', asset.id);
    expect(actions.filter((a: string) => a === 'asset.check_out').length).toBe(2);
    expect(actions).toContain('asset.check_in');

    // Disposal closes the open assignment.
    await t.api.post(`/api/assets/${asset.id}/dispose`, { disposal_approved_by: 'Pat Example', disposal_approved_on: '2026-11-03' });
    expect((await t.api.get(`/api/assets/${asset.id}/assignments`)).body.every((r: any) => !r.open)).toBe(true);
    expect((await t.api.post(`/api/assets/${asset.id}/check-out`, { assignee_name: 'Too late' })).status).toBe(409);
  });
});
