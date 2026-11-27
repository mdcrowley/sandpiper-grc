import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: attendance and the decision links recorded in data load mode carry the person the load
// names (for example the secretary who kept the minutes); outside a load, the signed-in person.

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

describe('governance actor columns', () => {
  it('follow the named person in a load and the caller outside one', async () => {
    const committee = (await t.api.post('/api/committees', { name: 'Invented safety committee', kind: 'safety' })).body;
    const member = (await t.api.post(`/api/committees/${committee.id}/members`, { name: 'Jordan Example' })).body;
    const meeting = (await t.api.post('/api/meetings', { committee_id: committee.id, title: 'Invented March meeting', scheduled_at: `${dayInZone(-3)}T18:00:00Z` })).body;
    const mark = (body: Row, extra: Row = {}) => t.api.put(`/api/meetings/${meeting.id}/attendance`, { attendance: [{ member_id: member.id, ...body }], ...extra });
    expect((await mark({ present: true })).status).toBe(200);
    const row = () => t.db.one<Row>('select updated_by from meeting_attendance where meeting_id = $1', [meeting.id]);
    expect((await row())!.updated_by).toBe(adminId);
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const res = await mark({ apology: true }, { on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await row())!.updated_by).toBe(former);
  });
});
