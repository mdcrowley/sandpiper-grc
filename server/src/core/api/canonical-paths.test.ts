// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../module.ts';
import { tokenBlocked } from '../tokens.ts';
import { testApp } from '../../test/helpers.ts';
import { pageOf } from './conventions.ts';
import { pathProblem, versioned } from './versioning.ts';

// Wave 9 (SA-1, SA-2, SA-5, AZ-1, AZ-3): every check made on a request - by its path or by the
// route it matched - must see the same thing however the path is spelled. `/api/v1/x` is routed as
// `/api/x` before routing (no second route), and a path the router would read differently from
// how it is written (`/%61pi/...`) is refused with 400 before anything else.

let t: Awaited<ReturnType<typeof testApp>>;
/** What the last hook saw of each request, by the test's own request id. */
const seen = new Map<string, { route: string | null; path: string; version: string | null }>();

// Added in seedDefaults, before any module registers a route, so every route (child scopes too) has it.
const probe: ModuleDef = {
  key: 'zz_path_probe',
  async seedDefaults(ctx) {
    ctx.app.addHook('onResponse', async (req) => {
      const id = req.headers['x-walk-id'];
      if (typeof id === 'string') seen.set(id, { route: req.routeOptions?.url ?? null, path: req.url.split('?')[0], version: req.apiVersion });
    });
  },
};

const ID = '00000000-0000-4000-8000-000000000000';
const fill = (url: string) => url.replace(/:([A-Za-z0-9_]+)/g, (_m, name: string) => (/id$/i.test(name) ? ID : 'probe'));
let n = 0;

async function call(method: string, url: string, headers: Record<string, string> = {}) {
  const id = `w${++n}`;
  const res = await t.app.inject({ method: method as 'GET', url, headers: { 'x-walk-id': id, ...headers }, ...(method === 'GET' || method === 'DELETE' ? {} : { payload: {} }) });
  let code: string | undefined;
  try { code = res.json()?.error?.code; } catch { /* not JSON */ }
  return { status: res.statusCode, code, seen: seen.get(id) };
}

let token = '';
beforeAll(async () => {
  t = await testApp({ extraModules: [probe] });
  // Every optional area on, the portal too, so every route answers as it would in use.
  await t.api.patch('/api/admin/features', { features: { portal: true } });
  // The walk sends well over 600 token requests a minute on a fast machine: lift the per-token limit.
  await t.ctx.settings.set('tokens.rate_per_minute', 1_000_000);
  const made = await t.api.post('/api/me/tokens', { name: 'Narrow walker', scopes: ['tickets.view'], expiresInDays: 5 });
  expect(made.status).toBe(201);
  token = made.body.token;
}, 120_000);
afterAll(async () => { await t.close(); });

describe('one canonical request path (wave 9)', () => {
  it('refuses paths the router would read differently from how they are written', () => {
    for (const bad of ['/%61pi/users/options', '/api/%61uth/totp/begin', '/api/me/tok%65ns', '/api/v%31/tickets', '/api/tickets%2Fx',
      '/api/tickets%5Cx', '/api/%7Eprobe', '/api/me/../auth/state', '/api/./tickets', '/api/tickets/%zz', '/api/x%4', 'api/tickets', '*']) {
      expect([bad, pathProblem(bad)]).not.toEqual([bad, null]);
    }
    for (const good of ['/', '/api/tickets?q=%61%2F..', '/api/me/preferences/views%3Aticket', '/api/tags/rail%20yard', '/api/x/%C3%A9t%C3%A9', '/tickets/ab-c_d.e~f', '/assets/index-1a2b.js']) {
      expect([good, pathProblem(good)]).toEqual([good, null]);
    }
  });

  it('answers 400 bad_path before any other check, on every route', async () => {
    const routes = t.core.openapi.routes();
    for (const r of routes) {
      const url = fill(r.url);
      // The first letter of the first segment after /api, encoded; and /api itself.
      const encodedSegment = url.replace(/^\/api\/(.)/, (_m, c: string) => `/api/%${c.charCodeAt(0).toString(16).toUpperCase()}`);
      for (const spelled of [url.replace(/^\/api/, '/%61pi'), encodedSegment, versioned(url).replace('/v1/', '/v%31/')]) {
        const res = await call(r.method, spelled, { authorization: `Bearer ${token}` });
        expect([r.method, spelled, res.status, res.code]).toEqual([r.method, spelled, 400, 'bad_path']);
      }
    }
  }, 300_000);

  it('routes /api/v1 to the same route as /api, so every guard sees the same request', async () => {
    const routes = t.core.openapi.routes();
    expect(routes.length).toBeGreaterThan(200);
    for (const r of routes) {
      const url = fill(r.url);
      for (const headers of [{ 'x-grc-csrf': '1' } as Record<string, string>, { authorization: `Bearer ${token}` }]) {
        const plain = await call(r.method, url, headers);
        const v1 = await call(r.method, versioned(url), headers);
        const who = headers.authorization ? 'token' : 'anonymous';
        // The same route and path seen by the hooks; only the version differs.
        expect([who, r.method, url, v1.seen?.route, v1.seen?.path, v1.seen?.version])
          .toEqual([who, r.method, url, plain.seen?.route, plain.seen?.path, 'v1']);
        expect(plain.seen?.route).toBe(r.url);
        // Without a session nothing but public routes answer; a token never reaches account routes.
        if (!headers.authorization && !r.public) expect([who, r.method, url, plain.status, v1.status]).toEqual([who, r.method, url, 401, 401]);
        if (headers.authorization && tokenBlocked(r.url)) {
          expect([who, r.method, url, plain.code, v1.code]).toEqual([who, r.method, url, 'token_not_allowed', 'token_not_allowed']);
        }
        if (r.method === 'GET') expect([who, r.method, url, v1.status]).toEqual([who, r.method, url, plain.status]);
      }
    }
  }, 600_000);

  it('keeps the private reports of others private under /api/v1 too (AZ-1)', async () => {
    const lead = await t.as('security_lead');
    const lead2 = await t.as('security_lead');
    const agent = await t.as('agent');
    const made = await lead.post('/api/reports', { name: 'Depot overtime (private)', spec: { type: 'ticket', columns: ['title'] } });
    expect(made.status).toBe(201);
    expect((await agent.get(`/api/reports/${made.body.id}`)).status).toBe(404);
    expect((await agent.get(`/api/v1/reports/${made.body.id}`)).status).toBe(404);
    expect((await agent.get('/api/v1/reports?pageSize=500')).body.rows.some((x: any) => x.id === made.body.id)).toBe(false);
    expect((await lead2.patch(`/api/v1/reports/${made.body.id}`, { name: 'Changed through v1', sharing: 'everyone' })).status).toBe(404);
    expect((await lead2.del(`/api/v1/reports/${made.body.id}`)).status).toBe(404);
    expect((await lead.get(`/api/reports/${made.body.id}`)).body).toMatchObject({ name: 'Depot overtime (private)', sharing: 'private' });
    // Deleting relies on the same route guard: refused for someone else under both spellings.
    const dash = await lead.post('/api/dashboards', { name: 'Private depot board' });
    expect(dash.status).toBe(201);
    for (const url of [`/api/dashboards/${dash.body.id}`, `/api/v1/dashboards/${dash.body.id}`]) {
      expect([url, (await lead2.del(url)).status]).toEqual([url, 404]);
    }
    expect((await lead.get(`/api/dashboards/${dash.body.id}`)).status).toBe(200);
  });

  it('refuses to delete a completed regulator notification under /api/v1 too (AZ-3)', async () => {
    const incident = await t.ctx.resources.create('security_incident', { title: 'Invented fare system outage' });
    const task = await t.ctx.resources.create('notification_task', {
      incident_id: incident.id, party: 'Invented regulator', status: 'done', notified_who: 'Duty desk (invented)', notified_how: 'Web form',
      notified_at: new Date().toISOString(),
    });
    expect((await t.api.get(`/api/notification-tasks/${task.id}`)).body.status).toBe('done');
    expect((await t.api.del(`/api/v1/notification-tasks/${task.id}`)).status).toBe(409);
    expect((await t.api.del(`/api/notification-tasks/${task.id}`)).status).toBe(409);
    expect((await t.api.get(`/api/notification-tasks/${task.id}`)).status).toBe(200);
  });

  it('keeps a switched-off area off under every spelling', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { fleet: false } })).status).toBe(200);
    try {
      expect((await t.api.get('/api/vehicles')).body.error.code).toBe('switched_off');
      expect((await t.api.get('/api/v1/vehicles')).body.error.code).toBe('switched_off');
      expect((await t.api.get('/%61pi/vehicles')).body.error.code).toBe('bad_path');
      expect((await t.api.get('/api/%76ehicles')).body.error.code).toBe('bad_path');
    } finally {
      await t.api.patch('/api/admin/features', { features: { fleet: true } });
    }
  });
});

describe('page numbers (SP-09)', () => {
  it('reads page and pageSize as whole numbers in range', () => {
    expect(pageOf({ page: '1e400', pageSize: '1e400' })).toEqual({ page: 1_000_000, pageSize: 500, offset: 999_999 * 500 });
    expect(pageOf({ page: '2.7', pageSize: '10.9' })).toEqual({ page: 2, pageSize: 10, offset: 10 });
    expect(pageOf({ page: 'x', pageSize: '-4' })).toEqual({ page: 1, pageSize: 50, offset: 0 });
    expect(pageOf({}, { size: 20, maxSize: 100 })).toEqual({ page: 1, pageSize: 20, offset: 0 });
  });

  it('answers a huge page with an empty page instead of a server error', async () => {
    for (const url of ['/api/tickets?page=1e400', '/api/audit?page=1e400', '/api/admin/users?page=1e400', '/api/notifications?page=1e400', '/api/tickets?page=9007199254740993&pageSize=500']) {
      const res = await t.api.get(url);
      expect([url, res.status]).toEqual([url, 200]);
      expect(res.body.rows ?? res.body.notifications ?? []).toEqual([]);
    }
  });
});
