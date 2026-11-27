import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef, Row } from './module.ts';
import { testApp } from '../test/helpers.ts';

// Acting on behalf of someone in data load mode (E18-71, core/dataload.ts): records, comments,
// links, files and approval decisions written in the name of the real people, by account (disabled
// ones too), roster person or plain name; the audit log keeps the real actor and adds "on behalf
// of"; outside data load mode, or for someone who is not an administrator, naming another person
// is refused; an unknown person is a field error, never the loader.

const stand: ModuleDef = {
  key: 'onbehalfstand',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_ob_items (
      id uuid primary key default gen_random_uuid(), ref text, title text not null, status text, owner_id uuid,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
    // The roster (people module); a minimal stand-in when that module is not loaded.
    await ctx.db.exec(`create table if not exists people (
      id uuid primary key default gen_random_uuid(), ref text unique, full_name text not null, preferred_name text, employee_number text,
      email text, user_id uuid, status text not null default 'active', created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'ob_item', table: 'test_ob_items', module: 'tickets', label: 'Work order', plural: 'Work orders',
      path: '/api/test-ob-items', route: '/test-ob-items', titleField: 'title', ref: { field: 'ref', prefix: 'WOB-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true }, title: { label: 'Title', type: 'text', required: true },
        status: { label: 'Status', type: 'text' }, owner_id: { label: 'Owner', type: 'user' },
      },
    });
  },
};

const modules = process.env.GRC_MODULES?.split(',');
const has = (m: string) => !modules || modules.includes(m);

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let former = '';
let rosterNoAccount = '';
let rosterWithAccount = '';
let item: Row;
let adminToken = '';
/** A request with the administrator's API token and extra headers. */
const withToken = (method: 'PUT' | 'PATCH', url: string, payload: unknown, headers: Record<string, string> = {}) =>
  t.app.inject({ method, url, payload: payload as string, headers: { authorization: `Bearer ${adminToken}`, ...headers } });

const confirm = () => t.db.query('update sessions set confirmed_at = now()');
const switchOn = async () => { await confirm(); expect((await t.api.post('/api/admin/data-load', { on: true, days: 2 })).status).toBe(200); };
const switchOff = () => t.api.post('/api/admin/data-load', { on: false });
const adminId = async () => (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
const lastEvent = (action: string, recordId: string) =>
  t.db.one<Row>('select * from audit_events where action = $1 and record_id = $2 order by id desc limit 1', [action, recordId]);

beforeAll(async () => {
  t = await testApp({ extraModules: [stand] });
  agent = await t.as('agent');
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('rclerk', 'r.clerk@example.test', 'Robin Clerk', 'disabled') returning id`))!.id;
  rosterNoAccount = (await t.db.one<{ id: string }>(
    `insert into people (ref, full_name, email, employee_number, status) values ('PPL-90001', 'Dana Retired', 'dana.retired@example.test', 'E-4411', 'left') returning id`))!.id;
  rosterWithAccount = (await t.db.one<{ id: string }>(
    `insert into people (ref, full_name, email, user_id) values ('PPL-90002', 'Agent On Roster', 'roster.agent@example.test', $1) returning id`, [agent.userId]))!.id;
  item = (await t.api.post('/api/test-ob-items', { title: 'Depot gate repair' })).body;
  await confirm();
  const token = await t.api.post('/api/me/tokens', { name: 'Loader', scopes: ['*'], expiresInDays: 5 });
  expect(token.status, JSON.stringify(token.body)).toBe(201);
  adminToken = token.body.token;
  expect(item.id).toBeTruthy();
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('outside data load mode', () => {
  it('refuses to name another author, on every route, and leaves the record alone', async () => {
    const comment = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Too early', on_behalf_of: 'rclerk' });
    expect([comment.status, comment.body.error.code]).toEqual([400, 'on_behalf_not_allowed']);
    expect(comment.body.error.fields.on_behalf_of).toMatch(/data load mode/);
    const made = await t.api.post('/api/test-ob-items', { title: 'Named', on_behalf_of: 'rclerk' });
    expect([made.status, made.body.error.code]).toEqual([400, 'on_behalf_not_allowed']);
    const patch = await withToken('PATCH', `/api/test-ob-items/${item.id}`, { title: 'Changed' }, { 'x-on-behalf-of': 'rclerk' });
    expect([patch.statusCode, patch.json().error.code]).toEqual([400, 'on_behalf_not_allowed']);
    expect((await t.db.one<Row>('select title from test_ob_items where id = $1', [item.id]))!.title).toBe('Depot gate repair');
    expect((await t.db.query(`select 1 from comments where body = 'Too early'`)).length).toBe(0);
    expect((await t.api.post('/api/data-load/person', { person: 'rclerk' })).status).toBe(409);
    // Without a name the routes behave as before.
    expect((await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Normal note' })).status).toBe(201);
  });
});

describe('in data load mode', () => {
  beforeAll(switchOn);

  it('resolves accounts (disabled too), roster people and plain names, and refuses unknown people', async () => {
    const r = (person: unknown) => t.api.post('/api/data-load/person', { person });
    expect((await r('rclerk')).body).toEqual({ kind: 'user', user_id: former, person_id: null, name: 'Robin Clerk' });
    expect((await r('R.Clerk@example.test')).body.user_id).toBe(former);
    expect((await r(former)).body.user_id).toBe(former);
    expect((await r('dana.retired@example.test')).body).toEqual({ kind: 'person', user_id: null, person_id: rosterNoAccount, name: 'Dana Retired' });
    expect((await r('person:E-4411')).body.person_id).toBe(rosterNoAccount);
    expect((await r({ person: 'PPL-90002' })).body).toMatchObject({ kind: 'person', user_id: agent.userId, person_id: rosterWithAccount });
    expect((await r('name:Pat Example')).body).toEqual({ kind: 'name', user_id: null, person_id: null, name: 'Pat Example' });
    expect((await r({ name: 'Lee Sample' })).body.name).toBe('Lee Sample');
    const unknown = await r('nobody.here');
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields.person).toMatch(/No account or roster person matches "nobody.here".*name:nobody.here/);
    expect((await r('user:dana.retired@example.test')).body.error.fields.person).toMatch(/No account/);
    expect((await r({ user: 'a', name: 'b' })).status).toBe(400);
  });

  it('creates a record in the name of a disabled account, audited with the real actor', async () => {
    const made = await t.api.post('/api/test-ob-items', { title: 'Platform light out (history)', on_behalf_of: 'rclerk', created_at: '2023-05-02T10:00:00Z' });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect([made.body.created_by, made.body.updated_by]).toEqual([former, former]);
    const ev = (await lastEvent('ob_item.create', made.body.id))!;
    expect(ev.actor_id).toBe(await adminId());
    expect([ev.on_behalf_id, ev.on_behalf_name]).toEqual([former, 'Robin Clerk']);
    expect(ev.summary).toMatch(/loaded \(data load mode\).*\(on behalf of Robin Clerk\)$/);
    expect((await t.db.one<Row>('select on_behalf_name from data_load_records where record_id = $1', [made.body.id]))!.on_behalf_name).toBe('Robin Clerk');
    // created_by, updated_by and person fields take a username or email in a load.
    const named = await t.api.post('/api/test-ob-items', { title: 'Owner by email', owner_id: 'r.clerk@example.test', created_by: 'rclerk', updated_by: agent.userId });
    expect([named.body.owner_id, named.body.created_by, named.body.updated_by]).toEqual([former, former, agent.userId]);
    const bad = await t.api.post('/api/test-ob-items', { title: 'Bad owner', owner_id: 'nobody.here' });
    expect(bad.body.error.fields.owner_id).toMatch(/no account/);
  });

  it('records a change (a status move) by someone without an account: no author id, the name in the history', async () => {
    const saved = await t.api.patch(`/api/test-ob-items/${item.id}`, { status: 'closed', on_behalf_of: 'person:PPL-90001' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.updated_by).toBeNull();
    const history = (await t.api.get(`/api/history?record_type=ob_item&record_id=${item.id}`)).body as Row[];
    const entry = history.find((h) => h.action === 'ob_item.update')!;
    expect(entry).toMatchObject({ actor_name: expect.any(String), on_behalf_id: null, on_behalf_name: 'Dana Retired' });
    expect(entry.actor_id).toBe(await adminId());
    expect(entry.summary).toMatch(/\(data load mode\).*\(on behalf of Dana Retired\)$/);
  });

  it('adds comments by another user, a roster person and a plain name, with their times, telling nobody', async () => {
    expect((await agent.post('/api/watchers', { record_type: 'ob_item', record_id: item.id })).status).toBe(201);
    const told = (await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length;
    const byUser = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Gate motor replaced.', internal: false, on_behalf_of: 'rclerk', created_at: '2023-05-03T08:15:00Z' });
    expect(byUser.status, JSON.stringify(byUser.body)).toBe(201);
    expect(byUser.body).toMatchObject({ author_id: former, author_name: 'Robin Clerk', internal: false });
    expect(new Date(byUser.body.created_at).toISOString()).toBe('2023-05-03T08:15:00.000Z');
    const byRoster = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Checked by the depot.', on_behalf_of: { person: 'dana.retired@example.test' } });
    expect(byRoster.body).toMatchObject({ author_id: null, author_name: 'Dana Retired', internal: true });
    const rosterAccount = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Seen.', on_behalf_of: 'person:PPL-90002' });
    expect(rosterAccount.body).toMatchObject({ author_id: agent.userId, author_name: 'Agent On Roster' });
    const byName = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Contractor signed off.', on_behalf_of: 'name:Pat Example' });
    expect(byName.body).toMatchObject({ author_id: null, author_name: 'Pat Example' });
    expect((await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length).toBe(told);
    const ev = (await t.db.query<Row>(`select * from audit_events where action = 'comment.add' and record_id = $1 and on_behalf_name is not null order by id`, [item.id]));
    expect(ev.map((e) => e.on_behalf_name)).toEqual(['Robin Clerk', 'Dana Retired', 'Agent On Roster', 'Pat Example']);
    expect(ev.every((e) => /\(data load, on behalf of /.test(e.summary))).toBe(true);
  });

  it('refuses an unknown person with a field error and saves nothing', async () => {
    const before = (await t.db.query('select 1 from comments')).length;
    const res = await t.api.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Who wrote this?', on_behalf_of: 'ghost.writer@example.test' });
    expect([res.status, res.body.error.code]).toEqual([400, 'validation']);
    expect(res.body.error.fields.on_behalf_of).toMatch(/No account or roster person matches/);
    expect((await t.db.query('select 1 from comments')).length).toBe(before);
    const rec = await t.api.post('/api/test-ob-items', { title: 'Ghost', on_behalf_of: { user: 'ghost' } });
    expect(rec.body.error.fields.on_behalf_of).toMatch(/No account has/);
  });

  it('records who made a link', async () => {
    const other = (await t.api.post('/api/test-ob-items', { title: 'Linked order' })).body;
    const link = await t.api.post('/api/links', { from_type: 'ob_item', from_id: item.id, to_type: 'ob_item', to_id: other.id, on_behalf_of: 'rclerk' });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.body.created_by).toBe(former);
    expect((await lastEvent('link.add', item.id))!.on_behalf_name).toBe('Robin Clerk');
  });

  it('does not lend the administrator\'s right to name people: others are refused', async () => {
    const res = await agent.post('/api/comments', { record_type: 'ob_item', record_id: item.id, body: 'Not mine to name', on_behalf_of: 'rclerk' });
    expect([res.status, res.body.error.code]).toEqual([400, 'on_behalf_not_allowed']);
    expect((await agent.post('/api/data-load/person', { person: 'rclerk' })).status).toBe(403);
  });

  it.runIf(has('attachments'))('uploads a file in the name of the person given in X-On-Behalf-Of', async () => {
    const res = await withToken('PUT', `/api/attachments/upload?${new URLSearchParams({ record_type: 'ob_item', record_id: item.id, name: 'gate-report.txt' })}`,
      Buffer.from('Gate inspected and repaired.\n'), { 'content-type': 'application/octet-stream', 'x-on-behalf-of': encodeURIComponent('name:Pat Example') });
    expect(res.statusCode, res.body).toBe(201);
    const row = (await t.db.one<Row>('select uploaded_by_name, created_by from attachments where id = $1', [res.json().id]))!;
    expect(row).toEqual({ uploaded_by_name: 'Pat Example', created_by: null });
    expect((await lastEvent('attachment.upload', item.id))!.on_behalf_name).toBe('Pat Example');
  });

  it('lists the work written on behalf of others on the Data loads page', async () => {
    const page = (await t.api.get('/api/admin/data-load')).body;
    const names = page.onBehalf.map((b: Row) => b.person);
    expect(names).toEqual(expect.arrayContaining(['Robin Clerk', 'Dana Retired', 'Pat Example']));
    expect(page.onBehalf.find((b: Row) => b.person === 'Robin Clerk').loaded_by).toBe('Test Admin');
    const load = page.loads.find((l: Row) => l.record_type === 'ob_item');
    expect(load.on_behalf).toMatch(/Robin Clerk/);
  });
});

describe.runIf(has('workflows'))('approval decisions', () => {
  it('records the decision of the approver named, with the loader\'s permissions, and refuses a name without an account', async () => {
    await switchOff();
    const approver = await t.as('agent');
    const wf = await t.api.post('/api/workflows/definitions', {
      record_type: 'ob_item', name: 'Work order sign-off', trigger: 'create',
      steps: [{ name: 'Supervisor', approvers: { kind: 'users', users: [approver.userId] } }],
    });
    expect(wf.status, JSON.stringify(wf.body)).toBe(201);
    const order = (await agent.post('/api/test-ob-items', { title: 'Needs sign-off' })).body;
    const step = (await t.db.one<{ id: string }>(
      `select s.id from workflow_steps s join workflow_instances i on i.id = s.instance_id where i.record_id = $1 and s.status = 'pending'`, [order.id]))!;
    expect(step).toBeTruthy();
    // Off: refused as before.
    const off = await t.api.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved', on_behalf_of: approver.userId });
    expect(off.body.error.code).toBe('on_behalf_not_allowed');
    await switchOn();
    const noAccount = await t.api.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved', on_behalf_of: 'name:Pat Example' });
    expect(noAccount.body.error.fields.on_behalf_of).toMatch(/account/);
    // The administrator is not an approver: deciding as themselves is refused, as the approver it is recorded.
    expect((await t.api.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved' })).status).toBe(403);
    const told = (await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length;
    const done = await t.api.post(`/api/workflows/steps/${step.id}/decision`, { decision: 'approved', comment: 'Signed on paper', on_behalf_of: approver.userId });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.stepOutcome).toBe('approved');
    const d = (await t.db.one<Row>('select user_id, comment from workflow_decisions where step_id = $1', [step.id]))!;
    expect(d).toEqual({ user_id: approver.userId, comment: 'Signed on paper' });
    const ev = (await lastEvent('workflow.decide', order.id))!;
    expect(ev.actor_id).toBe(await adminId());
    expect(ev.on_behalf_id).toBe(approver.userId);
    expect(ev.summary).toMatch(/on behalf of Test agent/);
    expect((await t.db.query('select 1 from notifications where user_id = $1', [agent.userId])).length).toBe(told);
  });
});
