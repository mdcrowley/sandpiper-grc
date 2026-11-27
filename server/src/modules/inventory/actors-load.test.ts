import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: asset check-outs and check-ins loaded in data load mode carry the person the load names
// and the times given; outside a load, the signed-in person and now. Invented assets only.

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

describe('asset assignments', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const a = (await t.api.post('/api/assets', { name: 'Invented depot radio' })).body;
    expect((await t.api.post(`/api/assets/${a.id}/check-out`, { assignee_name: 'Sam Invented' })).status).toBe(201);
    expect((await t.api.post(`/api/assets/${a.id}/check-in`, {})).status).toBe(200);
    const first = (await t.db.one<Row>('select checked_out_by, checked_in_by from asset_assignments where asset_id = $1', [a.id]))!;
    expect(first).toEqual({ checked_out_by: adminId, checked_in_by: adminId });

    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const out = await t.api.post(`/api/assets/${a.id}/check-out`, { assignee_name: 'Lee Invented', checked_out_at: '2023-05-02T08:00:00Z', on_behalf_of: 'rclerk' });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const back = await t.api.post(`/api/assets/${a.id}/check-in`, { checked_in_at: '2023-06-01T16:00:00Z', on_behalf_of: 'rclerk' });
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    const row = (await t.db.one<Row>(`select * from asset_assignments where asset_id = $1 and assignee_name = 'Lee Invented'`, [a.id]))!;
    expect([row.checked_out_by, row.checked_in_by]).toEqual([former, former]);
    expect([new Date(row.checked_out_at).toISOString(), new Date(row.checked_in_at).toISOString()]).toEqual(['2023-05-02T08:00:00.000Z', '2023-06-01T16:00:00.000Z']);
  });
});
