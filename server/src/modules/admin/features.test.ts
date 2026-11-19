import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { availability } from '../mcp/tools.ts';
import { ALL_TOOLS } from '../mcp/tools.ts';

// Feature switches (E14-28): a switched-off area disappears for everyone, administrators and
// tokens included, and comes back whole when switched on again.
let t: Awaited<ReturnType<typeof testApp>>;
let token = '';
const bearer = (url: string) => t.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
const setFeatures = (features: Record<string, boolean>) => t.api.patch('/api/admin/features', { features });

beforeAll(async () => {
  t = await testApp();
  const mode = (await t.ctx.lookups.values('vehicle_mode'))[0].value;
  await t.ctx.resources.create('vehicle', { fleet_number: 'ZEPHYR-4411', mode });
  await t.ctx.resources.create('hazard', { title: 'Zephyr platform gap' });
  const made = await t.api.post('/api/me/tokens', { name: 'Script', scopes: ['fleet.view', 'safety.view', 'risks.view', 'actions.view'], expiresInDays: 5 });
  expect(made.status).toBe(201);
  token = made.body.token;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('feature switches', () => {
  it('starts with every area on except the portal', async () => {
    const state = (await t.anon.get('/api/auth/state')).body;
    expect(state.features).toMatchObject({ fleet: true, safety: true, tickets: true, portal: false });
    const page = (await t.api.get('/api/admin/features')).body;
    expect(page.areas.find((a: any) => a.key === 'portal')).toMatchObject({ on: false, requires: ['tickets'] });
    expect(page.areas.find((a: any) => a.key === 'tickets').requiredBy).toEqual(['portal']);
    expect(page.assistant).toEqual({ enabled: false });
  });

  it('hides fleet and safety everywhere for an administrator and a token, and brings them back', async () => {
    const before = await t.api.get('/api/meta');
    expect(before.body.resources.vehicle).toBeTruthy();
    expect((await t.api.get('/api/search?q=zephyr')).body.map((r: any) => r.type)).toEqual(expect.arrayContaining(['vehicle', 'hazard']));

    const off = await setFeatures({ fleet: false, safety: false });
    expect(off.status).toBe(200);
    expect(off.body.switchedOff).toEqual(['fleet', 'safety']);

    // Routes: generated, hand-written, and core routes asked about a hidden type.
    for (const url of ['/api/vehicles', '/api/hazards', '/api/safety/summary', '/api/fleet/requirements', '/api/records/lookup?type=vehicle&q=z']) {
      const r = await t.api.get(url);
      expect(r.status, url).toBe(404);
      expect(r.body.error.code, url).toBe('switched_off');
    }
    expect((await t.api.get('/api/v1/vehicles')).status).toBe(404);
    // Permissions: nobody holds them, `*` included.
    const state = (await t.api.get('/api/auth/state')).body;
    expect(state.features).toMatchObject({ fleet: false, safety: false });
    expect(state.areasOff).toEqual(expect.arrayContaining(['fleet', 'safety']));
    expect(t.ctx.can({ id: 'x', permissions: ['*'] } as any, 'fleet.view')).toBe(false);
    expect(t.ctx.can({ id: 'x', permissions: ['*'] } as any, 'systems.view')).toBe(true);
    // Metadata, search, the report catalog and the OpenAPI document.
    const meta = (await t.api.get('/api/meta')).body;
    expect(meta.resources.vehicle).toBeUndefined();
    expect(meta.resources.hazard).toBeUndefined();
    expect(meta.resources.system).toBeTruthy();
    expect((await t.api.get('/api/search?q=zephyr')).body.map((r: any) => r.type)).not.toEqual(expect.arrayContaining(['vehicle']));
    const catalog = (await t.api.get('/api/reports/catalog')).body.types.map((x: any) => x.type);
    expect(catalog).not.toContain('vehicle');
    expect(catalog).not.toContain('hazard');
    const paths = Object.keys((await t.api.get('/api/openapi.json')).body.paths);
    expect(paths.some((p) => p.startsWith('/api/vehicles') || p.startsWith('/api/hazards') || p.startsWith('/api/safety') || p.startsWith('/api/fleet'))).toBe(false);
    expect(paths).toContain('/api/systems');
    // MCP tools that need fleet or safety are not offered.
    const a = availability(t.ctx, ['*']);
    expect(a.sees('vehicle')).toBe(false);
    const fleetTools = ALL_TOOLS.filter((x) => x.available && !x.available(a)).map((x) => x.name);
    expect(fleetTools.length).toBeGreaterThan(0);
    // A token: same answers.
    expect((await bearer('/api/vehicles')).statusCode).toBe(404);
    expect((await bearer('/api/meta')).json().resources.vehicle).toBeUndefined();
    expect((await bearer('/api/actions')).statusCode).toBe(200);
    // Scheduled reminders of a switched-off area are skipped.
    await t.app.jobs.enqueue('safety.reminders', {}, {});
    await t.app.jobs.runDue({ types: ['safety.reminders'] });
    const job = await t.db.one<any>(`select status, result from jobs where type = 'safety.reminders' order by created_at desc limit 1`);
    expect(job).toMatchObject({ status: 'done', result: { skipped: 'switched_off' } });
    // The data is kept.
    expect((await t.db.one<any>('select count(*)::int c from vehicles')).c).toBe(1);

    // Back on: everything returns at once.
    expect((await setFeatures({ fleet: true, safety: true })).body.switchedOn).toEqual(['fleet', 'safety']);
    expect((await t.api.get('/api/vehicles')).body.total).toBe(1);
    expect((await t.api.get('/api/meta')).body.resources.hazard).toBeTruthy();
    expect((await bearer('/api/vehicles')).statusCode).toBe(200);
    expect(Object.keys((await t.api.get('/api/openapi.json')).body.paths)).toContain('/api/vehicles');
    expect(availability(t.ctx, ['*']).sees('vehicle')).toBe(true);
  });

  it('switches security incidents off without taking restricted access from risks', async () => {
    await setFeatures({ secincidents: false });
    expect((await t.api.get('/api/security-incidents')).status).toBe(404);
    expect((await t.api.get('/api/meta')).body.resources.security_incident).toBeUndefined();
    expect((await t.api.get('/api/risks')).status).toBe(200);
    expect((await t.api.get('/api/auth/state')).body.areasOff).not.toContain('security');
    await setFeatures({ secincidents: true });
    expect((await t.api.get('/api/security-incidents')).status).toBe(200);
  });

  it('keeps the action tracker when risks and obligations are off', async () => {
    await setFeatures({ risks: false });
    expect((await t.api.get('/api/risks')).body.error.code).toBe('switched_off');
    expect((await t.api.get('/api/obligations')).status).toBe(404);
    expect((await t.api.get('/api/actions')).status).toBe(200);
    expect((await bearer('/api/risks')).statusCode).toBe(404);
    await setFeatures({ risks: true });
    expect((await t.api.get('/api/risks')).status).toBe(200);
  });

  it('refuses inconsistent switches and unknown areas, and audits changes', async () => {
    expect((await setFeatures({ portal: true, tickets: false })).body.error.fields.portal).toMatch(/needs service desk/);
    expect((await setFeatures({ portal: true })).status).toBe(200);
    expect((await setFeatures({ tickets: false })).status).toBe(400);
    expect((await setFeatures({ portal: false, tickets: false })).status).toBe(200);
    expect((await t.api.get('/api/tickets')).status).toBe(404);
    // The portal's own switch cannot bring it back either (its settings need the service desk's permissions).
    expect((await t.api.put('/api/portal/settings', { enabled: true })).status).toBe(403);
    expect((await t.anon.get('/api/auth/state')).body.features.portal).toBe(false);
    expect((await setFeatures({ tickets: true })).status).toBe(200);
    expect((await setFeatures({ teleporter: false })).body.error.fields.features).toMatch(/Unknown/);
    expect((await t.api.patch('/api/admin/settings', { features: { portal: true, tickets: false } })).status).toBe(400);
    const audit = await t.db.one<any>(`select summary from audit_events where action = 'features.change' order by id desc limit 1`);
    expect(audit.summary).toMatch(/Switched on: Service desk/);
  });

  it('needs a recent identity confirmation', async () => {
    await t.db.query('update sessions set confirmed_at = null');
    const r = await setFeatures({ fleet: false });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('reauth_required');
    expect((await t.api.get('/api/vehicles')).status).toBe(200);
  });
});
