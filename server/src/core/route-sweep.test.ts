// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { createSession, SESSION_COOKIE } from './auth.ts';
import { AREAS } from './features.ts';

// E40-05: one sweep over every registered /api route, instead of a few hand-picked URLs per module.
//  - Signed out, every route that is not public answers 401.
//  - Signed in as a person with no role, every route whose description names a permission (and every
//    generated record route) is refused: 403, or 404 where the route hides that the record exists.
//    Routes that need only a session must not fail with a server error.
//  - With every optional area switched off, every route of an area's module and of its record types
//    answers 404 `switched_off`, for an administrator too; the routes of parts that are always on do not.
// A new route is swept automatically. A route that cannot follow these rules goes in one of the lists
// below with its reason.

type T = Awaited<ReturnType<typeof testApp>>;
let t: T;
let doc: any;
let routes: { method: string; url: string; public: boolean }[] = [];
let noRoleUser = '';
let adminCookie = '';

const ID = '00000000-0000-4000-8000-0000000000a1';
/** A route pattern with every parameter filled in (an id that exists nowhere). */
const fill = (url: string) => url.replace(/:[A-Za-z0-9_]+/g, ID).replace(/\*/g, 'x');
const openApiPath = (url: string) => url.replace(/:([A-Za-z0-9_]+)/g, '{$1}').replace(/\*/g, '{path}');

/**
 * Routes answered before any session check on purpose, besides those registered as public
 * ("METHOD /api/path"): none today.
 */
const SIGNED_OUT_EXCEPTIONS: Record<string, string> = {};

/**
 * Routes with a documented permission that a person without it may still call, with the reason
 * ("METHOD /api/path"). Each must check the permission per record or answer only the caller's own data.
 */
const NO_ROLE_EXCEPTIONS: Record<string, string> = {};

async function call(method: string, url: string, cookie?: string) {
  const res = await t.app.inject({
    method: method as 'GET',
    url,
    headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), 'x-grc-csrf': '1' },
    ...(method === 'GET' || method === 'DELETE' || method === 'HEAD' ? {} : { payload: {} }),
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body };
}

/** The generated record routes (list, stats, one, create, change, delete) and their record type's permission module. */
function generatedPermission(method: string, url: string): string | null {
  for (const d of t.core.resources.registry.all()) {
    const actions: Record<string, string> = {
      [`GET ${d.path}`]: 'view', [`GET ${d.path}/stats`]: 'view', [`GET ${d.path}/:id`]: 'view',
      [`POST ${d.path}`]: 'create', [`PATCH ${d.path}/:id`]: 'edit', [`DELETE ${d.path}/:id`]: 'delete',
    };
    const a = actions[`${method} ${url}`];
    if (a) return `${d.module}.${a}`;
  }
  return null;
}

beforeAll(async () => {
  t = await testApp();
  // Every optional area on, the portal and the mobile app included, so every route is described and answers.
  const on = await t.api.patch('/api/admin/features', { features: Object.fromEntries(AREAS.map((a) => [a.key, true])) });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  doc = await t.core.openapi.build(null);
  adminCookie = await createSession(t.db, (await t.db.one<{ id: string }>("select id from users where username = 'admin'"))!.id);
  routes = t.core.openapi.routes();
  noRoleUser = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('norole', 'norole@example.test', 'Invented person with no role', 'active') returning id`))!.id;
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('every route (E40-05)', () => {
  it('finds the routes and their descriptions', () => {
    expect(routes.length).toBeGreaterThan(500);
    const withPermission = routes.filter((r) => doc.paths[openApiPath(r.url)]?.[r.method.toLowerCase()]?.['x-permission']);
    expect(withPermission.length).toBeGreaterThan(300);
  });

  it('answers 401 to someone signed out on every route that is not public', async () => {
    const wrong: string[] = [];
    for (const r of routes) {
      const op = doc.paths[openApiPath(r.url)]?.[r.method.toLowerCase()];
      const isPublic = r.public || (Array.isArray(op?.security) && op.security.length === 0);
      const key = `${r.method} ${r.url}`;
      if (isPublic || SIGNED_OUT_EXCEPTIONS[key]) continue;
      const res = await call(r.method, fill(r.url));
      if (res.status !== 401) wrong.push(`${key} -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
  }, 300_000);

  it('refuses a person with no role on every route that needs a permission, and never fails with a server error', async () => {
    const wrong: string[] = [];
    const errors: string[] = [];
    let checked = 0;
    for (const r of routes) {
      const op = doc.paths[openApiPath(r.url)]?.[r.method.toLowerCase()];
      const isPublic = r.public || (Array.isArray(op?.security) && op.security.length === 0);
      if (isPublic) continue;
      const key = `${r.method} ${r.url}`;
      const permission: string | null = op?.['x-permission'] ?? generatedPermission(r.method, r.url);
      // A fresh session for every call, so a route that signs out or changes the session cannot stop the sweep.
      const cookie = await createSession(t.db, noRoleUser);
      const res = await call(r.method, fill(r.url), cookie);
      if (res.status >= 500) errors.push(`${key} -> ${res.status} ${res.body?.error?.message ?? ''}`);
      if (!permission || NO_ROLE_EXCEPTIONS[key]) continue;
      checked += 1;
      if (res.status !== 403 && res.status !== 404) wrong.push(`${key} [${permission}] -> ${res.status}`);
    }
    expect(wrong).toEqual([]);
    expect(errors).toEqual([]);
    expect(checked).toBeGreaterThan(300);
  }, 300_000);

  it('answers switched_off for every route of a switched-off area, administrators included, and not for parts always on', async () => {
    const off = await t.api.patch('/api/admin/features', { features: Object.fromEntries(AREAS.map((a) => [a.key, false])) });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      const gate = t.core.features;
      await gate.state(); // the switches as just written, not the five-second cache
      const areaModules = new Set(AREAS.flatMap((a) => a.modules));
      const expected = routes.filter((r) => gate.routeOff(r.url, gate.moduleOf(r.url)));
      // Independently of the gate: every route registered by an area's module folder is among them.
      const byModule = routes.filter((r) => areaModules.has(gate.moduleOf(r.url) ?? ''));
      expect(byModule.filter((r) => !expected.includes(r)).map((r) => `${r.method} ${r.url}`)).toEqual([]);
      expect(expected.length).toBeGreaterThan(200);

      const notOff: string[] = [];
      for (const r of expected) {
        const res = await call(r.method, fill(r.url), adminCookie);
        if (res.status !== 404 || res.body?.error?.code !== 'switched_off') notOff.push(`${r.method} ${r.url} -> ${res.status} ${res.body?.error?.code ?? ''}`);
      }
      expect(notOff).toEqual([]);

      // The parts that are always on keep answering: no GET route of theirs says switched_off.
      const wronglyOff: string[] = [];
      for (const r of routes.filter((x) => x.method === 'GET' && !expected.includes(x))) {
        const res = await call('GET', fill(r.url), adminCookie);
        if (res.body?.error?.code === 'switched_off') wronglyOff.push(`${r.method} ${r.url}`);
      }
      expect(wronglyOff).toEqual([]);
    } finally {
      await t.api.patch('/api/admin/features', { features: Object.fromEntries(AREAS.map((a) => [a.key, true])) });
    }
  }, 300_000);
});
