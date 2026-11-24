import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// Behavior test for GET /api/inventory-counts/countable [tags.view] (E40-05): the kinds of record a
// count can cover follow the parts that are switched on.

let t: Awaited<ReturnType<typeof testApp>>;

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('GET /api/inventory-counts/countable', () => {
  it('lists the countable kinds with their labels, the same for every holder of tags.view', async () => {
    const res = await (await t.as('agent')).get('/api/inventory-counts/countable'); // tags.view
    expect(res.status).toBe(200);
    const types = res.body.types as { type: string; label: string; hasLocation: boolean }[];
    expect(types.map((x) => x.type)).toEqual(expect.arrayContaining(['asset', 'vehicle']));
    for (const x of types) {
      expect(Object.keys(x).sort()).toEqual(['hasLocation', 'label', 'type']);
      expect(typeof x.hasLocation).toBe('boolean');
    }
    expect(types.find((x) => x.type === 'vehicle')!.label).toBe('Vehicles');
    expect((await (await t.as('asset_manager')).get('/api/inventory-counts/countable')).body).toEqual(res.body);
  });

  it('leaves out the kinds of a part that is switched off', async () => {
    const before = (await t.api.get('/api/inventory-counts/countable')).body.types.map((x: any) => x.type);
    expect(before).toContain('vehicle');
    expect((await t.api.patch('/api/admin/features', { features: { fleet: false } })).status).toBe(200);
    try {
      const after = (await t.api.get('/api/inventory-counts/countable')).body.types.map((x: any) => x.type);
      expect(after).not.toContain('vehicle');
      expect(after).toContain('asset');
    } finally {
      await t.api.patch('/api/admin/features', { features: { fleet: true } });
    }
  });

  it('needs tags.view', async () => {
    for (const role of ['training_coordinator', 'project_manager']) {
      expect((await (await t.as(role)).get('/api/inventory-counts/countable')).status).toBe(403);
    }
    expect((await t.anon.get('/api/inventory-counts/countable')).status).toBe(401);
  });
});
