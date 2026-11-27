import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: equipment fitted to a vehicle in data load mode was fitted by the person the load names;
// outside a load, by the signed-in person. Invented vehicles only.

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

describe('vehicle equipment', () => {
  it('follows the named person in a load and the caller outside one', async () => {
    const bus = (await t.api.post('/api/vehicles', { fleet_number: '7101', mode: 'bus' })).body.id;
    const unit = async (name: string) => (await t.api.post('/api/assets', { name, status: 'in_use' })).body.id;
    const a = await unit('Invented AVL unit A');
    const b = await unit('Invented AVL unit B');
    expect((await t.api.post(`/api/vehicles/${bus}/equipment`, { asset_id: a })).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(`/api/vehicles/${bus}/equipment`, { asset_id: b, installed_on: '2023-04-01', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await t.db.query<Row>('select asset_id, created_by from vehicle_equipment where vehicle_id = $1', [bus]);
    expect(rows.find((r) => r.asset_id === a)!.created_by).toBe(adminId);
    expect(rows.find((r) => r.asset_id === b)!.created_by).toBe(former);
  });
});
