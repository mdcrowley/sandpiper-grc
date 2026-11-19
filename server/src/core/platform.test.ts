import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from './module.ts';
import { parseSearch, snippetParts } from './search.ts';
import { intersectGrants, scopeCovered, tokenBlocked } from './tokens.ts';
import { hostAllowed, RETRY_MINUTES, signWebhook } from './webhooks.ts';
import { testApp } from '../test/helpers.ts';

// Platform services: API tokens, OpenAPI, webhooks, full-text search, custom fields, tags, watchers,
// labels, preferences and retention. Exercised through a throwaway module with invented data.

const notified: any[] = [];
const gadgets: ModuleDef = {
  key: 'testgadgets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_gadgets (
        id uuid primary key default gen_random_uuid(),
        ref text, name text not null, notes text, status text, owner_id uuid,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_vaults (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
    await ctx.lookups.ensure('gadget_status', [
      { value: 'open', label: 'Open', color: 'blue' },
      { value: 'done', label: 'Done', color: 'green' },
    ]);
  },
  async register(ctx) {
    // When the notifications module is not loaded, stand in for it so watcher notices can be seen.
    if (!ctx.app.hasDecorator('notify')) (ctx.app as any).decorate('notify', async (input: any) => { notified.push(input); return { sent: 1, skipped: 0 }; });
    ctx.defineResource({
      type: 'gadget', table: 'test_gadgets', module: 'tickets', label: 'Gadget', plural: 'Gadgets',
      path: '/api/gadgets', route: '/gadgets', titleField: 'name', ref: { field: 'ref', prefix: 'G-' },
      restricted: 'flag', searchable: ['name', 'notes'],
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        notes: { label: 'Notes', type: 'longtext' },
        status: { label: 'Status', type: 'lookup', list: 'gadget_status', default: 'open' },
        owner_id: { label: 'Owner', type: 'user' },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    ctx.defineResource({
      type: 'vault', table: 'test_vaults', module: 'tickets', label: 'Vault', plural: 'Vaults',
      path: '/api/vaults', route: '/vaults', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
    ctx.app.get('/api/gadgets/:id/summary', { preHandler: ctx.requirePerm('tickets.view') }, async () => ({ ok: true }));
    ctx.describeRoute({ method: 'GET', path: '/api/gadgets/:id/summary', summary: 'A gadget in brief', permission: 'tickets.view', response: '{ ok }' });
    ctx.app.get('/api/gadget-extras', async () => ({ ok: true })); // deliberately not described
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let agent: Awaited<ReturnType<typeof t.as>>;
let lead: Awaited<ReturnType<typeof t.as>>;
let viewer: Awaited<ReturnType<typeof t.as>>;

/** A request with no cookie and no CSRF header unless given: what a script holding a token sends. */
async function raw(method: string, url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await t.app.inject({
    method: method as any, url,
    headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body };
}
const audited = async (action: string) =>
  t.db.query<any>('select * from audit_events where action = $1 order by id', [action]);

beforeAll(async () => {
  t = await testApp({ extraModules: [gadgets] });
  agent = await t.as('agent'); // tickets.* and no security.view
  lead = await t.as('security_lead'); // tickets.* and security.view
  viewer = await t.as('executive_viewer'); // no tickets permission at all
});
afterAll(async () => { await t.close(); });

// ---------------------------------------------------------------------------------------------

describe('personal access tokens', () => {
  it('works out what a token may do from its scopes and its owner\'s grants', () => {
    expect(intersectGrants(['*'], ['tickets.*', 'assets.view']).sort()).toEqual(['assets.view', 'tickets.*']);
    expect(intersectGrants(['tickets.view', 'risks.*'], ['tickets.*'])).toEqual(['tickets.view']);
    expect(intersectGrants(['tickets.*'], ['tickets.view'])).toEqual(['tickets.view']);
    expect(intersectGrants(['tickets.edit'], ['tickets.view'])).toEqual([]);
    expect(intersectGrants(['tickets.view'], ['*'])).toEqual(['tickets.view']);
    expect(scopeCovered('tickets.view', ['tickets.*'])).toBe(true);
    expect(scopeCovered('tickets.*', ['tickets.view'])).toBe(false);
    expect(scopeCovered('*', ['tickets.*'])).toBe(false);
    expect(tokenBlocked('/api/auth/state')).toBe(false);
    for (const url of ['/api/auth/change-password', '/api/auth/totp/begin', '/api/me/tokens', '/api/me/tokens/x', '/api/admin/tokens?user_id=1', '/api/setup']) {
      expect([url, tokenBlocked(url)]).toEqual([url, true]);
    }
  });

  it('creates a token shown once and stored hashed, with a name, scopes and a required, limited expiry', async () => {
    const bad = await agent.post('/api/me/tokens', { name: '', scopes: ['risks.view', 'tickets.view'] });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['expiresInDays', 'name', 'scopes']);
    expect(bad.body.error.fields.scopes).toMatch(/risks\.view/);
    expect((await agent.post('/api/me/tokens', { name: 'Too long', scopes: ['tickets.view'], expiresInDays: 366 })).body.error.fields.expiresInDays).toMatch(/365/);
    expect((await agent.post('/api/me/tokens', { name: 'Odd', scopes: ['Tickets View'], expiresInDays: 5 })).body.error.fields.scopes).toBeTruthy();

    const made = await agent.post('/api/me/tokens', { name: 'Reporting script', scopes: ['tickets.view'], expiresInDays: 30 });
    expect(made.status).toBe(201);
    expect(made.body.token).toMatch(/^grc_pat_[A-Za-z0-9_-]{40,}$/);
    expect((await agent.post('/api/me/tokens', { name: 'reporting SCRIPT', scopes: ['tickets.view'], expiresInDays: 30 })).body.error.fields.name).toMatch(/already/);

    const stored = await t.db.one<any>('select * from api_tokens where id = $1', [made.body.id]);
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(made.body.token);
    const list = await agent.get('/api/me/tokens');
    expect(list.body.tokens).toHaveLength(1);
    expect(list.body.tokens[0]).toMatchObject({ name: 'Reporting script', scopes: ['tickets.view'], active: true, last_used_at: null });
    expect(JSON.stringify(list.body)).not.toContain(made.body.token);
    expect(list.body.maxDays).toBe(365);
    expect((await audited('token.create')).at(-1).summary).toMatch(/Reporting script/);
  });

  it('needs a recent password confirmation to create one', async () => {
    await t.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = $1`, [agent.userId]);
    const res = await agent.post('/api/me/tokens', { name: 'Later', scopes: ['tickets.view'], expiresInDays: 1 });
    expect([res.status, res.body.error.code]).toEqual([403, 'reauth_required']);
    await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [agent.userId]);
  });

  it('authenticates /api requests by bearer token with no cookie and no CSRF header, within its scopes', async () => {
    const read = (await agent.post('/api/me/tokens', { name: 'Read only', scopes: ['tickets.view'], expiresInDays: 7 })).body.token;
    const write = (await agent.post('/api/me/tokens', { name: 'Gadget loader', scopes: ['tickets.*'], expiresInDays: 7 })).body.token;

    expect((await raw('GET', '/api/gadgets')).status).toBe(401);
    const listed = await raw('GET', '/api/gadgets', { token: read });
    expect(listed.status).toBe(200);
    const state = await raw('GET', '/api/auth/state', { token: read });
    expect(state.body.user.id).toBe(agent.userId);
    expect(state.body.permissions).toEqual(['tickets.view']);

    // Read-only scope: the owner could create, the token cannot.
    const refused = await raw('POST', '/api/gadgets', { token: read, body: { name: 'Nope' } });
    expect([refused.status, refused.body.error.code]).toEqual([403, 'forbidden']);
    const created = await raw('POST', '/api/gadgets', { token: write, body: { name: 'Made by a script' } });
    expect(created.status).toBe(201);

    // The change is audited with the token's name, and the request itself leaves an event.
    const ev = await t.db.one<any>(`select * from audit_events where action = 'gadget.create' and record_id = $1`, [created.body.id]);
    expect(ev).toMatchObject({ actor_id: agent.userId, token_name: 'Gadget loader' });
    expect(ev.token_id).toBeTruthy();
    const use = (await audited('token.use')).at(-1);
    expect(use.summary).toBe('POST /api/gadgets (201) with API token "Gadget loader"');
    expect((await agent.get(`/api/history?record_type=gadget&record_id=${created.body.id}`)).body[0].token_name).toBe('Gadget loader');
    const row = (await agent.get('/api/me/tokens')).body.tokens.find((x: any) => x.name === 'Gadget loader');
    expect(row.last_used_at).toBeTruthy();
  });

  it('never authenticates token management, account security or sensitive administration', async () => {
    const mine = (await t.api.post('/api/me/tokens', { name: 'Admin everything', scopes: ['*'], expiresInDays: 1 })).body.token;
    for (const [method, url] of [['GET', '/api/me/tokens'], ['POST', '/api/me/tokens'], ['GET', '/api/admin/tokens'], ['POST', '/api/auth/change-password'],
      ['GET', '/api/auth/security'], ['POST', '/api/auth/confirm'], ['POST', '/api/auth/logout'], ['POST', '/api/auth/login']]) {
      const res = await raw(method, url, { token: mine, body: method === 'POST' ? {} : undefined });
      expect([url, res.status, res.body?.error?.code]).toEqual([url, 403, 'token_not_allowed']);
    }
    // Ordinary administration works with an administrator's token...
    expect((await raw('GET', '/api/admin/custom-fields', { token: mine })).status).toBe(200);
    // ...but anything that asks for a recent password confirmation does not: a token has no session to confirm.
    const hook = await raw('POST', '/api/admin/webhooks', { token: mine, body: { name: 'By token', url: 'http://127.0.0.1:9/x', events: ['*'] } });
    expect([hook.status, hook.body.error.code]).toEqual([403, 'reauth_required']);
  });

  it('refuses wrong, expired and revoked tokens, and ignores the cookie when a token is sent', async () => {
    const wrong = await raw('GET', '/api/gadgets', { token: 'grc_pat_this-is-not-a-token' });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'invalid_token']);
    expect((await raw('GET', '/api/gadgets', { headers: { authorization: 'Basic abc' } })).status).toBe(401);
    // A valid administrator session plus a wrong token is still refused.
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'admin', password: 'a long test passphrase 1' } });
    const cookie = `grc_session=${login.cookies.find((c) => c.name === 'grc_session')!.value}`;
    expect((await raw('GET', '/api/gadgets', { headers: { cookie } })).status).toBe(200);
    expect((await raw('GET', '/api/gadgets', { token: 'grc_pat_wrong', headers: { cookie } })).status).toBe(401);
    expect((await audited('token.refused')).length).toBeGreaterThanOrEqual(2);

    const made = (await agent.post('/api/me/tokens', { name: 'Short lived', scopes: ['tickets.view'], expiresInDays: 1 })).body;
    expect((await raw('GET', '/api/gadgets', { token: made.token })).status).toBe(200);
    await t.db.query(`update api_tokens set expires_at = now() - interval '1 second' where id = $1`, [made.id]);
    expect((await raw('GET', '/api/gadgets', { token: made.token })).status).toBe(401);
    await t.db.query(`update api_tokens set expires_at = now() + interval '1 day' where id = $1`, [made.id]);
    expect((await agent.del(`/api/me/tokens/${made.id}`)).status).toBe(200);
    expect((await raw('GET', '/api/gadgets', { token: made.token })).status).toBe(401);
    expect((await agent.del(`/api/me/tokens/${made.id}`)).status).toBe(404);
    await t.db.query(`delete from rate_limit_hits where bucket = 'token'`);
  });

  it('never exceeds the owner\'s grants at the time of use, and stops when the owner is disabled', async () => {
    const pm = await t.as('project_manager'); // holds tickets.view
    const token = (await pm.post('/api/me/tokens', { name: 'PM reader', scopes: ['tickets.view'], expiresInDays: 3 })).body.token;
    expect((await raw('GET', '/api/gadgets', { token })).status).toBe(200);
    await t.db.query(`delete from role_permissions where permission = 'tickets.view' and role_id = (select id from roles where key = 'project_manager')`);
    expect((await raw('GET', '/api/gadgets', { token })).status).toBe(403);
    await t.db.query(`insert into role_permissions (role_id, permission) select id, 'tickets.view' from roles where key = 'project_manager'`);
    expect((await raw('GET', '/api/gadgets', { token })).status).toBe(200);
    await t.db.query(`update users set status = 'disabled' where id = $1`, [pm.userId]);
    expect((await raw('GET', '/api/gadgets', { token })).status).toBe(401);
    await t.db.query(`delete from rate_limit_hits where bucket = 'token'`);
  });

  it('lets an administrator list and revoke anyone\'s tokens, and nobody else', async () => {
    expect((await agent.get('/api/admin/tokens')).status).toBe(403);
    const all = await t.api.get('/api/admin/tokens');
    const target = all.body.tokens.find((x: any) => x.name === 'Read only');
    expect(target).toMatchObject({ userId: agent.userId, active: true });
    expect(JSON.stringify(all.body)).not.toMatch(/token_hash/);
    expect((await t.api.get(`/api/admin/tokens?user_id=${agent.userId}`)).body.tokens.every((x: any) => x.userId === agent.userId)).toBe(true);
    expect((await agent.del(`/api/admin/tokens/${target.id}`)).status).toBe(403);
    expect((await t.api.del(`/api/admin/tokens/${target.id}`)).status).toBe(200);
    expect((await audited('token.revoke')).at(-1).summary).toMatch(/Read only.*by an administrator/);
    expect((await agent.get('/api/me/tokens')).body.tokens.find((x: any) => x.id === target.id).active).toBe(false);
  });

  it('limits how many requests a token may make each minute', async () => {
    const token = (await agent.post('/api/me/tokens', { name: 'Busy', scopes: ['tickets.view'], expiresInDays: 1 })).body.token;
    await t.ctx.settings.set('tokens.rate_per_minute', 3);
    const codes: number[] = [];
    for (let i = 0; i < 5; i += 1) codes.push((await raw('GET', '/api/gadgets?pageSize=1', { token })).status);
    await t.ctx.settings.set('tokens.rate_per_minute', 600);
    // The window is the clock minute, so a run that straddles two minutes may see one more success.
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(1);
    expect(codes[0]).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------

describe('OpenAPI document', () => {
  it('describes every generated route with field schemas, filters, paging, errors and security', async () => {
    const res = await t.api.get('/api/openapi.json');
    expect(res.status).toBe(200);
    const doc = res.body;
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.components.securitySchemes).sort()).toEqual(['bearerToken', 'csrfHeader', 'session']);
    expect(doc.components.schemas.Error.properties.error.properties).toHaveProperty('fields');
    for (const [path, methods] of [['/api/gadgets', ['get', 'post']], ['/api/gadgets/stats', ['get']], ['/api/gadgets/{id}', ['get', 'patch', 'delete']]] as const) {
      for (const m of methods) expect([path, m, Boolean(doc.paths[path]?.[m])]).toEqual([path, m, true]);
    }
    const list = doc.paths['/api/gadgets'].get;
    const names = list.parameters.map((p: any) => p.name);
    for (const n of ['q', 'sort', 'dir', 'page', 'pageSize', 'format', 'f.status', 'f.owner_id', 'f.created_at', 'f.tags']) expect(names).toContain(n);
    expect(list['x-permission']).toBe('tickets.view');
    expect(list.responses[200].content['application/json'].schema.properties.rows.items.$ref).toBe('#/components/schemas/Gadget');
    expect(list.responses[400].content['application/json'].schema.$ref).toBe('#/components/schemas/Error');
    const schema = doc.components.schemas.Gadget.properties;
    expect(schema.name.type).toEqual(['string', 'null']);
    expect(schema.status['x-list']).toBe('gadget_status');
    expect(schema.owner_id).toMatchObject({ format: 'uuid', 'x-ref': 'user' });
    expect(doc.components.schemas.GadgetInput.required).toEqual(['name']);
    expect(doc.components.schemas.GadgetInput.properties).not.toHaveProperty('ref'); // read-only
    expect(doc.paths['/api/gadgets/{id}'].get.parameters[0]).toMatchObject({ name: 'id', in: 'path', required: true });
    expect(doc.paths['/api/vaults'].get['x-also-needs']).toBe('security.view');
  });

  it('lists every registered route, and none of core\'s own is left undescribed', async () => {
    const doc = (await t.api.get('/api/openapi.json')).body;
    const missing: string[] = [];
    const undescribedCore: string[] = [];
    const generated = new Set(t.ctx.resources.all().flatMap((d) => [d.path, `${d.path}/stats`, `${d.path}/:id`]));
    for (const r of t.core.openapi.routes()) {
      const path = r.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*/g, '{path}');
      if (!doc.paths[path]?.[r.method.toLowerCase()]) missing.push(`${r.method} ${r.url}`);
      if (r.origin === 'core' && !generated.has(r.url) && !t.core.openapi.described(r.method, r.url)) undescribedCore.push(`${r.method} ${r.url}`);
    }
    expect(missing).toEqual([]);
    expect(undescribedCore).toEqual([]);
    expect(t.core.openapi.routes().length).toBeGreaterThan(60);
  });

  it('includes routes described with ctx.describeRoute and marks the others', async () => {
    const doc = (await t.api.get('/api/openapi.json')).body;
    expect(doc.paths['/api/gadgets/{id}/summary'].get).toMatchObject({ summary: 'A gadget in brief', 'x-permission': 'tickets.view', tags: ['Gadgets'] });
    expect(doc.paths['/api/gadgets/{id}/summary'].get['x-undocumented']).toBeUndefined();
    expect(doc.paths['/api/gadget-extras'].get['x-undocumented']).toBe(true);
    expect(doc.paths['/api/auth/login'].post.security).toEqual([]);
    // The administration module describes all of its own routes.
    const adminUndescribed = t.core.openapi.routes().filter((r) => (r.url.startsWith('/api/admin/') || r.url.startsWith('/api/auth/')) && !t.core.openapi.described(r.method, r.url));
    expect(adminUndescribed).toEqual([]);
  });

  it('is cut down to what the caller may use', async () => {
    const forViewer = (await viewer.get('/api/openapi.json')).body;
    expect(forViewer.paths['/api/gadgets']).toBeUndefined();
    expect(forViewer.paths['/api/gadgets/{id}/summary']).toBeUndefined();
    expect(forViewer.paths['/api/admin/webhooks']).toBeUndefined();
    expect(forViewer.paths['/api/audit']).toBeUndefined();
    expect(forViewer.components.schemas.Gadget).toBeUndefined();
    expect(forViewer.paths['/api/search']).toBeTruthy();
    const forAgent = (await agent.get('/api/openapi.json')).body;
    expect(forAgent.paths['/api/gadgets']).toBeTruthy();
    expect(forAgent.paths['/api/vaults']).toBeUndefined(); // restricted type, no security.view
    expect(forAgent.components.schemas.Vault).toBeUndefined();
    expect((await t.anon.get('/api/openapi.json')).status).toBe(401);
    // The whole document (the `npm run openapi` command) has everything.
    const whole: any = await t.core.openapi.build(null);
    expect(whole.paths['/api/vaults']).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------

describe('full-text search', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    const mk = async (key: string, body: any, api = t.api) => { ids[key] = (await api.post('/api/gadgets', body)).body.id; };
    await mk('printers', { name: 'Printers failing in the east wing', notes: 'Paper jams every morning.' });
    await mk('noteonly', { name: 'Morning checklist', notes: 'Remember that the printer needs toner replacement.' });
    await mk('laptop', { name: 'Laptop replacement programme', notes: 'Budget approved for forty devices.' });
    await mk('hidden', { name: 'Quarantined printer evidence', notes: 'Held for an investigation.', restricted: true });
    await mk('code', { name: 'Switch SW-CORE-0042 firmware', notes: 'Serial ZX81QQ7.' });
  });
  const search = async (q: string, api = t.api) => (await api.get(`/api/search?q=${encodeURIComponent(q)}`)).body as any[];
  const listIds = async (q: string, api = t.api) => (await api.get(`/api/gadgets?q=${encodeURIComponent(q)}`)).body.rows.map((r: any) => r.id);

  it('parses queries: short ones fall back to substring, the last word is a prefix', () => {
    expect(parseSearch('ab').fts).toBe(false);
    expect(parseSearch('  ').text).toBe('');
    expect(parseSearch('!!!').fts).toBe(false);
    const p: unknown[] = [];
    const sql = parseSearch('printer fail').tsquery((v) => { p.push(v); return `$${p.length}`; });
    expect(sql).toContain('websearch_to_tsquery');
    expect(p).toEqual(['printer fail', 'fail:*', 'printer']);
    expect(parseSearch('50%_off').like).toBe('%50\\%\\_off%');
    expect(snippetParts('a \u0001hit\u0002 b')).toEqual([{ text: 'a ', match: false }, { text: 'hit', match: true }, { text: ' b', match: false }]);
  });

  it('matches whole words, word endings and several words, in lists and in global search', async () => {
    expect((await t.api.get('/api/meta')).body.resources.gadget.search).toBe('fulltext');
    // Stemming: "printer" finds "Printers"; both words must be present.
    expect(await listIds('printer fail')).toEqual([ids.printers]);
    expect((await listIds('printers')).sort()).toEqual([ids.printers, ids.noteonly, ids.hidden].sort());
    // Words need not be adjacent or in order.
    expect(await listIds('wing east')).toEqual([ids.printers]);
    expect(await listIds('replacement laptop')).toEqual([ids.laptop]);
    // The last word may be half typed.
    expect(await listIds('laptop replacem')).toEqual([ids.laptop]);
    expect(await listIds('lapt')).toEqual([ids.laptop]);
    // Websearch syntax: a phrase, and an exclusion.
    expect(await listIds('"needs toner"')).toEqual([ids.noteonly]);
    expect((await listIds('printer -toner')).includes(ids.noteonly)).toBe(false);
    // A single word still matches inside words and codes, as before.
    expect(await listIds('CORE-0042')).toEqual([ids.code]);
    expect(await listIds('81QQ')).toEqual([ids.code]);
    // Two characters: substring.
    expect((await listIds('zx'))).toEqual([ids.code]);
    expect((await t.api.get('/api/gadgets?q=printer')).body.total).toBe(3);
  });

  it('ranks the best matches first and boosts an exact reference number', async () => {
    const results = (await search('printer')).filter((r) => r.type === 'gadget');
    // Title matches come before a match in the notes only.
    expect(results.map((r) => r.id).indexOf(ids.noteonly)).toBe(results.length - 1);
    expect(results[0].rank).toBeGreaterThan(results.at(-1).rank);
    const ordered = (await t.api.get('/api/gadgets?q=printer')).body.rows.map((r: any) => r.id);
    expect(ordered.at(-1)).toBe(ids.noteonly);
    // An explicit sort still wins over rank.
    const byName = (await t.api.get('/api/gadgets?q=printer&sort=name')).body.rows.map((r: any) => r.name);
    expect(byName).toEqual([...byName].sort());

    const ref = (await t.api.get(`/api/gadgets/${ids.laptop}`)).body.ref;
    const byRef = await search(ref);
    expect(byRef[0]).toMatchObject({ id: ids.laptop, ref });
    expect(byRef[0].rank).toBeGreaterThanOrEqual(10);
    expect(await listIds(ref.toLowerCase())).toEqual([ids.laptop]);
  });

  it('returns snippets with the matches marked, keeping the old fields', async () => {
    const [hit] = (await search('toner')).filter((r) => r.id === ids.noteonly);
    expect(hit).toMatchObject({ type: 'gadget', typeLabel: 'Gadget', label: 'Morning checklist', route: '/gadgets', matched: 'record' });
    expect(hit.ref).toMatch(/^G-/);
    expect(hit.snippetParts.some((p: any) => p.match && /toner/i.test(p.text))).toBe(true);
    expect(hit.snippet).toContain('toner');
    expect(hit.snippet).not.toMatch(/[\u0001\u0002]/);
    expect(await search('x')).toEqual([]);
  });

  it('finds records by their comments and attached file names, under the record\'s own rules', async () => {
    await t.api.post('/api/comments', { record_type: 'gadget', record_id: ids.laptop, body: 'Supplier confirmed the zygomorphic casing.' });
    await t.api.post('/api/comments', { record_type: 'gadget', record_id: ids.hidden, body: 'Another zygomorphic mention, on a restricted record.' });
    const forAgent = await search('zygomorphic', agent);
    expect(forAgent.map((r) => r.id)).toEqual([ids.laptop]);
    expect(forAgent[0]).toMatchObject({ matched: 'comment' });
    expect(forAgent[0].snippetParts.some((p: any) => p.match)).toBe(true);
    expect((await search('zygomorphic', lead)).map((r) => r.id).sort()).toEqual([ids.laptop, ids.hidden].sort());
    expect(await search('zygomorphic', viewer)).toEqual([]);

    const hasFiles = (await t.db.one<any>(`select to_regclass('public.attachments')::text as t`))?.t;
    if (hasFiles) {
      for (const [id, name] of [[ids.laptop, 'quotation-heliotrope.pdf'], [ids.hidden, 'heliotrope-evidence.pdf']]) {
        await t.db.query(
          `insert into attachments (record_type, record_id, file_name, size_bytes, sha256, storage_key) values ('gadget', $1, $2, 1, 'x', $3)`,
          [id, name, `aa/bb/${id.replace(/-/g, '')}`]);
      }
      const files = await search('heliotrope', agent);
      expect(files.map((r) => r.id)).toEqual([ids.laptop]);
      expect(files[0]).toMatchObject({ matched: 'attachment', snippet: 'quotation-heliotrope.pdf' });
      expect((await search('heliotrope', lead)).length).toBe(2);
    }
  });

  it('keeps restricted records out, and indexes rows written by raw SQL', async () => {
    expect((await search('quarantined', agent))).toEqual([]);
    expect((await listIds('quarantined', agent))).toEqual([]);
    expect((await agent.get('/api/gadgets?q=printer')).body.total).toBe(2);
    expect((await search('quarantined', lead)).map((r) => r.id)).toEqual([ids.hidden]);
    // Several words on a type with no reference number (and wholly restricted).
    const vault = (await lead.post('/api/vaults', { title: 'Deep storage vault for ledgers' })).body;
    expect((await lead.get('/api/vaults?q=storage%20ledger')).body.rows.map((r: any) => r.id)).toEqual([vault.id]);
    expect((await lead.get('/api/vaults?q=deep%20storage%20vault')).body.total).toBe(1);
    expect((await search('ledgers vault', agent))).toEqual([]);
    // A seeder or importer writing straight to the table is indexed by the trigger.
    const row = await t.db.one<any>(`insert into test_gadgets (name, notes) values ('Seeded by hand', 'An unmistakable xylophonist.') returning id`);
    expect(await listIds('xylophonists')).toEqual([row.id]);
    await t.db.query(`update test_gadgets set notes = 'Now about bassoons.' where id = $1`, [row.id]);
    expect(await listIds('xylophonist')).toEqual([]);
    expect(await listIds('bassoon')).toEqual([row.id]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('custom fields', () => {
  const field: Record<string, any> = {};
  let gadgetId = '';
  const add = async (body: any) => {
    const res = await t.api.post('/api/admin/custom-fields', { record_type: 'gadget', ...body });
    if (res.status !== 201) throw new Error(JSON.stringify(res.body));
    field[res.body.key] = res.body;
    return res.body;
  };

  it('lets an administrator define fields of every type, with validation', async () => {
    expect((await agent.get('/api/admin/custom-fields')).status).toBe(403);
    expect((await agent.post('/api/admin/custom-fields', { record_type: 'gadget', label: 'X', type: 'text' })).status).toBe(403);
    const bad = await t.api.post('/api/admin/custom-fields', { record_type: 'nothing', label: '', type: 'colour', key: 'Bad Key' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['key', 'label', 'record_type', 'type']);
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'gadget', label: 'Pick', type: 'select' })).body.error.fields.options).toBeTruthy();
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'gadget', label: 'Link', type: 'ref', to: 'nothing' })).body.error.fields.to).toBeTruthy();

    const text = await add({ label: 'Cost centre', type: 'text', required: true, help: 'From the finance system.', section: 'Finance', position: 1 });
    expect(text).toMatchObject({ key: 'cost_centre', name: 'cf_cost_centre', active: true, field: { label: 'Cost centre', type: 'text', custom: true, required: true, help: 'From the finance system.', section: 'Finance' } });
    await add({ label: 'Score', type: 'number' });
    await add({ label: 'Budget', type: 'currency' });
    await add({ label: 'Review on', type: 'date' });
    await add({ label: 'Critical', type: 'boolean' });
    await add({ label: 'Reviewer', type: 'user' });
    await add({ label: 'Replaces', type: 'ref', to: 'gadget' });
    const colour = await add({ label: 'Colour', type: 'select', options: [{ value: 'red', label: 'Red', color: 'red' }, 'Blue'] });
    expect(colour.list_key).toBe('cf_gadget_colour');
    await add({ label: 'Zones', type: 'multiselect', options: ['North', 'South', 'East'] });
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'gadget', label: 'Score', type: 'text' })).body.error.fields.key).toMatch(/already/);
    expect((await audited('custom_field.create')).length).toBe(9);

    const listed = await t.api.get('/api/admin/custom-fields?record_type=gadget');
    expect(listed.body.fields).toHaveLength(9);
    expect(listed.body.types).toContain('multiselect');
    expect(listed.body.recordTypes.some((r: any) => r.type === 'gadget')).toBe(true);
  });

  it('puts them in /api/meta in the shape of built-in fields, with their lists', async () => {
    const meta = (await agent.get('/api/meta')).body;
    const f = meta.resources.gadget.fields;
    expect(f.name.custom).toBeUndefined();
    expect(f.cf_cost_centre).toMatchObject({ label: 'Cost centre', type: 'text', custom: true, required: true });
    expect(f.cf_colour).toMatchObject({ type: 'lookup', list: 'cf_gadget_colour', custom: true });
    expect(f.cf_zones).toMatchObject({ type: 'lookup', list: 'cf_gadget_zones', multiple: true });
    expect(f.cf_replaces).toMatchObject({ type: 'ref', to: 'gadget' });
    expect(f.cf_budget.type).toBe('currency');
    expect(meta.lookups.cf_gadget_colour.map((v: any) => v.value)).toEqual(['red', 'blue']);
    expect((await agent.get('/api/lookups/cf_gadget_zones')).body.map((v: any) => v.label)).toEqual(['North', 'South', 'East']);
    // Someone who cannot view the record type sees neither the fields nor their lists.
    const forViewer = (await viewer.get('/api/meta')).body;
    expect(forViewer.resources.gadget).toBeUndefined();
    expect(forViewer.lookups.cf_gadget_colour).toBeUndefined();
    const doc = (await agent.get('/api/openapi.json')).body;
    expect(doc.components.schemas.Gadget.properties.cf_colour).toMatchObject({ 'x-custom': true, 'x-list': 'cf_gadget_colour' });
    expect(doc.paths['/api/gadgets'].get.parameters.map((p: any) => p.name)).toContain('f.cf_score');
  });

  it('validates values like built-in fields and returns them in rows', async () => {
    const missing = await agent.post('/api/gadgets', { name: 'No cost centre' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.fields.cf_cost_centre).toMatch(/required/);
    const bad = await agent.post('/api/gadgets', {
      name: 'Bad values', cf_cost_centre: 'CC-1', cf_score: 'lots', cf_review_on: '31/12/2030', cf_critical: 'maybe',
      cf_reviewer: 'someone', cf_colour: 'green', cf_zones: ['north', 'west'],
    });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['cf_colour', 'cf_critical', 'cf_review_on', 'cf_reviewer', 'cf_score', 'cf_zones']);

    const other = (await agent.post('/api/gadgets', { name: 'Older gadget', cf_cost_centre: 'CC-9', cf_score: 3, cf_colour: 'blue', cf_zones: ['south'] })).body;
    const made = await agent.post('/api/gadgets', {
      name: 'Fully described gadget', cf_cost_centre: ' CC-7 ', cf_score: '12', cf_budget: '1,250.50', cf_review_on: '2031-03-01', cf_critical: true,
      cf_reviewer: lead.userId, cf_replaces: other.id, cf_colour: 'red', cf_zones: ['north', 'east'],
    });
    expect(made.status).toBe(201);
    gadgetId = made.body.id;
    expect(made.body).toMatchObject({
      cf_cost_centre: 'CC-7', cf_score: 12, cf_budget: 1250.5, cf_review_on: '2031-03-01', cf_critical: true,
      cf_reviewer: lead.userId, cf_replaces: other.id, cf_colour: 'red', cf_zones: ['north', 'east'],
    });
    expect(made.body._display).toMatchObject({ cf_colour: 'Red', cf_zones: 'North, East', cf_replaces: 'Older gadget' });
    expect(made.body._display.cf_reviewer).toMatch(/security_lead/);
    const got = (await agent.get(`/api/gadgets/${gadgetId}`)).body;
    expect(got.cf_score).toBe(12);
    expect(other.cf_budget).toBeNull(); // every active field is present, empty or not

    // Work done by the system (seeding, automation) is not held to an administrator's "required".
    const bySystem = await t.ctx.resources.create('gadget', { name: 'Made by the system' });
    expect(bySystem.id).toBeTruthy();
    expect((await t.ctx.resources.create('gadget', { name: 'System with a value', cf_score: 4 })).custom).toEqual({ score: 4 });
  });

  it('audits changes to custom values field by field', async () => {
    const res = await agent.patch(`/api/gadgets/${gadgetId}`, { cf_score: 15, cf_colour: 'blue', cf_cost_centre: 'CC-7', notes: 'Edited.' });
    expect(res.body).toMatchObject({ cf_score: 15, cf_colour: 'blue', cf_cost_centre: 'CC-7', cf_zones: ['north', 'east'] });
    const ev = (await agent.get(`/api/history?record_type=gadget&record_id=${gadgetId}`)).body[0];
    expect(ev.action).toBe('gadget.update');
    expect(ev.before).toEqual({ cf_score: 12, cf_colour: 'red', notes: null });
    expect(ev.after).toEqual({ cf_score: 15, cf_colour: 'blue', notes: 'Edited.' });
    expect(ev.summary).toMatch(/Notes, Colour, Score/);
    const created = (await agent.get(`/api/history?record_type=gadget&record_id=${gadgetId}`)).body.at(-1);
    expect(created.after).toMatchObject({ cf_cost_centre: 'CC-7', cf_zones: ['north', 'east'] });
    // Clearing a value, and an unchanged patch writes nothing.
    expect((await agent.patch(`/api/gadgets/${gadgetId}`, { cf_budget: null })).body.cf_budget).toBeNull();
    const count = (await agent.get(`/api/history?record_type=gadget&record_id=${gadgetId}`)).body.length;
    await agent.patch(`/api/gadgets/${gadgetId}`, { cf_score: 15 });
    expect((await agent.get(`/api/history?record_type=gadget&record_id=${gadgetId}`)).body.length).toBe(count);
    expect((await agent.patch(`/api/gadgets/${gadgetId}`, { cf_cost_centre: '' })).body.error.fields.cf_cost_centre).toMatch(/required/);
  });

  it('filters, sorts, groups, exports and searches on them', async () => {
    const names = async (qs: string) => (await agent.get(`/api/gadgets?${qs}`)).body.rows.map((r: any) => r.name);
    expect(await names('f.cf_colour=blue&sort=name')).toEqual(['Fully described gadget', 'Older gadget']);
    expect(await names('f.cf_score.gt=10')).toEqual(['Fully described gadget']);
    expect(await names('f.cf_score.lte=4&sort=cf_score&dir=desc')).toEqual(['System with a value', 'Older gadget']);
    expect(await names('f.cf_zones=east,west')).toEqual(['Fully described gadget']);
    expect(await names('f.cf_zones=south')).toEqual(['Older gadget']);
    expect(await names('f.cf_critical=true')).toEqual(['Fully described gadget']);
    expect((await names('f.cf_score.null=false&sort=cf_score')).length).toBe(3);
    expect(await names(`f.cf_reviewer=${lead.userId}`)).toEqual(['Fully described gadget']);
    expect((await agent.get('/api/gadgets?f.cf_nothing=1')).status).toBe(400);
    expect((await agent.get('/api/gadgets?f.cf_colour.gt=1')).status).toBe(400);

    const stats = (await agent.get('/api/gadgets/stats?group=cf_colour&f.cf_score.null=false')).body;
    expect(stats.groups.find((g: any) => g.value === 'blue')).toMatchObject({ label: 'Blue', count: 2 });
    expect((await agent.get('/api/gadgets/stats?group=cf_zones')).status).toBe(400);

    const csv = (await agent.get('/api/gadgets?format=csv&f.cf_score.gt=10')).text;
    const [header, line] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header).toMatch(/Restricted,Budget,Colour,Critical,Replaces,Review on,Reviewer,Score,Zones,Cost centre$/); // by position, then label
    expect(line).toMatch(/,,Blue,true,Older gadget,2031-03-01,Test security_lead \d+,15,"North, East",CC-7$/);

    // Text custom fields are searched.
    expect((await agent.get('/api/gadgets?q=CC-9')).body.rows.map((r: any) => r.name)).toEqual(['Older gadget']);
    await t.api.post('/api/admin/custom-fields', { record_type: 'gadget', label: 'Remarks', type: 'longtext' });
    await agent.patch(`/api/gadgets/${gadgetId}`, { cf_remarks: 'Stored beside the perambulators.' });
    expect((await agent.get('/api/gadgets?q=perambulator')).body.rows.map((r: any) => r.id)).toEqual([gadgetId]);
  });

  it('hides a removed field without deleting its data, and brings it back', async () => {
    const id = field.score.id;
    expect((await t.api.patch(`/api/admin/custom-fields/${id}`, { key: 'points' })).body.error.fields.key).toBeTruthy();
    expect((await t.api.patch(`/api/admin/custom-fields/${id}`, { type: 'text' })).body.error.fields.type).toBeTruthy();
    expect((await t.api.patch(`/api/admin/custom-fields/${id}`, { label: 'Points', required: false, position: 5 })).body).toMatchObject({ label: 'Points', position: 5 });
    expect((await agent.get('/api/meta')).body.resources.gadget.fields.cf_score.label).toBe('Points');

    expect((await t.api.del(`/api/admin/custom-fields/${id}`)).status).toBe(200);
    expect((await agent.get('/api/meta')).body.resources.gadget.fields.cf_score).toBeUndefined();
    const hiddenRow = (await agent.get(`/api/gadgets/${gadgetId}`)).body;
    expect(hiddenRow.cf_score).toBeUndefined();
    expect((await agent.get('/api/gadgets?f.cf_score.gt=1')).status).toBe(400);
    expect((await t.db.one<any>('select custom from test_gadgets where id = $1', [gadgetId])).custom.score).toBe(15);
    expect((await t.api.get('/api/admin/custom-fields?record_type=gadget')).body.fields.find((f: any) => f.key === 'score').active).toBe(false);

    expect((await t.api.patch(`/api/admin/custom-fields/${id}`, { active: true })).body.active).toBe(true);
    expect((await agent.get(`/api/gadgets/${gadgetId}`)).body.cf_score).toBe(15);
    expect((await audited('custom_field.retire')).length).toBe(1);
    // Options are added here; existing values are managed with the other lists.
    await t.api.patch(`/api/admin/custom-fields/${field.colour.id}`, { options: ['Green'] });
    expect((await agent.patch(`/api/gadgets/${gadgetId}`, { cf_colour: 'green' })).body._display.cf_colour).toBe('Green');
    // Make the required field optional so later tests can create gadgets freely.
    await t.api.patch(`/api/admin/custom-fields/${field.cost_centre.id}`, { required: false });
  });
});

// ---------------------------------------------------------------------------------------------

describe('tags and watchers', () => {
  let open = '';
  let secret = '';
  beforeAll(async () => {
    open = (await agent.post('/api/gadgets', { name: 'Tagged gadget' })).body.id;
    secret = (await lead.post('/api/gadgets', { name: 'Tagged restricted gadget', restricted: true })).body.id;
  });

  it('tags any record the caller may edit, normalised, audited and shown on rows', async () => {
    const set = await agent.put('/api/tags', { record_type: 'gadget', record_id: open, tags: [' Urgent ', 'urgent', 'Site  Visit', 'q3,review', ''] });
    expect(set.body.tags).toEqual(['q3 review', 'site visit', 'urgent']);
    expect((await agent.post('/api/tags', { record_type: 'gadget', record_id: open, tag: 'Legacy' })).body.tags).toContain('legacy');
    expect((await agent.del(`/api/tags?record_type=gadget&record_id=${open}&tag=${encodeURIComponent('Q3 REVIEW')}`)).body.tags).toEqual(['legacy', 'site visit', 'urgent']);
    expect((await agent.get(`/api/tags?record_type=gadget&record_id=${open}`)).body.tags).toEqual(['legacy', 'site visit', 'urgent']);
    expect((await agent.get(`/api/gadgets/${open}`)).body._tags).toEqual(['legacy', 'site visit', 'urgent']);
    const events = (await agent.get(`/api/history?record_type=gadget&record_id=${open}`)).body.filter((e: any) => e.action === 'tag.change');
    expect(events).toHaveLength(3);
    expect(events.at(-1).after.tags).toEqual(['q3 review', 'site visit', 'urgent']);
    expect((await agent.put('/api/tags', { record_type: 'gadget', record_id: open, tags: 'urgent' })).status).toBe(400);
    expect((await agent.put('/api/tags', { record_type: 'gadget', record_id: open, tags: Array.from({ length: 31 }, (_, i) => `t${i}`) })).status).toBe(400);
  });

  it('follows the record\'s permissions and restriction', async () => {
    await lead.put('/api/tags', { record_type: 'gadget', record_id: secret, tags: ['urgent', 'sealed'] });
    // A restricted record: no reading, no writing, no sign that it exists.
    expect((await agent.get(`/api/tags?record_type=gadget&record_id=${secret}`)).status).toBe(404);
    expect((await agent.put('/api/tags', { record_type: 'gadget', record_id: secret, tags: ['x'] })).status).toBe(404);
    expect((await agent.get('/api/tags?record_type=gadget&record_id=00000000-0000-4000-8000-000000000000')).status).toBe(404);
    // View without edit: read only.
    const pm = await t.as('project_manager');
    expect((await pm.get(`/api/tags?record_type=gadget&record_id=${open}`)).status).toBe(200);
    expect((await pm.put('/api/tags', { record_type: 'gadget', record_id: open, tags: ['x'] })).status).toBe(404);
    expect((await viewer.get(`/api/tags?record_type=gadget&record_id=${open}`)).status).toBe(404);
  });

  it('filters lists by tag and suggests tags, counting only what the caller may see', async () => {
    const names = async (api: typeof agent, qs: string) => (await api.get(`/api/gadgets?${qs}`)).body.rows.map((r: any) => r.name);
    expect(await names(agent, 'f.tags=urgent')).toEqual(['Tagged gadget']);
    expect((await names(lead, 'f.tags=urgent')).sort()).toEqual(['Tagged gadget', 'Tagged restricted gadget']);
    expect(await names(lead, 'f.tags=sealed,legacy&sort=name')).toEqual(['Tagged gadget', 'Tagged restricted gadget']);
    expect(await names(lead, 'f.tags.all=urgent,sealed')).toEqual(['Tagged restricted gadget']);
    expect(await names(agent, 'f.tags=nothing')).toEqual([]);
    expect((await agent.get('/api/gadgets?f.tags.null=false')).body.total).toBe(1);
    expect((await agent.get('/api/gadgets/stats?group=status&f.tags=urgent')).body.total).toBe(1);

    const forAgent = (await agent.get('/api/tags/options?record_type=gadget')).body;
    expect(forAgent.find((x: any) => x.tag === 'urgent').count).toBe(1);
    expect(forAgent.some((x: any) => x.tag === 'sealed')).toBe(false);
    const forLead = (await lead.get('/api/tags/options?record_type=gadget&q=URG')).body;
    expect(forLead).toEqual([{ tag: 'urgent', count: 2 }]);
    expect((await viewer.get('/api/tags/options?record_type=gadget')).body).toEqual([]);
  });

  it('lets an administrator rename and merge tags', async () => {
    expect((await agent.post('/api/admin/tags/rename', { record_type: 'gadget', from: 'legacy', to: 'old' })).status).toBe(403);
    expect((await t.api.post('/api/admin/tags/rename', { record_type: 'gadget', from: 'legacy', to: 'old' })).body).toEqual({ ok: true, changed: 1 });
    // Merging into a tag the record already has leaves one copy.
    expect((await t.api.post('/api/admin/tags/rename', { record_type: 'gadget', from: 'old', to: 'urgent' })).body.changed).toBe(1);
    expect((await agent.get(`/api/tags?record_type=gadget&record_id=${open}`)).body.tags).toEqual(['site visit', 'urgent']);
    expect((await audited('tag.rename')).length).toBe(2);
  });

  it('lets people who can see a record watch it, and tells them about comments and status changes', async () => {
    const realNotifications = Boolean((await t.db.one<any>(`select to_regclass('public.notifications')::text as t`))?.t);
    const received = async (userId: string): Promise<string[]> => (realNotifications
      ? (await t.db.query<any>('select title from notifications where user_id = $1 order by created_at', [userId])).map((n) => n.title)
      : notified.filter((n) => n.userIds.includes(userId)).map((n) => n.title));

    expect((await viewer.post('/api/watchers', { record_type: 'gadget', record_id: open })).status).toBe(404);
    expect((await agent.post('/api/watchers', { record_type: 'gadget', record_id: secret })).status).toBe(404);
    const first = await agent.post('/api/watchers', { record_type: 'gadget', record_id: open });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ watching: true, count: 1 });
    await agent.post('/api/watchers', { record_type: 'gadget', record_id: open }); // twice is harmless
    await lead.post('/api/watchers', { record_type: 'gadget', record_id: open });
    const state = (await lead.get(`/api/watchers?record_type=gadget&record_id=${open}`)).body;
    expect(state.count).toBe(2);
    expect(state.watchers.map((w: any) => w.id).sort()).toEqual([agent.userId, lead.userId].sort());
    expect((await audited('watch.add')).length).toBe(2);

    // A comment reaches the watchers, but not the person who wrote it.
    await lead.post('/api/comments', { record_type: 'gadget', record_id: open, body: 'Please look at this.' });
    expect(await received(agent.userId)).toEqual([expect.stringMatching(/^New comment on gadget G-\d+ Tagged gadget$/)]);
    expect(await received(lead.userId)).toEqual([]);
    // So does a status change; other edits do not.
    await agent.patch(`/api/gadgets/${open}`, { notes: 'Not a status change.' });
    await agent.patch(`/api/gadgets/${open}`, { status: 'done' });
    expect(await received(lead.userId)).toEqual([expect.stringMatching(/Tagged gadget: status is now Done$/)]);
    expect((await received(agent.userId)).length).toBe(1);

    expect((await agent.get('/api/me/watching')).body).toEqual([expect.objectContaining({ type: 'gadget', id: open, label: 'Tagged gadget', route: '/gadgets' })]);
    // When the record becomes restricted the watcher no longer sees it listed, and can still stop watching.
    await lead.patch(`/api/gadgets/${open}`, { restricted: true });
    expect((await agent.get('/api/me/watching')).body).toEqual([]);
    expect((await agent.del(`/api/watchers?record_type=gadget&record_id=${open}`)).body).toEqual({ watching: false });
    expect((await lead.get(`/api/watchers?record_type=gadget&record_id=${open}`)).body.count).toBe(1);
    await lead.patch(`/api/gadgets/${open}`, { restricted: false });
  });
});

// ---------------------------------------------------------------------------------------------

describe('labels by id and per-user preferences', () => {
  it('returns record labels for ids, leaving out what the caller may not see', async () => {
    const a = (await agent.post('/api/gadgets', { name: 'Labelled gadget' })).body;
    const b = (await lead.post('/api/gadgets', { name: 'Hidden labelled gadget', restricted: true })).body;
    const v = (await lead.post('/api/vaults', { title: 'A vault' })).body;
    const body = { records: { gadget: [a.id, b.id, 'not-an-id', '00000000-0000-4000-8000-000000000000'], vault: [v.id], nothing: [a.id] } };
    const forAgent = (await agent.post('/api/records/labels', body)).body;
    expect(forAgent).toEqual({ gadget: { [a.id]: { label: 'Labelled gadget', ref: a.ref, route: '/gadgets' } }, vault: {}, nothing: {} });
    const forLead = (await lead.post('/api/records/labels', body)).body;
    expect(Object.keys(forLead.gadget).sort()).toEqual([a.id, b.id].sort());
    expect(forLead.vault[v.id].label).toBe('A vault');
    expect((await viewer.post('/api/records/labels', body)).body).toEqual({ gadget: {}, vault: {}, nothing: {} });
    expect((await agent.post('/api/records/labels', { records: [] })).status).toBe(400);
  });

  it('returns user names for ids, and lets a picker ask for exactly the people it holds', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      ids.push((await t.db.one<any>(
        `insert into users (username, email, display_name, status) values ($1, $2, $3, 'active') returning id`,
        [`crowd${i}`, `crowd${i}@example.test`, `Crowd Member ${String(i).padStart(2, '0')}`])).id);
    }
    await t.db.query(`update users set status = 'disabled' where id = $1`, [ids[29]]);
    expect((await agent.get('/api/users/options?q=Crowd')).body).toHaveLength(25);
    const picked = (await agent.get(`/api/users/options?ids=${ids.join(',')}`)).body;
    expect(picked).toHaveLength(30);
    expect(picked[0]).toEqual({ id: ids[0], label: 'Crowd Member 00' });
    expect((await agent.get('/api/users/options?ids=')).body).toEqual([]);
    const labels = (await agent.get(`/api/users/labels?ids=${ids[29]},${ids[0]},junk`)).body;
    expect(labels).toEqual([{ id: ids[0], label: 'Crowd Member 00', active: true }, { id: ids[29], label: 'Crowd Member 29', active: false }]);
    expect((await agent.get('/api/users/options?q=%25')).body).toEqual([]); // wildcards are literal
  });

  it('stores small JSON preferences for each person', async () => {
    expect((await agent.get('/api/me/preferences/views:gadget')).body).toEqual({ key: 'views:gadget', value: null, updatedAt: null });
    const value = { views: [{ name: 'Mine', filters: { 'f.owner_id': 'me' }, columns: ['name', 'status'] }] };
    const put = await agent.put<any>('/api/me/preferences/views:gadget', { value });
    expect(put.status).toBe(200);
    expect(put.body.value).toEqual(value);
    await agent.put('/api/me/preferences/overview.widgets', { value: ['tickets', 'risks'] });
    expect((await agent.get('/api/me/preferences/views:gadget')).body.value).toEqual(value);
    expect((await agent.get('/api/me/preferences')).body).toEqual({ 'overview.widgets': ['tickets', 'risks'], 'views:gadget': value });
    expect((await agent.get('/api/me/preferences?prefix=views:')).body).toEqual({ 'views:gadget': value });
    // Each person has their own.
    expect((await lead.get('/api/me/preferences')).body).toEqual({});
    await lead.put('/api/me/preferences/views:gadget', { value: 1 });
    expect((await agent.get('/api/me/preferences/views:gadget')).body.value).toEqual(value);
    // Limits.
    expect((await agent.put('/api/me/preferences/big', { value: 'x'.repeat(33 * 1024) })).status).toBe(413);
    expect((await agent.put('/api/me/preferences/bad key!', { value: 1 })).status).toBe(400);
    expect((await agent.put('/api/me/preferences/novalue', {})).status).toBe(400);
    expect((await t.anon.get('/api/me/preferences')).status).toBe(401);
    // Remove.
    await agent.put('/api/me/preferences/overview.widgets', { value: null });
    expect((await agent.del('/api/me/preferences/views:gadget')).status).toBe(200);
    expect((await agent.get('/api/me/preferences')).body).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------

describe('outbound webhooks', () => {
  let server: Server;
  let port = 0;
  let respond = 200;
  const received: { headers: IncomingMessage['headers']; body: string }[] = [];
  let hook: any;
  const deliveries = async (status?: string) =>
    (await t.api.get(`/api/admin/webhooks/${hook.id}/deliveries${status ? `?status=${status}` : ''}`)).body.rows as any[];
  const dueNow = () => t.db.query(`update webhook_deliveries set next_attempt_at = now() where status = 'pending'`);

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        if (respond === 302) res.writeHead(302, { location: `http://127.0.0.1:${port}/elsewhere` });
        else res.writeHead(respond);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

  it('checks hosts against the allow-list and signs with HMAC-SHA256 over timestamp and body', () => {
    const u = (s: string) => new URL(s);
    expect(hostAllowed(u('http://127.0.0.1:8129/x'), ['127.0.0.1:8129'])).toBe(true);
    expect(hostAllowed(u('http://127.0.0.1:8130/x'), ['127.0.0.1:8129'])).toBe(false);
    expect(hostAllowed(u('https://hooks.example.test/x'), ['hooks.example.test'])).toBe(true);
    expect(hostAllowed(u('https://hooks.example.test:8443/x'), ['hooks.example.test:443'])).toBe(false);
    expect(hostAllowed(u('https://a.b.example.test/x'), ['*.example.test'])).toBe(true);
    expect(hostAllowed(u('https://example.test/x'), ['*.example.test'])).toBe(false);
    expect(hostAllowed(u('https://badexample.test/x'), ['example.test'])).toBe(false);
    expect(hostAllowed(u('https://example.test/x'), [])).toBe(false);
    expect(hostAllowed(u('https://example.test/x'), 'example.test')).toBe(false);
    expect(signWebhook('secret', 1700000000, '{"a":1}')).toBe(`sha256=${createHmac('sha256', 'secret').update('1700000000.{"a":1}').digest('hex')}`);
    expect(signWebhook('secret', 1, 'x')).not.toBe(signWebhook('secret', 2, 'x'));
  });

  it('is managed by administrators only, and keeps the secret to itself', async () => {
    expect((await agent.get('/api/admin/webhooks')).status).toBe(403);
    expect((await agent.post('/api/admin/webhooks', { name: 'x', url: 'http://127.0.0.1/x', events: ['*'] })).status).toBe(403);
    const bad = await t.api.post('/api/admin/webhooks', { name: '', url: 'ftp://user:pw@host/x', events: ['gadget.explode', 'nothing.create'], secret: 'short' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['events', 'name', 'secret', 'url']);
    expect((await t.api.post('/api/admin/webhooks', { name: 'Creds', url: 'https://user:pw@example.test/x', events: ['*'] })).body.error.fields.url).toBeTruthy();

    const made = await t.api.post('/api/admin/webhooks', { name: 'Gadget feed', url: `http://127.0.0.1:${port}/hook`, events: ['gadget.create', 'gadget.update'] });
    expect(made.status).toBe(201);
    hook = made.body;
    expect(hook.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(hook).toMatchObject({ active: true, include_restricted: false, pending: 0 });
    const list = (await t.api.get('/api/admin/webhooks')).body;
    expect(list.outboundEnabled).toBe(false);
    expect(list.allowedHosts).toEqual([]);
    expect(list.webhooks[0].secret).toBeUndefined();
    expect(JSON.stringify(list)).not.toContain(hook.secret);
    expect((await t.db.one<any>('select secret from webhooks where id = $1', [hook.id])).secret).toMatch(/^enc:v1:/);
    expect((await audited('webhook.create')).at(-1).after.secret).toBeUndefined();
  });

  it('sends nothing while outbound connections are off, or to a host that is not on the allow-list', async () => {
    await agent.post('/api/gadgets', { name: 'Created while switched off' });
    expect(await deliveries()).toEqual([]); // not even queued
    const test = await t.api.post(`/api/admin/webhooks/${hook.id}/test`);
    expect(test.body).toMatchObject({ status: 'blocked', attempts: 1 });
    expect(test.body.last_error).toMatch(/switched off/);

    // Switching it on is a security setting.
    await t.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = (select id from users where username = 'admin')`);
    expect((await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true })).body.error.code).toBe('reauth_required');
    await t.db.query(`update sessions set confirmed_at = now() where user_id = (select id from users where username = 'admin')`);
    expect((await t.api.patch('/api/admin/settings', { 'integrations.allowed_hosts': ['not a host!'] })).status).toBe(400);
    expect((await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true })).status).toBe(200);

    const blocked = await t.api.post(`/api/admin/webhooks/${hook.id}/test`);
    expect(blocked.body.status).toBe('blocked');
    expect(blocked.body.last_error).toMatch(/not on the allow-list/);
    expect(received).toEqual([]);
  });

  it('delivers signed events once the host is allowed, and logs each delivery', async () => {
    await t.api.patch('/api/admin/settings', { 'integrations.allowed_hosts': [`127.0.0.1:${port}`] });
    const gadget = (await agent.post('/api/gadgets', { name: 'Announced gadget', notes: 'Hello.' })).body;
    await agent.post('/api/vaults', { title: 'Not subscribed' }).catch(() => undefined);
    expect((await deliveries('pending')).map((d) => d.event)).toEqual(['gadget.create']);
    expect(await t.core.webhooks.processDue()).toBe(1);

    expect(received).toHaveLength(1);
    const { headers, body } = received[0];
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      event: 'gadget.create', record: { type: 'gadget', id: gadget.id, ref: gadget.ref, route: `/gadgets/${gadget.id}` },
      data: { name: 'Announced gadget', notes: 'Hello.' }, actor: { id: agent.userId },
    });
    expect(headers['x-grc-event']).toBe('gadget.create');
    expect(headers['x-grc-delivery']).toBe(payload.id);
    expect(headers['x-grc-signature']).toBe(signWebhook(hook.secret, String(headers['x-grc-timestamp']), body));
    expect(Math.abs(Number(headers['x-grc-timestamp']) - Date.now() / 1000)).toBeLessThan(60);
    expect(headers.cookie).toBeUndefined();

    const [log] = await deliveries('delivered');
    expect(log).toMatchObject({ event: 'gadget.create', status: 'delivered', attempts: 1, response_status: 200, record_id: gadget.id, last_error: null });
    expect(log.delivered_at).toBeTruthy();

    // Updates carry what changed; events not subscribed to are not sent.
    await agent.patch(`/api/gadgets/${gadget.id}`, { status: 'done' });
    await agent.del(`/api/gadgets/${gadget.id}`);
    await t.core.webhooks.processDue();
    expect(received).toHaveLength(2);
    expect(JSON.parse(received[1].body)).toMatchObject({ event: 'gadget.update', changes: { before: { status: 'open' }, after: { status: 'done' } } });
    // An inactive webhook queues nothing.
    await t.api.patch(`/api/admin/webhooks/${hook.id}`, { active: false });
    await agent.post('/api/gadgets', { name: 'While paused' });
    await t.core.webhooks.processDue();
    expect(received).toHaveLength(2);
    await t.api.patch(`/api/admin/webhooks/${hook.id}`, { active: true });
  });

  it('never sends restricted records unless someone holding security.view opted in', async () => {
    await lead.post('/api/gadgets', { name: 'Restricted and unannounced', restricted: true });
    await lead.post('/api/vaults', { title: 'Whole type restricted' });
    await t.core.webhooks.processDue();
    expect(received).toHaveLength(2);

    // An administrator without security.view cannot opt in.
    const role = (await t.api.post('/api/admin/roles', { name: 'Integration admin', grants: ['admin.*', 'tickets.*'] })).body;
    const limited = await t.as(role.key);
    const refused = await limited.patch(`/api/admin/webhooks/${hook.id}`, { includeRestricted: true });
    expect(refused.body.error.fields.includeRestricted).toMatch(/security\.view/);
    expect((await limited.post('/api/admin/webhooks', { name: 'Sneaky', url: `http://127.0.0.1:${port}/h`, events: ['*'], includeRestricted: true })).body.error.fields.includeRestricted).toBeTruthy();

    // The administrator (who holds everything) opts in: restricted records are now sent.
    expect((await t.api.patch(`/api/admin/webhooks/${hook.id}`, { includeRestricted: true, events: ['gadget.create', 'vault.create'] })).body.include_restricted).toBe(true);
    // Nor can that administrator then point the webhook somewhere else.
    const moved = await limited.patch(`/api/admin/webhooks/${hook.id}`, { url: `http://127.0.0.1:${port}/elsewhere` });
    expect(moved.status).toBe(400);
    expect(moved.body.error.fields.url).toMatch(/security\.view/);
    const flagged = (await lead.post('/api/gadgets', { name: 'Restricted and announced', restricted: true })).body;
    await lead.post('/api/vaults', { title: 'Announced vault' });
    await t.core.webhooks.processDue();
    expect(received.slice(2).map((r) => JSON.parse(r.body).record.id)).toContain(flagged.id);
    expect(received).toHaveLength(4);

    // If the person who opted in loses security.view, restricted records stop.
    await t.db.query('update webhooks set created_by = $2 where id = $1', [hook.id, limited.userId]);
    await lead.post('/api/gadgets', { name: 'Restricted again', restricted: true });
    await agent.post('/api/gadgets', { name: 'Ordinary gadget' });
    await t.core.webhooks.processDue();
    expect(received).toHaveLength(5);
    expect(JSON.parse(received[4].body).data.name).toBe('Ordinary gadget');
  });

  it('retries failures with growing gaps, gives up, and can be retried by hand; redirects are not followed', async () => {
    respond = 500;
    const before = received.length;
    await agent.post('/api/gadgets', { name: 'Hard to deliver' });
    await t.core.webhooks.processDue();
    let [d] = await deliveries('pending');
    expect(d).toMatchObject({ status: 'pending', attempts: 1, response_status: 500 });
    expect(d.last_error).toMatch(/answered 500/);
    const wait = (new Date(d.next_attempt_at).getTime() - Date.now()) / 60000;
    expect(wait).toBeGreaterThan(0.5);
    expect(wait).toBeLessThan(1.5);
    // Not due yet: nothing is sent.
    expect(await t.core.webhooks.processDue()).toBe(0);

    respond = 302;
    for (let attempt = 2; attempt <= RETRY_MINUTES.length + 1; attempt += 1) {
      await dueNow();
      await t.core.webhooks.processDue();
      const row = await t.db.one<any>('select * from webhook_deliveries where id = $1', [d.id]);
      expect(row.attempts).toBe(attempt);
      if (attempt <= RETRY_MINUTES.length) {
        const mins = (new Date(row.next_attempt_at).getTime() - Date.now()) / 60000;
        expect(Math.round(mins)).toBe(RETRY_MINUTES[attempt - 1]);
      }
    }
    [d] = await deliveries('failed');
    expect(d).toMatchObject({ status: 'failed', attempts: RETRY_MINUTES.length + 1, response_status: 302 });
    expect(received.length).toBe(before + RETRY_MINUTES.length + 1);
    expect(received.every((r) => !String(r.headers.host).includes('elsewhere'))).toBe(true);
    expect((await t.api.get('/api/admin/webhooks')).body.webhooks[0].failed_recently).toBeGreaterThanOrEqual(1);

    respond = 200;
    expect((await agent.post(`/api/admin/webhook-deliveries/${d.id}/retry`)).status).toBe(403);
    const retried = await t.api.post(`/api/admin/webhook-deliveries/${d.id}/retry`);
    expect(retried.body).toMatchObject({ status: 'delivered', attempts: 1, response_status: 200 });
    expect((await t.api.post(`/api/admin/webhook-deliveries/${d.id}/retry`)).status).toBe(404);
  });

  it('replaces the secret, and stops when removed or when outbound connections are switched off again', async () => {
    const rotated = await t.api.post(`/api/admin/webhooks/${hook.id}/rotate-secret`);
    expect(rotated.body.secret).not.toBe(hook.secret);
    const n = received.length;
    expect((await t.api.post(`/api/admin/webhooks/${hook.id}/test`)).body.status).toBe('delivered');
    const last = received[n];
    expect(last.headers['x-grc-signature']).toBe(signWebhook(rotated.body.secret, String(last.headers['x-grc-timestamp']), last.body));
    expect(JSON.parse(last.body).event).toBe('webhook.test');

    // Queued, then switched off before sending: recorded as blocked, not sent.
    await agent.post('/api/gadgets', { name: 'Queued then blocked' });
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': false });
    await t.core.webhooks.processDue();
    expect((await deliveries('blocked'))[0].last_error).toMatch(/switched off/);
    expect(received.length).toBe(n + 1);
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': true });

    expect((await t.api.del(`/api/admin/webhooks/${hook.id}`)).status).toBe(200);
    await agent.post('/api/gadgets', { name: 'After removal' });
    await t.core.webhooks.processDue();
    expect(received.length).toBe(n + 1);
    expect((await t.api.get('/api/admin/webhooks')).body.webhooks).toEqual([]);
    expect((await t.api.get(`/api/admin/webhooks/${hook.id}/deliveries`)).status).toBe(404);
    await t.api.patch('/api/admin/settings', { 'integrations.outbound_enabled': false, 'integrations.allowed_hosts': [] });
  });
});

// ---------------------------------------------------------------------------------------------

describe('retention', () => {
  let old = '';
  let older = '';
  let fresh = '';
  beforeAll(async () => {
    old = (await agent.post('/api/gadgets', { name: 'Long finished gadget' })).body.id;
    older = (await agent.post('/api/gadgets', { name: 'Even older gadget' })).body.id;
    fresh = (await agent.post('/api/gadgets', { name: 'Fresh gadget' })).body.id;
    await t.db.query(`update test_gadgets set updated_at = now() - interval '30 months', created_at = now() - interval '40 months' where id = $1`, [old]);
    await t.db.query(`update test_gadgets set updated_at = now() - interval '50 months', created_at = now() - interval '60 months' where id = $1`, [older]);
  });

  it('holds a retention period and schedule category per record type, as data', async () => {
    expect((await agent.get('/api/admin/retention')).status).toBe(403);
    const before = (await t.api.get('/api/admin/retention')).body;
    expect(before.types.find((x: any) => x.type === 'gadget')).toMatchObject({ periodMonths: null, active: false, pendingReviews: 0 });
    expect(before.categories.map((c: any) => c.value)).toContain('operational');
    const bad = await t.api.put('/api/admin/retention/gadget', { periodMonths: 0, basis: 'whenever', category: 'made-up' });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['basis', 'category', 'periodMonths']);
    expect((await t.api.put('/api/admin/retention/nothing', { periodMonths: 12 })).status).toBe(404);
    const set = await t.api.put('/api/admin/retention/gadget', { periodMonths: 24, category: 'operational', notes: 'Two years after the last change.' });
    expect(set.body).toMatchObject({ record_type: 'gadget', period_months: 24, category: 'operational', basis: 'updated_at', active: true });
    expect((await audited('retention.policy')).at(-1).summary).toMatch(/gadgets set to 24 months/);
    expect((await t.api.get('/api/admin/settings')).body.values['retention.audit_months']).toBe(84);
  });

  it('flags records past their period for review and never deletes them', async () => {
    const count = async () => (await t.db.one<any>('select count(*)::int c from test_gadgets'))!.c;
    const total = await count();
    const swept = await t.core.retention.sweep();
    expect(swept).toEqual({ flagged: 2, byType: { gadget: 2 } });
    expect(await count()).toBe(total);
    expect((await t.core.retention.sweep()).flagged).toBe(0); // once only
    expect((await audited('retention.flag')).at(-1)).toMatchObject({ actor_name: 'System', record_type: 'gadget' });

    expect((await agent.get('/api/admin/retention/reviews')).status).toBe(403);
    const reviews = (await t.api.get('/api/admin/retention/reviews')).body;
    expect(reviews.total).toBe(2);
    expect(reviews.rows.map((r: any) => r.label)).toEqual(['Even older gadget', 'Long finished gadget']); // oldest first
    expect(reviews.rows[0]).toMatchObject({ record_type: 'gadget', typeLabel: 'Gadget', status: 'pending', route: `/gadgets/${older}` });
    expect(reviews.rows.some((r: any) => r.record_id === fresh)).toBe(false);
    expect((await t.api.get('/api/admin/retention')).body.types.find((x: any) => x.type === 'gadget').pendingReviews).toBe(2);
    expect((await t.api.post('/api/admin/retention/sweep')).body.flagged).toBe(0);
  });

  it('lets an administrator keep a record for longer, with a reason', async () => {
    const [review] = (await t.api.get('/api/admin/retention/reviews')).body.rows.filter((r: any) => r.record_id === old);
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/extend`, { months: 6 })).body.error.fields.reason).toBeTruthy();
    expect((await t.api.post(`/api/admin/retention/reviews/${review.id}/extend`, { reason: 'Still needed', until: '2001-01-01' })).body.error.fields.until).toBeTruthy();
    const kept = await t.api.post(`/api/admin/retention/reviews/${review.id}/extend`, { reason: 'Needed for an open enquiry.', months: 6 });
    expect(kept.body.status).toBe('extended');
    expect(kept.body.extended_until > new Date().toISOString().slice(0, 10)).toBe(true);
    expect((await t.api.get('/api/admin/retention/reviews')).body.total).toBe(1);
    expect((await t.api.get('/api/admin/retention/reviews?status=extended')).body.rows[0]).toMatchObject({ record_id: old, reason: 'Needed for an open enquiry.', decided_by_name: 'Test Admin' });
    expect((await t.core.retention.sweep()).flagged).toBe(0);
    // When the extension runs out the record comes back for review.
    await t.db.query(`update retention_reviews set extended_until = current_date - 1 where id = $1`, [review.id]);
    expect((await t.core.retention.sweep()).flagged).toBe(1);
    expect((await t.api.get('/api/admin/retention/reviews')).body.total).toBe(2);
    expect((await agent.get(`/api/history?record_type=gadget&record_id=${old}`)).body.some((e: any) => e.action === 'retention.extend')).toBe(true);
  });

  it('removes a record for good only by an explicit, confirmed, audited administrator action', async () => {
    const [review] = (await t.api.get('/api/admin/retention/reviews')).body.rows.filter((r: any) => r.record_id === older);
    await t.api.post('/api/comments', { record_type: 'gadget', record_id: older, body: 'Goes with the record.' });
    await t.api.put('/api/tags', { record_type: 'gadget', record_id: older, tags: ['going'] });
    const url = `/api/admin/retention/reviews/${review.id}/delete`;
    expect((await agent.post(url, { reason: 'Past retention.', confirm: true })).status).toBe(403);
    expect((await t.api.post(url, { reason: 'Past retention.' })).body.error.fields.confirm).toBeTruthy();
    expect((await t.api.post(url, { confirm: true })).body.error.fields.reason).toBeTruthy();
    await t.db.query(`update sessions set confirmed_at = now() - interval '11 minutes' where user_id = (select id from users where username = 'admin')`);
    expect((await t.api.post(url, { reason: 'Past retention.', confirm: true })).body.error.code).toBe('reauth_required');
    await t.db.query(`update sessions set confirmed_at = now() where user_id = (select id from users where username = 'admin')`);
    expect(await t.db.one('select 1 from test_gadgets where id = $1', [older])).toBeTruthy();

    const ref = (await t.api.get(`/api/gadgets/${older}`)).body.ref;
    const done = await t.api.post(url, { reason: 'Past retention; nothing depends on it.', confirm: true });
    expect(done.body).toMatchObject({ status: 'deleted', record_label: ref });
    expect(await t.db.one('select 1 from test_gadgets where id = $1', [older])).toBeUndefined();
    for (const table of ['comments', 'record_tags', 'search_index']) {
      expect([table, (await t.db.query(`select 1 from ${table} where record_type = 'gadget' and record_id = $1`, [older])).length]).toEqual([table, 0]);
    }
    const ev = (await audited('retention.delete')).at(-1);
    expect(ev).toMatchObject({ record_type: 'gadget', record_id: older, actor_name: 'Test Admin' });
    expect(ev.summary).toMatch(/removed for good.*nothing depends on it/);
    expect((await t.api.post(url, { reason: 'Again, please.', confirm: true })).status).toBe(404);
    expect((await t.api.get('/api/admin/retention/reviews?status=deleted')).body.rows[0]).toMatchObject({ label: ref, route: null });
    expect((await t.api.get('/api/admin/retention/reviews')).body.rows.map((r: any) => r.record_id)).toEqual([old]);
    expect(await t.db.one('select 1 from test_gadgets where id = $1', [fresh])).toBeTruthy();
  });
});
