import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: control test samples loaded in data load mode are written by the person the load names;
// outside a load, by the signed-in person. Invented controls only.

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

describe('control test samples', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const control = (await t.api.post('/api/controls', { title: 'Invented gate badge check', control_type: 'preventive', domain: 'safety', status: 'active' })).body;
    const test = (await t.api.post('/api/control-tests', { control_id: control.id, test_type: 'operating', method: 'inspection' })).body;
    expect((await t.api.post(`/api/control-tests/${test.id}/samples`, { item: 'Gate log, Monday', result: 'pass' })).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(`/api/control-tests/${test.id}/samples`, { item: 'Gate log, Tuesday', result: 'pass', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await t.db.query<Row>('select item, created_by from control_test_samples where test_id = $1 order by sort', [test.id]);
    expect(rows.map((r) => r.created_by)).toEqual([adminId, former]);
  });
});
