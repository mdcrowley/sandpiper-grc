import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.ts';
import { testApp } from '../../test/helpers.ts';
import mod from './index.ts';

// No stand-ins here: the frameworks and risks modules are absent.
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  process.env.GRC_MODULES = 'policies'; // on its own: the guards for absent modules are part of what is tested
  t = await testApp();
});
afterAll(async () => { await t.close(); });

const count = async (sql: string) => (await t.db.one<{ c: number }>(`select count(*)::int c from ${sql}`))!.c;

describe('sample data', () => {
  it('loads invented samples once, however often it runs', async () => {
    const note = await mod.seed!(t.ctx, { profile: 'dev', seedDir: 'none', organisation: {} });
    expect(note).toBe('6 sample policies, 3 sample exceptions (1 marked expired), 6 sample people, 8 sample acknowledgements');
    const again = await mod.seed!(t.ctx, { profile: 'dev', seedDir: 'none', organisation: {} });
    expect(again).toBe('0 sample policies, 0 sample exceptions (0 marked expired)');

    expect(await count(`policies where title like '[Sample] %'`)).toBe(6);
    expect(await count(`policies where title not like '[Sample] %'`)).toBe(0);
    expect(await count('policy_exceptions')).toBe(3);
    expect(await count(`users where username like 'sample.%' and password_hash is null`)).toBe(6);

    const list = (await t.api.get('/api/policies?sort=title')).body.rows;
    expect(list.map((p: any) => p.status)).toEqual(['published', 'published', 'approved', 'in_review', 'draft', 'published']);
    const use = list[0];
    expect(use.current_version).toBe(2);
    const versions = (await t.api.get(`/api/policies/${use.id}/versions`)).body;
    expect(versions.map((v: any) => v.status)).toEqual(['published', 'superseded']);

    // One published policy has acknowledgements partly complete, the rest overdue.
    const track = (await t.api.get(`/api/policies/${use.id}/acknowledgements`)).body;
    expect(track.counts.total).toBe(7); // six sample people and the administrator
    expect(track.counts.acknowledged).toBe(3);
    expect(track.counts.overdue).toBe(4);

    const exceptions = (await t.api.get('/api/exceptions?sort=expires_on')).body.rows;
    expect(exceptions.map((e: any) => e.status)).toEqual(['expired', 'approved', 'requested']);
    const expiring = (await t.api.get('/api/exceptions/expiring?days=30')).body.rows;
    expect(expiring.map((e: any) => e.expired)).toEqual([true, false]);
  });

  it('never invents acknowledgements for real people in the pilot profile', async () => {
    await t.db.query(`delete from policy_acknowledgements; delete from policy_versions;`).catch(async () => {
      await t.db.query('delete from policy_acknowledgements');
      await t.db.query('delete from policy_versions');
    });
    await t.db.query('delete from policy_exceptions');
    await t.db.query('delete from policies');
    await mod.seed!(t.ctx, { profile: 'pilot', seedDir: 'none', organisation: {} });
    expect(await count('policies')).toBe(6);
    expect(await count('policy_acknowledgements where acknowledged_at is not null')).toBe(0);
  });
});

describe('before the first administrator exists', () => {
  it('adds no accounts, so the setup wizard is still offered', async () => {
    const fresh = await buildApp({ dataDir: 'memory', serveWeb: false });
    try {
      const note = await mod.seed!(fresh.ctx, { profile: 'dev', seedDir: 'none', organisation: {} });
      expect(note).toMatch(/sample people skipped until the first administrator exists/);
      expect((await fresh.db.one<{ c: number }>('select count(*)::int c from users'))!.c).toBe(0);
      const state = await fresh.app.inject({ method: 'GET', url: '/api/auth/state' });
      expect(state.json().setupRequired).toBe(true);
      expect((await fresh.db.one<{ c: number }>(`select count(*)::int c from policies where status = 'published'`))!.c).toBe(3);
    } finally {
      await fresh.close();
    }
  });
});

describe('without the other modules', () => {
  it('guards framework outcomes and risks', async () => {
    const policy = (await t.api.get('/api/policies?pageSize=1')).body.rows[0];
    expect((await t.api.get(`/api/policies/${policy.id}/outcomes`)).body).toEqual({ available: false, route: null, rows: [] });
    expect((await t.api.post(`/api/policies/${policy.id}/outcomes`, { outcome_id: policy.id })).body.error.code).toBe('unavailable');
    const res = await t.api.post('/api/exceptions', { title: 'Invented exception', risk_id: policy.id });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.risk_id).toMatch(/not available/);
    expect((await t.api.post('/api/exceptions', { title: 'Invented exception' })).status).toBe(201);
  });
});
