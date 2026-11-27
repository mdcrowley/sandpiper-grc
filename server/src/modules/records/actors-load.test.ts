import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: records listed as responsive to a records request in data load mode were added by the
// person the load names; outside a load, by the signed-in person. Invented requests only.

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

describe('responsive records', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const r = (await t.api.post('/api/records-requests', { subject: 'Invented timetable request', kind: 'records' })).body;
    const a = (await t.api.post('/api/systems', { name: 'Invented scheduling system' })).body;
    const b = (await t.api.post('/api/systems', { name: 'Invented fare system' })).body;
    expect((await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: a.id })).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(`/api/records-requests/${r.id}/items`, { record_type: 'system', record_id: b.id, on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await t.db.query<Row>('select record_id, added_by from records_request_items where request_id = $1', [r.id]);
    expect(rows.find((x) => x.record_id === a.id)!.added_by).toBe(adminId);
    expect(rows.find((x) => x.record_id === b.id)!.added_by).toBe(former);
  });
});
