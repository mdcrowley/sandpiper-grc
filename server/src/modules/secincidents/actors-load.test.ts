import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: incident log entries written in data load mode carry the person the load names as their
// author; outside a load, the signed-in person; entries the application writes stay "System".

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

describe('incident log entries', () => {
  it('are the caller\'s outside a load and the named person\'s in one', async () => {
    const incident = (await t.api.post('/api/security-incidents', { title: 'Invented phishing report', severity: 'low' })).body;
    expect((await t.api.post(`/api/security-incidents/${incident.id}/log`, { entry: 'Mailbox checked.' })).status).toBe(201);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const loaded = await t.api.post(`/api/security-incidents/${incident.id}/log`, { entry: 'Sender blocked.', at: '2024-04-02T08:00:00Z', on_behalf_of: 'rclerk' });
    expect(loaded.status, JSON.stringify(loaded.body)).toBe(201);
    const rows = await t.db.query<Row>(`select author_id, author_name, entry, at from incident_log_entries where incident_id = $1 and kind <> 'system' order by created_at`, [incident.id]);
    expect(rows.map((r) => [r.entry, r.author_id, r.author_name])).toEqual([
      ['Mailbox checked.', adminId, 'Test Admin'],
      ['Sender blocked.', former, 'Robin Clerk'],
    ]);
    expect(new Date(rows[1].at).toISOString()).toBe('2024-04-02T08:00:00.000Z');
  });
});
