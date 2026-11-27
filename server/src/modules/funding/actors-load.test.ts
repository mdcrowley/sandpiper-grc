import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: sub-recipient monitoring loaded in data load mode is done and recorded by the person the
// load names; outside a load, by the signed-in person. Invented awards only.

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

describe('sub-recipient monitoring', () => {
  it('follows the named person in a load and the caller outside one', async () => {
    const award = (await t.api.post('/api/funding-awards', { title: 'Invented bus shelter grant', status: 'active', amount: 50000 })).body.id;
    const sub = (await t.api.post('/api/subrecipients', { name: 'Invented partner agency', award_id: award, monitoring_frequency: 'yearly' })).body.id;
    const url = `/api/subrecipients/${sub}/monitoring`;
    expect((await t.api.post(url, { method: 'desk_review', result: 'satisfactory', monitored_on: '2023-05-01' })).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(url, { method: 'desk_review', result: 'satisfactory', monitored_on: '2024-05-01', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rows = await t.db.query<Row>('select by, created_by from subrecipient_monitoring where subrecipient_id = $1 order by monitored_on', [sub]);
    expect(rows.map((r) => [r.by, r.created_by])).toEqual([[adminId, adminId], [former, former]]);
  });
});
