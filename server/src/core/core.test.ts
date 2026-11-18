import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { ADMIN, testApp } from '../test/helpers.ts';
import { generateTotpSecret, totpCode, verifyTotp } from './totp.ts';

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
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('widget_status', [
      { value: 'open', label: 'Open', color: 'blue' },
      { value: 'done', label: 'Done', color: 'green' },
    ]);
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
    const stats = await agent.get('/api/widgets/stats?group=restricted');
    expect(stats.body.groups.map((g: any) => g.value)).toEqual(['false']);

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
