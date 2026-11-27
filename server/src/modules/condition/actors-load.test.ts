import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: a condition assessment loaded in data load mode without an assessor is the named person's
// (their account, or their name when they have none); outside a load, the signed-in person's.

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

describe('condition assessments', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const site = (await t.api.post('/api/sites', { name: 'Invented North Station' })).body.id;
    const make = (extra: Record<string, unknown>) => t.api.post('/api/condition-assessments', { target_type: 'site', target_id: site, rating: '3', ...extra });
    const now = await make({ assessed_on: dayInZone(-1) });
    expect(now.status, JSON.stringify(now.body)).toBe(201);
    expect(now.body.assessor_id).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const past = await make({ assessed_on: '2022-05-01', on_behalf_of: 'rclerk' });
    expect(past.status, JSON.stringify(past.body)).toBe(201);
    expect(past.body.assessor_id).toBe(former);
    const named = await make({ assessed_on: '2021-05-01', on_behalf_of: 'name:Contract Inspector' });
    expect([named.body.assessor_id, named.body.assessor_name]).toEqual([null, 'Contract Inspector']);
  });
});
