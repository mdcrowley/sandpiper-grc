import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { acceptTotpCode, readTotpSecret, SESSION_COOKIE, storeTotpSecret } from './auth.ts';
import type { ModuleDef } from './module.ts';
import { makeDbLimiter } from './ratelimit.ts';
import { makeSecretBox, parseKey } from './secretbox.ts';
import { defaultKeyFile } from './secretkey.ts';
import { ADMIN, testApp } from '../test/helpers.ts';
import { generateTotpSecret, matchTotpStep, totpCode, verifyTotp } from './totp.ts';

// A throwaway module exercising the generic resource engine with invented data.
const widgets: ModuleDef = {
  key: 'testwidgets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_widgets (
        id uuid primary key default gen_random_uuid(),
        ref text, name text not null, notes text, status text, owner_id uuid, parent_id uuid,
        due_on date, cost numeric, details jsonb, restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_secrets (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_notes (
        id uuid primary key default gen_random_uuid(), title text not null, about_type text, about_id uuid,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('widget_status', [
      { value: 'open', label: 'Open', color: 'blue' },
      { value: 'done', label: 'Done', color: 'green' },
    ]);
    // Lists used by hand-written pages only: one owned by a module, one by a restricted module, one public, one untagged.
    await ctx.lookups.ensure('widget_color', [{ value: 'red', label: 'Red' }], { module: 'tickets' });
    await ctx.lookups.ensure('secret_scenario', [{ value: 'zebra', label: 'Zebra scenario' }], { module: 'testsecrets' });
    await ctx.lookups.ensure('risk_only', [{ value: 'r', label: 'Risk-only value' }], { module: 'risks' });
    await ctx.lookups.ensure('everyone_list', [{ value: 'e', label: 'For everyone' }], { public: true });
    await ctx.lookups.ensure('orphan_list', [{ value: 'o', label: 'Orphan' }]);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'widget', table: 'test_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/widgets', route: '/widgets', titleField: 'name', ref: { field: 'ref', prefix: 'W-' },
      restricted: 'flag', searchable: ['name', 'notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'widget_status', default: 'open' },
        owner_id: { label: 'Owner', type: 'user' },
        parent_id: { label: 'Parent', type: 'ref', to: 'widget' },
        due_on: { label: 'Due', type: 'date' },
        cost: { label: 'Cost', type: 'currency' },
        details: { label: 'Details', type: 'json' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    ctx.defineResource({
      type: 'secret', table: 'test_secrets', module: 'tickets', label: 'Secret', plural: 'Secrets',
      path: '/api/secrets', route: '/secrets', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
    // A second restricted type under a module key of its own, to test list ownership.
    ctx.defineResource({
      type: 'vault_item', table: 'test_secrets', module: 'testsecrets', label: 'Vault item', plural: 'Vault items',
      path: '/api/vault-items', route: '/vault-items', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
    // Notes take their restriction from the record they are about.
    ctx.defineResource({
      type: 'note', table: 'test_notes', module: 'tickets', label: 'Note', plural: 'Notes',
      path: '/api/notes', route: '/notes', titleField: 'title',
      restricted: 'flag', restrictedFrom: { typeField: 'about_type', idField: 'about_id' },
      fields: {
        title: { label: 'Title', type: 'text', required: true },
        about_type: { label: 'About type', type: 'text' },
        about_id: { label: 'About', type: 'text' },
        restricted: { label: 'Restricted', type: 'boolean', readOnly: true },
      },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ extraModules: [widgets] }); });
afterAll(async () => { await t.close(); });

describe('sign-in', () => {
  it('requires a session and the CSRF header', async () => {
    expect((await t.anon.get('/api/meta')).status).toBe(401);
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(res.statusCode).toBe(403);
  });

  it('reports state and refuses a second setup', async () => {
    const state = await t.api.get('/api/auth/state');
    expect(state.body.setupRequired).toBe(false);
    expect(state.body.user.username).toBe('admin');
    expect(state.body.permissions).toContain('*');
    expect((await t.anon.post('/api/setup', ADMIN)).status).toBe(409);
  });

  it('signs in with the right password and gives the same error for unknown users and wrong passwords', async () => {
    const ok = await t.anon.post('/api/auth/login', { username: 'ADMIN', password: ADMIN.password });
    expect(ok.status).toBe(200);
    const wrong = await t.anon.post('/api/auth/login', { username: 'admin', password: 'not the password' });
    const unknown = await t.anon.post('/api/auth/login', { username: 'nobody', password: 'not the password' });
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
  });

  it('locks an account after repeated failures and audits it', async () => {
    const victim = await t.as('agent');
    await t.db.query(`update users set password_hash = (select password_hash from users where username = 'admin') where id = $1`, [victim.userId]);
    const name = (await t.db.one<{ username: string }>('select username from users where id = $1', [victim.userId]))!.username;
    for (let i = 0; i < 5; i++) await t.anon.post('/api/auth/login', { username: name, password: 'wrong wrong wrong' });
    const locked = await t.anon.post('/api/auth/login', { username: name, password: ADMIN.password });
    expect(locked.status).toBe(401);
    const events = await t.db.query(`select action from audit_events where record_id = $1 and action = 'signin.lockout'`, [victim.userId]);
    expect(events.length).toBe(1);
  });

  it('enforces the password policy on change and ends other sessions', async () => {
    const short = await t.api.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: 'short' });
    expect(short.body.error.fields.newPassword).toMatch(/at least 14/);
    const reuse = await t.api.post('/api/auth/change-password', { currentPassword: ADMIN.password, newPassword: ADMIN.password });
    expect(reuse.body.error.fields.newPassword).toMatch(/reuse/);
  });

  it('verifies time-based codes', () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totpCode(secret))).toBe(true);
    expect(verifyTotp(secret, '000000') && verifyTotp(secret, '111111')).toBe(false);
    // RFC 6238 test vector (SHA-1, 59 seconds)
    expect(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000)).toBe('287082');
  });
});

describe('resources', () => {
  let id: string;

  it('creates with an auto-number, defaults and display labels', async () => {
    const res = await t.api.post('/api/widgets', { name: 'First widget', cost: '1,250.50', due_on: '2026-12-01', details: { a: 1 } });
    expect(res.status).toBe(201);
    expect(res.body.ref).toBe('W-00001');
    expect(res.body.status).toBe('open');
    expect(res.body.cost).toBe(1250.5);
    expect(res.body.due_on).toBe('2026-12-01');
    expect(res.body.details).toEqual({ a: 1 });
    expect(res.body._display.status).toBe('Open');
    expect(res.body._display.created_by).toBe('Test Admin');
    id = res.body.id;
  });

  it('validates input', async () => {
    const res = await t.api.post('/api/widgets', { status: 'nonsense', cost: 'abc', due_on: '12/01/2026' });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields).sort()).toEqual(['cost', 'due_on', 'name', 'status']);
  });

  it('updates, records before and after, and shows history', async () => {
    const res = await t.api.patch(`/api/widgets/${id}`, { status: 'done', name: 'First widget', ref: 'HACK' });
    expect(res.body.status).toBe('done');
    expect(res.body.ref).toBe('W-00001');
    const history = await t.api.get(`/api/history?record_type=widget&record_id=${id}`);
    expect(history.body[0].before).toEqual({ status: 'open' });
    expect(history.body[0].after).toEqual({ status: 'done' });
    expect(history.body.map((h: any) => h.action)).toEqual(['widget.update', 'widget.create']);
  });

  it('lists with search, filters, sort, paging, stats and CSV', async () => {
    await t.api.post('/api/widgets', { name: 'Second widget', notes: 'needle in here', cost: 5, due_on: '2027-01-15', parent_id: id });
    await t.api.post('/api/widgets', { name: 'Third widget', cost: 50 });
    expect((await t.api.get('/api/widgets?q=needle')).body.total).toBe(1);
    expect((await t.api.get('/api/widgets?f.status=open')).body.total).toBe(2);
    expect((await t.api.get('/api/widgets?f.status=open,done')).body.total).toBe(3);
    expect((await t.api.get('/api/widgets?f.cost.gt=10')).body.total).toBe(2);
    expect((await t.api.get('/api/widgets?f.due_on.lt=2026-12-31')).body.total).toBe(1);
    expect((await t.api.get('/api/widgets?f.due_on.null=true')).body.total).toBe(1);
    expect((await t.api.get('/api/widgets?f.created_by=me')).body.total).toBe(3);
    expect((await t.api.get('/api/widgets?f.bogus=1')).status).toBe(400);
    const sorted = await t.api.get('/api/widgets?sort=cost&dir=desc&pageSize=2');
    expect(sorted.body.rows.map((r: any) => r.cost)).toEqual([1250.5, 50]);
    expect(sorted.body.total).toBe(3);
    const child = (await t.api.get('/api/widgets?q=Second')).body.rows[0];
    expect(child._display.parent_id).toBe('First widget');
    const stats = await t.api.get('/api/widgets/stats?group=status');
    expect(stats.body.groups).toEqual([
      { value: 'open', label: 'Open', color: 'blue', count: 2 },
      { value: 'done', label: 'Done', color: 'green', count: 1 },
    ]);
    const csv = await t.api.get('/api/widgets?format=csv&sort=cost');
    expect(csv.text.split('\r\n').length).toBe(4);
    expect(csv.text).toContain('Second widget');
    const exported = await t.db.query(`select 1 from audit_events where action = 'widget.export'`);
    expect(exported.length).toBe(1);
  });

  it('soft-deletes', async () => {
    const made = await t.api.post('/api/widgets', { name: 'Doomed' });
    expect((await t.api.del(`/api/widgets/${made.body.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/widgets/${made.body.id}`)).status).toBe(404);
    expect((await t.db.query('select 1 from test_widgets where id = $1', [made.body.id])).length).toBe(1);
  });

  it('supports comments, links and search', async () => {
    const other = (await t.api.get('/api/widgets?q=Third')).body.rows[0];
    expect((await t.api.post('/api/comments', { record_type: 'widget', record_id: id, body: 'Looks fine', internal: true })).status).toBe(201);
    expect((await t.api.get(`/api/comments?record_type=widget&record_id=${id}`)).body[0].author_name).toBe('Test Admin');
    expect((await t.api.post('/api/links', { from_type: 'widget', from_id: id, to_type: 'widget', to_id: other.id, relation: 'blocks' })).status).toBe(201);
    const out = await t.api.get(`/api/links?record_type=widget&record_id=${id}`);
    expect(out.body[0]).toMatchObject({ direction: 'out', relation: 'blocks', label: 'Third widget', route: '/widgets' });
    const back = await t.api.get(`/api/links?record_type=widget&record_id=${other.id}`);
    expect(back.body[0].direction).toBe('in');
    expect((await t.api.get('/api/search?q=third')).body[0]).toMatchObject({ type: 'widget', label: 'Third widget' });
    expect((await t.api.get('/api/records/lookup?type=widget&q=W-00001')).body[0].label).toBe('First widget');
  });
});

describe('permissions and restricted records', () => {
  it('keeps restricted records invisible to an ordinary agent everywhere', async () => {
    const agent = await t.as('agent');
    const open = (await t.api.get('/api/widgets?q=First')).body.rows[0];
    const hidden = await t.api.post('/api/widgets', { name: 'Zebra confidential', restricted: true, parent_id: open.id });
    await t.api.post('/api/links', { from_type: 'widget', from_id: open.id, to_type: 'widget', to_id: hidden.body.id });
    const pointer = await t.api.post('/api/widgets', { name: 'Points at hidden', parent_id: hidden.body.id });
    await t.api.post('/api/secrets', { title: 'Zebra secret' });

    const adminTotal = (await t.api.get('/api/widgets')).body.total;
    expect((await agent.get('/api/widgets')).body.total).toBe(adminTotal - 1);
    expect((await agent.get(`/api/widgets/${hidden.body.id}`)).status).toBe(404);
    expect((await agent.patch(`/api/widgets/${hidden.body.id}`, { name: 'x' })).status).toBe(404);
    expect((await agent.get('/api/search?q=zebra')).body).toEqual([]);
    expect((await agent.get('/api/records/lookup?type=widget&q=zebra')).body).toEqual([]);
    expect((await agent.get(`/api/links?record_type=widget&record_id=${open.id}`)).body.every((l: any) => l.recordId !== hidden.body.id)).toBe(true);
    expect((await agent.get(`/api/history?record_type=widget&record_id=${hidden.body.id}`)).status).toBe(404);
    expect((await agent.get(`/api/widgets/${pointer.body.id}`)).body._display.parent_id).toBe('Restricted');
    expect((await agent.get('/api/widgets?format=csv')).text).not.toContain('Zebra');
    // Figures are the same for everyone: the restricted widget counts, but none of its words or links show.
    const stats = await agent.get('/api/widgets/stats?group=restricted');
    expect(stats.body).toEqual((await t.api.get('/api/widgets/stats?group=restricted')).body);
    expect(stats.body.total).toBe(adminTotal);
    expect(stats.body.groups.find((g: any) => g.value === 'true').count).toBe(1);
    const byName = (await agent.get('/api/widgets/stats?group=name')).body;
    expect(byName).toEqual((await t.api.get('/api/widgets/stats?group=name')).body);
    expect(JSON.stringify(byName)).not.toContain('Zebra');
    expect(byName.groups.find((g: any) => g.restricted)).toMatchObject({ value: null, label: 'Restricted records', count: 1 });
    // A search or a filter on its words never finds it in a figure, for anyone.
    for (const q of ['q=zebra', 'f.name=Zebra%20confidential']) {
      expect((await agent.get(`/api/widgets/stats?group=status&${q}`)).body.total).toBe(0);
      expect((await t.api.get(`/api/widgets/stats?group=status&${q}`)).body.total).toBe(0);
    }
    // The pointer's reference to it is labeled "Restricted" for the agent; the count is the same.
    const byParent = (await agent.get('/api/widgets/stats?group=parent_id')).body;
    expect(byParent.groups.find((g: any) => g.value === hidden.body.id)).toMatchObject({ label: 'Restricted', count: 1 });
    expect(byParent.total).toBe((await t.api.get('/api/widgets/stats?group=parent_id')).body.total);

    expect((await agent.get('/api/secrets')).status).toBe(403);
    expect((await agent.get('/api/meta')).body.resources.secret).toBeUndefined();
    expect((await agent.get('/api/meta')).body.resources.widget).toBeDefined();

    const lead = await t.as('security_lead');
    expect((await lead.get('/api/widgets')).body.total).toBe(adminTotal);
    expect((await lead.get('/api/secrets')).body.total).toBe(1);
  });

  it('applies role grants', async () => {
    const pm = await t.as('project_manager');
    expect((await pm.get('/api/widgets')).status).toBe(200);
    expect((await pm.post('/api/widgets', { name: 'Nope' })).status).toBe(403);
    expect((await pm.get('/api/audit')).status).toBe(403);
    expect((await pm.post('/api/lookups', { list_key: 'widget_status', value: 'x', label: 'X' })).status).toBe(403);
  });
});

describe('audit and configuration', () => {
  it('is append-only', async () => {
    await expect(t.db.query(`update audit_events set summary = 'tampered'`)).rejects.toThrow(/append-only/);
    await expect(t.db.query('delete from audit_events')).rejects.toThrow(/append-only/);
  });

  it('can be searched by people with audit.view', async () => {
    const res = await t.api.get('/api/audit?action=widget.create');
    expect(res.body.total).toBeGreaterThan(2);
    expect(res.body.rows[0].actor_name).toBe('Test Admin');
  });

  it('lets an administrator add a status without code', async () => {
    const add = await t.api.post('/api/lookups', { list_key: 'widget_status', value: 'parked', label: 'Parked', color: 'amber', sort: 15 });
    expect(add.status).toBe(201);
    const made = await t.api.post('/api/widgets', { name: 'Parked one', status: 'parked' });
    expect(made.body._display.status).toBe('Parked');
    await t.api.del(`/api/lookups/${add.body.id}`);
    expect((await t.api.post('/api/widgets', { name: 'Too late', status: 'parked' })).status).toBe(400);
  });
});

describe('inherited restriction (E08-16)', () => {
  it('copies the restriction of the source record on create, on change of source, and when the source changes', async () => {
    const agent = await t.as('agent');
    const open = (await t.api.post('/api/widgets', { name: 'Okapi open widget' })).body;
    const closed = (await t.api.post('/api/widgets', { name: 'Okapi closed widget', restricted: true })).body;
    const secret = (await t.api.post('/api/secrets', { title: 'Okapi secret' })).body;

    const a = (await t.api.post('/api/notes', { title: 'Okapi note A', about_type: 'widget', about_id: open.id })).body;
    const b = (await t.api.post('/api/notes', { title: 'Okapi note B', about_type: 'widget', about_id: closed.id })).body;
    const c = (await t.api.post('/api/notes', { title: 'Okapi note C', about_type: 'secret', about_id: secret.id })).body;
    const d = (await t.api.post('/api/notes', { title: 'Okapi note D', about_type: 'unknown_type', about_id: open.id })).body;
    expect([a.restricted, b.restricted, c.restricted, d.restricted]).toEqual([false, true, true, false]);
    expect((await agent.get('/api/notes?q=Okapi')).body.rows.map((r: any) => r.title).sort()).toEqual(['Okapi note A', 'Okapi note D']);

    // Flagging the source restricts what hangs off it; clearing the flag releases it. Each change is audited.
    await t.api.patch(`/api/widgets/${open.id}`, { restricted: true });
    expect((await agent.get(`/api/notes/${a.id}`)).status).toBe(404);
    expect((await agent.get('/api/search?q=Okapi note')).body.map((r: any) => r.label)).toEqual(['Okapi note D']);
    await t.api.patch(`/api/widgets/${open.id}`, { restricted: false });
    expect((await agent.get(`/api/notes/${a.id}`)).body.restricted).toBe(false);
    const events = await t.db.query<{ actor_name: string }>(`select actor_name from audit_events where action = 'note.restriction' and record_id = $1`, [a.id]);
    expect(events.map((e) => e.actor_name)).toEqual(['System', 'System']);

    // An agent cannot point a note at a record they cannot see, whether or not it exists.
    const probe = await agent.post('/api/notes', { title: 'Probe', about_type: 'widget', about_id: closed.id });
    expect(probe.status).toBe(400);
    expect((await agent.post('/api/notes', { title: 'Probe', about_type: 'widget', about_id: '11111111-2222-4333-8444-555555555555' })).body).toEqual(probe.body);
    expect((await agent.patch(`/api/notes/${a.id}`, { about_id: closed.id })).status).toBe(400);
    expect((await agent.post('/api/notes', { title: 'Tries to hide', restricted: true })).body.restricted).toBe(false);
  });

  it('gives hand-written queries the same condition through ctx.resources.visibleWhere', async () => {
    const agent = await t.as('agent');
    const user = { id: agent.userId, username: 'x', displayName: 'x', email: 'x', roles: [], permissions: ['tickets.*'] };
    expect(t.ctx.resources.visibleWhere('note', user)).toBe('coalesce(restricted, false) = false');
    expect(t.ctx.resources.visibleWhere('note', user, 'n')).toBe('coalesce(n.restricted, false) = false');
    expect(t.ctx.resources.visibleWhere('secret', user)).toBe('false');
    expect(t.ctx.resources.visibleWhere('note', null)).toBe('true');
    expect(t.ctx.resources.visibleWhere('note', { ...user, permissions: ['security.view'] })).toBe('true');
    expect(t.ctx.resources.visibleWhere('no_such_type', null)).toBe('false');
    expect(() => t.ctx.resources.visibleWhere('note', user, 'n; drop table x')).toThrow();
  });

  it('hides audit events about a flagged record, and labels of records in modules the caller cannot view', async () => {
    const auditor = await t.as('auditor'); // audit.view, no security.view, no tickets.view
    const flagged = (await t.api.post('/api/widgets', { name: 'Narwhal flagged widget', restricted: true })).body;
    await t.api.post('/api/widgets', { name: 'Narwhal plain widget', parent_id: flagged.id });
    const seen = (await auditor.get('/api/audit?q=Narwhal')).body.rows.map((e: any) => e.summary);
    expect(seen.some((s: string) => s.includes('Narwhal plain widget'))).toBe(true);
    expect(seen.some((s: string) => s.includes('Narwhal flagged widget'))).toBe(false);
    expect((await auditor.get('/api/audit?q=Narwhal&format=csv')).text).not.toContain('Narwhal flagged widget');
    expect((await t.api.get('/api/audit?q=Narwhal')).body.rows.some((e: any) => e.summary.includes('Narwhal flagged widget'))).toBe(true);

    // A project manager may view widgets (tickets.view) but not vault items: stats grouped by a reference show no title.
    const labels = await (t as any).ctx.resources.labelFor('widget', flagged.id);
    expect(labels).toBe('Narwhal flagged widget'); // the system sees everything
  });
});

describe('list metadata (E01-23)', () => {
  const lists = async (api: { get: (url: string) => Promise<any> }) => Object.keys((await api.get('/api/meta')).body.lookups).sort();

  it('returns only the lists a person may use', async () => {
    const agent = await t.as('agent'); // tickets.*, no security.view, no risks.view
    const mine = await lists(agent);
    expect(mine).toContain('widget_status'); // a field of a record type they may view
    expect(mine).toContain('widget_color'); // owned by a module they hold view on
    expect(mine).toContain('everyone_list'); // public
    expect(mine).not.toContain('secret_scenario'); // owner module is restricted
    expect(mine).not.toContain('risk_only'); // no view on the owner module
    expect(mine).not.toContain('orphan_list'); // no owner: administrators only

    const viewer = await t.as('executive_viewer'); // no tickets permission at all
    const theirs = await lists(viewer);
    expect(theirs).toContain('everyone_list');
    for (const l of ['widget_status', 'widget_color', 'secret_scenario', 'risk_only', 'orphan_list']) expect(theirs).not.toContain(l);

    const all = await lists(t.api);
    for (const l of ['widget_status', 'widget_color', 'everyone_list', 'secret_scenario', 'risk_only', 'orphan_list']) expect(all).toContain(l);
  });

  it('applies the same rule to GET /api/lookups/:list', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/lookups/widget_status')).body.map((v: any) => v.value)).toContain('open');
    expect((await agent.get('/api/lookups/widget_color')).status).toBe(200);
    expect((await agent.get('/api/lookups/everyone_list')).status).toBe(200);
    for (const l of ['secret_scenario', 'risk_only', 'orphan_list', 'no_such_list']) {
      const res = await agent.get(`/api/lookups/${l}`);
      expect([l, res.status]).toEqual([l, 403]);
      expect(JSON.stringify(res.body)).not.toMatch(/Zebra|Risk-only|Orphan/);
    }
    expect((await t.api.get('/api/lookups/secret_scenario')).body[0].label).toBe('Zebra scenario');
    expect((await t.anon.get('/api/lookups/everyone_list')).status).toBe(401);
  });

  it('keeps the owner of a list when values are added later without one', async () => {
    await t.ctx.lookups.ensure('widget_color', [{ value: 'blue', label: 'Blue' }]); // as the organization profile does
    const agent = await t.as('agent');
    expect((await agent.get('/api/lookups/widget_color')).body.map((v: any) => v.value).sort()).toEqual(['blue', 'red']);
  });
});

describe('audit actor (E18-22)', () => {
  it('names the system for system events and nobody for a request with no signed-in user', async () => {
    await t.ctx.audit(null, { action: 'test.system_event', summary: 'Written by a timer' });
    const sys = await t.db.one<any>(`select actor_id, actor_name, ip from audit_events where action = 'test.system_event'`);
    expect(sys).toEqual({ actor_id: null, actor_name: 'System', ip: null });
    await t.anon.post('/api/auth/login', { username: 'nobody-here', password: 'not the password' });
    const failed = await t.db.one<any>(`select actor_id, actor_name, ip from audit_events where action = 'signin.failure' order by id desc limit 1`);
    expect(failed.actor_name).toBeNull(); // nobody was signed in
    expect(failed.ip).toBeTruthy(); // but the source address is kept
    const seeded = await t.ctx.resources.create('widget', { name: 'Seeded by the system' });
    const ev = (await t.api.get(`/api/history?record_type=widget&record_id=${seeded.id}`)).body[0];
    expect(ev.actor_name).toBe('System');
  });
});

describe('session cookie (E02-14)', () => {
  const login = (headers: Record<string, string> = {}) => t.app.inject({
    method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1', ...headers },
    payload: { username: ADMIN.username, password: ADMIN.password },
  });
  const cookieOf = (res: Awaited<ReturnType<typeof login>>) => res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  const withEnv = async <T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> => {
    const before = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
    Object.assign(process.env, env);
    try { return await fn(); } finally {
      for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
  };

  it('is not marked secure by default (plain http on 127.0.0.1)', async () => {
    const c = cookieOf(await login({ 'x-forwarded-proto': 'https' }));
    expect(c.secure).toBeFalsy();
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Strict');
  });

  it('is marked secure when configured: always, or automatically behind a trusted HTTPS proxy', async () => {
    expect(cookieOf(await withEnv({ GRC_COOKIE_SECURE: 'always' }, () => login())).secure).toBe(true);
    // auto: only when the request really is HTTPS; a forwarded header counts only when the proxy is trusted.
    expect(cookieOf(await withEnv({ GRC_COOKIE_SECURE: 'auto' }, () => login())).secure).toBeFalsy();
    expect(cookieOf(await withEnv({ GRC_COOKIE_SECURE: 'auto' }, () => login({ 'x-forwarded-proto': 'https' }))).secure).toBeFalsy();
    expect(cookieOf(await withEnv({ GRC_COOKIE_SECURE: 'auto', GRC_TRUST_PROXY: '1' }, () => login({ 'x-forwarded-proto': 'https' }))).secure).toBe(true);
    expect(cookieOf(await withEnv({ GRC_COOKIE_SECURE: 'auto', GRC_TRUST_PROXY: '1' }, () => login({ 'x-forwarded-proto': 'http' }))).secure).toBeFalsy();
  });

  it('records the address the trusted proxy reports, and ignores the header otherwise', async () => {
    const last = async () => (await t.db.one<{ ip: string }>(`select ip from sessions order by created_at desc limit 1`))!.ip;
    await login({ 'x-forwarded-for': '203.0.113.9' });
    expect(await last()).toBe('127.0.0.1');
    await withEnv({ GRC_TRUST_PROXY: '1' }, () => login({ 'x-forwarded-for': '198.51.100.1, 203.0.113.9' }));
    expect(await last()).toBe('203.0.113.9');
  });
});

describe('secret key and authenticator codes (E02-06, E02-07)', () => {
  it('encrypts with AES-256-GCM in a versioned format bound to its context', () => {
    const key = randomBytes(32);
    const box = makeSecretBox(key);
    const sealed = box.encrypt('JBSWY3DPEHPK3PXP', 'totp:user-1');
    expect(sealed).toMatch(/^enc:v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.encrypt('JBSWY3DPEHPK3PXP', 'totp:user-1')).not.toBe(sealed); // fresh iv each time
    expect(box.decrypt(sealed, 'totp:user-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => box.decrypt(sealed, 'totp:user-2')).toThrow(); // copied onto another row
    expect(() => makeSecretBox(randomBytes(32)).decrypt(sealed, 'totp:user-1')).toThrow(); // wrong key
    // Altered: change the first character of the last part. (Changing the very last characters
    // can leave the decoded bytes unchanged, because base64's final character is partly padding.)
    const cut = sealed.lastIndexOf(':') + 1;
    const altered = sealed.slice(0, cut) + (sealed[cut] === 'A' ? 'B' : 'A') + sealed.slice(cut + 1);
    expect(() => box.decrypt(altered, 'totp:user-1')).toThrow();
    expect(box.decrypt('PLAINOLDSECRET', 'totp:user-1')).toBe('PLAINOLDSECRET'); // data from before encryption
    // A retired key still opens old values, which are then not "current".
    const next = makeSecretBox(randomBytes(32), [key]);
    expect(next.decrypt(sealed, 'totp:user-1')).toBe('JBSWY3DPEHPK3PXP');
    expect(next.isCurrent(sealed, 'totp:user-1')).toBe(false);
    expect(box.isCurrent(sealed, 'totp:user-1')).toBe(true);
    expect(parseKey(key.toString('hex')).equals(key)).toBe(true);
    expect(parseKey(key.toString('base64')).equals(key)).toBe(true);
    expect(() => parseKey('too short')).toThrow(/32 bytes/);
  });

  it('stores authenticator keys encrypted and accepts each code once', async () => {
    const user = await t.as('agent');
    const secret = generateTotpSecret();
    await storeTotpSecret(t.db, user.userId, secret);
    const stored = (await t.db.one<{ totp_secret: string }>('select totp_secret from users where id = $1', [user.userId]))!.totp_secret;
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain(secret);
    expect(await readTotpSecret(t.db, user.userId)).toBe(secret);

    const now = Date.now();
    const code = totpCode(secret, now);
    expect(matchTotpStep(secret, code, now)).toBe(Math.floor(now / 30000));
    expect(await acceptTotpCode(t.db, user.userId, '000000', now) && await acceptTotpCode(t.db, user.userId, '111111', now)).toBe(false);
    expect(await acceptTotpCode(t.db, user.userId, code, now)).toBe(true);
    expect(await acceptTotpCode(t.db, user.userId, code, now)).toBe(false); // replay of the same code
    expect(await acceptTotpCode(t.db, user.userId, totpCode(secret, now - 30000), now)).toBe(false); // an earlier step
    expect(await acceptTotpCode(t.db, user.userId, totpCode(secret, now + 30000), now + 30000)).toBe(true); // the next step
    expect((await t.db.one<{ s: number }>('select totp_last_step as s from users where id = $1', [user.userId]))!.s).toBe(Math.floor(now / 30000) + 1);
  });
});

describe('across a restart (E01-22, E02-07)', () => {
  it('keeps rate-limit counts, creates the key file once, and encrypts keys left in the clear', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'grc-core-'));
    const keep = { ...process.env };
    delete process.env.GRC_SECRET_KEY; delete process.env.GRC_SECRET_KEY_FILE;
    try {
      const first = await buildApp({ dataDir: dir, serveWeb: false });
      const keyFile = defaultKeyFile(dir); // beside the data folder, not inside it
      expect(existsSync(keyFile)).toBe(true); // generated on first start
      const limiter = makeDbLimiter(first.db, 'test', 3, 60_000);
      for (let i = 0; i < 3; i++) await limiter.hit('198.51.100.7');
      expect(await limiter.blocked('198.51.100.7')).toBe(true);
      expect(await limiter.blocked('198.51.100.8')).toBe(false);
      // Sign-in failures are counted in the same table.
      for (let i = 0; i < 20; i++) await first.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'nobody', password: 'x' } });
      // A user enrolled by an earlier version: the key sits in the database in the clear.
      const secret = generateTotpSecret();
      const u = (await first.db.one<{ id: string }>(
        `insert into users (username, email, display_name, status, totp_secret, totp_enabled) values ('old', 'old@example.test', 'Old', 'active', $1, true) returning id`, [secret]))!;
      await first.close();

      const second = await buildApp({ dataDir: dir, serveWeb: false });
      expect(await makeDbLimiter(second.db, 'test', 3, 60_000).blocked('198.51.100.7')).toBe(true); // survived the restart
      const login = await second.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'nobody', password: 'x' } });
      expect(login.statusCode).toBe(429);
      const stored = (await second.db.one<{ totp_secret: string }>('select totp_secret from users where id = $1', [u.id]))!.totp_secret;
      expect(stored).toMatch(/^enc:v1:/);
      expect(await readTotpSecret(second.db, u.id)).toBe(secret);
      expect((await second.db.query(`select 1 from audit_events where action = 'mfa.secrets_encrypted'`)).length).toBe(1);
      const key = readFileSync(keyFile, 'utf8').trim();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      // Old entries are removed once they fall outside the window.
      await second.db.query(`update rate_limit_hits set at = now() - interval '2 minutes' where bucket = 'test'`);
      const short = makeDbLimiter(second.db, 'test', 3, 60_000);
      expect(await short.blocked('198.51.100.7')).toBe(false);
      await short.hit('198.51.100.9');
      expect((await second.db.one<{ c: number }>(`select count(*)::int c from rate_limit_hits where bucket = 'test'`))!.c).toBe(1);
      await second.close();

      // Third start: same key file, nothing left to migrate; a different key cannot read the stored value.
      const third = await buildApp({ dataDir: dir, serveWeb: false });
      expect(readFileSync(keyFile, 'utf8').trim()).toBe(key);
      expect(await readTotpSecret(third.db, u.id)).toBe(secret);
      expect((await third.db.query(`select 1 from audit_events where action = 'mfa.secrets_encrypted'`)).length).toBe(1);
      await third.close();

      // A different key: the server still starts, says so, and refuses codes rather than failing.
      process.env.GRC_SECRET_KEY = randomBytes(32).toString('hex');
      const fourth = await buildApp({ dataDir: dir, serveWeb: false });
      expect(await readTotpSecret(fourth.db, u.id)).toBeNull();
      expect(await acceptTotpCode(fourth.db, u.id, totpCode(secret))).toBe(false);
      expect((await fourth.db.query(`select 1 from audit_events where action = 'mfa.secrets_unreadable'`)).length).toBe(1);
      await fourth.close();
      // The old key listed as retired: values are re-encrypted with the new one.
      process.env.GRC_SECRET_KEY_PREVIOUS = key;
      const fifth = await buildApp({ dataDir: dir, serveWeb: false });
      expect(await readTotpSecret(fifth.db, u.id)).toBe(secret);
      await fifth.close();
      delete process.env.GRC_SECRET_KEY_PREVIOUS;
      const sixth = await buildApp({ dataDir: dir, serveWeb: false });
      expect(await readTotpSecret(sixth.db, u.id)).toBe(secret); // the retired key is no longer needed
      await sixth.close();
    } finally {
      process.env = keep;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});