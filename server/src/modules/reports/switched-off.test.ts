import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// BW-04: the web leaves the widgets of switched-off areas out of dashboards, and does not list a
// standard dashboard made only of them. It learns which record types those are here.
let t: Awaited<ReturnType<typeof testApp>>;
const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });

// Civil rights starts off (wave 26); switch it on so that everything is on.
beforeAll(async () => { t = await testApp(); await setFeatures({ civilrights: true }); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('record types of switched-off areas, for dashboards', () => {
  it('lists none while everything is on, and the area\'s types while it is off', async () => {
    const before = await t.api.get('/api/dashboards/switched-off-types');
    expect(before.status).toBe(200);
    expect(before.body.types).toEqual([]);

    expect((await setFeatures({ portal: false, tickets: false, vendors: false })).status).toBe(200);
    const off = (await t.api.get('/api/dashboards/switched-off-types')).body.types as string[];
    expect(off).toEqual(expect.arrayContaining(['ticket', 'contract', 'vendor']));
    expect(off).not.toContain('risk');

    // The same answer for anyone who may look at dashboards.
    const viewer = await (await t.as('executive_viewer')).get('/api/dashboards/switched-off-types');
    expect(viewer.status).toBe(200);
    expect(viewer.body.types).toEqual(off);

    expect((await setFeatures({ portal: true, tickets: true, vendors: true })).status).toBe(200);
    expect((await t.api.get('/api/dashboards/switched-off-types')).body.types).toEqual([]);
  });
});
