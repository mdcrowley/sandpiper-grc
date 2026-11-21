import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';
import { invalidateFeatures } from './features.ts';
import { defineMetric, metricsAvailable, monthStartOf } from './metrics.ts';
import type { ModuleDef } from './module.ts';

// The metric registry (wave 10, contract C3): modules offer named monthly figures, readers list them.

const seen: string[] = [];
const probe: ModuleDef = {
  key: 'metricprobe',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists metric_probes (
      id uuid primary key default gen_random_uuid(), name text not null, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    // Its permission module is the service desk's, so switching that area off hides it.
    ctx.defineResource({
      type: 'metric_probe', table: 'metric_probes', module: 'tickets', label: 'Probe', plural: 'Probes',
      path: '/api/metric-probes', route: '/metric-probes', titleField: 'name', restricted: 'flag',
      fields: { name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean', readOnly: true } },
    });
    defineMetric(ctx.app, {
      key: 'probe.created', label: 'Probes created', unit: 'count', recordType: 'metric_probe',
      description: 'Probes created in the month.',
      async compute(c, monthStart) {
        seen.push(monthStart);
        // A figure counts every record, restricted ones included.
        return (await c.db.one<{ n: number }>(
          `select count(*)::int as n from metric_probes where deleted_at is null
           and created_at >= $1::date and created_at < ($1::date + interval '1 month')`, [monthStart]))!.n;
      },
    });
    defineMetric(ctx.app, {
      key: 'probe.always', label: 'Always there', unit: 'percent', description: 'A metric about no record type.',
      async compute() { return 50; },
    });
    defineMetric(ctx.app, {
      key: 'probe.broken', label: 'Broken', unit: 'number', description: 'Fails to compute.',
      async compute() { throw new Error('test failure'); },
    });
  },
};

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp({ extraModules: [probe] }); });
afterAll(async () => { await t.close(); });

describe('metric registry', () => {
  it('refuses a malformed or duplicate key', () => {
    expect(() => defineMetric(t.app, { key: 'Bad key', label: 'x', unit: 'count', description: 'x', compute: async () => 0 })).toThrow(/module/);
    expect(() => defineMetric(t.app, { key: 'probe.always', label: 'x', unit: 'count', description: 'x', compute: async () => 0 })).toThrow(/twice/);
  });

  it('reads a month as its first day', () => {
    expect(monthStartOf('2026-03')).toBe('2026-03-01');
    expect(monthStartOf('2026-03-01')).toBe('2026-03-01');
    expect(monthStartOf('2026-13')).toBeNull();
    expect(monthStartOf('2026-03-15')).toBeNull();
  });

  it('lists the metrics, sorted, without values unless a month is asked for', async () => {
    expect(metricsAvailable(t.app, t.ctx.resources).map((m) => m.key)).toEqual(expect.arrayContaining(['probe.always', 'probe.broken', 'probe.created']));
    const res = await t.api.get('/api/metrics');
    expect(res.status).toBe(200);
    expect(res.body.month).toBeNull();
    const keys = res.body.metrics.map((m: any) => m.key);
    expect(keys).toEqual([...keys].sort());
    const created = res.body.metrics.find((m: any) => m.key === 'probe.created');
    expect(created).toMatchObject({ label: 'Probes created', unit: 'count', recordType: 'metric_probe' });
    expect(created).not.toHaveProperty('value');
  });

  it('computes each value for a month, counting restricted records, and survives a failing metric', async () => {
    await t.ctx.resources.create('metric_probe', { name: 'Open one' });
    const hidden = await t.ctx.resources.create('metric_probe', { name: 'Restricted one' });
    await t.db.query('update metric_probes set restricted = true where id = $1', [hidden.id]);
    const month = (await t.db.one<{ m: string }>(`select to_char(now(), 'YYYY-MM') as m`))!.m;
    const res = await t.api.get(`/api/metrics?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.month).toBe(`${month}-01`);
    const byKey = Object.fromEntries(res.body.metrics.map((m: any) => [m.key, m]));
    expect(byKey['probe.created'].value).toBe(2);
    expect(byKey['probe.always'].value).toBe(50);
    expect(byKey['probe.broken'].value).toBeNull();
    expect(byKey['probe.broken'].error).toBeTruthy();
    expect(seen).toContain(`${month}-01`);
    // The same figure for someone who may view the type but not restricted records.
    const agent = await t.as('agent');
    const theirs = (await agent.get(`/api/metrics?month=${month}`)).body.metrics.find((m: any) => m.key === 'probe.created');
    expect(theirs.value).toBe(2);
  });

  it('refuses a malformed month and needs a signed-in caller', async () => {
    expect((await t.api.get('/api/metrics?month=March')).status).toBe(400);
    expect((await t.anon.get('/api/metrics')).status).toBe(401);
  });

  it('lists a metric about a record type only to people who may view that type', async () => {
    const safety = await t.as('safety_manager'); // holds no service desk permission
    const keys = (await safety.get('/api/metrics')).body.metrics.map((m: any) => m.key);
    expect(keys).toContain('probe.always');
    expect(keys).not.toContain('probe.created');
  });

  it('leaves out a metric whose record type is switched off', async () => {
    // Through the setting itself, so the test does not need the administration module loaded.
    const switchTickets = async (on: boolean) => { await t.ctx.settings.set('features', { tickets: on }); invalidateFeatures(t.db); };
    await switchTickets(false);
    try {
      const keys = (await t.api.get('/api/metrics')).body.metrics.map((m: any) => m.key);
      expect(keys).not.toContain('probe.created');
      expect(keys).toContain('probe.always');
      // Outside a request the registry reads the cached switch state, which the request above refreshed.
      expect(metricsAvailable(t.app, t.ctx.resources).map((m) => m.key)).not.toContain('probe.created');
    } finally {
      await switchTickets(true);
    }
  });
});
