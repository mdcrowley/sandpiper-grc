import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: a legal hold release asked for in data load mode is asked for by the person the load
// names (the approval workflow's requester); outside a load, by the signed-in person.

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

describe('legal hold release', () => {
  it('is asked for by the person a load names, else the caller', async () => {
    const requester = async (holdId: string) =>
      (await t.db.one<Row>(`select requested_by from workflow_instances where record_id = $1 order by started_at desc limit 1`, [holdId]))?.requested_by;
    const own = (await t.api.post('/api/legal-holds', { matter: 'Invented claim A' })).body;
    expect((await t.api.post(`/api/legal-holds/${own.id}/release`, { reason: 'Settled (invented)' })).status).toBe(202);
    expect(await requester(own.id)).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const named = (await t.api.post('/api/legal-holds', { matter: 'Invented claim B' })).body;
    const r = await t.api.post(`/api/legal-holds/${named.id}/release`, { reason: 'Settled (invented)', on_behalf_of: 'rclerk' });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(await requester(named.id)).toBe(former);
  });
});
