import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { safeRoute } from './service.ts';

// Invented record types. `action` and `ticket` stand in for the real ones when those
// modules are not loaded (GRC_MODULES=attachments,notifications); when they are loaded the
// real types are used, which is why they are only defined if missing.
const fixtures: ModuleDef = {
  key: 'testnotify',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_n_widgets (
        id uuid primary key default gen_random_uuid(), name text not null, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_n_secrets (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_n_actions (
        id uuid primary key default gen_random_uuid(), title text not null, status text, owner_id uuid, due_on date,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_n_tickets (
        id uuid primary key default gen_random_uuid(), title text not null, assignee_id uuid,
        resolve_due_at timestamptz, resolved_at timestamptz, paused_at timestamptz,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'n_widget', table: 'test_n_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/n-widgets', route: '/n-widgets', titleField: 'name', restricted: 'flag',
      fields: { name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean', default: false } },
    });
    ctx.defineResource({
      type: 'n_secret', table: 'test_n_secrets', module: 'tickets', label: 'Secret', plural: 'Secrets',
      path: '/api/n-secrets', route: '/n-secrets', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
    if (!ctx.resources.get('action')) {
      ctx.defineResource({
        type: 'action', table: 'test_n_actions', module: 'actions', label: 'Action', plural: 'Actions',
        path: '/api/actions', route: '/actions', titleField: 'title',
        fields: {
          title: { label: 'Title', type: 'text', required: true }, status: { label: 'Status', type: 'text' },
          owner_id: { label: 'Owner', type: 'user' }, due_on: { label: 'Due', type: 'date' },
        },
      });
    }
    if (!ctx.resources.get('ticket')) {
      ctx.defineResource({
        type: 'ticket', table: 'test_n_tickets', module: 'tickets', label: 'Ticket', plural: 'Tickets',
        path: '/api/tickets', route: '/tickets', titleField: 'title',
        fields: { title: { label: 'Title', type: 'text', required: true }, assignee_id: { label: 'Assignee', type: 'user' } },
      });
    }
  },
};

const day = (offset: number) => todayInZone(new Date(Date.now() + offset * 86_400_000));

let t: Awaited<ReturnType<typeof testApp>>;
let adminId: string;
let open: string;
let hidden: string;
let secret: string;

type Client = Awaited<ReturnType<typeof t.as>>;
const mine = async (c: { get: Client['get'] }, query = '') => (await c.get(`/api/notifications${query}`)).body;
const titles = async (c: { get: Client['get'] }) => (await mine(c, '?pageSize=100')).rows.map((r: any) => r.title);

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  open = (await t.api.post('/api/n-widgets', { name: 'Open widget' })).body.id;
  hidden = (await t.api.post('/api/n-widgets', { name: 'Zebra confidential', restricted: true })).body.id;
  secret = (await t.api.post('/api/n-secrets', { title: 'Zebra secret' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('the notify service', () => {
  it('is registered on the Fastify instance and never throws', async () => {
    expect(t.app.hasDecorator('notify')).toBe(true);
    expect(await t.app.notify({} as any)).toEqual({ sent: 0, skipped: 0 });
    expect(await t.app.notify({ kind: 'general', title: '   ', userIds: [adminId] })).toEqual({ sent: 0, skipped: 0 });
    expect(await t.app.notify({ kind: 'general', title: 'Nobody named' })).toEqual({ sent: 0, skipped: 0 });
  });

  it('targets named users, and only active ones', async () => {
    const agent = await t.as('agent');
    const other = await t.as('agent');
    const disabled = await t.as('agent');
    await t.db.query(`update users set status = 'disabled' where id = $1`, [disabled.userId]);

    const res = await t.app.notify({
      userIds: [agent.userId, disabled.userId, null, 'not-a-uuid', '00000000-0000-4000-8000-000000000000'],
      kind: 'assignment', title: 'Widget assigned to you: Open widget', body: 'Please take a look.',
      recordType: 'n_widget', recordId: open,
    });
    expect(res).toEqual({ sent: 1, skipped: 0 });

    const list = await mine(agent);
    expect(list).toMatchObject({ total: 1, unread: 1, page: 1, pageSize: 20 });
    expect(list.rows[0]).toMatchObject({
      kind: 'assignment', title: 'Widget assigned to you: Open widget', body: 'Please take a look.',
      route: `/n-widgets/${open}`, record_type: 'n_widget', record_id: open, read_at: null, unavailable: false,
    });
    expect((await mine(other)).total).toBe(0);
    expect((await t.db.query('select 1 from notifications where user_id = $1', [disabled.userId])).length).toBe(0);
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'notification.send' and record_id = $1`, [open]);
    expect(audit[0].summary).toBe('Notification (assignment) sent to 1 person');
  });

  it('targets everyone holding a permission', async () => {
    const pm = await t.as('project_manager');
    const agent = await t.as('agent');
    const viewer = await t.as('executive_viewer');
    const holders = (await t.db.query<{ id: string }>(
      `select distinct u.id from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id and r.enabled
       join role_permissions rp on rp.role_id = r.id where u.status = 'active' and rp.permission in ('*', 'projects.*', 'projects.approve')`,
    )).length;
    const res = await t.app.notify({ permission: 'projects.approve', kind: 'approval', title: 'Gate decision requested: Harbour upgrade', route: '/projects' });
    expect(res.sent).toBe(holders);
    expect(await titles(pm)).toContain('Gate decision requested: Harbour upgrade');
    expect(await titles(t.api)).toContain('Gate decision requested: Harbour upgrade'); // the administrator holds "*"
    expect(await titles(agent)).not.toContain('Gate decision requested: Harbour upgrade');
    expect(await titles(viewer)).not.toContain('Gate decision requested: Harbour upgrade');
    expect((await mine(pm)).rows[0]).toMatchObject({ route: '/projects', record_type: null });

    // Named users and a permission are combined, without duplicates.
    const both = await t.app.notify({ userIds: [pm.userId, viewer.userId], permission: 'projects.approve', kind: 'general', title: 'Combined targets', route: '/' });
    expect(both.sent).toBe(holders + 1);
    expect((await titles(pm)).filter((x: string) => x === 'Combined targets').length).toBe(1);
  });

  it('never tells someone about a record they may not see', async () => {
    const agent = await t.as('agent'); // tickets.* but not security.view
    const lead = await t.as('security_lead');
    const viewer = await t.as('executive_viewer'); // cannot see widgets at all

    const flagged = await t.app.notify({ userIds: [agent.userId, lead.userId, viewer.userId], kind: 'clock', title: 'Clock amber: Zebra confidential', recordType: 'n_widget', recordId: hidden });
    expect(flagged).toEqual({ sent: 1, skipped: 2 });
    const whole = await t.app.notify({ permission: 'tickets.view', kind: 'clock', title: 'Clock red: Zebra secret', recordType: 'n_secret', recordId: secret });
    expect(whole.sent).toBeGreaterThan(0);
    const plain = await t.app.notify({ userIds: [agent.userId, viewer.userId], kind: 'general', title: 'Open widget changed', recordType: 'n_widget', recordId: open });
    expect(plain).toEqual({ sent: 1, skipped: 1 });

    expect(await titles(lead)).toEqual(expect.arrayContaining(['Clock amber: Zebra confidential', 'Clock red: Zebra secret']));
    expect(JSON.stringify(await mine(agent, '?pageSize=100'))).not.toContain('Zebra');
    expect((await mine(viewer)).total).toBe(0);
    // Nothing was stored for them either: not even a count gives the record away.
    expect((await t.db.query(`select 1 from notifications where user_id = any($1::uuid[]) and title like '%Zebra%'`, [[agent.userId, viewer.userId]])).length).toBe(0);

    // A record that cannot be checked is not announced to anyone.
    expect((await t.app.notify({ userIds: [lead.userId], kind: 'general', title: 'Unknown type', recordType: 'no_such_type', recordId: open })).sent).toBe(0);
    expect((await t.app.notify({ userIds: [lead.userId], kind: 'general', title: 'Missing record', recordType: 'n_widget', recordId: '00000000-0000-4000-8000-000000000000' })).sent).toBe(0);
    expect((await t.app.notify({ userIds: [lead.userId], kind: 'general', title: 'Bad id', recordType: 'n_widget', recordId: 'nope' })).sent).toBe(0);
  });

  it('hides a notification again when its record becomes restricted later', async () => {
    const agent = await t.as('agent');
    const later = (await t.api.post('/api/n-widgets', { name: 'Yak project plan' })).body.id;
    await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Assigned to you: Yak project plan', recordType: 'n_widget', recordId: later });
    expect(await titles(agent)).toContain('Assigned to you: Yak project plan');
    await t.api.patch(`/api/n-widgets/${later}`, { restricted: true });
    const list = await mine(agent);
    expect(JSON.stringify(list)).not.toContain('Yak');
    expect(list.rows[0]).toMatchObject({ title: 'A record you can no longer open', route: null, record_id: null, unavailable: true });
  });

  it('only stores links that stay inside the application', async () => {
    expect(safeRoute('/tickets/123?tab=activity')).toBe('/tickets/123?tab=activity');
    for (const bad of ['https://example.test/x', '//example.test/x', 'javascript:alert(1)', 'tickets', '/a b', '/a\\b', '', undefined]) {
      expect(safeRoute(bad), String(bad)).toBeNull();
    }
    const agent = await t.as('agent');
    await t.app.notify({ userIds: [agent.userId], kind: 'general', title: 'Outside link', route: 'https://example.test/phish' });
    expect((await mine(agent)).rows[0]).toMatchObject({ title: 'Outside link', route: null });
  });
});

describe('reading', () => {
  it('counts unread, marks one read, marks all read, and pages', async () => {
    const agent = await t.as('agent');
    const other = await t.as('agent');
    for (let i = 1; i <= 5; i++) await t.app.notify({ userIds: [agent.userId], kind: 'general', title: `Note ${i}`, route: '/' });
    await t.app.notify({ userIds: [other.userId], kind: 'general', title: 'Not yours', route: '/' });

    expect((await agent.get('/api/notifications/unread-count')).body).toEqual({ unread: 5 });
    const first = await mine(agent, '?pageSize=2');
    expect(first).toMatchObject({ total: 5, unread: 5, page: 1, pageSize: 2 });
    expect(first.rows.length).toBe(2);
    expect((await mine(agent, '?pageSize=2&page=3')).rows.length).toBe(1);

    const target = first.rows[0];
    const read = await agent.post(`/api/notifications/${target.id}/read`);
    expect(read.body).toMatchObject({ ok: true, unread: 4 });
    expect(read.body.read_at).toBeTruthy();
    // Reading it again keeps the first time.
    expect((await agent.post(`/api/notifications/${target.id}/read`)).body.read_at).toBe(read.body.read_at);
    expect((await mine(agent, '?unread=true')).total).toBe(4);

    // Someone else's notification cannot be read or marked, and looks like one that does not exist.
    const theirs = (await mine(other)).rows[0];
    const denied = await agent.post(`/api/notifications/${theirs.id}/read`);
    expect(denied.status).toBe(404);
    expect(denied.body).toEqual((await agent.post('/api/notifications/00000000-0000-4000-8000-000000000000/read')).body);
    expect((await agent.post('/api/notifications/nope/read')).status).toBe(404);
    expect((await other.get('/api/notifications/unread-count')).body.unread).toBe(1);

    expect((await agent.post('/api/notifications/read-all')).body).toEqual({ ok: true, marked: 4, unread: 0 });
    expect((await agent.get('/api/notifications/unread-count')).body.unread).toBe(0);
    expect((await mine(agent)).total).toBe(5);
    expect((await other.get('/api/notifications/unread-count')).body.unread).toBe(1);
  });

  it('needs a session', async () => {
    expect((await t.anon.get('/api/notifications')).status).toBe(401);
    expect((await t.anon.get('/api/notifications/unread-count')).status).toBe(401);
    expect((await t.anon.post('/api/notifications/read-all')).status).toBe(401);
  });
});

describe('preferences', () => {
  it('lets each person switch kinds off, and honours the choice', async () => {
    const agent = await t.as('agent');
    const other = await t.as('agent');
    const before = (await agent.get('/api/notifications/preferences')).body;
    expect(before.dailyDigest).toBe(false);
    expect(before.emailAvailable).toBe(false);
    expect(before.kinds.map((k: any) => k.value)).toEqual(['assignment', 'approval', 'due', 'sla', 'reminder', 'acknowledgement', 'clock', 'general']);
    expect(before.kinds.every((k: any) => k.enabled && k.label && k.description)).toBe(true);

    const saved = await save(agent.userId, { kinds: { assignment: false, reminder: false }, dailyDigest: true });
    expect(saved.status).toBe(200);
    expect(saved.body.dailyDigest).toBe(true);
    expect(saved.body.kinds.filter((k: any) => !k.enabled).map((k: any) => k.value)).toEqual(['assignment', 'reminder']);

    const both = [agent.userId, other.userId];
    expect(await t.app.notify({ userIds: both, kind: 'assignment', title: 'Muted kind', route: '/' })).toEqual({ sent: 1, skipped: 1 });
    expect(await t.app.notify({ userIds: both, kind: 'due', title: 'Wanted kind', route: '/' })).toEqual({ sent: 2, skipped: 0 });
    expect(await titles(agent)).toEqual(['Wanted kind']);
    expect(await titles(other)).toEqual(expect.arrayContaining(['Muted kind', 'Wanted kind']));

    // Switching one back on leaves the other choice alone.
    const again = await save(agent.userId, { kinds: { assignment: true } });
    expect(again.body.kinds.filter((k: any) => !k.enabled).map((k: any) => k.value)).toEqual(['reminder']);
    expect(again.body.dailyDigest).toBe(true);
    expect((await t.app.notify({ userIds: [agent.userId], kind: 'assignment', title: 'Now wanted', route: '/' })).sent).toBe(1);

    const events = await t.db.query<{ before: any; after: any }>(
      `select before, after from audit_events where action = 'notification.preferences' and record_id = $1 order by id`, [agent.userId],
    );
    expect(events.length).toBe(2);
    expect(events[0].before).toEqual({ muted: [], dailyDigest: false });
    expect(events[0].after).toEqual({ muted: ['assignment', 'reminder'], dailyDigest: true });
    // Saving the same choices again writes nothing.
    await save(agent.userId, { kinds: { assignment: true } });
    expect((await t.db.query(`select 1 from audit_events where action = 'notification.preferences' and record_id = $1`, [agent.userId])).length).toBe(2);

    expect((await save(agent.userId, { kinds: { nonsense: false } })).body.error.fields.kinds).toMatch(/Unknown kind/);
    expect((await save(agent.userId, { kinds: { due: 'no' } })).body.error.fields.kinds).toBeDefined();
    expect((await save(agent.userId, { dailyDigest: 'yes' })).body.error.fields.dailyDigest).toBeDefined();
  });
});

describe('daily digest', () => {
  it('tells owners about actions due and assignees about tickets near their target, once a day', async () => {
    const owner = await t.as('agent');
    const assignee = await t.as('agent');
    const make = (type: string, data: Record<string, unknown>) => t.ctx.resources.create(type, data);
    const actionTable = t.ctx.resources.get('action')!.table;
    const ticketTable = t.ctx.resources.get('ticket')!.table;

    const overdue = await make('action', { title: 'Renew the lighthouse licence', owner_id: owner.userId, due_on: day(-4) });
    const soon = await make('action', { title: 'Review harbour access list', owner_id: owner.userId, due_on: day(2) });
    await make('action', { title: 'Far-off action', owner_id: owner.userId, due_on: day(20) });
    await make('action', { title: 'Nobody owns this', due_on: day(-1) });
    const done = await make('action', { title: 'Already finished', owner_id: owner.userId, due_on: day(-2) });
    await t.db.query(`update ${actionTable} set status = 'done' where id = $1`, [done.id]);

    const near = await make('ticket', { title: 'Printer on the quay is offline', assignee_id: assignee.userId });
    const far = await make('ticket', { title: 'New starter laptop', assignee_id: assignee.userId });
    const solved = await make('ticket', { title: 'Solved already', assignee_id: assignee.userId });
    await t.db.query(`update ${ticketTable} set resolve_due_at = now() + interval '90 minutes', resolved_at = null, paused_at = null where id = $1`, [near.id]);
    await t.db.query(`update ${ticketTable} set resolve_due_at = now() + interval '3 days', resolved_at = null, paused_at = null where id = $1`, [far.id]);
    await t.db.query(`update ${ticketTable} set resolve_due_at = now() + interval '30 minutes', resolved_at = now() where id = $1`, [solved.id]);

    const mineOnly = async (c: Client) => (await mine(c, '?pageSize=100')).rows.filter((r: any) => ['due', 'sla'].includes(r.kind));
    const count = async () => (await t.db.one<{ c: number }>(
      `select count(*)::int c from notifications where user_id = any($1::uuid[]) and kind in ('due', 'sla')`, [[owner.userId, assignee.userId]],
    ))!.c;

    expect((await owner.post('/api/notifications/digest/run')).status).toBe(403);
    const first = await t.api.post('/api/notifications/digest/run');
    expect(first.status).toBe(200);
    expect(await count()).toBe(3);

    const forOwner = await mineOnly(owner);
    expect(forOwner.map((r: any) => r.record_id).sort()).toEqual([overdue.id, soon.id].sort());
    expect(forOwner.find((r: any) => r.record_id === overdue.id).title).toMatch(/^Action overdue since \d{1,2} \w{3} \d{4}: Renew the lighthouse licence$/);
    expect(forOwner.find((r: any) => r.record_id === soon.id).title).toMatch(/^Action due on .*: Review harbour access list$/);
    expect(forOwner[0].route).toBe(`${t.ctx.resources.get('action')!.route}/${forOwner[0].record_id}`);
    const forAssignee = await mineOnly(assignee);
    expect(forAssignee.length).toBe(1);
    expect(forAssignee[0]).toMatchObject({ kind: 'sla', record_id: near.id, title: 'Ticket close to its resolution target: Printer on the quay is offline' });
    expect(forAssignee[0].body).toMatch(/^The target is /);

    // Running it again the same day adds nothing, however often.
    await t.api.post('/api/notifications/digest/run');
    await t.api.post('/api/notifications/digest/run');
    expect(await count()).toBe(3);

    // The next day the reminders are raised again, once.
    await t.db.query(`update notifications set created_at = created_at - interval '1 day' where user_id = any($1::uuid[])`, [[owner.userId, assignee.userId]]);
    await t.api.post('/api/notifications/digest/run');
    await t.api.post('/api/notifications/digest/run');
    expect(await count()).toBe(6);

    // A person who has switched the kind off is left alone.
    await save(owner.userId, { kinds: { due: false } });
    await t.db.query(`update notifications set created_at = created_at - interval '1 day' where user_id = any($1::uuid[])`, [[owner.userId, assignee.userId]]);
    await t.api.post('/api/notifications/digest/run');
    expect(await count()).toBe(7);
  });
});

/** Saves preferences as a given user. */
async function save(userId: string, body: unknown) {
  const { createSession, SESSION_COOKIE } = await import('../../core/auth.ts');
  const token = await createSession(t.db, userId);
  const res = await t.app.inject({
    method: 'PATCH', url: '/api/notifications/preferences', payload: body as object,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1' },
  });
  return { status: res.statusCode, body: res.json() };
}
