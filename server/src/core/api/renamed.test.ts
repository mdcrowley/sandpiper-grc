import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../auth.ts';
import { testApp } from '../../test/helpers.ts';
import { DEPRECATIONS } from './deprecations.ts';
import { versioned } from './versioning.ts';

// Routes renamed to American spelling keep their British path as a deprecated alias:
// same handler and permissions, a Deprecation header, and `deprecated: true` in the document.

let t: Awaited<ReturnType<typeof testApp>>;
let cookie = '';
const renamed = DEPRECATIONS.filter((d) => d.replacement);
const loaded = (path: string) => t.core.openapi.routes().some((r) => r.url === path);

beforeAll(async () => {
  t = await testApp();
  // Every optional part on, the portal included (off by default), so every route is described (E14-34).
  await t.api.patch('/api/admin/features', { features: { portal: true } });
  const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  cookie = await createSession(t.db, admin!.id);
});
afterAll(async () => { await t.close(); });

const get = async (url: string) => {
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1' } });
  return { status: res.statusCode, headers: res.headers, body: res.json() };
};

describe('renamed routes', () => {
  it('lists the British-spelled paths with their American replacements', () => {
    expect(renamed.map((d) => `${d.method} ${d.path} -> ${d.replacement}`)).toEqual(expect.arrayContaining([
      'GET /api/policies/acknowledgements/mine -> /api/policies/acknowledgments/mine',
      'GET /api/policies/:id/acknowledgements -> /api/policies/:id/acknowledgments',
      'POST /api/policies/acknowledgements/:ackId/acknowledge -> /api/policies/acknowledgments/:ackId/acknowledge',
      'GET /api/portal/catalogue -> /api/portal/catalog',
      'GET /api/reports/catalogue -> /api/reports/catalog',
    ]));
  });

  it('serves each old path wherever the new one is registered (under /api/v1 too, through the same route)', async () => {
    for (const d of renamed) {
      if (!loaded(d.replacement!)) continue; // module not loaded (GRC_MODULES)
      expect([d.path, t.app.hasRoute({ method: d.method, url: d.path })]).toEqual([d.path, true]);
    }
    for (const d of renamed.filter((r) => r.method === 'GET' && !r.path.includes(':') && loaded(r.replacement!))) {
      expect([d.path, (await get(versioned(d.path))).status]).toEqual([d.path, (await get(d.path)).status]);
    }
  });

  it('answers the old path like the new one, with a Deprecation header only on the old', async () => {
    for (const [oldUrl, newUrl] of [['/api/reports/catalogue', '/api/reports/catalog'], ['/api/policies/acknowledgements/mine', '/api/policies/acknowledgments/mine'], ['/api/portal/catalogue', '/api/portal/catalog']]) {
      if (!loaded(newUrl)) continue;
      const now = await get(newUrl);
      const old = await get(oldUrl);
      expect([oldUrl, old.status, old.body]).toEqual([oldUrl, now.status, now.body]);
      expect(old.headers.deprecation).toBe(`@${Date.UTC(2026, 10, 19) / 1000}`);
      expect(now.headers.deprecation).toBeUndefined();
      expect((await get(versioned(oldUrl))).headers.deprecation).toBeDefined();
    }
  });

  it('documents the old paths as deprecated, pointing at the new ones', async () => {
    const doc: any = await t.core.openapi.build(null);
    for (const d of renamed) {
      if (!loaded(d.replacement!)) continue;
      const op = doc.paths[d.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}')]?.[d.method.toLowerCase()];
      expect([d.path, op?.deprecated]).toEqual([d.path, true]);
      expect(op.description).toContain(d.replacement);
      expect(op['x-undocumented']).toBeUndefined();
      const current = doc.paths[d.replacement!.replace(/:([A-Za-z0-9_]+)/g, '{$1}')][d.method.toLowerCase()];
      expect(current.deprecated).toBeUndefined();
    }
  });
});
