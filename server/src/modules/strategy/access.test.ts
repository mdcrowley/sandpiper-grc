import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';

// Wave 26: the strategy area in data load mode (past plans, quarterly updates and statistics with
// their dates and the people named), its roles, and the area switched off. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
let former = '';
let adminId = '';

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  former = (await t.db.one<{ id: string }>(
    `insert into users (username, email, display_name, status) values ('pplanner', 'p.planner@example.test', 'Pat Planner', 'disabled') returning id`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('data load mode', () => {
  it('loads past plans, updates and statistics with their dates and the people named', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    try {
      const plan = await t.api.post('/api/strategy/plans', {
        title: 'Invented plan 2019 to 2023', period_start: '2019-01-01', period_end: '2023-12-31', status: 'retired', created_at: '2019-02-01T10:00:00Z',
      });
      expect(plan.status, plan.text).toBe(201);
      // A load keeps an adopted plan's missing adoption day missing rather than today.
      const adopted = (await t.api.post('/api/strategy/plans', { title: 'Invented plan 2014', period_start: '2014-01-01', period_end: '2018-12-31', status: 'adopted' })).body;
      expect(adopted.adopted_on).toBeNull();
      expect(plan.body.created_at.slice(0, 10)).toBe('2019-02-01');
      const goal = (await t.api.post('/api/strategy/goals', { plan_id: plan.body.id, title: 'Invented goal' })).body;
      const obj = (await t.api.post('/api/strategy/objectives', { goal_id: goal.id, title: 'Invented objective' })).body;
      const u = await t.api.post('/api/strategy/updates', { objective_id: obj.id, status: 'at_risk', reported_on: '2020-04-08', narrative: 'Invented', on_behalf_of: 'pplanner' });
      expect(u.status, u.text).toBe(201);
      expect(u.body).toMatchObject({ period: '2020-Q2', reported_by: former, reported_by_name: 'Pat Planner' });
      expect(u.body.reported_on.slice(0, 10)).toBe('2020-04-08');
      const series = (await t.api.post('/api/strategy/stat-series', { name: 'Invented revenue miles', frequency: 'yearly' })).body;
      const v = await t.api.post('/api/strategy/stat-values', { series_id: series.id, period: '2020', value: 123456, on_behalf_of: 'pplanner' });
      expect(v.status, v.text).toBe(201);
      expect(v.body).toMatchObject({ entered_by: former, entered_by_name: 'Pat Planner' });
      const m = (await t.api.post('/api/strategy/measures', { objective_id: obj.id, title: 'Invented measure', frequency: 'yearly' })).body;
      const mv = await t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2020', target: 5, actual: 4, on_behalf_of: 'pplanner' });
      expect(mv.body).toMatchObject({ entered_by: former });
      const sub = await t.api.post('/api/strategy/submissions', { report_name: 'Invented annual report', due_on: '2020-10-31', status: 'submitted', submitted_on: '2020-10-20', submitted_by: former });
      expect(sub.body).toMatchObject({ submitted_by: former });
      expect(sub.body.submitted_on.slice(0, 10)).toBe('2020-10-20');
      // Everything created is listed with the load, so it can be undone.
      const loaded = await t.db.query<Row>(`select record_type from data_load_records where record_type like 'strategi%' or record_type in ('strategy_update', 'stat_value')`);
      expect(loaded.length).toBeGreaterThanOrEqual(4);
    } finally {
      await t.api.post('/api/admin/data-load', { on: false });
    }
    // Outside a load, the person signed in.
    const s = (await t.api.post('/api/strategy/stat-series', { name: 'Invented hours', frequency: 'yearly' })).body;
    const v = (await t.api.post('/api/strategy/stat-values', { series_id: s.id, period: '2021', value: 10 })).body;
    expect(v.entered_by).toBe(adminId);
    expect((await t.api.post('/api/strategy/stat-values', { series_id: s.id, period: '2022', value: 10, on_behalf_of: 'pplanner' })).status).toBe(400);
  });
});

describe('roles and the area switch', () => {
  it('lets the analyst work, the executive viewer read, others nothing', async () => {
    const analyst = await t.as('strategy_analyst');
    const plan = await analyst.post('/api/strategy/plans', { title: 'Invented analyst plan', period_start: '2026-01-01', period_end: '2030-12-31' });
    expect(plan.status, plan.text).toBe(201);
    expect((await analyst.put('/api/strategy/settings', { due_soon_days: 45 })).status).toBe(200);
    const viewer = await t.as('executive_viewer');
    expect((await viewer.get(`/api/strategy/plans/${plan.body.id}/scorecard`)).status).toBe(200);
    expect((await viewer.post('/api/strategy/plans', { title: 'No', period_start: '2026-01-01', period_end: '2026-12-31' })).status).toBe(403);
    expect((await viewer.put('/api/strategy/settings', { due_soon_days: 10 })).status).toBe(403);
    // The figures are the same for everyone who may see them.
    expect((await viewer.get('/api/strategy/summary')).body).toEqual((await analyst.get('/api/strategy/summary')).body);
    const agent = await t.as('agent');
    expect((await agent.get('/api/strategy/summary')).status).toBe(403);
    expect((await agent.get('/api/strategy/plans')).status).toBe(403);
  });

  it('is hidden everywhere while its area is off', async () => {
    const p = (await t.api.post('/api/strategy/plans', { title: 'Invented zeppelin plan', period_start: '2026-01-01', period_end: '2026-12-31' })).body;
    expect((await t.api.get('/api/search?q=zeppelin')).body.map((h: Row) => h.id)).toContain(p.id);
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect((await t.api.patch('/api/admin/features', { features: { strategy: false } })).status).toBe(200);
    try {
      expect((await t.api.get('/api/strategy/plans')).status).toBe(404);
      expect((await t.api.get('/api/strategy/summary')).status).toBe(404);
      expect((await t.api.get('/api/search?q=zeppelin')).body).toEqual([]);
      const meta = (await t.api.get('/api/meta')).body;
      expect(meta.resources.strategic_plan).toBeUndefined();
      expect(meta.lookups.strategy_rag).toBeUndefined();
      expect((await t.api.get('/api/metrics')).body.metrics.map((m: Row) => m.key)).not.toContain('strategy.objectives_off_track');
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { strategy: true } })).status).toBe(200);
    }
  });
});
