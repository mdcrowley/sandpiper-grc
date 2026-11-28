// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { testApp } from '../../test/helpers.ts';
import { scopeGrantable } from '../tokens.ts';
import { DEPRECATIONS } from './deprecations.ts';
import { etagOf, ifMatchAccepts, pageLinks } from './conventions.ts';
import { unversioned, versioned } from './versioning.ts';

// The integrator conventions (docs/api.md): /api/v1, request ids, ETag / If-Match,
// Idempotency-Key, paging links, rate-limit headers, deprecation headers and the error envelope.
// Exercised through a throwaway module with invented data.

const widgets: ModuleDef = {
  key: 'testwidgets',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_widgets (
        id uuid primary key default gen_random_uuid(),
        ref text, name text not null, color text,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'widget', table: 'test_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/widgets', route: '/widgets', titleField: 'name', ref: { field: 'ref', prefix: 'W-' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        color: { label: 'Color', type: 'text' },
      },
    });
    // A hand-written route that answers an error without the envelope, to show it is added.
    ctx.app.get('/api/widgets-teapot', async (_req, reply) => reply.code(418).send({ message: 'Short and stout.' }));
    ctx.describeRoute({ method: 'GET', path: '/api/widgets-teapot', summary: 'Always refuses', tag: 'Widgets' });
    // A route outside /api whose error answer is its own business.
    ctx.app.get('/widgets-plain', async (_req, reply) => reply.code(400).send({ message: 'Not an API answer.' }));
    // A route that sees the url it was called with.
    ctx.app.get('/api/widgets-echo', async (req) => ({ url: req.url, version: req.apiVersion, requestId: req.requestId }));
    ctx.describeRoute({ method: 'GET', path: '/api/widgets-echo', summary: 'Echo', tag: 'Widgets' });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
let token = '';

async function call(method: string, url: string, opts: { token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) {
  const useToken = opts.token === undefined ? token : opts.token;
  const res = await t.app.inject({
    method: method as 'GET', url,
    headers: { ...(useToken ? { authorization: `Bearer ${useToken}` } : {}), ...(opts.headers ?? {}) },
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body, headers: res.headers };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [widgets] });
  token = (await t.api.post('/api/me/tokens', { name: 'Conventions', scopes: ['tickets.*'], expiresInDays: 1 })).body.token;
});
afterAll(async () => { await t.close(); });

describe('versioned base path /api/v1', () => {
  it('maps between the two forms', () => {
    expect(versioned('/api/tickets/1')).toBe('/api/v1/tickets/1');
    expect(versioned('/api/v1/tickets')).toBe('/api/v1/tickets');
    expect(unversioned('/api/v1/tickets?q=a')).toBe('/api/tickets?q=a');
    expect(unversioned('/api/v1')).toBe('/api');
    expect(unversioned('/api/v10/x')).toBe('/api/v10/x');
  });

  it('serves every route under /api/v1 as well, seen by the route as the /api path', async () => {
    const made = await call('POST', '/api/v1/widgets', { body: { name: 'Depot ticket printer' } });
    expect(made.status).toBe(201);
    expect(made.headers['api-version']).toBe('1');
    const one = await call('GET', `/api/v1/widgets/${made.body.id}`);
    expect(one.body.name).toBe('Depot ticket printer');
    const same = await call('GET', `/api/widgets/${made.body.id}`);
    expect(same.body).toEqual(one.body);
    expect(same.headers['api-version']).toBeUndefined();
    const echo = await call('GET', '/api/v1/widgets-echo?x=1');
    expect(echo.body).toMatchObject({ url: '/api/widgets-echo?x=1', version: 'v1' });
    expect((await call('GET', '/api/widgets-echo')).body.version).toBeNull();
    // Core routes and module routes alike.
    expect((await call('GET', '/api/v1/auth/state')).body.user.username).toBe('admin');
    expect((await call('GET', '/api/v1/health', { token: null })).status).toBe(200);
    expect((await call('GET', '/api/v1/nothing-here')).status).toBe(404);
  });

  it('applies the same rules under /api/v1: sign-in, token limits and CSRF', async () => {
    expect((await call('GET', '/api/v1/widgets', { token: null })).status).toBe(401);
    const blocked = await call('GET', '/api/v1/me/tokens');
    expect([blocked.status, blocked.body.error.code]).toEqual([403, 'token_not_allowed']);
    // A session without the CSRF header is refused on the versioned path too.
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' }, payload: { username: 'admin', password: 'a long test passphrase 1' } });
    const cookie = `grc_session=${login.cookies.find((c) => c.name === 'grc_session')!.value}`;
    const csrf = await call('POST', '/api/v1/widgets', { token: null, headers: { cookie }, body: { name: 'No header' } });
    expect([csrf.status, csrf.body.error.code]).toEqual([403, 'csrf']);
  });

  it('audits token use with the unversioned path', async () => {
    await call('POST', '/api/v1/widgets', { body: { name: 'Audited through v1' } });
    const ev = await t.db.one<any>(`select summary from audit_events where action = 'token.use' order by id desc limit 1`);
    expect(ev.summary).toBe('POST /api/widgets (201) with API token "Conventions"');
  });

  it('records the caller\'s request id on the audit events it causes', async () => {
    await call('POST', '/api/v1/widgets', { body: { name: 'Traced change' }, headers: { 'x-request-id': 'sync-job-42' } });
    const events = await t.db.query<any>(`select action, request_id from audit_events where request_id = 'sync-job-42'`);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e: any) => e.request_id === 'sync-job-42')).toBe(true);
  });

  it('describes the v1 paths in /api/v1/openapi.json', async () => {
    const doc = (await call('GET', '/api/v1/openapi.json')).body;
    expect(doc['x-api-version']).toBe('v1');
    expect(doc.paths['/api/v1/widgets'].post).toBeTruthy();
    expect(doc.paths['/api/widgets']).toBeUndefined();
    expect(Object.keys(doc.paths).every((p) => p.startsWith('/api/v1/'))).toBe(true);
    const plain = (await call('GET', '/api/openapi.json')).body;
    expect(plain.paths['/api/widgets'].post).toBeTruthy();
    expect(plain.paths['/api/v1/widgets']).toBeUndefined();
  });
});

describe('request id', () => {
  it('sends one on every answer, keeps a sensible one the caller gave, and replaces a bad one', async () => {
    const a = await call('GET', '/api/widgets');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await call('GET', '/api/widgets');
    expect(b.headers['x-request-id']).not.toBe(a.headers['x-request-id']);
    expect((await call('GET', '/api/widgets', { headers: { 'x-request-id': 'monitor-7f3a.42' } })).headers['x-request-id']).toBe('monitor-7f3a.42');
    expect((await call('GET', '/api/widgets', { headers: { 'x-request-id': 'bad id <script>' } })).headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    // Errors, refusals and unknown routes too.
    expect((await call('GET', '/api/widgets', { token: null })).headers['x-request-id']).toBeTruthy();
    expect((await call('GET', '/api/nope')).headers['x-request-id']).toBeTruthy();
    expect((await call('GET', '/api/widgets-echo', { headers: { 'x-request-id': 'abc-1' } })).body.requestId).toBe('abc-1');
  });
});

describe('ETag and If-Match', () => {
  it('compares versions', () => {
    const tag = etagOf('11111111-1111-1111-1111-111111111111', '2026-01-01T00:00:00.000Z');
    expect(tag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    expect(etagOf('11111111-1111-1111-1111-111111111111', new Date('2026-01-01T00:00:00.000Z'))).toBe(tag);
    expect(etagOf('11111111-1111-1111-1111-111111111111', '2026-01-01T00:00:00.001Z')).not.toBe(tag);
    expect(ifMatchAccepts(tag, tag)).toBe(true);
    expect(ifMatchAccepts(`"x", W/${tag}`, tag)).toBe(true);
    expect(ifMatchAccepts('*', tag)).toBe(true);
    expect(ifMatchAccepts('"x"', tag)).toBe(false);
    expect(ifMatchAccepts(tag.slice(1, -1), tag)).toBe(true); // quotes dropped by a shell
  });

  it('gives one record an ETag and refuses a change made against an old version, only when asked', async () => {
    const made = await call('POST', '/api/v1/widgets', { body: { name: 'Fare gate' } });
    const first = made.headers.etag as string;
    expect(first).toBeTruthy();
    expect((await call('GET', `/api/v1/widgets/${made.body.id}`)).headers.etag).toBe(first);

    const ok = await call('PATCH', `/api/v1/widgets/${made.body.id}`, { body: { color: 'blue' }, headers: { 'if-match': first } });
    expect(ok.status).toBe(200);
    const second = ok.headers.etag as string;
    expect(second).not.toBe(first);

    const stale = await call('PATCH', `/api/v1/widgets/${made.body.id}`, { body: { color: 'red' }, headers: { 'if-match': first } });
    expect([stale.status, stale.body.error.code]).toEqual([409, 'version_conflict']);
    expect(stale.headers.etag).toBe(second);
    expect((await call('GET', `/api/widgets/${made.body.id}`)).body.color).toBe('blue');

    // Without If-Match, as the web application sends it, nothing changes.
    expect((await t.api.patch(`/api/widgets/${made.body.id}`, { color: 'green' })).status).toBe(200);
    expect((await call('DELETE', `/api/v1/widgets/${made.body.id}`, { headers: { 'if-match': second } })).status).toBe(409);
    expect((await call('DELETE', `/api/v1/widgets/${made.body.id}`, { headers: { 'if-match': '*' } })).status).toBe(200);
    // A record that is not there answers 404, not 409.
    expect((await call('PATCH', `/api/v1/widgets/${made.body.id}`, { body: { color: 'x' }, headers: { 'if-match': first } })).status).toBe(404);
  });

  it('takes concurrent changes to one record one at a time', async () => {
    const made = await call('POST', '/api/widgets', { body: { name: 'Platform display' } });
    const tag = made.headers.etag as string;
    const results = await Promise.all([1, 2, 3].map((n) => call('PATCH', `/api/widgets/${made.body.id}`, { body: { color: `c${n}` }, headers: { 'if-match': tag } })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});

describe('Idempotency-Key', () => {
  it('replays the first answer for a repeated create, and creates one record', async () => {
    const key = 'sync-run-2026-11-18-0001';
    const first = await call('POST', '/api/v1/widgets', { body: { name: 'Bus 1402 radio' }, headers: { 'idempotency-key': key } });
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    const again = await call('POST', '/api/v1/widgets', { body: { name: 'Bus 1402 radio' }, headers: { 'idempotency-key': key } });
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body).toEqual(first.body);
    expect((await t.db.one<any>(`select count(*)::int c from test_widgets where name = 'Bus 1402 radio'`)).c).toBe(1);
    // The unversioned path is the same route.
    expect((await call('POST', '/api/widgets', { body: { name: 'Bus 1402 radio' }, headers: { 'idempotency-key': key } })).body.id).toBe(first.body.id);

    const reused = await call('POST', '/api/v1/widgets', { body: { name: 'Something else' }, headers: { 'idempotency-key': key } });
    expect([reused.status, reused.body.error.code]).toEqual([422, 'idempotency_key_reused']);
    // Keys belong to whoever sent them: another caller's same key is a new request.
    const other = await t.api.post('/api/widgets', { name: 'Bus 1402 radio' });
    expect(other.body.id).not.toBe(first.body.id);
  });

  it('does not remember a refused request, so it can be corrected and sent again', async () => {
    const key = 'retry-after-fix';
    const bad = await call('POST', '/api/widgets', { body: { color: 'no name' }, headers: { 'idempotency-key': key } });
    expect(bad.status).toBe(400);
    const good = await call('POST', '/api/widgets', { body: { name: 'Fixed', color: 'no name' }, headers: { 'idempotency-key': key } });
    expect(good.status).toBe(201);
    expect((await call('POST', '/api/widgets', { body: { name: 'x' }, headers: { 'idempotency-key': ' ' } })).body.error.code).toBe('bad_idempotency_key');
  });

  it('forgets keys after 24 hours', async () => {
    const key = 'old-key';
    const first = await call('POST', '/api/widgets', { body: { name: 'Old' }, headers: { 'idempotency-key': key } });
    await t.db.query(`update api_idempotency_keys set expires_at = now() - interval '1 second' where key = $1`, [key]);
    const later = await call('POST', '/api/widgets', { body: { name: 'Old' }, headers: { 'idempotency-key': key } });
    expect(later.body.id).not.toBe(first.body.id);
  });
});

describe('paging links', () => {
  it('adds Link and X-Total-Count to a page of a list, keeping the filters and the path used', async () => {
    for (let i = 0; i < 5; i += 1) await call('POST', '/api/widgets', { body: { name: `Paged ${i}`, color: 'paged' } });
    const res = await call('GET', '/api/v1/widgets?f.color=paged&pageSize=2&page=2');
    expect(res.headers['x-total-count']).toBe('5');
    const link = res.headers.link as string;
    expect(link).toContain('</api/v1/widgets?f.color=paged&pageSize=2&page=1>; rel="first"');
    expect(link).toContain('page=1>; rel="prev"');
    expect(link).toContain('page=3>; rel="next"');
    expect(link).toContain('page=3>; rel="last"');
    expect(pageLinks('/api/x', 1, 50, 0)).toBe('</api/x?page=1&pageSize=50>; rel="first", </api/x?page=1&pageSize=50>; rel="last"');
  });
});

describe('rate-limit headers', () => {
  it('tells a token how many requests it has left this minute, and when to retry', async () => {
    const own = (await t.api.post('/api/me/tokens', { name: 'Counted', scopes: ['tickets.view'], expiresInDays: 1 })).body.token;
    await t.ctx.settings.set('tokens.rate_per_minute', 3);
    try {
      const a = await call('GET', '/api/v1/widgets?pageSize=1', { token: own });
      expect(a.headers['ratelimit-limit']).toBe('3');
      expect(Number(a.headers['ratelimit-reset'])).toBeGreaterThanOrEqual(1);
      expect(Number(a.headers['ratelimit-reset'])).toBeLessThanOrEqual(60);
      expect(a.headers['ratelimit-policy']).toBe('3;w=60');
      const b = await call('GET', '/api/v1/widgets?pageSize=1', { token: own });
      // The window is the clock minute, so a run that straddles two minutes starts again.
      expect(Number(b.headers['ratelimit-remaining'])).toBeLessThanOrEqual(Number(a.headers['ratelimit-remaining']) + 2);
      let refused: Awaited<ReturnType<typeof call>> | null = null;
      for (let i = 0; i < 6 && !refused; i += 1) {
        const r = await call('GET', '/api/v1/widgets?pageSize=1', { token: own });
        if (r.status === 429) refused = r;
      }
      expect(refused!.headers['retry-after']).toBeTruthy();
      expect(refused!.headers['ratelimit-remaining']).toBe('0');
      // A session request carries none of them.
      expect((await t.api.get('/api/widgets')).status).toBe(200);
      const viaSession = await t.app.inject({ method: 'GET', url: '/api/health' });
      expect(viaSession.headers['ratelimit-limit']).toBeUndefined();
    } finally {
      await t.ctx.settings.set('tokens.rate_per_minute', 600);
    }
  });
});

describe('deprecations and errors', () => {
  it('announces a deprecated route with Deprecation and Sunset headers and in the document', async () => {
    DEPRECATIONS.push({ method: 'GET', path: '/api/widgets-echo', since: '2026-11-01', sunset: '2027-06-30', notice: 'Use GET /api/widgets instead.', link: 'https://example.test/notice' });
    try {
      const res = await call('GET', '/api/v1/widgets-echo');
      expect(res.headers.deprecation).toBe(`@${Date.UTC(2026, 10, 1) / 1000}`);
      expect(res.headers.sunset).toBe('Wed, 30 Jun 2027 00:00:00 GMT');
      expect(res.headers.link).toContain('rel="deprecation"');
      const op = (await call('GET', '/api/v1/openapi.json')).body.paths['/api/v1/widgets-echo'].get;
      expect(op.deprecated).toBe(true);
      expect(op.description).toMatch(/Use GET \/api\/widgets instead/);
      expect((await call('GET', '/api/widgets')).headers.deprecation).toBeUndefined();
    } finally {
      DEPRECATIONS.splice(DEPRECATIONS.findIndex((d) => d.path === '/api/widgets-echo'), 1);
    }
  });

  it('puts every error answer in the envelope', async () => {
    const res = await call('GET', '/api/v1/widgets-teapot');
    expect(res.status).toBe(418);
    expect(res.body.error).toEqual({ code: 'http_418', message: 'Short and stout.' });
    const bad = await t.app.inject({ method: 'POST', url: '/api/v1/widgets', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, payload: '{not json' });
    expect(bad.json().error.code).toBe('bad_json');
  });

  it('leaves answers outside /api alone', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/widgets-plain' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ message: 'Not an API answer.' });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('capability scopes', () => {
  it('lets anyone with permissions give a token a capability scope such as mcp.use, and nothing beyond their permissions', async () => {
    expect(scopeGrantable('mcp.use', ['tickets.view'])).toBe(true);
    expect(scopeGrantable('mcp.use', [])).toBe(false);
    expect(scopeGrantable('mcp.*', ['tickets.view'])).toBe(true);
    expect(scopeGrantable('mcp.other', ['tickets.view'])).toBe(false);
    expect(scopeGrantable('reports.view', ['tickets.view'])).toBe(false);
    expect(scopeGrantable('tickets.view', ['tickets.*'])).toBe(true);

    const agent = await t.as('agent'); // no administrator rights
    expect((await agent.get('/api/me/tokens')).body.scopeFamilies).toEqual([{ scope: 'mcp.use', description: expect.any(String) }]);
    const made = await agent.post('/api/me/tokens', { name: 'Assistant', scopes: ['tickets.view', 'mcp.use'], expiresInDays: 7 });
    expect(made.status).toBe(201);
    expect(made.body.scopes).toEqual(['tickets.view', 'mcp.use']);
    const beyond = await agent.post('/api/me/tokens', { name: 'Too much', scopes: ['mcp.use', 'admin.administer'], expiresInDays: 7 });
    expect(beyond.body.error.fields.scopes).toMatch(/admin\.administer/);
    expect(beyond.body.error.fields.scopes).not.toMatch(/mcp\.use/);
    // The capability scope adds no permission: the token still reads only what tickets.view allows.
    const state = await call('GET', '/api/v1/auth/state', { token: made.body.token });
    expect(state.body.permissions).toEqual(['tickets.view']);
  });
});
