import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// All data here is invented. Needs the fleet and inventory modules (GRC_MODULES=fleet,inventory or all).

let t: Awaited<ReturnType<typeof testApp>>;
const ids: Record<string, string> = {};

/** A client holding a role made of exactly these grants. */
async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(
    `insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}

beforeAll(async () => {
  t = await testApp();
  ids.depot = (await t.api.post('/api/sites', { name: 'Test Depot East' })).body.id;
  ids.avl = (await t.api.post('/api/systems', { name: 'Test CAD/AVL', hosting_type: 'on_vehicle' })).body.id;
  ids.video = (await t.api.post('/api/systems', { name: 'Test Video', hosting_type: 'on_vehicle' })).body.id;
  ids.rti = (await t.api.post('/api/systems', { name: 'Test Real-Time Info' })).body.id;
  await t.api.post(`/api/systems/${ids.avl}/integrations`, { to_system_id: ids.rti, direction: 'one_way', method: 'api' });
  const asset = async (name: string, asset_type: string, system_id: string, status = 'in_use') =>
    (await t.api.post('/api/assets', { name, asset_type, system_id, status })).body.id;
  ids.unit1 = await asset('Test AVL unit 1', 'cad_avl_unit', ids.avl);
  ids.unit2 = await asset('Test AVL unit 2', 'cad_avl_unit', ids.avl);
  ids.cam1 = await asset('Test camera 1', 'camera', ids.video, 'in_repair');
  ids.old = await asset('Test old radio', 'radio', ids.avl, 'disposed');
});
afterAll(async () => { await t.close(); });

describe('vehicles', () => {
  it('creates a vehicle and refuses a duplicate fleet number, a bad year and a bad percentage', async () => {
    const res = await t.api.post('/api/vehicles', { fleet_number: ' 3001 ', mode: 'bus', depot_id: ids.depot, model_year: 2022 });
    expect(res.status).toBe(201);
    expect(res.body.fleet_number).toBe('3001');
    expect(res.body.status).toBe('in_service');
    ids.bus = res.body.id;
    expect((await t.api.post('/api/vehicles', { fleet_number: '3001', mode: 'bus' })).body.error.fields.fleet_number).toMatch(/already in use/);
    expect((await t.api.post('/api/vehicles', { fleet_number: '3002', mode: 'bus', model_year: 22 })).body.error.fields.model_year).toBeDefined();
    expect((await t.api.post('/api/vehicles', { fleet_number: '3002', mode: 'bus', funder_interest_pct: 120 })).status).toBe(400);
    expect((await t.api.post('/api/vehicles', { fleet_number: '3002' })).body.error.fields.mode).toBeDefined();
    ids.tram = (await t.api.post('/api/vehicles', { fleet_number: 'T90', mode: 'light_rail' })).body.id;
  });

  it('installs equipment, refuses a second installation of the same asset, and keeps the history', async () => {
    const res = await t.api.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.unit1, install_notes: 'Fitted at the depot' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ asset_id: ids.unit1, current: true, working: true, asset_type: 'cad_avl_unit' });
    ids.install1 = res.body.id;
    const twice = await t.api.post(`/api/vehicles/${ids.tram}/equipment`, { asset_id: ids.unit1 });
    expect(twice.status).toBe(409);
    expect(twice.body.error.message).toMatch(/installed on vehicle 3001/);
    expect((await t.api.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.old })).status).toBe(400);
    expect((await t.api.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.unit2, installed_on: dayInZone(3) })).body.error.fields.installed_on).toMatch(/future/);
    expect((await t.api.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.cam1 })).status).toBe(201);

    const removed = await t.api.post(`/api/vehicles/${ids.bus}/equipment/${ids.install1}/remove`, { removal_reason: 'Moved to the tram' });
    expect(removed.status).toBe(200);
    expect(removed.body.current).toBe(false);
    expect((await t.api.post(`/api/vehicles/${ids.bus}/equipment/${ids.install1}/remove`, {})).status).toBe(409);
    expect((await t.api.post(`/api/vehicles/${ids.tram}/equipment`, { asset_id: ids.unit1 })).status).toBe(201);
    await t.api.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.unit2 });

    const history = (await t.api.get(`/api/assets/${ids.unit1}/installations`)).body;
    expect(history.map((h: any) => [h.fleet_number, h.current])).toEqual([['T90', true], ['3001', false]]);
    const audit = (await t.api.get(`/api/history?record_type=vehicle&record_id=${ids.bus}`)).body;
    expect(JSON.stringify(audit)).toMatch(/Equipment removed from 3001/);
  });

  it('refuses a removal date before the installation date', async () => {
    const eq = (await t.api.get(`/api/vehicles/${ids.bus}/equipment`)).body;
    const cur = eq.installations.find((r: any) => r.current && r.asset_id === ids.unit2);
    const res = await t.api.post(`/api/vehicles/${ids.bus}/equipment/${cur.id}/remove`, { removed_on: '2001-01-01' });
    expect(res.body.error.fields.removed_on).toMatch(/before the installation/);
  });

  it('shows required equipment and coverage gaps, counting equipment in repair as not working', async () => {
    const eq = (await t.api.get(`/api/vehicles/${ids.bus}/equipment`)).body;
    const state = Object.fromEntries(eq.required.map((r: any) => [r.asset_type, r.state]));
    expect(state).toMatchObject({ cad_avl_unit: 'ok', camera: 'not_working', farebox: 'missing' });

    const cov = (await t.api.get('/api/fleet/coverage')).body;
    const bus = cov.vehicles.find((v: any) => v.fleet_number === '3001');
    expect(bus.cells.camera).toBe('not_working');
    expect(bus.cells.cad_avl_unit).toBe('ok');
    expect(bus.cells.passenger_info_display).toBe('not_required');
    expect(bus.gaps).toBeGreaterThan(0);
    expect(cov.columns.find((c: any) => c.value === 'camera')).toMatchObject({ not_working: 1 });
    const busesOnly = (await t.api.get('/api/fleet/coverage?mode=bus&gaps=true')).body;
    expect(busesOnly.vehicles.every((v: any) => v.mode === 'bus' && v.gaps > 0)).toBe(true);
  });

  it('lets an administrator change the required equipment, and checks the values', async () => {
    expect((await t.api.put('/api/fleet/requirements', { bus: ['nonsense'] })).status).toBe(400);
    expect((await t.api.put('/api/fleet/requirements', { rocket: ['camera'] })).status).toBe(400);
    const ok = await t.api.put('/api/fleet/requirements', { bus: ['cad_avl_unit'], light_rail: ['cad_avl_unit'] });
    expect(ok.status).toBe(200);
    const bus = (await t.api.get('/api/fleet/coverage')).body.vehicles.find((v: any) => v.fleet_number === '3001');
    expect(bus.gaps).toBe(0);
  });

  it('refuses to retire a vehicle that still carries equipment', async () => {
    const res = await t.api.patch(`/api/vehicles/${ids.tram}`, { status: 'retired' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('equipment_installed');
  });
});

describe('services and what is affected', () => {
  it('records the systems a service depends on', async () => {
    ids.svc = (await t.api.post('/api/services', { route_code: '9', name: 'Test Crosstown', mode: 'bus' })).body.id;
    expect((await t.api.post('/api/services', { route_code: '9', name: 'Again' })).status).toBe(400);
    const add = await t.api.post(`/api/services/${ids.svc}/systems`, { system_id: ids.rti, dependency: 'passenger_information' });
    expect(add.status).toBe(201);
    expect(add.body.dependency_label).toBe('Passenger information');
    expect((await t.api.post(`/api/services/${ids.svc}/systems`, { system_id: ids.rti })).status).toBe(409);
    expect((await t.api.post(`/api/services/${ids.svc}/systems`, { system_id: ids.avl, dependency: 'bogus' })).status).toBe(400);
    expect((await t.api.get(`/api/systems/${ids.rti}/services`)).body.map((s: any) => s.route_code)).toEqual(['9']);
  });

  it('draws services on the relationship map, tied to the systems they depend on', async () => {
    const graph = (await t.api.get('/api/systems/graph')).body;
    const node = graph.nodes.find((n: any) => n.id === ids.svc);
    expect(node).toMatchObject({ type: 'service', label: 'Test Crosstown', ref: '9', route: `/services/${ids.svc}`, group: 'Services' });
    expect(graph.edges).toContainEqual({ from: ids.rti, to: ids.svc, kind: 'service', label: 'needed for Passenger information' });
    // A service with no dependency, or a discontinued one, is not drawn.
    const lone = (await t.api.post('/api/services', { route_code: '99', name: 'Test lone route', mode: 'bus' })).body.id;
    const gone = (await t.api.post('/api/services', { route_code: '98', name: 'Test old route', mode: 'bus', status: 'discontinued' })).body.id;
    await t.api.post(`/api/services/${gone}/systems`, { system_id: ids.rti });
    const again = (await t.api.get('/api/systems/graph')).body.nodes.map((n: any) => n.id);
    expect(again).not.toContain(lone);
    expect(again).not.toContain(gone);
    // A system's own map reaches its services.
    const focus = (await t.api.get(`/api/systems/graph?focus=${ids.rti}`)).body;
    expect(focus.nodes.map((n: any) => n.id)).toContain(ids.svc);
  });

  it('draws vehicles on the map grouped by depot and mode, tied to the systems whose equipment they carry', async () => {
    await t.api.post(`/api/systems/${ids.avl}/sites`, { site_id: ids.depot }); // puts the depot on the map
    const graph = (await t.api.get('/api/systems/graph')).body;
    const groups = graph.nodes.filter((n: any) => n.type === 'vehicle');
    // 3001 (bus at the depot) and T90 (light rail, no depot): one node per group, never one per vehicle.
    const bus = groups.find((n: any) => n.id === `vehicles:${ids.depot}:bus`);
    expect(bus).toMatchObject({ label: 'Bus ×1 · Test Depot East', group: 'Vehicles', ref: '1 vehicle', route: `/vehicles?f.mode=bus&f.depot_id=${ids.depot}` });
    expect(groups.find((n: any) => n.id === 'vehicles:none:light_rail')).toMatchObject({ label: 'Light rail ×1 · no depot', route: '/vehicles?f.mode=light_rail' });
    expect(graph.edges).toContainEqual({ from: ids.avl, to: bus.id, kind: 'vehicle', label: 'equipment on 1 of 1' });
    expect(graph.edges).toContainEqual({ from: ids.video, to: bus.id, kind: 'vehicle', label: 'equipment on 1 of 1' });
    expect(graph.edges).toContainEqual({ from: bus.id, to: ids.depot, kind: 'depot', label: 'based at' });
    // More vehicles in the same group make the count grow, not the map.
    const extra = (await t.api.post('/api/vehicles', { fleet_number: '3005', mode: 'bus', depot_id: ids.depot })).body.id;
    const again = (await t.api.get('/api/systems/graph')).body;
    expect(again.nodes.filter((n: any) => n.type === 'vehicle')).toHaveLength(groups.length);
    expect(again.nodes.find((n: any) => n.id === bus.id).label).toBe('Bus ×2 · Test Depot East');
    expect(again.edges).toContainEqual({ from: ids.avl, to: bus.id, kind: 'vehicle', label: 'equipment on 1 of 2' });
    await t.api.del(`/api/vehicles/${extra}`);
    // A system's own map reaches its vehicle groups.
    const focus = (await t.api.get(`/api/systems/graph?focus=${ids.video}`)).body;
    expect(focus.nodes.map((n: any) => n.id)).toContain(bus.id);
  });

  it('names the vehicles and services affected by an on-vehicle system outage, directly and downstream', async () => {
    const direct = (await t.api.get(`/api/fleet/impact?system_id=${ids.avl}`)).body;
    expect(direct.vehicles.map((v: any) => v.fleet_number).sort()).toEqual(['3001', 'T90']);
    expect(direct.services).toEqual([]);
    const down = (await t.api.get(`/api/fleet/impact?system_id=${ids.avl}&downstream=true`)).body;
    expect(down.systems.map((s: any) => s.name)).toEqual(['Test CAD/AVL', 'Test Real-Time Info']);
    expect(down.services.map((s: any) => s.route_code)).toEqual(['9']);
    const read = (await t.api.get(`/api/fleet/affected?system_ids=${ids.avl},${ids.rti}`)).body;
    expect(read.vehicles.length).toBe(2);
    expect(read.services.length).toBe(1);
    expect((await t.api.get('/api/fleet/affected?system_ids=nope')).status).toBe(400);
    // The inventory impact view includes them too.
    const inv = (await t.api.get(`/api/systems/${ids.avl}/impact`)).body;
    expect(inv.counts).toMatchObject({ vehicles: 2, services: 1 });
  });

  it('removes a dependency', async () => {
    expect((await t.api.del(`/api/services/${ids.svc}/systems/${ids.rti}`)).status).toBe(200);
    expect((await t.api.del(`/api/services/${ids.svc}/systems/${ids.rti}`)).status).toBe(404);
  });
});

describe('import (core import service)', () => {
  const file = (text: string) => ({ fileName: 'vehicles.csv', content: Buffer.from(text, 'utf8').toString('base64') });
  const mapping = { 'Fleet number': 'fleet_number', Mode: 'mode', Depot: 'depot_id', Make: 'make' };
  it('creates vehicles and updates existing ones by fleet number, with the vehicle rules applied', async () => {
    const csv = 'Fleet number,Mode,Depot,Make\n4001,Bus,Test Depot East,Example\n3001,Bus,Test Depot East,Example Coachworks\n';
    const dry = await t.api.post('/api/import/vehicle', { ...file(csv), mapping, mode: 'upsert', matchKey: 'fleet_number', dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ created: 1, updated: 1, errors: 0 });
    const real = await t.api.post('/api/import/vehicle', { ...file(csv), mapping, mode: 'upsert', matchKey: 'fleet_number', dryRun: false });
    expect(real.body).toMatchObject({ created: 1, updated: 1, errors: 0 });
    expect((await t.api.get(`/api/vehicles/${ids.bus}`)).body.make).toBe('Example Coachworks');
    const made = (await t.api.get('/api/vehicles?f.fleet_number=4001')).body.rows[0];
    expect(made.depot_id).toBe(ids.depot);
    // A bad model year is refused by the vehicle's own rule.
    const bad = await t.api.post('/api/import/vehicle', { ...file('Fleet number,Mode,Year\n4003,Bus,22\n'), mapping: { 'Fleet number': 'fleet_number', Mode: 'mode', Year: 'model_year' }, mode: 'create', matchKey: 'fleet_number', dryRun: false });
    expect(bad.body.errors).toBe(1);
    expect((await t.api.get('/api/vehicles?f.fleet_number=4003')).body.total).toBe(0);
  });
});

describe('permissions', () => {
  it('needs fleet permissions, and assets.view for equipment', async () => {
    const agent = await withGrants('no_fleet', ['assets.view', 'systems.view']); // assets and systems, not fleet
    expect((await agent.get('/api/vehicles')).status).toBe(403);
    expect((await agent.get('/api/fleet/coverage')).status).toBe(403);
    expect((await agent.get(`/api/fleet/affected?system_ids=${ids.avl}`)).status).toBe(403);

    const viewer = await withGrants('fleet_viewer', ['fleet.view']);
    expect((await viewer.get('/api/vehicles')).status).toBe(200);
    expect((await viewer.post('/api/vehicles', { fleet_number: '5001', mode: 'bus' })).status).toBe(403);
    expect((await viewer.post(`/api/vehicles/${ids.bus}/equipment`, { asset_id: ids.unit2 })).status).toBe(403);
    expect((await viewer.get(`/api/vehicles/${ids.bus}/equipment`)).status).toBe(403); // no assets.view
    expect((await viewer.put('/api/fleet/requirements', {})).status).toBe(403);
    expect((await viewer.post('/api/import/vehicle', { fileName: 'v.csv', content: Buffer.from('Fleet number\n1\n').toString('base64'), mapping: { 'Fleet number': 'fleet_number' }, mode: 'create' })).status).toBe(403);
    // Without assets.view the read API leaves vehicles out (it would name assets) but keeps services.
    const read = (await viewer.get(`/api/fleet/affected?system_ids=${ids.avl}`)).body;
    expect(read.vehicles).toEqual([]);

    const editor = await withGrants('fleet_editor', ['fleet.view', 'fleet.edit', 'assets.view', 'systems.view']);
    expect((await editor.get(`/api/vehicles/${ids.bus}/equipment`)).status).toBe(200);
    expect((await editor.put('/api/fleet/requirements', {})).status).toBe(403);
  });

  it('leaves vehicles and services out of the inventory impact view and the map for people without fleet.view', async () => {
    const agent = await t.as('no_fleet');
    const inv = (await agent.get(`/api/systems/${ids.avl}/impact`)).body;
    expect(inv.counts.vehicles).toBe(0);
    expect(inv.vehicles).toEqual([]);
    const graph = (await agent.get('/api/systems/graph')).body;
    expect(graph.nodes.some((n: any) => n.type === 'service')).toBe(false);
    expect(graph.nodes.some((n: any) => n.type === 'vehicle')).toBe(false);
    // fleet.view without assets.view: services, but no vehicles (their equipment is asset information).
    const fleetOnly = await withGrants('fleet_systems', ['fleet.view', 'systems.view']);
    const seen = (await fleetOnly.get('/api/systems/graph')).body;
    expect(seen.nodes.some((n: any) => n.type === 'vehicle')).toBe(false);
    const both = await withGrants('fleet_assets_systems', ['fleet.view', 'systems.view', 'assets.view']);
    expect((await both.get('/api/systems/graph')).body.nodes.some((n: any) => n.type === 'vehicle')).toBe(true);
  });

  it('leaves vehicles off the map while the fleet area is switched off', async () => {
    expect((await t.api.get('/api/systems/graph')).body.nodes.some((n: any) => n.type === 'vehicle')).toBe(true);
    await t.ctx.settings.set('features', { fleet: false });
    try {
      const graph = (await t.api.get('/api/systems/graph')).body;
      expect(graph.nodes.some((n: any) => n.type === 'vehicle' || n.type === 'service')).toBe(false);
    } finally {
      await t.ctx.settings.set('features', { fleet: true });
    }
    expect((await t.api.get('/api/systems/graph')).body.nodes.some((n: any) => n.type === 'vehicle')).toBe(true);
  });

  it('gives the default roles their fleet grants', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/vehicles')).status).toBe(200);
    expect((await agent.post('/api/vehicles', { fleet_number: 'A-1', mode: 'bus' })).status).toBe(201);
    const lead = await t.as('security_lead');
    expect((await lead.get('/api/services')).status).toBe(200);
    expect((await lead.post('/api/services', { route_code: 'L1', name: 'Lead line' })).status).toBe(403);
  });
});
