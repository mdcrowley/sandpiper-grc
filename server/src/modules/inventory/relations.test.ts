import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Invented estate:  Alpha -> Beta -> Gamma,  Beta <-> Delta,  Epsilon -> Alpha (upstream only).
let t: Awaited<ReturnType<typeof testApp>>;
const sys: Record<string, any> = {};
const site: Record<string, any> = {};
const cat: Record<string, any> = {};
const asset: Record<string, any> = {};

const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

beforeAll(async () => {
  t = await testApp();
  const owner = (await t.as('agent')).userId;
  const make = async (path: string, body: object) => {
    const res = await t.api.post(path, body);
    if (res.status !== 201) throw new Error(`${path}: ${res.text}`);
    return res.body;
  };
  site.north = await make('/api/sites', { name: 'North Workshop' });
  site.south = await make('/api/sites', { name: 'South Office' });
  cat.pay = await make('/api/data-categories', { name: 'Invented pay data', sensitivity_level: 'restricted' });
  cat.open = await make('/api/data-categories', { name: 'Invented public data', sensitivity_level: 'public' });
  cat.unclassified = await make('/api/data-categories', { name: 'Invented unclassified data' });
  sys.alpha = await make('/api/systems', { name: 'Alpha', system_group: 'Ops', vendor_name: 'Vendor One', mfa_status: 'none', rto_hours: 4, rpo_hours: 1, business_owner_id: owner, technical_owner_id: owner });
  sys.beta = await make('/api/systems', { name: 'Beta', system_group: 'Ops', vendor_name: 'Vendor One', mfa_status: 'enforced', rto_hours: 4 });
  sys.gamma = await make('/api/systems', { name: 'Gamma', system_group: 'Finance', vendor_name: 'Not known', business_owner_id: owner });
  sys.delta = await make('/api/systems', { name: 'Delta', system_group: 'Finance', vendor_name: 'Vendor Two', mfa_status: 'optional' });
  sys.epsilon = await make('/api/systems', { name: 'Epsilon', vendor_id: '11111111-2222-4333-8444-555555555555', vendor_name: 'Vendor Three', status: 'retired' });

  asset.server = await make('/api/assets', { name: 'Alpha server', status: 'in_use', system_id: sys.alpha.id, site_id: site.north.id, support_end: day(-10), assigned_to_name: 'Ops team', cost: 500 });
  asset.switch = await make('/api/assets', { name: 'Gamma switch', status: 'in_use', system_id: sys.gamma.id, site_id: site.north.id, warranty_end: day(30), cost: 250, funder_interest: true });
  asset.spare = await make('/api/assets', { name: 'Spare screen', status: 'in_stock', site_id: site.south.id, warranty_end: day(200), support_end: day(400) });
  asset.old = await make('/api/assets', { name: 'Retired box', status: 'retired', support_end: day(-500) });
});
afterAll(async () => { await t.close(); });

describe('integrations, data categories and sites', () => {
  it('adds, lists and removes integrations with audit on both systems', async () => {
    const a = await t.api.post(`/api/systems/${sys.alpha.id}/integrations`, { to_system_id: sys.beta.id, direction: 'one_way', method: 'api', notes: 'Nightly' });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ from_system_id: sys.alpha.id, to_system_id: sys.beta.id, flow: 'out', other_name: 'Beta', method_label: 'API' });
    await t.api.post(`/api/systems/${sys.beta.id}/integrations`, { to_system_id: sys.gamma.id, method: 'file_transfer' });
    await t.api.post(`/api/systems/${sys.beta.id}/integrations`, { to_system_id: sys.delta.id, direction: 'two_way' });
    // "inbound" is stored the other way round: Epsilon -> Alpha.
    const inbound = await t.api.post(`/api/systems/${sys.alpha.id}/integrations`, { to_system_id: sys.epsilon.id, direction: 'inbound' });
    expect(inbound.body).toMatchObject({ from_system_id: sys.epsilon.id, to_system_id: sys.alpha.id, flow: 'in' });

    expect((await t.api.post(`/api/systems/${sys.alpha.id}/integrations`, { to_system_id: sys.beta.id, method: 'api' })).status).toBe(409);
    expect((await t.api.post(`/api/systems/${sys.alpha.id}/integrations`, { to_system_id: sys.alpha.id })).status).toBe(400);
    expect((await t.api.post(`/api/systems/${sys.alpha.id}/integrations`, { to_system_id: sys.gamma.id, method: 'telepathy' })).body.error.fields.method).toBeTruthy();

    const beta = (await t.api.get(`/api/systems/${sys.beta.id}/integrations`)).body;
    expect(beta.map((r: any) => [r.other_name, r.flow]).sort()).toEqual([['Alpha', 'in'], ['Delta', 'both'], ['Gamma', 'out']]);

    const extra = await t.api.post(`/api/systems/${sys.gamma.id}/integrations`, { to_system_id: sys.delta.id, method: 'manual' });
    expect((await t.api.del(`/api/systems/${sys.gamma.id}/integrations/${extra.body.id}`)).status).toBe(200);
    expect((await t.api.del(`/api/systems/${sys.gamma.id}/integrations/${extra.body.id}`)).status).toBe(404);
    for (const id of [sys.gamma.id, sys.delta.id]) {
      const actions = (await t.api.get(`/api/history?record_type=system&record_id=${id}`)).body.map((h: any) => h.action);
      expect(actions).toContain('system.integration_add');
      expect(actions).toContain('system.integration_remove');
    }
  });

  it('links data categories and sites to systems, audited', async () => {
    for (const [s, c] of [[sys.alpha, cat.pay], [sys.beta, cat.pay], [sys.gamma, cat.open], [sys.delta, cat.unclassified]]) {
      expect((await t.api.post(`/api/systems/${s.id}/data-categories`, { data_category_id: c.id })).status).toBe(201);
    }
    expect((await t.api.post(`/api/systems/${sys.alpha.id}/data-categories`, { data_category_id: cat.pay.id })).status).toBe(409);
    await t.api.post(`/api/systems/${sys.alpha.id}/data-categories`, { data_category_id: cat.open.id });
    expect((await t.api.del(`/api/systems/${sys.alpha.id}/data-categories/${cat.open.id}`)).status).toBe(200);
    const held = (await t.api.get(`/api/systems/${sys.alpha.id}/data-categories`)).body;
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ name: 'Invented pay data', sensitivity_label: 'Restricted' });
    expect((await t.api.get(`/api/data-categories/${cat.pay.id}/systems`)).body.map((r: any) => r.name)).toEqual(['Alpha', 'Beta']);

    expect((await t.api.post(`/api/systems/${sys.alpha.id}/sites`, { site_id: site.north.id })).status).toBe(201);
    expect((await t.api.post(`/api/systems/${sys.gamma.id}/sites`, { site_id: site.south.id })).status).toBe(201);
    await t.api.post(`/api/systems/${sys.alpha.id}/sites`, { site_id: site.south.id });
    expect((await t.api.del(`/api/systems/${sys.alpha.id}/sites/${site.south.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/systems/${sys.alpha.id}/sites`)).body.map((r: any) => r.name)).toEqual(['North Workshop']);
    expect((await t.api.get(`/api/sites/${site.north.id}/systems`)).body.map((r: any) => r.name)).toEqual(['Alpha']);

    const actions = (await t.api.get(`/api/history?record_type=system&record_id=${sys.alpha.id}`)).body.map((h: any) => h.action);
    for (const a of ['system.data_category_add', 'system.data_category_remove', 'system.site_add', 'system.site_remove']) expect(actions).toContain(a);
  });
});

describe('relationship graph', () => {
  it('returns typed nodes and edges', async () => {
    const { nodes, edges } = (await t.api.get('/api/systems/graph')).body;
    const byLabel = (label: string) => nodes.find((n: any) => n.label === label);
    expect(nodes.filter((n: any) => n.type === 'system')).toHaveLength(5);
    expect(byLabel('Alpha')).toEqual({ id: sys.alpha.id, type: 'system', label: 'Alpha', group: 'Ops', route: `/systems/${sys.alpha.id}`, ref: sys.alpha.ref });
    for (const n of nodes) expect(Object.keys(n)).toEqual(expect.arrayContaining(['id', 'type', 'label', 'group', 'route']));
    for (const e of edges) {
      expect(Object.keys(e)).toEqual(expect.arrayContaining(['from', 'to', 'kind', 'label']));
      expect(nodes.some((n: any) => n.id === e.from) && nodes.some((n: any) => n.id === e.to)).toBe(true);
    }

    // Vendors: one node per recorded name, keyed by vendor_id when set, none for "Not known".
    const vendors = nodes.filter((n: any) => n.type === 'vendor');
    expect(vendors.map((v: any) => v.label).sort()).toEqual(['Vendor One', 'Vendor Three', 'Vendor Two']);
    expect(byLabel('Vendor One').id).toBe('vendor:vendor one');
    expect(byLabel('Vendor Three').id).toBe('11111111-2222-4333-8444-555555555555');
    expect(edges.filter((e: any) => e.kind === 'vendor' && e.to === 'vendor:vendor one')).toHaveLength(2);

    expect(edges).toContainEqual({ from: sys.alpha.id, to: sys.beta.id, kind: 'integration', direction: 'one_way', label: 'API' });
    expect(edges).toContainEqual({ from: sys.alpha.id, to: site.north.id, kind: 'site', label: 'serves' });
    expect(edges).toContainEqual({ from: sys.alpha.id, to: cat.pay.id, kind: 'data', label: 'holds' });
    expect(edges).toContainEqual({ from: sys.alpha.id, to: asset.server.id, kind: 'asset', label: 'runs on' });
    expect(edges).toContainEqual({ from: asset.server.id, to: site.north.id, kind: 'location', label: 'located at' });
    // Assets not linked to a system stay off the map.
    expect(byLabel('Spare screen')).toBeUndefined();
  });

  it('narrows to one system and respects permissions', async () => {
    const near = (await t.api.get(`/api/systems/graph?focus=${sys.gamma.id}`)).body;
    expect(near.nodes.filter((n: any) => n.type === 'system').map((n: any) => n.label).sort()).toEqual(['Beta', 'Gamma']);
    expect(near.nodes.some((n: any) => n.label === 'Alpha server')).toBe(false);
    expect((await t.api.get('/api/systems/graph?focus=00000000-0000-4000-8000-000000000000')).status).toBe(404);

    const pm = await t.as('project_manager'); // systems.view only
    const limited = (await pm.get('/api/systems/graph')).body;
    expect([...new Set(limited.nodes.map((n: any) => n.type))].sort()).toEqual(['system', 'vendor']);
    expect((await (await t.as('executive_viewer')).get('/api/systems/graph')).status).toBe(403);
  });

  it('shows a linked vendor record\'s name only to people who may see vendors', async () => {
    if (!t.ctx.resources.get('vendor')) return; // the vendors module is not loaded in an isolated run
    const vendor = await t.ctx.resources.create('vendor', { name: 'Private Vendor Record Ltd' });
    const s = (await t.api.post('/api/systems', { name: 'Epsilon', vendor_name: 'As recorded', vendor_id: vendor.id })).body;
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('systems_only', 'Systems only', true) returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'systems.view')`, [role!.id]);
    const limited = (await (await t.as('systems_only')).get(`/api/systems/graph?focus=${s.id}`)).body;
    const node = limited.nodes.find((n: any) => n.id === vendor.id);
    expect(node).toMatchObject({ label: 'As recorded', route: null });
    const full = (await t.api.get(`/api/systems/graph?focus=${s.id}`)).body;
    expect(full.nodes.find((n: any) => n.id === vendor.id).label).toBe('Private Vendor Record Ltd');
    await t.api.del(`/api/systems/${s.id}`);
  });
});

describe('impact', () => {
  it('walks downstream integrations transitively', async () => {
    const impact = (await t.api.get(`/api/systems/${sys.alpha.id}/impact`)).body;
    expect(impact.downstream.map((d: any) => [d.label, d.depth, d.via.label])).toEqual([
      ['Beta', 1, 'Alpha'], ['Gamma', 2, 'Beta'], ['Delta', 2, 'Beta'],
    ]);
    expect(impact.downstream.some((d: any) => d.label === 'Epsilon')).toBe(false); // upstream only
    expect(impact.sites.map((s: any) => [s.label, s.via.label]).sort()).toEqual([['North Workshop', 'Alpha'], ['South Office', 'Gamma']]);
    expect(impact.data_categories.find((c: any) => c.label === 'Invented pay data').via).toMatchObject({ label: 'Alpha', direct: true });
    expect(impact.assets.map((a: any) => a.label).sort()).toEqual(['Alpha server', 'Gamma switch']);
    expect(impact.counts).toEqual({ systems: 3, sites: 2, data_categories: 3, assets: 2 });

    // Two-way links carry failure both ways; one-way links do not run backwards.
    const delta = (await t.api.get(`/api/systems/${sys.delta.id}/impact`)).body;
    expect(delta.downstream.map((d: any) => d.label)).toEqual(['Beta', 'Gamma']);
    expect((await t.api.get(`/api/systems/${sys.gamma.id}/impact`)).body.downstream).toEqual([]);

    const pm = await t.as('project_manager');
    const limited = (await pm.get(`/api/systems/${sys.alpha.id}/impact`)).body;
    expect(limited.downstream).toHaveLength(3);
    expect(limited.counts).toMatchObject({ sites: 0, data_categories: 0, assets: 0 });
  });
});

describe('canned reports', () => {
  const names = async (key: string, field = 'name') =>
    (await t.api.get(`/api/inventory/reports/${key}`)).body.rows.map((r: any) => r[field]);

  it('lists the seven reports', async () => {
    const list = (await t.api.get('/api/inventory/reports')).body;
    expect(list.map((r: any) => r.key)).toEqual([
      'assets-past-support', 'warranty-expiring', 'assets-by-site', 'unassigned-assets',
      'systems-without-owner', 'systems-without-recovery-targets', 'sensitive-data-without-mfa',
    ]);
    expect((await t.api.get('/api/inventory/reports/nonsense')).status).toBe(404);
  });

  it('assets past support', async () => {
    const res = (await t.api.get('/api/inventory/reports/assets-past-support')).body;
    expect(res.rows.map((r: any) => r.name)).toEqual(['Alpha server']); // the retired one is left out
    expect(res.rows[0]).toMatchObject({ days_past: 10, site: 'North Workshop', status: 'In use', route: `/assets/${asset.server.id}` });
  });

  it('warranty expiring in the next 90 days', async () => {
    expect(await names('warranty-expiring')).toEqual(['Gamma switch']);
    expect((await t.api.get('/api/inventory/reports/warranty-expiring')).body.rows[0].days_left).toBe(30);
    expect((await t.api.get('/api/inventory/reports/warranty-expiring?days=365')).body.total).toBe(2);
  });

  it('assets by site', async () => {
    const rows = (await t.api.get('/api/inventory/reports/assets-by-site')).body.rows;
    expect(rows.map((r: any) => [r.site, r.assets, r.in_use, r.funder_interest, r.cost])).toEqual([
      ['North Workshop', 2, 2, 1, 750], ['South Office', 1, 0, 0, 0], ['No site recorded', 1, 0, 0, 0],
    ]);
  });

  it('unassigned assets', async () => {
    expect((await names('unassigned-assets')).sort()).toEqual(['Gamma switch', 'Spare screen']);
  });

  it('systems without an owner', async () => {
    const rows = (await t.api.get('/api/inventory/reports/systems-without-owner')).body.rows;
    expect(rows.map((r: any) => [r.name, r.missing]).sort()).toEqual([
      ['Beta', 'Business owner, Technical owner'], ['Delta', 'Business owner, Technical owner'], ['Gamma', 'Technical owner'],
    ]);
  });

  it('systems without recovery targets', async () => {
    const rows = (await t.api.get('/api/inventory/reports/systems-without-recovery-targets')).body.rows;
    expect(rows.map((r: any) => [r.name, r.missing]).sort()).toEqual([
      ['Beta', 'Recovery point objective'],
      ['Delta', 'Recovery time objective, Recovery point objective'],
      ['Gamma', 'Recovery time objective, Recovery point objective'],
    ]);
  });

  it('systems holding sensitive data without multi-factor', async () => {
    const rows = (await t.api.get('/api/inventory/reports/sensitive-data-without-mfa')).body.rows;
    // Alpha: restricted data, no multi-factor. Delta: unclassified data counts. Beta enforces it. Gamma holds public data only.
    expect(rows.map((r: any) => [r.name, r.mfa, r.data_categories]).sort()).toEqual([
      ['Alpha', 'Not in place', 'Invented pay data'], ['Delta', 'Available, not enforced', 'Invented unclassified data'],
    ]);
  });

  it('exports to CSV with an audit entry, and checks permissions', async () => {
    const csv = await t.api.get('/api/inventory/reports/assets-past-support?format=csv');
    expect(csv.text).toContain('Alpha server');
    expect((await t.db.query(`select 1 from audit_events where action = 'report.export'`)).length).toBe(1);
    const pm = await t.as('project_manager');
    expect((await pm.get('/api/inventory/reports')).body.map((r: any) => r.key)).toEqual(['systems-without-owner', 'systems-without-recovery-targets']);
    expect((await pm.get('/api/inventory/reports/assets-past-support')).status).toBe(403);
  });
});
