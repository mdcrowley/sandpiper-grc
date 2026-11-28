import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// Wave 26 (E46): where every safety indicator stands (latest complete month, trend, sparkline) and the
// safety plan as the safety pages show it. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const month = (offset: number) => {
  const [y, m] = dayInZone().slice(0, 7).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

beforeAll(async () => { t = await testApp(); }, 60_000);
afterAll(async () => { await t?.close(); });

describe('indicator status', () => {
  it('judges the latest complete month, never the month to date, and gives the trend', async () => {
    const id = (await t.api.post('/api/safety-indicators', { name: 'Invented depot walk-rounds', measure: 'manual', target: 10, target_direction: 'at_least' })).body.id;
    expect((await t.api.put(`/api/safety-indicators/${id}/values/${month(-2)}`, { value: 12 })).status).toBe(200);
    expect((await t.api.put(`/api/safety-indicators/${id}/values/${month(-1)}`, { value: 8 })).status).toBe(200);
    expect((await t.api.put(`/api/safety-indicators/${id}/values/${month(0)}`, { value: 1 })).status).toBe(200);
    const low = (await t.api.post('/api/safety-indicators', { name: 'Invented slips reported', measure: 'manual', target: 5, target_direction: 'at_most' })).body.id;
    await t.api.put(`/api/safety-indicators/${low}/values/${month(-2)}`, { value: 6 });
    await t.api.put(`/api/safety-indicators/${low}/values/${month(-1)}`, { value: 3 });
    const res = await t.api.get('/api/safety/indicator-status');
    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: Row) => r.id === id);
    expect(row.latest).toMatchObject({ period: month(-1), value: 8, met: false });
    expect(row.previous).toEqual({ period: month(-2), value: 12 });
    expect(row.direction).toBe('worse');
    expect(row.month_to_date).toEqual({ period: month(0), value: 1 });
    expect(row.spark).toHaveLength(12);
    expect(row.spark.at(-1)).toBe(8);
    const other = res.body.rows.find((r: Row) => r.id === low);
    expect(other.latest.met).toBe(true);
    expect(other.direction).toBe('better');
    expect(res.body.off_target).toBeGreaterThanOrEqual(1);
    const none = await t.as('project_manager');
    expect((await none.get('/api/safety/indicator-status')).status).toBe(403);
  });
});

describe('the safety plan', () => {
  it('shows plans titled with safety until an administrator chooses, with the review state', async () => {
    const plan = await t.api.post('/api/policies', { title: 'Invented agency safety plan', document_type: 'plan', review_date: '2020-01-31' });
    expect(plan.status, JSON.stringify(plan.body)).toBe(201);
    const other = await t.api.post('/api/policies', { title: 'Invented emergency operations plan', document_type: 'plan' });
    await t.api.post('/api/policies', { title: 'Invented safety policy', document_type: 'policy' });
    let res = await t.api.get('/api/safety/plans');
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(true);
    expect(res.body.chosen).toBe(false);
    expect(res.body.plans.map((p: Row) => p.title)).toEqual(['Invented agency safety plan']);
    expect(res.body.plans[0]).toMatchObject({ review_overdue: true, review_running: false, elements: 0 });
    expect(res.body.candidates.map((p: Row) => p.title)).toContain('Invented emergency operations plan');

    expect((await t.api.put('/api/safety/plans', { plan_ids: ['not-an-id'] })).status).toBe(400);
    const policyOnly = (await t.api.get('/api/policies?q=Invented%20safety%20policy')).body.rows[0].id;
    expect((await t.api.put('/api/safety/plans', { plan_ids: [policyOnly] })).status).toBe(400);
    expect((await t.api.put('/api/safety/plans', { plan_ids: [other.body.id] })).status).toBe(200);
    res = await t.api.get('/api/safety/plans');
    expect(res.body.chosen).toBe(true);
    expect(res.body.plans.map((p: Row) => p.title)).toEqual(['Invented emergency operations plan']);

    const role = (await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ('t_safety_view','t','test',true) returning id`))!.id;
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'safety.view')`, [role]);
    const safety = await t.as('t_safety_view');
    const seen = await safety.get('/api/safety/plans');
    expect(seen.status).toBe(200);
    expect(seen.body.candidates).toEqual([]);
    expect((await safety.put('/api/safety/plans', { plan_ids: [] })).status).toBe(403);
    expect((await t.api.put('/api/safety/plans', { plan_ids: [] })).status).toBe(200);
  });
});
