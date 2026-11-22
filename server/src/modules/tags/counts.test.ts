import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Inventory counts (E37-09): starting fixes the expected list; finds by tag value (typed or a handheld
// scanner), by another identifier or by record; unexpected records; several people at once; finishing,
// resolving, raising a ticket or an action; last verified; the report. Invented values only.

type Client = Awaited<ReturnType<Awaited<ReturnType<typeof testApp>>['as']>>;
let t: Awaited<ReturnType<typeof testApp>>;
let agent: Client;
let viewer: Client;     // tags.view only (and inventory views)
let noFleet: Client;    // may count, but may not see vehicles

async function withGrants(key: string, grants: string[]): Promise<Client> {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

const ids: Record<string, string> = {};

beforeAll(async () => {
  process.env.GRC_MODULES ??= 'tags,inventory,fleet,tickets,risks,notifications,workflows,admin,attachments';
  t = await testApp();
  agent = await t.as('agent');
  viewer = await withGrants('count_viewer_test', ['tags.view', 'assets.view', 'sites.view']);
  noFleet = await withGrants('count_nofleet_test', ['tags.view', 'tags.count', 'assets.view', 'sites.view']);
  const site = async (name: string) => (await t.api.post('/api/sites', { name })).body.id as string;
  ids.north = await site('North depot (test)');
  ids.south = await site('South yard (test)');
  const asset = async (name: string, data: Record<string, unknown>) => {
    const res = await t.api.post('/api/assets', { name, status: 'in_use', ...data });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  ids.radio = await asset('Depot radio base', { tag: 'TA-118342', site_id: ids.north, location: 'Room 12' });
  ids.camera = await asset('Yard camera', { tag: 'TA-118359', site_id: ids.north, location: 'Gate', serial: 'SN-77X41' });
  ids.old = await asset('Old printer', { tag: 'TA-118367', site_id: ids.north });
  await t.db.query(`update assets set status = 'disposed' where id = $1`, [ids.old]);
  ids.stray = await asset('Spare switch', { tag: 'SB-004512', site_id: ids.south, location: 'Shelf 3' });
  const bus = await t.api.post('/api/vehicles', { fleet_number: '4107', mode: 'bus', status: 'in_service', depot_id: ids.north, tag_number: 'K7Q2M9' });
  expect(bus.status, JSON.stringify(bus.body)).toBe(201);
  ids.bus = bus.body.id;
});
afterAll(async () => { await t.close(); });

describe('starting a count', () => {
  it('needs tags.count, and the expected list is fixed at the start', async () => {
    expect((await viewer.post('/api/inventory-counts/start', { site_id: ids.north })).status).toBe(403);
    // The generated create needs tags.create as well; the agent has view and count.
    expect((await agent.post('/api/inventory-counts', { site_id: ids.north })).status).toBe(403);
    const res = await agent.post('/api/inventory-counts/start', { site_id: ids.north });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'open', ref: expect.stringMatching(/^CNT-/), title: expect.stringContaining('North depot') });
    ids.count = res.body.id;
    const items = (await agent.get(`/api/inventory-counts/${ids.count}/items`)).body;
    // The site itself, two assets in use and the bus; the disposed printer is not expected.
    expect(items.totals).toEqual({ expected: 4, found: 0, unexpected: 0, pending: 4, missing: 0 });
    expect(items.rows.map((r: any) => r.recordId).sort()).toEqual([ids.north, ids.radio, ids.camera, ids.bus].sort());
    // A record added to the site afterwards is not expected by this count.
    await t.api.post('/api/assets', { name: 'Late arrival', status: 'in_use', site_id: ids.north, tag: 'TA-118375' });
    expect((await agent.get(`/api/inventory-counts/${ids.count}/items`)).body.totals.expected).toBe(4);
  });

  it('narrows by area and record types, and refuses changing what is counted', async () => {
    const roomOnly = await agent.post('/api/inventory-counts/start', { site_id: ids.north, area: 'room 12', record_types: ['asset'] });
    expect(roomOnly.status, JSON.stringify(roomOnly.body)).toBe(201);
    const items = (await agent.get(`/api/inventory-counts/${roomOnly.body.id}/items`)).body;
    expect(items.rows.map((r: any) => r.recordId)).toEqual([ids.radio]);
    expect((await agent.post('/api/inventory-counts/start', { site_id: ids.north, record_types: ['system'] })).body.error.fields.record_types).toBeTruthy();
    expect((await agent.post('/api/inventory-counts/start', { site_id: ids.north, record_types: ['vehicle'], area: 'Bay 2' })).body.error.fields.area).toBeTruthy();
    expect((await agent.post('/api/inventory-counts/start', {})).body.error.fields.site_id).toBeTruthy();
    const edit = await t.api.patch(`/api/inventory-counts/${roomOnly.body.id}`, { site_id: ids.south });
    expect(edit.body.error.fields.site_id).toBeTruthy();
    expect((await t.api.patch(`/api/inventory-counts/${roomOnly.body.id}`, { notes: 'Second pass' })).status).toBe(200);
    expect((await agent.post(`/api/inventory-counts/${roomOnly.body.id}/cancel`)).status).toBe(200);
    expect((await agent.post(`/api/inventory-counts/${roomOnly.body.id}/found`, { value: 'TA-118342' })).body.error.code).toBe('not_open');
  });
});

describe('counting', () => {
  it('finds a typed or scanned value, however it is written, and finding twice is harmless', async () => {
    const found = await agent.post(`/api/inventory-counts/${ids.count}/found`, { value: ' ta-118 342 ', source: 'handheld' });
    expect(found.status, JSON.stringify(found.body)).toBe(200);
    expect(found.body).toMatchObject({ outcome: 'found', item: { recordId: ids.radio, state: 'found', expected: true, label: 'Depot radio base' } });
    expect((await agent.post(`/api/inventory-counts/${ids.count}/found`, { value: 'TA118342' })).body.outcome).toBe('already_found');
  });

  it('finds by another identifier and by record', async () => {
    expect((await agent.post(`/api/inventory-counts/${ids.count}/found`, { value: 'sn-77x41' })).body).toMatchObject({ outcome: 'found', item: { recordId: ids.camera } });
    expect((await agent.post(`/api/inventory-counts/${ids.count}/found`, { recordType: 'site', recordId: ids.north })).body.outcome).toBe('found');
  });

  it('adds a record registered elsewhere as unexpected', async () => {
    const res = await agent.post(`/api/inventory-counts/${ids.count}/found`, { value: 'SB-004512', source: 'code' });
    expect(res.body).toMatchObject({ outcome: 'unexpected', item: { recordId: ids.stray, expected: false, state: 'found' } });
  });

  it('answers unknown values and records the person may not see alike', async () => {
    const unknown = (await noFleet.post(`/api/inventory-counts/${ids.count}/found`, { value: 'ZZ-999999' })).body;
    const hidden = (await noFleet.post(`/api/inventory-counts/${ids.count}/found`, { value: 'K7Q2M9' })).body;
    expect(unknown).toEqual({ outcome: 'not_found', item: null, message: 'Nothing found for ZZ-999999.' });
    expect(hidden).toEqual({ outcome: 'not_found', item: null, message: 'Nothing found for K7Q2M9.' });
    expect((await viewer.post(`/api/inventory-counts/${ids.count}/found`, { value: 'K7Q2M9' })).status).toBe(403);
  });

  it('takes several people counting the same thing at once: one finds it, the other is told', async () => {
    const other = await t.as('agent');
    const results = await Promise.all([
      agent.post(`/api/inventory-counts/${ids.count}/found`, { value: 'K7Q2M9' }),
      other.post(`/api/inventory-counts/${ids.count}/found`, { value: 'k7q2m9' }),
    ]);
    expect(results.map((r) => r.body.outcome).sort()).toEqual(['already_found', 'found']);
    const n = await t.db.one<{ n: number }>(`select count(*)::int n from inventory_count_items where count_id = $1 and record_id = $2`, [ids.count, ids.bus]);
    expect(n!.n).toBe(1);
  });

  it('records the last verified date and place, and logs the lookup', async () => {
    const v = await t.db.one<any>(`select * from tag_verifications where record_type = 'asset' and record_id = $1`, [ids.stray]);
    expect(v).toMatchObject({ site_id: ids.north, count_id: ids.count });
    const log = await t.db.query<any>(`select * from tag_lookups where record_type = 'asset' and record_id = $1`, [ids.radio]);
    expect(log[0]).toMatchObject({ value_key: 'TA118342', source: 'web', action: 'count', outcome: 'current' });
    // A lookup that found nothing the person may see is not tied to a record.
    const hidden = await t.db.query<any>(`select * from tag_lookups where value_key = 'K7Q2M9' and record_id is null`);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('lists items with totals; people without the record\'s permission see no name', async () => {
    const all = (await agent.get(`/api/inventory-counts/${ids.count}/items`)).body;
    expect(all.totals).toEqual({ expected: 4, found: 4, unexpected: 1, pending: 0, missing: 0 });
    const unexpected = (await agent.get(`/api/inventory-counts/${ids.count}/items?expected=false`)).body.rows;
    expect(unexpected.map((r: any) => r.recordId)).toEqual([ids.stray]);
    const masked = (await viewer.get(`/api/inventory-counts/${ids.count}/items`)).body;
    expect(masked.totals).toEqual(all.totals);
    const bus = masked.rows.find((r: any) => r.recordId === ids.bus);
    expect(bus).toMatchObject({ label: 'A record you may not see', route: '', tagValue: null });
  });
});

describe('finishing and the differences', () => {
  let countId = '';
  beforeAll(async () => {
    countId = (await agent.post('/api/inventory-counts/start', { site_id: ids.north, record_types: ['asset'] })).body.id;
    await agent.post(`/api/inventory-counts/${countId}/found`, { value: 'TA-118342' });
    await agent.post(`/api/inventory-counts/${countId}/found`, { value: 'SB-004512' });
  });

  it('cannot resolve before finishing; finishing lists what is missing', async () => {
    expect((await agent.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: [countId], resolution: 'left' })).body.error.code).toBe('not_finished');
    const res = await agent.post(`/api/inventory-counts/${countId}/finish`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Expected: radio, camera and the late arrival.
    expect(res.body.summary).toEqual({ expected: 3, found: 1, unexpected: 1, missing: 2 });
    expect(res.body.missing.map((m: any) => m.label).sort()).toEqual(['Late arrival', 'Yard camera']);
    expect(res.body.unexpected.map((m: any) => m.recordId)).toEqual([ids.stray]);
    const count = (await agent.get(`/api/inventory-counts/${countId}`)).body;
    expect(count).toMatchObject({ status: 'finished', summary: { missing: 2 } });
    expect((await agent.post(`/api/inventory-counts/${countId}/finish`)).body.error.code).toBe('not_open');
    expect((await agent.post(`/api/inventory-counts/${countId}/found`, { value: 'TA-118359' })).body.error.code).toBe('not_open');
    const history = (await agent.get(`/api/history?record_type=inventory_count&record_id=${countId}`)).body;
    expect(JSON.stringify(history)).toContain('inventory_count.finish');
  });

  it('moves unexpected records here and marks missing ones missing', async () => {
    const items = (await agent.get(`/api/inventory-counts/${countId}/items`)).body.rows;
    const stray = items.find((i: any) => i.recordId === ids.stray);
    const camera = items.find((i: any) => i.recordId === ids.camera);
    // Each resolution only for the items it fits.
    const wrong = (await agent.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: [camera.id], resolution: 'moved' })).body;
    expect(wrong).toMatchObject({ resolved: 0, refused: [{ itemId: camera.id }] });
    expect((await viewer.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: [stray.id], resolution: 'moved' })).status).toBe(403);
    expect((await agent.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: [stray.id], resolution: 'moved' })).body).toEqual({ resolved: 1, refused: [] });
    expect((await t.api.get(`/api/assets/${ids.stray}`)).body.site_id).toBe(ids.north);
    expect((await agent.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: [camera.id], resolution: 'marked_missing' })).body.resolved).toBe(1);
    expect((await t.api.get(`/api/assets/${ids.camera}`)).body.status).toBe('missing');
    const after = (await agent.get(`/api/inventory-counts/${countId}/items`)).body.rows;
    expect(after.find((i: any) => i.id === stray.id).resolution).toBe('moved');
    expect((await agent.post(`/api/inventory-counts/${countId}/resolve`, { itemIds: ['x'], resolution: 'moved' })).status).toBe(400);
  });

  it('raises an action or a ticket from the discrepancy summary', async () => {
    const action = await agent.post(`/api/inventory-counts/${countId}/raise`, { kind: 'action' });
    expect(action.status, JSON.stringify(action.body)).toBe(201);
    const a = (await agent.get(`/api/actions/${action.body.id}`)).body;
    expect(a).toMatchObject({ source: 'inventory_count', source_type: 'inventory_count', source_id: countId });
    expect(a.description).toContain('Yard camera');
    expect(a.description).toContain('Missing:');
    const ticket = await agent.post(`/api/inventory-counts/${countId}/raise`, { kind: 'ticket', title: 'Find the yard camera' });
    expect(ticket.status, JSON.stringify(ticket.body)).toBe(201);
    const links = (await agent.get(`/api/links?record_type=inventory_count&record_id=${countId}`)).body;
    expect(links.some((l: any) => l.recordId === ticket.body.id)).toBe(true);
    expect((await agent.get(`/api/inventory-counts/${countId}`)).body.summary.raised).toHaveLength(2);
    expect((await agent.post(`/api/inventory-counts/${countId}/raise`, { kind: 'memo' })).status).toBe(400);
  });
});

describe('report', () => {
  it('gives coverage by site for everyone alike, and the records not verified', async () => {
    const rep = (await agent.get('/api/inventory-counts/report?days=30')).body;
    expect(rep.counts).toMatchObject({ open: 1, finished: 1, canceled: 1 });
    const north = rep.sites.find((s: any) => s.siteId === ids.north);
    // North now holds the site, radio, camera, late arrival, stray (moved) and the bus.
    expect(north).toMatchObject({ records: 6, verified: 5, lastCountId: expect.any(String) });
    const stale = rep.stale.rows.map((r: any) => r.recordId);
    expect(stale).toContain(ids.south);
    expect(stale).not.toContain(ids.radio);
    const masked = (await viewer.get('/api/inventory-counts/report?days=30')).body;
    expect(masked.sites.find((s: any) => s.siteId === ids.north)).toEqual(north);
    // The list follows what the person may see: no vehicles without fleet.view.
    expect((await t.api.get(`/api/inventory-counts/report?days=30&site=${ids.north}`)).body.stale.rows.every((r: any) => r.siteId === ids.north)).toBe(true);
  });
});

describe('switched off', () => {
  it('answers switched_off while the Asset tags area is off', async () => {
    await t.api.patch('/api/admin/features', { features: { tags: false } });
    try {
      await t.api.get('/api/auth/state');
      expect((await t.api.get('/api/inventory-counts')).body.error?.code).toBe('switched_off');
      expect((await t.api.get(`/api/inventory-counts/${ids.count}/items`)).status).toBe(404);
      expect((await t.api.get('/api/inventory-counts/report')).status).toBe(404);
    } finally {
      await t.api.patch('/api/admin/features', { features: { tags: true } });
      await t.api.get('/api/auth/state');
    }
  });
});
