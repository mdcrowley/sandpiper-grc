import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// E18-94: in data load mode the document library's actor columns follow the person a load names
// (on_behalf_of): version approvals, roster acknowledgments and exceptions; and a load records a
// reader's acknowledgment of a version on a past date. Outside a load the caller is recorded.
// Invented people and documents only.

const modules = process.env.GRC_MODULES?.split(',');
const has = (m: string) => !modules || modules.includes(m);

let t: Awaited<ReturnType<typeof testApp>>;
let author: Awaited<ReturnType<typeof t.as>>;
let former = '';
let outsider = '';
let adminId = '';
let doc: Row;

const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const switchOn = async () => { await confirm(); expect((await t.api.post('/api/admin/data-load', { on: true, days: 2 })).status).toBe(200); };

beforeAll(async () => {
  t = await testApp();
  author = await t.as('security_lead');
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
  outsider = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('pout', 'p.out@example.test', 'Pat Outside', 'active') returning id`))!.id;
  doc = (await author.post('/api/policies', { title: 'Invented depot safety rule' })).body;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('outside data load mode', () => {
  it('records the signed-in approver, and refuses to load an acknowledgment', async () => {
    const v = (await author.post(`/api/policies/${doc.id}/versions`, { body: 'Version one, invented.' })).body;
    await author.post(`/api/policies/${doc.id}/versions/${v.id}/submit`);
    const ok = await t.api.post(`/api/policies/${doc.id}/versions/${v.id}/approve`, {});
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect([ok.body.approved_by_name]).toEqual(['Test Admin']);
    expect((await t.db.one<Row>('select approved_by from policy_versions where id = $1', [v.id]))!.approved_by).toBe(adminId);
    expect((await t.api.post(`/api/policies/${doc.id}/versions/${v.id}/publish`, {})).status).toBe(200);
    const refused = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'rclerk', acknowledged_at: '2024-03-04' });
    expect([refused.status, refused.body.error.code]).toEqual([409, 'not_loading']);
    const exc = await t.api.post('/api/exceptions', { title: 'Invented deviation', policy_id: doc.id });
    expect(exc.body.requested_by).toBe(adminId);
  });
});

describe('in data load mode', () => {
  beforeAll(switchOn);

  it('makes the named person the approver of a version', async () => {
    const v = (await t.api.post(`/api/policies/${doc.id}/versions`, { body: 'Version two, invented.' })).body;
    const res = await t.api.post(`/api/policies/${doc.id}/versions/${v.id}/approve`, { approved_on: '2024-05-01', on_behalf_of: 'rclerk' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.approved_by_name).toBe('Robin Clerk');
    expect((await t.db.one<Row>('select approved_by from policy_versions where id = $1', [v.id]))!.approved_by).toBe(former);
  });

  it('records an account\'s past acknowledgment of a version, once, with its time and language', async () => {
    const res = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'r.clerk@example.test', acknowledged_at: '2024-03-04T09:30:00Z' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ recorded: true, kind: 'user', user_id: former, name: 'Robin Clerk', version: 1, acknowledged_at: '2024-03-04T09:30:00.000Z', language: 'en' });
    const row = (await t.db.one<Row>('select * from policy_acknowledgements where user_id = $1', [former]))!;
    expect(new Date(row.acknowledged_at).toISOString()).toBe('2024-03-04T09:30:00.000Z');
    const again = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'rclerk', acknowledged_at: '2024-04-01' });
    expect([again.status, again.body.already]).toEqual([200, true]);
    const ev = (await t.db.one<Row>(`select * from audit_events where action = 'policy.acknowledge' and record_id = $1 order by id desc limit 1`, [doc.id]))!;
    expect(ev.actor_id).toBe(adminId);
    expect(ev.summary).toMatch(/Robin Clerk acknowledged version 1 .* on 2024-03-04/);
    // The person named by on_behalf_of is meant when no user is given.
    const self = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { acknowledged_at: '2024-03-05', on_behalf_of: 'pout' });
    expect([self.status, self.body.user_id]).toEqual([201, outsider]);
  });

  it('refuses a plain name, a future date and an unknown version', async () => {
    const name = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'name:Lee Sample', acknowledged_at: '2024-03-04' });
    expect(name.body.error.fields.user).toMatch(/no account and is not on the roster/);
    const future = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'rclerk', acknowledged_at: '2999-01-01' });
    expect(future.body.error.fields.acknowledged_at).toMatch(/future/);
    expect((await t.api.post(`/api/policies/${doc.id}/versions/9/acknowledgments`, { user: 'rclerk', acknowledged_at: '2024-03-04' })).status).toBe(404);
  });

  it('keeps to the document\'s distribution', async () => {
    const restricted = (await t.api.post('/api/policies', { title: 'Invented restricted plan', access: 'restricted', access_users: [former] })).body;
    const v = (await t.api.post(`/api/policies/${restricted.id}/versions`, { body: 'Restricted, invented.' })).body;
    await t.api.post(`/api/policies/${restricted.id}/versions/${v.id}/approve`, {});
    expect((await t.api.post(`/api/policies/${restricted.id}/versions/${v.id}/publish`, {})).status).toBe(200);
    const no = await t.api.post(`/api/policies/${restricted.id}/versions/1/acknowledgments`, { user: 'pout', acknowledged_at: '2024-03-04' });
    expect(no.status).toBe(400);
    expect(no.body.error.fields.user).toMatch(/not one of this document's readers/);
    expect((await t.api.post(`/api/policies/${restricted.id}/versions/1/acknowledgments`, { user: 'rclerk', acknowledged_at: '2024-03-04' })).status).toBe(201);
  });

  it.runIf(has('people'))('records roster people: by the loader, or by the person named as recorder', async () => {
    const dana = (await t.api.post('/api/people', { full_name: 'Dana Retired', employee_number: 'E-4411' })).body;
    const eli = (await t.api.post('/api/people', { full_name: 'Eli Example', employee_number: 'E-4412' })).body;
    const r1 = await t.api.post(`/api/policies/${doc.id}/versions/1/acknowledgments`, { user: 'person:E-4411', acknowledged_at: '2024-02-01' });
    expect(r1.body).toMatchObject({ recorded: true, kind: 'person', person_id: dana.id, user_id: null });
    expect((await t.db.one<Row>('select method, recorded_by from policy_person_acknowledgements where person_id = $1', [dana.id]))).toEqual({ method: 'recorded', recorded_by: adminId });
    // The sign-in sheet route: an earlier version, a past time, the recorder named.
    const sheet = await t.api.post(`/api/policies/${doc.id}/person-acknowledgments`, {
      people: [eli.id], method: 'sign_in_sheet', version: 1, acknowledged_at: '2024-02-02T08:00:00Z', on_behalf_of: 'rclerk',
    });
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(201);
    const row = (await t.db.one<Row>(`select a.recorded_by, a.acknowledged_at, v.version from policy_person_acknowledgements a join policy_versions v on v.id = a.version_id where a.person_id = $1`, [eli.id]))!;
    expect([row.recorded_by, Number(row.version), new Date(row.acknowledged_at).toISOString()]).toEqual([former, 1, '2024-02-02T08:00:00.000Z']);
  });

  it('gives a loaded approved exception to the named person', async () => {
    const exc = await t.api.post('/api/exceptions', { title: 'Invented past deviation', status: 'approved', expires_on: '2024-12-31', on_behalf_of: 'rclerk' });
    expect(exc.status, JSON.stringify(exc.body)).toBe(201);
    expect([exc.body.requested_by, exc.body.approver_name]).toEqual([former, 'Robin Clerk']);
  });
});
