import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: an emergency activation loaded in data load mode is declared by the person the load names,
// and its log names them; outside a load, the signed-in person. Invented events only.

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

describe('emergency activations', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const now = await t.api.post('/api/emergency-activations', { title: 'Invented power cut at the depot', event_type: 'severe_weather' });
    expect(now.status, JSON.stringify(now.body)).toBe(201);
    expect(now.body.declared_by).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const past = await t.api.post('/api/emergency-activations', { title: 'Invented flood of 2022', event_type: 'severe_weather', declared_at: '2022-07-01T06:00:00Z', on_behalf_of: 'rclerk' });
    expect(past.status, JSON.stringify(past.body)).toBe(201);
    expect(past.body.declared_by).toBe(former);
    const log = await t.db.query<Row>('select by_id, by_name from activation_log_entries where activation_id = $1', [past.body.id]);
    expect(log.length).toBeGreaterThan(0);
    for (const l of log) expect([l.by_id, l.by_name]).toEqual([former, 'Robin Clerk']);
  });
});
