import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS } from '../../core/features.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import { personalFields } from '../../core/retention.ts';
import { validateReference } from '../frameworks/importer.ts';
import { testApp } from '../../test/helpers.ts';
import { loadStarter, zonesBelowTarget } from './routes.ts';

// OT and rail-systems security (E33): OT fields on systems and assets, zones and conduits with their
// levels and restriction, the overview figures, the map, the starter structure file and the switch.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;  // security lead: systems.*, assets.*, security.view
let agent: Client; // agent: systems.*, assets.*, no security.view
let open: string;      // a zone everyone with systems.view sees, below target
let secret: string;    // a restricted zone, at target
let conduit: string;   // open to secret
let plain: string;     // open to a third zone

const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });

beforeAll(async () => {
  process.env.GRC_MODULES = 'admin,inventory,ot,reports,frameworks,risks,notifications';
  t = await testApp();
  lead = await t.as('security_lead');
  agent = await t.as('agent');
}, 60_000);
afterAll(async () => { await t?.close(); delete process.env.GRC_MODULES; });

describe('zones and conduits', () => {
  it('creates zones with a reference, stamps the assessment date and keeps restriction to security.view holders', async () => {
    const a = await agent.post('/api/ot-zones', { name: 'Invented yard control zone', target_level: 'level_3', achieved_level: 'level_2' });
    expect(a.status).toBe(201);
    expect(a.body.ref).toMatch(/^ZON-\d{5}$/);
    expect(a.body.level_assessed_on).toBeTruthy();
    open = a.body.id;
    // Only someone who may see restricted records may restrict a zone.
    expect((await agent.post('/api/ot-zones', { name: 'Invented hidden zone', restricted: true })).status).toBe(403);
    expect((await agent.patch(`/api/ot-zones/${open}`, { restricted: true })).status).toBe(403);
    const s = await lead.post('/api/ot-zones', { name: 'Invented signaling core zone', restricted: true, target_level: 'level_2', achieved_level: 'level_3' });
    expect(s.status).toBe(201);
    secret = s.body.id;
    const third = await lead.post('/api/ot-zones', { name: 'Invented station zone', target_level: 'level_2', achieved_level: 'level_2' });
    // Not assessed counts as below target; achieved below target too.
    const notAssessed = await lead.post('/api/ot-zones', { name: 'Invented back office zone', target_level: 'level_2' });
    expect(notAssessed.body.level_assessed_on).toBeNull();
    const c = await lead.post('/api/ot-conduits', { from_zone_id: open, to_zone_id: secret, remote_access: false, protocols: 'Invented telemetry' });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ restricted: true, name: 'Invented yard control zone to Invented signaling core zone' });
    conduit = c.body.id;
    const p = await agent.post('/api/ot-conduits', { name: 'Invented station link', from_zone_id: open, to_zone_id: third.body.id, remote_access: true });
    expect(p.status).toBe(201);
    expect(p.body.restricted).toBe(false);
    plain = p.body.id;
  });

  it('refuses a conduit to a zone the person cannot see, or from a zone to itself', async () => {
    const res = await agent.post('/api/ot-conduits', { from_zone_id: open, to_zone_id: secret });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.to_zone_id).toMatch(/not found/);
    expect((await lead.post('/api/ot-conduits', { from_zone_id: open, to_zone_id: open })).body.error.fields.to_zone_id).toMatch(/two different zones/);
    // The flag is read-only: nobody sets it by hand.
    expect((await lead.patch(`/api/ot-conduits/${plain}`, { restricted: true })).body.restricted).toBe(false);
  });

  it('hides a restricted zone and its conduits from people without security.view, in lists, records, search and the matrix', async () => {
    expect((await agent.get(`/api/ot-zones/${secret}`)).status).toBe(404);
    expect((await agent.get(`/api/ot-conduits/${conduit}`)).status).toBe(404);
    expect((await agent.get('/api/ot-zones')).body.rows.map((r: any) => r.id)).not.toContain(secret);
    expect((await agent.get('/api/ot-conduits')).body.rows.map((r: any) => r.id)).toEqual([plain]);
    expect((await agent.get('/api/search?q=signaling')).body.some((r: any) => r.id === secret)).toBe(false);
    const matrix = (await agent.get('/api/ot/matrix')).body;
    expect(matrix.zones.map((z: any) => z.id)).not.toContain(secret);
    expect(matrix.conduits.map((c: any) => c.id)).toEqual([plain]);
    expect((await agent.get(`/api/ot-zones/${secret}/members`)).status).toBe(404);
    const full = (await lead.get('/api/ot/matrix')).body;
    expect(full.zones.map((z: any) => z.id)).toContain(secret);
    expect(full.conduits.find((c: any) => c.id === conduit)).toMatchObject({ flagged: true }); // touches a zone below target
    expect(full.zones.find((z: any) => z.id === open).below_target).toBe(true);
    expect(full.zones.find((z: any) => z.id === secret).below_target).toBe(false);
  });

  it('keeps a conduit restricted while either zone is, as its zones change', async () => {
    expect((await lead.patch(`/api/ot-zones/${secret}`, { restricted: false })).status).toBe(200);
    expect((await agent.get(`/api/ot-conduits/${conduit}`)).body.restricted).toBe(false);
    expect((await lead.patch(`/api/ot-zones/${open}`, { restricted: true })).status).toBe(200);
    expect((await t.api.get(`/api/ot-conduits/${plain}`)).body.restricted).toBe(true);
    expect((await agent.get(`/api/ot-conduits/${plain}`)).status).toBe(404);
    // Put things back for the tests that follow.
    expect((await lead.patch(`/api/ot-zones/${open}`, { restricted: false })).status).toBe(200);
    expect((await lead.patch(`/api/ot-zones/${secret}`, { restricted: true })).status).toBe(200);
    expect((await t.api.get(`/api/ot-conduits/${conduit}`)).body.restricted).toBe(true);
    expect((await t.api.get(`/api/ot-conduits/${plain}`)).body.restricted).toBe(false);
  });

  it('marks only the owner as personal data', () => {
    expect(personalFields(t.ctx.resources.get('ot_zone')!)).toEqual(['owner_id']);
    expect(personalFields(t.ctx.resources.get('ot_conduit')!)).toEqual([]);
  });
});

describe('OT systems and assets', () => {
  let systemId: string;

  it('records the OT fields on a system and an asset, and refuses a zone the person cannot see', async () => {
    const sys = await agent.post('/api/systems', {
      name: 'Invented interlocking supervisor', ot_system: true, control_level: 'level_2', safety_related: true,
      vendor_remote_access: 'always_connected', remote_access_path: 'Invented vendor router', patchability: 'cannot_patch', field_location: 'Invented equipment room', zone_id: open,
    });
    expect(sys.status).toBe(201);
    systemId = sys.body.id;
    expect(sys.body).toMatchObject({ ot_system: true, control_level: 'level_2', zone_id: open });
    const hidden = await agent.post('/api/systems', { name: 'Invented hidden system', zone_id: secret });
    expect(hidden.status).toBe(400);
    expect(hidden.body.error.fields.zone_id).toMatch(/not found/);
    expect((await agent.patch(`/api/systems/${systemId}`, { zone_id: secret })).status).toBe(400);
    expect((await lead.post('/api/systems', { name: 'Invented signaling server', ot_system: true, zone_id: secret })).status).toBe(201);
    expect((await agent.post('/api/systems', { name: 'Invented plain system', control_level: 'not_a_level' })).status).toBe(400);
    const asset = await agent.post('/api/assets', { name: 'Invented field controller', ot_asset: true, control_level: 'level_1', firmware_version: '1.2.3', zone_id: open });
    expect(asset.status).toBe(201);
    expect((await agent.post('/api/assets', { name: 'Invented hidden controller', zone_id: secret })).status).toBe(400);
  });

  it('lists a zone\'s members the caller may see', async () => {
    const m = (await agent.get(`/api/ot-zones/${open}/members`)).body;
    expect(m.systems.map((s: any) => s.name)).toEqual(['Invented interlocking supervisor']);
    expect(m.assets.map((a: any) => a.name)).toEqual(['Invented field controller']);
    expect((await lead.get(`/api/ot-zones/${secret}/members`)).body.systems).toHaveLength(1);
  });

  it('counts every record in the summary, the same for everyone', async () => {
    const a = (await agent.get('/api/ot/summary')).body;
    const b = (await lead.get('/api/ot/summary')).body;
    expect(a).toEqual(b);
    expect(a).toMatchObject({
      ot_systems: 2, ot_assets: 1, zones: 4, zones_below_target: 2, conduits: 2, conduits_with_remote_access: 1,
      conduits_flagged: 2, unpatchable: 1, always_connected: 1, without_zone: 0, safety_related: 1,
    });
    expect(a.by_control_level.find((l: any) => l.value === 'level_2').count).toBe(1);
    expect(a.by_control_level.find((l: any) => l.value === '').count).toBe(1);
    expect(await zonesBelowTarget(t.ctx)).toBe(2);
    const metric = metricsAvailable(t.app, t.ctx.resources).find((m) => m.key === 'ot.zones_below_target');
    expect(metric).toBeTruthy();
    const month = (await t.api.get(`/api/metrics?month=${new Date().toISOString().slice(0, 7)}`)).body;
    const value = (month.metrics ?? month).find?.((m: any) => m.key === 'ot.zones_below_target');
    if (value && value.value !== null) expect(value.value).toBe(2);
  });

  it('puts the zone and an OT mark on the relationship map, only for zones the caller may see', async () => {
    const node = (nodes: any[], name: string) => nodes.find((n) => n.label === name);
    const mine = (await agent.get('/api/systems/graph')).body.nodes;
    expect(node(mine, 'Invented interlocking supervisor').attrs).toMatchObject({ ot: 'true', zone: open, zone_name: 'Invented yard control zone' });
    expect(node(mine, 'Invented signaling server').attrs).toMatchObject({ ot: 'true' });
    expect(node(mine, 'Invented signaling server').attrs.zone).toBeUndefined();
    expect(node((await lead.get('/api/systems/graph')).body.nodes, 'Invented signaling server').attrs.zone).toBe(secret);
  });

  it('offers the OT fields and types to the report builder', async () => {
    const types = (await agent.get('/api/reports/catalog')).body.types;
    const system = types.find((x: any) => x.type === 'system');
    const names = JSON.stringify(system.fields);
    for (const f of ['ot_system', 'control_level', 'vendor_remote_access', 'patchability', 'zone_id']) expect(names).toContain(`"${f}"`);
    expect(types.some((x: any) => x.type === 'ot_zone')).toBe(true);
    expect(types.some((x: any) => x.type === 'ot_conduit')).toBe(true);
  });

  it('clears the zone of systems and assets when the zone is deleted', async () => {
    const z = await lead.post('/api/ot-zones', { name: 'Invented short-lived zone' });
    const sys = await lead.post('/api/systems', { name: 'Invented short-lived system', zone_id: z.body.id });
    expect((await lead.del(`/api/ot-zones/${z.body.id}`)).status).toBeLessThan(300);
    expect((await lead.get(`/api/systems/${sys.body.id}`)).body.zone_id).toBeNull();
  });
});

describe('starter structure file (E33-03)', () => {
  it('is a valid reference file holding placeholders and a mapping block only', async () => {
    const file = loadStarter();
    const { ref, errors } = validateReference(file);
    expect(errors).toEqual([]);
    const outcomes = ref!.functions.flatMap((f) => f.categories.flatMap((c) => c.outcomes));
    expect(outcomes.length).toBeGreaterThan(10);
    for (const o of outcomes) expect(o.text).toMatch(/^Fill from your licensed copy/);
    const shipped = JSON.stringify((await import('../frameworks/csf2.json', { with: { type: 'json' } })).default);
    for (const m of file.mappings) {
      expect(outcomes.some((o) => o.code === m.outcome)).toBe(true);
      for (const code of m.outcomes) expect(shipped).toContain(`"${code}"`);
    }
    const res = await agent.get('/api/frameworks/starters/ot-control-structure');
    expect(res.status).toBe(200);
    expect(res.body.key).toBe(file.key);
  });
});

describe('the OT switch', () => {
  it('hides zones, conduits, the OT fields and lists while off, and brings them back as they were', async () => {
    const area = AREAS.find((a) => a.key === 'ot')!;
    expect((await setFeatures({ ot: false })).status).toBe(200);
    for (const url of ['/api/ot/summary', '/api/ot/matrix', '/api/ot-zones', `/api/ot-zones/${open}/members`, '/api/frameworks/starters/ot-control-structure']) {
      const res = await lead.get(url);
      expect(res.status, url).toBe(404);
      expect(res.body.error.code, url).toBe('switched_off');
    }
    const meta = (await lead.get('/api/meta')).body;
    expect(meta.resources.ot_zone).toBeUndefined();
    expect(meta.resources.ot_conduit).toBeUndefined();
    for (const f of area.fields!.system) expect(meta.resources.system.fields[f], f).toBeUndefined();
    for (const f of area.fields!.asset) expect(meta.resources.asset.fields[f], f).toBeUndefined();
    expect(meta.lookups.ot_security_level).toBeUndefined();
    if (area.lists?.includes('ot_control_level')) {
      for (const l of ['ot_control_level', 'vendor_remote_access', 'ot_patchability']) expect(meta.lookups[l], l).toBeUndefined();
    }
    expect((meta.lookups.action_source ?? []).map((v: any) => v.value)).not.toContain('ot');
    const node = (await lead.get('/api/systems/graph')).body.nodes.find((n: any) => n.label === 'Invented interlocking supervisor');
    expect(node.attrs.ot).toBeUndefined();
    expect(metricsAvailable(t.app, t.ctx.resources).some((m) => m.key === 'ot.zones_below_target')).toBe(false);

    expect((await setFeatures({ ot: true })).status).toBe(200);
    expect((await lead.get('/api/ot/summary')).body.ot_systems).toBe(2);
    const back = (await lead.get('/api/meta')).body;
    expect(back.resources.system.fields.zone_id).toMatchObject({ type: 'ref', to: 'ot_zone' });
    expect((await lead.get('/api/systems/graph')).body.nodes.find((n: any) => n.label === 'Invented interlocking supervisor').attrs.zone).toBe(open);
  });
});
