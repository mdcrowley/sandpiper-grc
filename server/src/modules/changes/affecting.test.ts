import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// Stand-ins for the inventory module's systems and assets.
const standIns: ModuleDef = {
  key: 'affectingstandins',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists t_aff_systems (
        id uuid primary key default gen_random_uuid(), name text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists t_aff_assets (
        id uuid primary key default gen_random_uuid(), name text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    for (const [type, table, label, module] of [['system', 't_aff_systems', 'System', 'systems'], ['asset', 't_aff_assets', 'Asset', 'assets']]) {
      ctx.defineResource({
        type, table, module, label, plural: `${label}s`, path: `/api/${type}s`, route: `/${type}s`, titleField: 'name',
        fields: { name: { label: 'Name', type: 'text', required: true } },
      });
    }
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;
beforeAll(async () => {
  process.env.GRC_MODULES = 'changes';
  t = await testApp({ extraModules: [standIns] });
});
afterAll(async () => {
  await t.close();
  if (before === undefined) delete process.env.GRC_MODULES; else process.env.GRC_MODULES = before;
});

const at = (day: string) => ({ planned_start: `${day}T18:00:00.000Z`, planned_end: `${day}T20:00:00.000Z` });

describe('changes on a system or asset page (E05-08)', () => {
  it('lists the changes affecting one system, main or linked, newest first', async () => {
    const tram = (await t.api.post('/api/systems', { name: 'Tram signaling' })).body.id;
    const fares = (await t.api.post('/api/systems', { name: 'Fare collection' })).body.id;
    const kiosk = (await t.api.post('/api/assets', { name: 'Ticket kiosk 4' })).body.id;
    const old = (await t.api.post('/api/changes', { title: 'Patch the signaling server', system_id: tram, ...at('2020-03-01') })).body;
    const later = (await t.api.post('/api/changes', { title: 'Upgrade fare readers', system_id: fares, asset_id: kiosk, ...at('2039-06-01') })).body;
    await t.api.post('/api/links', { from_type: 'change', from_id: later.id, to_type: 'system', to_id: tram, relation: 'affects' });
    await t.api.post('/api/changes', { title: 'Unrelated', ...at('2039-07-01') });

    const res = await t.api.get(`/api/changes/affecting?type=system&id=${tram}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.rows.map((r: any) => [r.ref, r.main, r.when])).toEqual([[later.ref, false, 'planned'], [old.ref, true, 'planned']]);
    expect(res.body.rows[0]).toMatchObject({ status: 'draft', status_label: 'Draft', change_type_label: expect.any(String) });

    const onAsset = await t.api.get(`/api/changes/affecting?type=asset&id=${kiosk}`);
    expect(onAsset.body.rows.map((r: any) => r.id)).toEqual([later.id]);
    expect((await t.api.get(`/api/changes/affecting?type=asset&id=${kiosk}&limit=0`)).body.rows).toHaveLength(1);

    expect((await t.api.get('/api/changes/affecting?type=vendor&id=x')).status).toBe(400);
    expect((await t.api.get(`/api/changes/affecting?type=system&id=${kiosk}`)).status).toBe(404);

    const affected = (await t.api.get(`/api/changes/${later.id}/affected`)).body;
    expect(affected.systems).toEqual(expect.arrayContaining([{ id: fares, label: 'Fare collection', main: true }, { id: tram, label: 'Tram signaling', main: false }]));
    expect(affected.assets).toEqual([{ id: kiosk, label: 'Ticket kiosk 4', main: true }]);
  });

  it('needs changes.view', async () => {
    const safety = await t.as('safety_manager');
    expect((await safety.get('/api/changes/affecting?type=system&id=00000000-0000-0000-0000-000000000000')).status).toBe(403);
  });
});
