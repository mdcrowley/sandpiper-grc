import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';

// The area is off by default, so the shared coverage test only sees its routes once it is switched on:
// with it on, every civil rights route is in the OpenAPI document with a description.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  await t.db.query('update sessions set confirmed_at = now()');
  expect((await t.api.patch('/api/admin/features', { features: { civilrights: true } })).status).toBe(200);
  await t.api.get('/api/auth/state');
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('civil rights routes', () => {
  it('are all described', async () => {
    const whole: any = await t.core.openapi.build(null);
    const ours = Object.entries<any>(whole.paths).filter(([p]) => p.startsWith('/api/civil-rights'));
    expect(ours.length).toBeGreaterThan(20);
    const undocumented = ours.flatMap(([p, ops]) => Object.entries<any>(ops).filter(([, op]) => op['x-undocumented']).map(([m]) => `${m} ${p}`));
    expect(undocumented).toEqual([]);
    const registered = t.core.openapi.routes().filter((r) => r.url.startsWith('/api/civil-rights'));
    const missing = registered.filter((r) => !whole.paths[r.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}')]);
    expect(missing).toEqual([]);
  });

  it('answer switched_off while the area is off, and leave its lists out', async () => {
    expect((await t.api.patch('/api/admin/features', { features: { civilrights: false } })).status).toBe(200);
    expect((await t.api.get('/api/civil-rights/complaints')).status).toBe(404);
    expect((await t.api.get('/api/civil-rights/complaint-handlers')).status).toBe(404);
    const meta = (await t.api.get('/api/meta')).body;
    expect(Object.keys(meta.lookups).filter((k) => k.startsWith('civil_rights'))).toEqual([]);
    const roles = (await t.api.get('/api/admin/roles')).body.roles as { key: string }[];
    expect(roles.some((r) => r.key === 'civil_rights_officer')).toBe(false);
    expect((await t.api.patch('/api/admin/features', { features: { civilrights: true } })).status).toBe(200);
    const on = (await t.api.get('/api/admin/roles')).body.roles as { key: string }[];
    expect(on.some((r) => r.key === 'civil_rights_officer')).toBe(true);
  });
});
