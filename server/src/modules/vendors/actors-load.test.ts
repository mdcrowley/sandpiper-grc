import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: contract scores and exclusion-list checks loaded in data load mode carry the person the
// load names; outside a load, the signed-in person. Invented vendors only.

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

describe('vendor actor columns', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const v = (await t.api.post('/api/vendors', { name: 'Invented shelter cleaning vendor' })).body;
    const c = (await t.api.post('/api/contracts', { title: 'Invented shelter cleaning', vendor_id: v.id, status: 'active' })).body;
    const m = (await t.api.post(`/api/contracts/${c.id}/measures`, { name: 'Shelters cleaned on schedule', target: 95, unit: '%' })).body;
    expect((await t.api.post(`/api/contracts/${c.id}/measures/${m.id}/scores`, { period: '2024-01', value: 91 })).status).toBe(201);
    expect((await t.api.post(`/api/vendors/${v.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'clear', checked_on: '2024-01-05' })).status).toBe(201);

    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const s = await t.api.post(`/api/contracts/${c.id}/measures/${m.id}/scores`, { period: '2024-02', value: 96, on_behalf_of: 'rclerk' });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const scores = await t.db.query<Row>('select period, recorded_by from contract_scores where measure_id = $1 order by period', [m.id]);
    expect(scores.map((r) => r.recorded_by)).toEqual([adminId, former]);
    const check = await t.api.post(`/api/vendors/${v.id}/exclusion-checks`, { list_key: 'government_exclusion_list', result: 'clear', checked_on: '2024-02-05', on_behalf_of: 'rclerk' });
    expect(check.status, JSON.stringify(check.body)).toBe(201);
    expect(check.body.checked_by_name).toBe('Robin Clerk');
    const checks = await t.db.query<Row>('select checked_by from vendor_exclusion_checks where vendor_id = $1 order by checked_on', [v.id]);
    expect(checks.map((r) => r.checked_by)).toEqual([adminId, former]);
  });
});
