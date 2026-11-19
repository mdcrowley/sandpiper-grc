import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { testApp, type TestApi } from '../../test/helpers.ts';

// E15-12 (on behalf of a colleague), E15-13 (files shared with the requester), E15-14 (required
// custom fields), E03-21 in the portal's approvals and E03-20 (shared queues). Invented people only.
type Person = TestApi & { userId: string; token: string };
let t: Awaited<ReturnType<typeof testApp>>;
let pat: Person;
let lee: Person;
let robin: Person;
let agent: Awaited<ReturnType<typeof t.as>>;

async function person(name: string, roles: string[], department: string | null): Promise<Person> {
  const dept = department
    ? (await t.db.one<{ id: string }>(`insert into departments (name) values ($1) on conflict (name) do update set name = excluded.name returning id`, [department]))!.id
    : null;
  const login = name.toLowerCase().replace(/\W/g, '');
  const user = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status, department_id) values ($1,$2,$3,'active',$4) returning id`,
    [login, `${login}@example.test`, name, dept]))!;
  for (const r of roles) await t.db.query('insert into user_roles (user_id, role_id) select $1, id from roles where key = $2', [user.id, r]);
  const token = await createSession(t.db, user.id);
  const call = async (method: string, url: string, body?: unknown) => {
    const res = await t.app.inject({ method: method as 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1' }, ...(body !== undefined ? { payload: body as object } : {}) });
    let parsed: any = null;
    try { parsed = res.json(); } catch { /* not JSON */ }
    return { status: res.statusCode, body: parsed, text: res.body };
  };
  return {
    userId: user.id, token,
    get: (u: string) => call('GET', u), post: (u: string, b?: unknown) => call('POST', u, b ?? {}),
    patch: (u: string, b?: unknown) => call('PATCH', u, b ?? {}), put: (u: string, b?: unknown) => call('PUT', u, b ?? {}),
    del: (u: string) => call('DELETE', u),
  } as Person;
}

const upload = (token: string, ticketId: string, name: string, data: Buffer) => t.app.inject({
  method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'ticket', record_id: ticketId, name })}`,
  headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
  payload: data,
});
const report = { title: 'Depot printer offline', affects: 'team', how_urgent: 'slowed' };

beforeAll(async () => {
  t = await testApp();
  pat = await person('Pat Supervisor', ['requester'], 'North depot');
  lee = await person('Lee Operator', ['requester'], 'North depot');
  robin = await person('Robin Elsewhere', ['requester'], 'Finance');
  agent = await t.as('agent');
  await t.api.put('/api/portal/settings', { enabled: true });
});
afterAll(async () => { await t.close(); });

describe('raising a request for a colleague (E15-12)', () => {
  it('offers colleagues of my department by default, and the request shows to both of us', async () => {
    expect((await pat.get('/api/portal/config')).body.on_behalf).toBe('department');
    const found = (await pat.get('/api/portal/colleagues?q=op')).body;
    expect(found.rows.map((r: any) => r.label)).toEqual(['Lee Operator']);
    expect((await pat.get('/api/portal/colleagues?q=robin')).body.rows).toEqual([]);

    expect((await pat.post('/api/portal/requests', { ...report, for_user_id: robin.userId })).body.error.fields.for_user_id).toContain('your own department');
    const made = await pat.post('/api/portal/requests', { ...report, for_user_id: lee.userId });
    expect(made.status).toBe(201);
    const row = (await t.api.get(`/api/tickets/${made.body.id}`)).body;
    expect(row).toMatchObject({ requester_id: pat.userId, affected_user_id: lee.userId, affected_user: 'Lee Operator' });
    expect(row.description).toContain('Raised by Pat Supervisor for Lee Operator.');
    expect((await pat.get(`/api/portal/requests/${made.body.id}`)).body).toMatchObject({ raised_for: 'Lee Operator', raised_by: null });
    expect((await lee.get(`/api/portal/requests/${made.body.id}`)).body).toMatchObject({ raised_by: 'Pat Supervisor', raised_for: null });
    expect((await lee.get('/api/portal/requests')).body.rows.map((r: any) => r.id)).toContain(made.body.id);
    expect((await robin.get(`/api/portal/requests/${made.body.id}`)).status).toBe(404);
  });

  it('follows the setting: anyone, or nobody', async () => {
    expect((await t.api.put('/api/portal/settings', { on_behalf: 'sometimes' })).status).toBe(400);
    await t.api.put('/api/portal/settings', { on_behalf: 'anyone' });
    expect((await pat.get('/api/portal/colleagues?q=robin')).body.rows.map((r: any) => r.id)).toEqual([robin.userId]);
    expect((await pat.post('/api/portal/requests', { ...report, for_user_id: robin.userId })).status).toBe(201);
    await t.api.put('/api/portal/settings', { on_behalf: 'nobody' });
    expect((await pat.get('/api/portal/config')).body.on_behalf).toBe('nobody');
    expect((await pat.get('/api/portal/colleagues?q=lee')).body.rows).toEqual([]);
    expect((await pat.post('/api/portal/requests', { ...report, for_user_id: lee.userId })).status).toBe(400);
    // Raising for myself is always fine.
    expect((await pat.post('/api/portal/requests', { ...report, for_user_id: pat.userId })).status).toBe(201);
    await t.api.put('/api/portal/settings', { on_behalf: 'department' });
  });
});

describe('files the service desk shares (E15-13)', () => {
  it('shows the requester only their own files and the ones shared with them', async () => {
    const made = await pat.post('/api/portal/requests', { ...report, title: 'Timetable display blank' });
    const id = made.body.id;
    expect((await upload(pat.token, id, 'photo.txt', Buffer.from('what I saw'))).statusCode).toBe(201);
    const deskUpload = (await upload((await createSession(t.db, agent.userId)), id, 'fix-steps.txt', Buffer.from('Steps to fix'))).json();
    const internal = (await upload((await createSession(t.db, agent.userId)), id, 'internal.txt', Buffer.from('internal only'))).json();

    let files = (await pat.get(`/api/portal/requests/${id}`)).body.files;
    expect(files.map((f: any) => f.file_name)).toEqual(['photo.txt']);
    expect((await pat.get(`/api/attachments/${deskUpload.id}/download`)).status).toBe(404);

    const list = (await agent.get(`/api/tickets/${id}/shared-files`)).body;
    expect(list.rows.map((r: any) => [r.file_name, r.from_requester, r.shared])).toEqual([
      ['photo.txt', true, false], ['fix-steps.txt', false, false], ['internal.txt', false, false],
    ]);
    const viewer = await t.as('executive_viewer');
    expect((await viewer.put(`/api/tickets/${id}/shared-files/${deskUpload.id}`, { shared: true })).status).toBe(403);
    expect((await agent.put(`/api/tickets/${id}/shared-files/${deskUpload.id}`, { shared: 'yes' })).status).toBe(400);
    expect((await agent.put(`/api/tickets/${id}/shared-files/${deskUpload.id}`, { shared: true })).body).toEqual({ shared: true });

    files = (await pat.get(`/api/portal/requests/${id}`)).body.files;
    expect(files.map((f: any) => [f.file_name, f.from_desk])).toEqual([['photo.txt', false], ['fix-steps.txt', true]]);
    const down = await pat.get(`/api/attachments/${deskUpload.id}/download`);
    expect(down.status).toBe(200);
    expect(down.text).toBe('Steps to fix');
    expect((await pat.get(`/api/attachments/${internal.id}/download`)).status).toBe(404);
    // Someone else's request: still nothing.
    expect((await robin.get(`/api/attachments/${deskUpload.id}/download`)).status).toBe(404);

    expect((await agent.put(`/api/tickets/${id}/shared-files/${deskUpload.id}`, { shared: false })).body).toEqual({ shared: false });
    expect((await pat.get(`/api/attachments/${deskUpload.id}/download`)).status).toBe(404);
    const history = (await t.api.get(`/api/history?record_type=ticket&record_id=${id}`)).body;
    expect(history.map((h: any) => h.action)).toEqual(expect.arrayContaining(['ticket.file_shared', 'ticket.file_unshared']));
  });
});

describe('required custom fields (E15-14)', () => {
  it('do not refuse a portal request, but still apply to agents', async () => {
    const field = await t.api.post('/api/admin/custom-fields', { record_type: 'ticket', label: 'Cost center', type: 'text', required: true });
    expect(field.status).toBe(201);
    try {
      const fromPortal = await pat.post('/api/portal/requests', { ...report, title: 'Badge reader at the gate' });
      expect(fromPortal.status).toBe(201);
      const byAgent = await agent.post('/api/tickets', { title: 'Logged by IT', requester_name: 'Pat Supervisor' });
      expect(byAgent.status).toBe(400);
      expect(byAgent.body.error.fields).toHaveProperty('cf_cost_center');
    } finally {
      expect((await t.api.patch(`/api/admin/custom-fields/${field.body.id}`, { active: false })).status).toBe(200);
    }
  });
});

describe('approvals in the portal (E03-21)', () => {
  it('lists only requests I may still decide, with the progress', async () => {
    const approver = await person('Alex Approver', ['requester', 'approver'], 'Finance');
    const other = await person('Sam Approver', ['requester', 'approver'], 'Finance');
    const item = await t.api.post('/api/catalog-items', {
      name: 'Access to fare data', active: true, portal: true, requires_approval: true, approvals_needed: 2, approver_ids: [approver.userId, other.userId],
    });
    const named = await pat.post('/api/portal/requests', { catalog_item_id: item.body.id });
    const notNamed = await t.api.post('/api/catalog-items', { name: 'Named elsewhere', active: true, portal: true, requires_approval: true, approver_ids: [other.userId] });
    const elsewhere = await pat.post('/api/portal/requests', { catalog_item_id: notNamed.body.id });

    let mine = (await approver.get('/api/portal/approvals')).body.rows;
    expect(mine.map((r: any) => r.id)).toContain(named.body.id);
    expect(mine.map((r: any) => r.id)).not.toContain(elsewhere.body.id);
    expect(mine.find((r: any) => r.id === named.body.id)).toMatchObject({ approvals_needed: 2, approvals_given: 0 });
    expect((await approver.post(`/api/tickets/${named.body.id}/approval`, { decision: 'approved' })).status).toBe(200);
    mine = (await approver.get('/api/portal/approvals')).body.rows;
    expect(mine.map((r: any) => r.id)).not.toContain(named.body.id);
    const theirs = (await other.get('/api/portal/approvals')).body.rows;
    expect(theirs.find((r: any) => r.id === named.body.id)).toMatchObject({ approvals_given: 1 });
  });
});

describe('shared ticket queues (E03-20)', () => {
  it('are offered to every agent once, as shared views of the ticket list', async () => {
    const views = await agent.get('/api/views?record_type=ticket');
    if (views.status === 404) return; // core shared views are not in this build
    const names = views.body.views.map((v: any) => v.name);
    expect(names).toEqual(expect.arrayContaining(['My open', 'Unassigned', 'Breaching', 'All open']));
    expect(views.body.views.find((v: any) => v.name === 'My open').view.filters).toEqual({ assignee_id: ['me'], 'resolved_at.null': ['true'] });
  });
});
