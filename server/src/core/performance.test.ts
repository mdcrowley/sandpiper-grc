import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { isWrite, openDb } from './db.ts';
import { indexedTable } from './search.ts';

// E16-38: fewer statements per request, the Overview's figures kept while nothing is written, and
// record types that are a view searched through the index.

type T = Awaited<ReturnType<typeof testApp>>;

/** Counts the statements run while `fn` runs. */
async function statements(t: T, fn: () => Promise<unknown>): Promise<string[]> {
  const seen: string[] = [];
  // The handle is a plain object: its methods are replaced for the duration and put back.
  const db = t.db as any;
  const saved = { one: db.one, query: db.query };
  db.one = async (sql: string, params?: unknown[]) => { seen.push(sql); return saved.one(sql, params); };
  db.query = async (sql: string, params?: unknown[]) => { seen.push(sql); return saved.query(sql, params); };
  try {
    await fn();
  } finally {
    db.one = saved.one;
    db.query = saved.query;
  }
  return seen;
}

describe('statements per request (E16-38)', () => {
  let t: T;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('reads the session, the person, their permissions and the settings in one statement', async () => {
    await t.api.get('/api/users/options'); // warm: feature switches read, last-seen written
    const seen = await statements(t, () => t.api.get('/api/users/options?q=zz'));
    // One for the session and one for the route itself.
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/from sessions s/);
  });

  it('still ends an idle session, and applies a changed idle time at once', async () => {
    const reader = await t.as('agent');
    expect((await reader.get('/api/users/options')).status).toBe(200);
    await t.db.query(`update sessions set last_seen_at = now() - interval '20 minutes' where user_id = $1`, [reader.userId]);
    expect((await reader.get('/api/users/options')).status).toBe(200); // within the default 30 minutes
    await t.db.query(`update sessions set last_seen_at = now() - interval '20 minutes' where user_id = $1`, [reader.userId]);
    await t.ctx.settings.set('auth.idle_minutes', 15);
    expect((await reader.get('/api/users/options')).status).toBe(401);
    await t.ctx.settings.set('auth.idle_minutes', 30);
  });

  it('refreshes the last-seen time at most once a minute', async () => {
    const reader = await t.as('agent');
    await t.db.query(`update sessions set last_seen_at = now() - interval '2 minutes' where user_id = $1`, [reader.userId]);
    await reader.get('/api/users/options');
    const seen = (await t.db.one<{ s: number }>(`select extract(epoch from now() - last_seen_at)::float8 as s from sessions where user_id = $1`, [reader.userId]))!.s;
    expect(seen).toBeLessThan(5);
    const writes = await statements(t, () => reader.get('/api/users/options'));
    expect(writes.some((s) => /update sessions/.test(s))).toBe(false);
  });

  it('applies a required second factor from the setting read with the session', async () => {
    const agent = await t.as('agent');
    await t.ctx.settings.set('auth.mfa_required_for_all', true);
    await t.ctx.settings.set('auth.mfa_enforcement', 'required');
    try {
      expect((await agent.get('/api/users/options')).body.error.code).toBe('mfa_enrolment_required');
      await t.ctx.settings.set('auth.mfa_enforcement', 'notice');
      expect((await agent.get('/api/users/options')).status).toBe(200);
    } finally {
      await t.ctx.settings.set('auth.mfa_required_for_all', false);
      await t.ctx.settings.set('auth.mfa_enforcement', 'notice');
    }
  });

  it('refuses a disabled person at once', async () => {
    const agent = await t.as('agent');
    expect((await agent.get('/api/users/options')).status).toBe(200);
    await t.db.query(`update users set status = 'disabled' where id = $1`, [agent.userId]);
    expect((await agent.get('/api/users/options')).status).toBe(401);
  });
});

describe('write generation (E16-38)', () => {
  it('counts changed rows only, scripts, and the end of every transaction', async () => {
    const db = await openDb('memory');
    try {
      await db.exec('create table g (id int primary key, v text)');
      const start = db.generation!();
      await db.query('select 1');
      expect(db.generation!()).toBe(start);
      await db.query(`update g set v = 'x' where id = 1`); // no row changed
      expect(db.generation!()).toBe(start);
      await db.query(`insert into g values (1, 'a')`);
      expect(db.generation!()).toBe(start + 1);
      await db.one(`with x as (update g set v = 'b' where id = 1 returning id) select count(*) from x`);
      expect(db.generation!()).toBe(start + 2);
      await db.tx(async (tx) => { await tx.query('select 1'); });
      expect(db.generation!()).toBe(start + 3);
    } finally {
      await db.close();
    }
  });

  it('tells writes from reads', () => {
    expect(isWrite('insert into a values (1)')).toBe(true);
    expect(isWrite('  UPDATE a set b = 1')).toBe(true);
    expect(isWrite('with x as (delete from a returning id) select 1')).toBe(true);
    expect(isWrite('select updated_at from a')).toBe(false);
    expect(isWrite('with x as (select 1) select updated_at, deleted_at from a')).toBe(false);
  });
});

describe('figures cache (E16-38)', () => {
  let t: T;
  const env = process.env.GRC_FIGURES_CACHE_SECONDS;
  beforeAll(async () => {
    process.env.GRC_FIGURES_CACHE_SECONDS = '30';
    t = await testApp();
  });
  afterAll(async () => {
    await t.close();
    if (env === undefined) delete process.env.GRC_FIGURES_CACHE_SECONDS; else process.env.GRC_FIGURES_CACHE_SECONDS = env;
  });
  afterEach(() => { vi.useRealTimers(); });

  const routeStatements = (seen: string[]) => seen.filter((s) => !/from sessions s/.test(s));

  it('answers again from the cache while nothing is written, and at once after a write', async () => {
    const first = await t.api.get('/api/actions/summary');
    expect(first.status).toBe(200);
    const again = await statements(t, async () => expect((await t.api.get('/api/actions/summary')).body).toEqual(first.body));
    expect(routeStatements(again)).toEqual([]);
    expect((await t.api.post('/api/actions', { title: 'Counted at once', source: 'other' })).status).toBeLessThan(300);
    expect((await t.api.get('/api/actions/summary')).body.open).toBe(first.body.open + 1);
  });

  it('keeps one answer per set of permissions, and the same figures for everyone', async () => {
    const lead = await t.as('security_lead');
    const agent = await t.as('agent');
    const a = await lead.get('/api/vulnerabilities/summary');
    expect(a.status).toBe(200);
    // Someone without the permission is still refused, whatever is kept.
    expect((await agent.get('/api/vulnerabilities/summary')).status).toBe(403);
    // The administrator holds other permissions: computed for them, with the same figures.
    const admin = await t.api.get('/api/vulnerabilities/summary');
    expect(admin.body.open ?? admin.body).toEqual(a.body.open ?? a.body);
  });

  it('keeps per person the figures that hold the caller\'s own counts', async () => {
    const one = await t.as('security_lead');
    const two = await t.as('security_lead');
    await one.post('/api/actions', { title: 'Mine only', source: 'other', owner_id: one.userId });
    expect((await one.get('/api/actions/summary')).body.mine.open).toBe(1);
    expect((await two.get('/api/actions/summary')).body.mine.open).toBe(0);
  });

  it('expires by time even with nothing written', async () => {
    await t.api.get('/api/risks/summary');
    const kept = await statements(t, () => t.api.get('/api/risks/summary'));
    expect(routeStatements(kept)).toEqual([]);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 31_000 });
    const after = await statements(t, () => t.api.get('/api/risks/summary'));
    expect(routeStatements(after).length).toBeGreaterThan(0);
  });

  it('computes once for callers asking at the same moment', async () => {
    await t.api.post('/api/actions', { title: 'Changes the figures', source: 'other' });
    const alone = routeStatements(await statements(t, () => t.api.get('/api/risks/summary')));
    expect(alone.length).toBeGreaterThan(0);
    await t.api.post('/api/actions', { title: 'Changes them again', source: 'other' });
    const together = await statements(t, () => Promise.all(Array.from({ length: 5 }, () => t.api.get('/api/risks/summary'))));
    expect(routeStatements(together)).toHaveLength(alone.length);
  });

  it('answers 404 for a switched-off area even when its figures were kept', async () => {
    expect((await t.api.get('/api/vulnerabilities/summary')).status).toBe(200);
    await t.ctx.settings.set('features', { vulnerabilities: false });
    try {
      expect((await t.api.get('/api/vulnerabilities/summary')).status).toBe(404);
    } finally {
      await t.ctx.settings.set('features', { vulnerabilities: true });
    }
    expect((await t.api.get('/api/vulnerabilities/summary')).status).toBe(200);
  });
});

describe('a record type that is a view is searched through the index (E16-38)', () => {
  let t: T;
  beforeAll(async () => { t = await testApp(); });
  afterAll(async () => { await t.close(); });

  it('indexes vulnerabilities through their table and finds them by word and by part of a word', async () => {
    expect(t.core.resources.ftsTypes.has('vulnerability')).toBe(true);
    const def = t.core.resources.registry.get('vulnerability')!;
    expect(await indexedTable(t.db, def, false)).toBe('vulnerabilities');
    const made = await t.api.post('/api/vulnerabilities', { title: 'Outdated firmware on depot gateways', severity: 'high', host_name: 'gw-depot-07' });
    expect(made.status).toBeLessThan(300);
    const meta = (await t.api.get('/api/meta')).body;
    expect(meta.resources.vulnerability.search).toBe('fulltext');
    expect((await t.api.get('/api/vulnerabilities?q=gateway')).body.rows.map((r: any) => r.id)).toContain(made.body.id);
    expect((await t.api.get('/api/vulnerabilities?q=depot-07')).body.rows.map((r: any) => r.id)).toContain(made.body.id);
    const found = (await t.api.get('/api/search?q=gateways')).body;
    expect(found.some((r: any) => r.type === 'vulnerability' && r.id === made.body.id)).toBe(true);
    // A change through the view reaches the index.
    await t.api.patch(`/api/vulnerabilities/${made.body.id}`, { title: 'Expired certificate on depot gateways' });
    expect((await t.api.get('/api/vulnerabilities?q=certificate')).body.rows.map((r: any) => r.id)).toContain(made.body.id);
  });
});
