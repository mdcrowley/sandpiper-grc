import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 11 contract C7: a control may also cover an OT security zone (type `ot_zone`, permission
// module `systems`, restricted by its own flag). The OT module is stood in for here, so the
// control library is tested alone. Invented data only.
const standIn: ModuleDef = {
  key: 'controlsotstand',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists t_ot_zones (
      id uuid primary key default gen_random_uuid(), ref text, name text not null, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'ot_zone', table: 't_ot_zones', module: 'systems', label: 'OT zone', plural: 'OT zones', restricted: 'flag',
      path: '/api/ot-zones', route: '/ot/zones', titleField: 'name', ref: { field: 'ref', prefix: 'ZON-' },
      fields: { ref: { label: 'Reference', type: 'text', readOnly: true }, name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean' } },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let lead: Awaited<ReturnType<typeof t.as>>;  // controls.*, security.view
let audit: Awaited<ReturnType<typeof t.as>>; // controls.* and systems.view, without security.view
let controlId = '';

beforeAll(async () => {
  process.env.GRC_MODULES = 'controls,inventory,notifications';
  t = await testApp({ extraModules: [standIn] });
  lead = await t.as('security_lead');
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('ot_controls_test', 'OT controls (test)', 'test', true) returning id`);
  for (const g of ['controls.*', 'systems.view']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [role!.id, g]);
  audit = await t.as('ot_controls_test');
  controlId = (await lead.post('/api/controls', { title: 'Invented remote access gateway with session recording' })).body.id;
}, 60_000);
afterAll(async () => { await t.close(); delete process.env.GRC_MODULES; });

describe('controls covering OT zones', () => {
  it('offers OT zones as a kind of record a control covers, and shows the control on the zone', async () => {
    const zone = (await t.api.post('/api/ot-zones', { name: 'Invented train control zone' })).body;
    const before = await lead.get(`/api/controls/${controlId}/coverage`);
    expect(before.body.types.map((x: any) => x.type)).toContain('ot_zone');
    const add = await lead.post(`/api/controls/${controlId}/coverage`, { type: 'ot_zone', id: zone.id });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect((await lead.get(`/api/controls/${controlId}/coverage`)).body.rows.map((r: any) => r.id)).toContain(zone.id);
    const covering = await lead.get(`/api/controls/covering?type=ot_zone&id=${zone.id}`);
    expect(covering.status).toBe(200);
    expect(covering.body.rows.map((r: any) => r.id)).toEqual([controlId]);
  });

  it('keeps a restricted zone from people without security.view', async () => {
    const zone = (await t.api.post('/api/ot-zones', { name: 'Invented restricted signaling zone', restricted: true })).body;
    expect((await lead.post(`/api/controls/${controlId}/coverage`, { type: 'ot_zone', id: zone.id })).status).toBe(201);
    const theirs = await audit.get(`/api/controls/${controlId}/coverage`);
    expect(theirs.status).toBe(200);
    expect(theirs.body.rows.map((r: any) => r.id)).not.toContain(zone.id);
    expect(theirs.body.rows.map((r: any) => r.title)).toEqual(['Invented train control zone']); // the open zone stays
    expect(JSON.stringify(theirs.body)).not.toContain('Invented restricted signaling zone');
    expect((await audit.get(`/api/controls/covering?type=ot_zone&id=${zone.id}`)).status).toBe(404);
    expect((await audit.post(`/api/controls/${controlId}/coverage`, { type: 'ot_zone', id: zone.id })).status).toBe(400);
  });
});
