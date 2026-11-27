import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: safety indicator values and exposure figures loaded in data load mode carry the person the
// load names; outside a load, the signed-in person. Invented figures only.

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

describe('safety figures', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const id = (await t.api.post('/api/safety-indicators', { name: 'Invented platform inspections', measure: 'manual', target: 10, target_direction: 'at_least' })).body.id;
    const month = dayInZone(0).slice(0, 7);
    expect((await t.api.put(`/api/safety-indicators/${id}/values/${month}`, { value: 4 })).status).toBe(200);
    expect((await t.db.one<Row>('select entered_by from safety_indicator_values where indicator_id = $1', [id]))!.entered_by).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.put(`/api/safety-indicators/${id}/values/2024-03`, { value: 9, on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await t.db.one<Row>(`select entered_by from safety_indicator_values where indicator_id = $1 and period = '2024-03-01'`, [id]))!.entered_by).toBe(former);
    const exp = await t.api.put('/api/safety/exposure', { period: '2024-03', vehicle_miles: 1000, on_behalf_of: 'rclerk' });
    expect(exp.status, JSON.stringify(exp.body)).toBe(200);
    expect((await t.db.one<Row>(`select updated_by from safety_exposure where period = '2024-03-01'`))!.updated_by).toBe(former);
  });
});
