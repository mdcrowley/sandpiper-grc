import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: confirming that a linked document still opens, in data load mode, is recorded as the
// person the load names; outside a load, as the signed-in person.

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

describe('link checks', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const system = (await t.api.post('/api/systems', { name: 'Invented passenger information' })).body.id;
    const link = (await t.api.post('/api/attachments/link', { record_type: 'system', record_id: system, url: 'https://docs.example.test/manual' })).body;
    expect((await t.api.post(`/api/attachments/${link.id}/checked`, {})).body.checked_by_name).toBe('Test Admin');
    expect((await t.db.one<Row>('select checked_by from attachments where id = $1', [link.id]))!.checked_by).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await t.api.post(`/api/attachments/${link.id}/checked`, { on_behalf_of: 'rclerk' });
    expect([res.status, res.body.checked_by_name]).toEqual([200, 'Robin Clerk']);
    expect((await t.db.one<Row>('select checked_by from attachments where id = $1', [link.id]))!.checked_by).toBe(former);
  });
});
