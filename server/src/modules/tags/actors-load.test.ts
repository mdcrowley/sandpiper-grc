import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: tags found in an inventory count in data load mode were found (and verified) by the person
// the load names; outside a load, by the signed-in person. Invented tags only.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';
let adminId = '';

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('inventory count finds', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const site = (await t.api.post('/api/sites', { name: 'Invented east depot' })).body.id;
    const a = (await t.api.post('/api/assets', { name: 'Invented radio', status: 'in_use', site_id: site, tag: 'TA-500101' })).body.id;
    const b = (await t.api.post('/api/assets', { name: 'Invented camera', status: 'in_use', site_id: site, tag: 'TA-500118' })).body.id;
    const count = (await t.api.post('/api/inventory-counts/start', { site_id: site })).body.id;
    expect((await t.api.post(`/api/inventory-counts/${count}/found`, { value: 'TA-500101' })).status).toBeLessThan(300);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(`/api/inventory-counts/${count}/found`, { value: 'TA-500118', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const found = await t.db.query<Row>('select record_id, found_by from inventory_count_items where count_id = $1 and found_by is not null', [count]);
    expect(found.find((r) => r.record_id === a)!.found_by).toBe(adminId);
    expect(found.find((r) => r.record_id === b)!.found_by).toBe(former);
    expect((await t.db.one<Row>('select verified_by from tag_verifications where record_id = $1', [b]))!.verified_by).toBe(former);
  });
});
