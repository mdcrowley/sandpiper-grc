import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleDef } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { monthsBack } from './indicators.ts';

// E25-07 to E25-10: indicators entered by hand, computed from a metric (a stand-in metric here),
// measured as distance between failures, and yearly targets with approval. Everything is invented.
// GRC_MODULES=safety,risks,notifications,workflows (or all).

const standIn: ModuleDef = {
  key: 'standin_metrics',
  async register(ctx) {
    defineMetric(ctx.app, {
      key: 'standin.widgets', label: 'Invented widgets', unit: 'count', description: 'A stand-in figure: the month number.',
      compute: async (_ctx, monthStart) => Number(monthStart.slice(5, 7)),
    });
  },
};

const workflows = !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes('workflows');
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let editor: Client; // safety.view and edit, cannot approve
let approver: Client;

async function withGrants(key: string, grants: string[]) {
  const role = await t.db.one<{ id: string }>(`insert into roles (key, name, description, enabled) values ($1,$1,'test',true) returning id`, [key]);
  for (const g of grants) await t.db.query('insert into role_permissions (role_id, permission) values ($1,$2)', [role!.id, g]);
  return t.as(key);
}
const thisMonth = () => dayInZone().slice(0, 7);
const year = () => Number(dayInZone().slice(0, 4));

beforeAll(async () => {
  t = await testApp({ extraModules: [standIn] });
  editor = await withGrants('e25_ind_editor', ['safety.view', 'safety.create', 'safety.edit']);
  approver = await withGrants('e25_ind_approver', ['safety.view', 'safety.approve']);
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('manual indicators', () => {
  let id = '';
  it('takes a value per month, refuses negatives and future months', async () => {
    id = (await editor.post('/api/safety-indicators', { name: 'Test inspections done', measure: 'manual', target: 10, target_direction: 'at_least' })).body.id;
    const p = thisMonth();
    expect((await editor.put(`/api/safety-indicators/${id}/values/${p}`, { value: -1 })).body.error.fields.value).toBeDefined();
    expect((await editor.put(`/api/safety-indicators/${id}/values/2999-01`, { value: 1 })).body.error.fields.period).toMatch(/future/);
    expect((await editor.put(`/api/safety-indicators/${id}/values/${p}`, { value: 12, note: 'Invented' })).status).toBe(200);
    const trend = (await editor.get(`/api/safety-indicators/${id}/trend`)).body.points;
    // The month is not over: month to date, not judged against the target (E18-79).
    expect(trend.at(-1)).toMatchObject({ period: p, value: 12, target: 10, met: null, partial: true });
    expect((await editor.get(`/api/safety-indicators/${id}/values`)).body[0]).toMatchObject({ period: p, value: 12 });
    // Emptying removes it.
    await editor.put(`/api/safety-indicators/${id}/values/${p}`, { value: null });
    expect((await editor.get(`/api/safety-indicators/${id}/trend`)).body.points.at(-1).value).toBeNull();
  });

  it('refuses values for an indicator that is not measured by hand', async () => {
    const other = (await editor.post('/api/safety-indicators', { name: 'Test count', measure: 'count' })).body.id;
    expect((await editor.put(`/api/safety-indicators/${other}/values/${thisMonth()}`, { value: 1 })).status).toBe(409);
  });
});

describe('the month to date (E18-79)', () => {
  it('is never judged against the target, and the dashboard shows the last complete month', async () => {
    const [last, now] = monthsBack(2);
    const id = (await editor.post('/api/safety-indicators', { name: 'Test month to date', measure: 'manual', target: 10, target_direction: 'at_least', active: true })).body.id;
    expect((await editor.put(`/api/safety-indicators/${id}/values/${last}`, { value: 12 })).status).toBe(200);
    expect((await editor.put(`/api/safety-indicators/${id}/values/${now}`, { value: 1 })).status).toBe(200);
    const pts = (await editor.get(`/api/safety-indicators/${id}/trend?months=2`)).body.points;
    expect(pts[0]).toMatchObject({ period: last, value: 12, met: true, partial: false });
    expect(pts[1]).toMatchObject({ period: now, value: 1, met: null, partial: true });
    const shown = (await editor.get('/api/safety/summary')).body.indicators.find((i: any) => i.id === id);
    expect(shown.latest).toMatchObject({ period: last, value: 12, met: true });
  });
});

describe('computed indicators', () => {
  it('lists the metric and works the indicator out from it', async () => {
    const metrics = (await editor.get('/api/metrics')).body.metrics;
    expect(metrics.some((m: any) => m.key === 'standin.widgets')).toBe(true);
    expect((await editor.post('/api/safety-indicators', { name: 'Test computed', measure: 'computed' })).body.error.fields.metric_key).toBeDefined();
    expect((await editor.post('/api/safety-indicators', { name: 'Test computed', measure: 'computed', metric_key: 'nope.none' })).body.error.fields.metric_key).toMatch(/not available/);
    const id = (await editor.post('/api/safety-indicators', { name: 'Test computed', measure: 'computed', metric_key: 'standin.widgets', target: 6 })).body.id;
    const pts = (await editor.get(`/api/safety-indicators/${id}/trend?months=12`)).body.points;
    expect(pts.map((p: any) => p.value)).toEqual(monthsBack(12).map((p) => Number(p.slice(5))));
    // At most 6 (the default direction): judged on every complete month; the month to date is not judged (E18-79).
    for (const p of pts) expect(p.met).toBe(p.partial ? null : p.value <= 6);
    expect(pts.filter((p: any) => p.partial).map((p: any) => p.period)).toEqual([thisMonth()]);
  });
});

describe('distance between failures', () => {
  it('divides revenue miles by major failures from the exposure', async () => {
    const p = thisMonth();
    expect((await editor.put('/api/safety/exposure', { period: p, revenue_miles: 50000, major_failures: 1.5 })).body.error.fields.major_failures).toBeDefined();
    expect((await editor.put('/api/safety/exposure', { period: p, revenue_miles: 50000, major_failures: 4 })).status).toBe(200);
    const id = (await editor.post('/api/safety-indicators', { name: 'Test miles between failures', measure: 'distance_between', target: 10000, target_direction: 'at_least' })).body.id;
    const last = (await editor.get(`/api/safety-indicators/${id}/trend`)).body.points.at(-1);
    expect(last).toMatchObject({ value: 12500, events: 4, exposure: 50000, met: null, partial: true });
    expect((await editor.get('/api/safety/exposure')).body.rows.find((r: any) => r.period === p)).toMatchObject({ revenue_miles: 50000, major_failures: 4 });
  });
});

describe('yearly targets', () => {
  let id = '';
  beforeAll(async () => {
    id = (await editor.post('/api/safety-indicators', { name: 'Test targets', measure: 'manual', target: 50, target_direction: 'at_most' })).body.id;
    await editor.put(`/api/safety-indicators/${id}/values/${thisMonth()}`, { value: 30 });
  });

  it('proposes a target for the year, which then applies in place of the indicator\'s own', async () => {
    expect((await editor.post(`/api/safety-indicators/${id}/targets`, { year: 1999, target: 1 })).body.error.fields.year).toBeDefined();
    expect((await editor.post(`/api/safety-indicators/${id}/targets`, { year: year(), target: -1 })).body.error.fields.target).toBeDefined();
    const res = await editor.post(`/api/safety-indicators/${id}/targets`, { year: year(), target: 20, direction: 'at_most' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ year: year(), target: 20, status: 'proposed' });
    expect((await editor.post(`/api/safety-indicators/${id}/targets`, { year: year(), target: 5 })).status).toBe(409);
    expect((await editor.get(`/api/safety-indicators/${id}/trend`)).body.points.at(-1)).toMatchObject({ target: 20, met: null, partial: true });
  });

  it('records a decision taken outside, only for people who may approve', async () => {
    const body = { approved_by_name: 'Invented safety committee', approved_on: dayInZone(-1), approval_ref: 'Invented meeting, item 4' };
    expect((await editor.post(`/api/safety-indicators/${id}/targets/${year()}/decision`, body)).status).toBe(403);
    expect((await approver.post(`/api/safety-indicators/${id}/targets/${year()}/decision`, { ...body, approved_on: '2999-01-01' })).body.error.fields.approved_on).toBeDefined();
    const res = await approver.post(`/api/safety-indicators/${id}/targets/${year()}/decision`, body);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved', approved_by_name: 'Invented safety committee', approval_ref: 'Invented meeting, item 4' });
    // A changed figure needs approval again; an approved target can be removed only by an approver.
    expect((await editor.patch(`/api/safety-indicators/${id}/targets/${year()}`, { target: 25 })).body.status).toBe('proposed');
    await approver.post(`/api/safety-indicators/${id}/targets/${year()}/decision`, body);
    expect((await editor.del(`/api/safety-indicators/${id}/targets/${year()}`)).status).toBe(403);
  });

  describe.runIf(workflows)('through the approval workflow', () => {
    it('installs the default workflow and approves a year\'s target', async () => {
      const defs = (await t.api.get('/api/workflows/definitions?record_type=safety_indicator')).body.rows.filter((d: any) => d.kind === 'safety_targets');
      expect(defs).toHaveLength(1);
      const next = year() + 1;
      await editor.post(`/api/safety-indicators/${id}/targets`, { year: next, target: 15 });
      const res = await editor.post(`/api/safety-indicators/${id}/targets/${next}/approval`, {});
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.target.status).toBe('pending_approval');
      expect((await editor.post(`/api/safety-indicators/${id}/targets/${next}/approval`, {})).status).toBe(409);
      expect((await editor.patch(`/api/safety-indicators/${id}/targets/${next}`, { target: 1 })).status).toBe(409);
      const item = ((await approver.get('/api/workflows/approvals')).body.rows as any[]).find((a) => a.record_id === id);
      expect(item).toMatchObject({ kind: 'safety_targets' });
      const decided = await approver.post(`/api/workflows/steps/${item.step_id}/decision`, { decision: 'approved' });
      expect(decided.status, JSON.stringify(decided.body)).toBe(200);
      const target = (await editor.get(`/api/safety-indicators/${id}/targets`)).body.targets.find((x: any) => x.year === next);
      expect(target).toMatchObject({ status: 'approved', approval_ref: 'Approval workflow "Safety performance targets"' });
    });
  });
});
