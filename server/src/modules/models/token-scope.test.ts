import type { FastifyRequest } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { issueToken } from '../../core/tokens.ts';
import { testApp } from '../../test/helpers.ts';

// E40-13: a background change of a model saved with an access token works within that token's
// scopes, not with the person's full permissions, and stops when the token is revoked first.
// Every name and value is invented.
let t: Awaited<ReturnType<typeof testApp>>;
type Row = Record<string, any>;
let userId = '';
let vm: Row;
let members: Row[] = [];
const runJobs = () => t.app.jobs.runDue({ types: ['fleet.model_apply'] });

async function withToken(scopes: string[]) {
  const { row, token } = await issueToken(t.db, { userId, name: `Invented integration ${scopes.join(' ')}`, scopes, expires: new Date(Date.now() + 86_400_000) });
  const patch = async (url: string, body: Row) => {
    const res = await t.app.inject({ method: 'PATCH', url, headers: { authorization: `Bearer ${token}` }, payload: body });
    return { status: res.statusCode, body: res.json() };
  };
  return { id: row.id as string, patch };
}

beforeAll(async () => {
  t = await testApp();
  const r = await t.db.one<{ id: string }>(`insert into roles (key, name, enabled) values ('e40_fleet_lead', 'Fleet lead', true) returning id`);
  // Everything in fleet, sites and assets; the tokens below carry only part of it.
  for (const g of ['fleet.*', 'sites.view', 'assets.view']) await t.db.query('insert into role_permissions (role_id, permission) values ($1, $2)', [r!.id, g]);
  const lead = await t.as('e40_fleet_lead');
  userId = lead.userId;
  const depot = (await t.api.post('/api/sites', { name: 'Invented Curlew Depot' })).body.id;
  vm = (await lead.post('/api/vehicle-models', { name: 'Invented Curlew 12', mode: 'bus', make: 'Curlew' })).body;
  for (let i = 0; i < 3; i++) members.push((await lead.post('/api/vehicles', { fleet_number: `TS-${i}`, depot_id: depot, model_id: vm.id })).body);
  expect(members.every((m) => m.id)).toBe(true);
  await t.ctx.settings.set('models.background_after', 1);
}, 120_000);
afterAll(async () => { await t?.close(); });

describe('a background model change saved with an access token (E40-13)', () => {
  it('records the token with the change, saves each member within its scopes, and names it in the audit', async () => {
    const tok = await withToken(['fleet.view', 'fleet.edit']);
    const saved = await tok.patch(`/api/vehicle-models/${vm.id}`, { make: 'Curlew Coachworks' });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body._model_change).toMatchObject({ status: 'queued', total: 3 });
    expect(await t.db.one<Row>('select via_token_id, via_token_scopes from model_changes where id = $1', [saved.body._model_change.id]))
      .toMatchObject({ via_token_id: tok.id, via_token_scopes: ['fleet.view', 'fleet.edit'] });

    const seen: string[][] = [];
    const spy = vi.spyOn(t.app.lifecycles, 'check').mockImplementation(async (_def, _existing, _data, req: FastifyRequest | null) => {
      if (req?.user) seen.push([...req.user.permissions].sort());
      return {};
    });
    try {
      await runJobs();
    } finally {
      spy.mockRestore();
    }
    const change = (await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved.body._model_change.id}`)).body;
    expect(change).toMatchObject({ status: 'done', applied: 3 });
    // The person holds fleet.*, sites.view and assets.view; the members were saved with the token's two.
    expect(seen.length).toBeGreaterThan(0);
    for (const perms of seen) expect(perms).toEqual(['fleet.edit', 'fleet.view']);
    const audit = await t.db.one<Row>(`select actor_id, token_id, token_name from audit_events where record_type = 'vehicle' and record_id = $1 order by id desc limit 1`, [members[0].id]);
    expect(audit).toMatchObject({ actor_id: userId, token_id: tok.id });
  });

  it('stops, changing nothing, when the token was revoked before the change ran', async () => {
    const tok = await withToken(['fleet.view', 'fleet.edit']);
    const saved = await tok.patch(`/api/vehicle-models/${vm.id}`, { make: 'Curlew After Revoking' });
    expect(saved.status).toBe(200);
    await t.db.query('update api_tokens set revoked_at = now() where id = $1', [tok.id]);
    await runJobs();
    const change = (await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved.body._model_change.id}`)).body;
    expect(change).toMatchObject({ status: 'stopped', applied: 0 });
    expect(change.reason).toMatch(/access token/);
    expect((await t.db.one<Row>('select make from vehicles where id = $1', [members[0].id]))!.make).not.toBe('Curlew After Revoking');
  });

  it('stops when the token\'s scopes do not include editing the area, even though the person may', async () => {
    const tok = await withToken(['fleet.view', 'fleet.edit']);
    const saved = await tok.patch(`/api/vehicle-models/${vm.id}`, { make: 'Curlew Narrowed' });
    expect(saved.status).toBe(200);
    // As if the token had been issued with less (scopes are recorded with the change).
    await t.db.query(`update model_changes set via_token_scopes = '["fleet.view"]'::jsonb where id = $1`, [saved.body._model_change.id]);
    await runJobs();
    expect((await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved.body._model_change.id}`)).body).toMatchObject({ status: 'stopped', applied: 0 });
  });

  it('a change saved in a browser session still works with the person\'s own permissions', async () => {
    const lead = await t.as('e40_fleet_lead');
    const saved = (await lead.patch(`/api/vehicle-models/${vm.id}`, { make: 'Curlew Session' })).body;
    expect(await t.db.one<Row>('select via_token_id, via_token_scopes from model_changes where id = $1', [saved._model_change.id])).toMatchObject({ via_token_id: null, via_token_scopes: null });
    await runJobs();
    expect((await t.api.get(`/api/vehicle-models/${vm.id}/changes/${saved._model_change.id}`)).body).toMatchObject({ status: 'done', applied: 3 });
  });
});
