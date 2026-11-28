import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { describeFiscalYear, frequencyOf, normalizePeriod, periodLabel, periodRange, periodSpan, quarterOf, quartersBetween, yearsBetween, type FiscalYear } from './periods.ts';

// Wave 27: fiscal-year quarters (E46-58), measures from statistics series (E46-59) and the dashboard
// widget for one measure (E46-60). Invented data only.

const JULY: FiscalYear = { startMonth: 7, namedFor: 'end' };
const OCT_START: FiscalYear = { startMonth: 10, namedFor: 'start' };

describe('periods on a fiscal year', () => {
  it('names years and quarters after the fiscal year, and keeps calendar keys as they are', () => {
    expect(normalizePeriod('quarterly', '2026-07-15', JULY)).toBe('FY2027-Q1');
    expect(normalizePeriod('quarterly', '2027-02-01', JULY)).toBe('FY2027-Q3');
    expect(normalizePeriod('quarterly', '2027-06-30', JULY)).toBe('FY2027-Q4');
    expect(normalizePeriod('yearly', '2026-06-30', JULY)).toBe('FY2026');
    expect(normalizePeriod('yearly', '2026-07-01', JULY)).toBe('FY2027');
    expect(normalizePeriod('quarterly', 'fy2027 q2', JULY)).toBe('FY2027-Q2');
    expect(normalizePeriod('quarterly', 'Q2 FY2027', JULY)).toBe('FY2027-Q2');
    // On a fiscal year a plain quarter or year is the fiscal one.
    expect(normalizePeriod('quarterly', '2027-Q1', JULY)).toBe('FY2027-Q1');
    expect(normalizePeriod('yearly', '2027', JULY)).toBe('FY2027');
    expect(normalizePeriod('monthly', '2026-07-15', JULY)).toBe('2026-07');
    // On the calendar year an FY key is that calendar year.
    expect(normalizePeriod('quarterly', 'FY2026-Q3')).toBe('2026-Q3');
    // Named after the year it starts in.
    expect(normalizePeriod('quarterly', '2026-11-05', OCT_START)).toBe('FY2026-Q1');
    expect(normalizePeriod('yearly', '2027-09-30', OCT_START)).toBe('FY2026');
    expect(frequencyOf('FY2027-Q1')).toBe('quarterly');
    expect(frequencyOf('FY2027')).toBe('yearly');
  });

  it('works out their days, labels and spans', () => {
    expect(periodRange('FY2027', JULY)).toEqual({ start: '2026-07-01', end: '2027-06-30' });
    expect(periodRange('FY2027-Q3', JULY)).toEqual({ start: '2027-01-01', end: '2027-03-31' });
    expect(periodRange('FY2026-Q1', OCT_START)).toEqual({ start: '2026-10-01', end: '2026-12-31' });
    expect(periodRange('FY2025-Q2', { startMonth: 2, namedFor: 'end' })).toEqual({ start: '2024-05-01', end: '2024-07-31' });
    // Calendar keys never move.
    expect(periodRange('2026-Q1', JULY)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(periodLabel('FY2027-Q1')).toBe('FY2027 Q1');
    expect(periodLabel('FY2027')).toBe('FY2027');
    expect(periodSpan('FY2027-Q1', JULY)).toBe('July to September 2026');
    expect(periodSpan('FY2027', JULY)).toBe('July 2026 to June 2027');
    expect(quarterOf('2026-12-31', JULY)).toBe('FY2027-Q2');
    expect(quartersBetween('2026-05-01', '2026-12-01', JULY)).toEqual(['FY2026-Q4', 'FY2027-Q1', 'FY2027-Q2']);
    expect(quartersBetween('2025-11-02', '2026-04-01')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(yearsBetween('2025-01-01', '2027-12-31', JULY)).toEqual(['FY2025', 'FY2026', 'FY2027', 'FY2028']);
    expect(describeFiscalYear(JULY)).toMatch(/^July to June, named after the calendar year it ends in/);
    expect(describeFiscalYear({ startMonth: 1, namedFor: 'end' })).toMatch(/calendar year/);
  });
});

let t: Awaited<ReturnType<typeof testApp>>;
const ok = async (p: Promise<{ status: number; body: any; text: string }>, status = 201) => {
  const r = await p;
  expect(r.status, r.text).toBe(status);
  return r.body;
};
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await testApp();
  ids.plan = (await ok(t.api.post('/api/strategy/plans', { title: 'Invented fiscal plan', period_start: '2025-07-01', period_end: '2029-06-30', status: 'adopted' }))).id;
  ids.goal = (await ok(t.api.post('/api/strategy/goals', { plan_id: ids.plan, code: 'G1', title: 'Invented goal' }))).id;
  ids.objective = (await ok(t.api.post('/api/strategy/objectives', { goal_id: ids.goal, code: '1.1', title: 'Invented objective' }))).id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('the fiscal year setting', () => {
  it('starts on the calendar year and validates what is given', async () => {
    const s = (await t.api.get('/api/strategy/settings')).body;
    expect(s).toMatchObject({ fiscal_year_start_month: 1, fiscal_year_named_for: 'end', fiscal_periods_in_use: 0 });
    const bad = await t.api.put('/api/strategy/settings', { fiscal_year_start_month: 13, fiscal_year_named_for: 'middle' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['fiscal_year_named_for', 'fiscal_year_start_month']);
  });

  it('keeps calendar periods entered before it is set, and puts new ones on the fiscal year', async () => {
    const m = await ok(t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'Invented on-time running', frequency: 'quarterly', direction: 'increase' }));
    ids.measure = m.id;
    // Entered on the calendar year.
    await ok(t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2026-Q1', target: 80, actual: 81 }));
    ids.calUpdate = (await ok(t.api.post('/api/strategy/updates', { objective_id: ids.objective, period: '2026-Q1', status: 'at_risk' }))).id;
    const set = await ok(t.api.put('/api/strategy/settings', { fiscal_year_start_month: 7, fiscal_year_named_for: 'end' }), 200);
    expect(set.fiscal_year_text).toMatch(/^July to June/);
    // A date gives the fiscal quarter, and the calendar value is untouched.
    const v = await ok(t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2026-08-14', target: 82, actual: 84 }));
    expect(v).toMatchObject({ period: 'FY2027-Q1', state: 'met' });
    expect(v.period_start.slice(0, 10)).toBe('2026-07-01');
    const cal = (await t.api.get(`/api/strategy/measure-values?f.measure_id=${m.id}&sort=period_start&dir=asc`)).body.rows;
    expect(cal.map((r: Row) => r.period)).toEqual(['2026-Q1', 'FY2027-Q1']);
    // Saving the calendar value as it is keeps its period.
    const kept = await ok(t.api.patch(`/api/strategy/measure-values/${cal[0].id}`, { period: '2026-Q1', target: 79 }), 200);
    expect(kept.period).toBe('2026-Q1');
    // The same days under the other kind of year are the same period.
    expect((await t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2026-Q3', target: 1 })).body.error.fields.period).toMatch(/already/);
    expect((await t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2026', target: 1 })).body.error.fields.period).toMatch(/FYYYYY-Q1/);
    // The latest actual is worked out by date, whatever the key.
    expect((await t.api.get(`/api/strategy/measures/${m.id}`)).body).toMatchObject({ latest_period: 'FY2027-Q1', latest_state: 'met' });
  });

  it('orders updates by date and shows calendar updates in the fiscal matrix', async () => {
    const u = await ok(t.api.post('/api/strategy/updates', { objective_id: ids.objective, status: 'on_track', reported_on: '2026-10-10' }));
    expect(u.period).toBe('FY2027-Q2');
    expect(u.period_start.slice(0, 10)).toBe('2026-10-01');
    expect((await t.api.get(`/api/strategy/objectives/${ids.objective}`)).body).toMatchObject({ status: 'on_track', status_period: 'FY2027-Q2' });
    const grid = await ok(t.api.get(`/api/strategy/plans/${ids.plan}/matrix?year=FY2026`), 200);
    expect(grid.quarters).toEqual(['FY2026-Q1', 'FY2026-Q2', 'FY2026-Q3', 'FY2026-Q4']);
    expect(grid.spans['FY2026-Q3']).toBe('January to March 2026');
    expect(grid.years.map((y: Row) => y.key)).toEqual(['FY2026', 'FY2027', 'FY2028', 'FY2029']);
    expect(grid.fiscal_year).toEqual({ start_month: 7, named_for: 'end' });
    const row = grid.rows.find((r: Row) => r.id === ids.objective);
    // The calendar 2026-Q1 update is January to March: fiscal Q3 of FY2026.
    expect(row.cells['FY2026-Q3']).toMatchObject({ status: 'at_risk', period: '2026-Q1' });
    expect(row.cells['FY2026-Q1']).toBeNull();
    const next = await ok(t.api.get(`/api/strategy/plans/${ids.plan}/matrix?year=FY2027`), 200);
    expect(next.rows.find((r: Row) => r.id === ids.objective).cells['FY2027-Q2']).toMatchObject({ status: 'on_track' });
    // The board PDF follows.
    expect((await t.api.get(`/api/strategy/plans/${ids.plan}/scorecard.pdf`)).status).toBe(200);
  });

  it('cannot change under periods kept on the fiscal year', async () => {
    const s = (await t.api.get('/api/strategy/settings')).body;
    expect(s.fiscal_periods_in_use).toBeGreaterThanOrEqual(2);
    const r = await t.api.put('/api/strategy/settings', { fiscal_year_start_month: 10 });
    expect(r.status).toBe(400);
    expect(r.body.error.fields.fiscal_year_start_month).toMatch(/cannot change/);
    expect((await t.api.put('/api/strategy/settings', { fiscal_year_named_for: 'start' })).body.error.fields.fiscal_year_named_for).toMatch(/cannot change/);
    // Other settings still save.
    expect((await t.api.put('/api/strategy/settings', { due_soon_days: 20, fiscal_year_start_month: 7 })).status).toBe(200);
    // Once the fiscal periods are gone it can change again (back to the calendar year here).
    await t.db.query(`update strategy_measure_values set deleted_at = now() where period like 'FY%'`);
    await t.db.query(`update strategy_updates set deleted_at = now() where period like 'FY%'`);
    expect((await t.api.put('/api/strategy/settings', { fiscal_year_start_month: 1 })).body.fiscal_year_start_month).toBe(1);
  });
});

describe('measures from statistics series', () => {
  it('takes the actual from a series breakdown or total, combined over the period', async () => {
    const series = await ok(t.api.post('/api/strategy/stat-series', { name: 'Invented trips', frequency: 'monthly', breakdowns: 'Bus\nRail' }));
    ids.series = series.id;
    for (const [month, bus, rail] of [['2025-01', 100, 40], ['2025-02', 110, 42], ['2025-03', 120, 44], ['2025-04', 130, 46]] as const) {
      await ok(t.api.post('/api/strategy/stat-values', { series_id: series.id, period: month, breakdown: 'Bus', value: bus }));
      await ok(t.api.post('/api/strategy/stat-values', { series_id: series.id, period: month, breakdown: 'rail', value: rail }));
    }
    const sources = (await t.api.get('/api/strategy/measure-sources')).body;
    expect(sources.series.find((s: Row) => s.id === series.id)).toMatchObject({ frequency: 'monthly', breakdowns: ['Bus', 'Rail'] });
    // The bus breakdown, added up over each quarter, for every quarter the series has values in.
    const bus = await ok(t.api.post('/api/strategy/measures', {
      objective_id: ids.objective, title: 'Invented bus trips', frequency: 'quarterly', source: 'series', series_id: series.id, series_breakdown: 'bus',
    }));
    expect(bus).toMatchObject({ series_breakdown: 'Bus', series_aggregation: 'sum' });
    const values = async (id: string) => Object.fromEntries((await t.api.get(`/api/strategy/measure-values?f.measure_id=${id}`)).body.rows.map((r: Row) => [r.period, r.actual === null ? null : Number(r.actual)]));
    expect(await values(bus.id)).toEqual({ '2025-Q1': 330, '2025-Q2': 130 });
    // The total (no total row entered: the breakdowns added up), averaged.
    const total = await ok(t.api.post('/api/strategy/measures', {
      objective_id: ids.objective, title: 'Invented average trips', frequency: 'quarterly', source: 'series', series_id: series.id, series_aggregation: 'average',
    }));
    expect((await values(total.id))['2025-Q1']).toBe(152);
    // A value entered or changed later follows at once; a target is kept.
    const q1 = (await t.api.get(`/api/strategy/measure-values?f.measure_id=${bus.id}&f.period=2025-Q1`)).body.rows[0];
    await ok(t.api.patch(`/api/strategy/measure-values/${q1.id}`, { target: 300 }), 200);
    const jan = (await t.api.get(`/api/strategy/stat-values?f.series_id=${series.id}&f.period=2025-01&f.breakdown=Bus`)).body.rows[0];
    await ok(t.api.patch(`/api/strategy/stat-values/${jan.id}`, { value: 50 }), 200);
    const after = (await t.api.get(`/api/strategy/measure-values/${q1.id}`)).body;
    expect(Number(after.actual)).toBe(280);
    expect(after).toMatchObject({ value_source: 'series', state: 'missed' });
    await ok(t.api.post('/api/strategy/stat-values', { series_id: series.id, period: '2025-07', breakdown: 'Bus', value: 10 }));
    expect((await values(bus.id))['2025-Q3']).toBe(10);
    // Removing the only value of a period clears the actual it gave.
    const jul = (await t.api.get(`/api/strategy/stat-values?f.series_id=${series.id}&f.period=2025-07`)).body.rows[0];
    expect((await t.api.del(`/api/strategy/stat-values/${jul.id}`)).status).toBe(200);
    expect((await values(bus.id))['2025-Q3']).toBeNull();
    // On demand, like a metric.
    expect((await ok(t.api.post(`/api/strategy/measures/${bus.id}/pull`, { period: '2025-Q2' }), 200)).value).toBe(130);
    ids.busMeasure = bus.id;
  });

  it('refuses a coarser series, an unknown breakdown or aggregation, and clears the series when hand-entered', async () => {
    const yearly = await ok(t.api.post('/api/strategy/stat-series', { name: 'Invented fleet size', frequency: 'yearly' }));
    const coarse = await t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'x', frequency: 'quarterly', source: 'series', series_id: yearly.id });
    expect(coarse.body.error.fields.series_id).toMatch(/by year/);
    const breakdown = await t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'x', frequency: 'quarterly', source: 'series', series_id: ids.series, series_breakdown: 'Ferry' });
    expect(breakdown.body.error.fields.series_breakdown).toMatch(/Bus, Rail/);
    const agg = await t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'x', frequency: 'quarterly', source: 'series', series_id: ids.series, series_aggregation: 'median' });
    expect(agg.body.error.fields.series_aggregation).toBeTruthy();
    expect((await t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'x', source: 'series' })).body.error.fields.series_id).toBeTruthy();
    const m = await ok(t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'Invented yearly trips', frequency: 'yearly', source: 'series', series_id: ids.series }));
    const manual = await ok(t.api.patch(`/api/strategy/measures/${m.id}`, { source: 'manual' }), 200);
    expect(manual).toMatchObject({ series_id: null, series_breakdown: null, series_aggregation: null });
  });
});

describe('the dashboard widget for one measure', () => {
  it('shows the latest actual against target and the trend, to people who may view strategy', async () => {
    const widget = { kind: 'measure', title: 'Bus trips', config: { measureId: ids.busMeasure, recordType: 'strategic_measure', periods: 6 } };
    const r = await ok(t.api.post('/api/dashboards/run-widget', { widget }), 200);
    expect(r.status).toBe('ok');
    expect(r.measure).toMatchObject({ id: ids.busMeasure, latest_period: '2025-Q2', latest_value: 130, latest_label: '2025 Q2', route: `/strategy/measures/${ids.busMeasure}` });
    expect(r.result.columns.map((c: Row) => c.key)).toEqual(['g0', 'a0', 'a1']);
    expect(r.result.rows.map((x: Row) => x.v.g0)).toEqual(['2025-Q1', '2025-Q2', '2025-Q3']);
    expect(r.result.rows[0].v).toMatchObject({ a0: 300, a1: 280 });
    // A dashboard may hold it, and its print-ready document says the latest figure.
    const dash = await ok(t.api.post('/api/dashboards', { name: 'Invented measure dashboard', widgets: [{ ...widget, id: 'm1', x: 0, y: 0, w: 6, h: 4 }] }));
    expect(dash.widgets[0].kind).toBe('measure');
    const doc = await t.api.get(`/api/dashboards/${dash.id}/export?format=html`);
    expect(doc.status, doc.text).toBe(200);
    expect(doc.text).toContain('2025 Q2: 130');
    expect((await t.api.post('/api/dashboards/run-widget', { widget: { kind: 'measure', config: {} } })).body.status).toBe('error');
    expect((await t.api.post('/api/dashboards/run-widget', { widget: { kind: 'measure', config: { measureId: '00000000-0000-4000-8000-000000000000' } } })).body.status).toBe('unavailable');
  });

  it('refuses people who may not view strategy, and is unavailable while the area is off', async () => {
    const widget = { kind: 'measure', config: { measureId: ids.busMeasure } };
    const agent = await t.as('agent');
    const r = await agent.post('/api/dashboards/run-widget', { widget });
    if (r.status === 200) expect(r.body.status).toBe('forbidden');
    else expect(r.status).toBe(403);
    const viewer = await t.as('executive_viewer');
    expect((await viewer.post('/api/dashboards/run-widget', { widget })).body.status).toBe('ok');
    await t.api.post('/api/auth/confirm', { password: ADMIN.password });
    expect((await t.api.patch('/api/admin/features', { features: { strategy: false } })).status).toBe(200);
    try {
      expect((await t.api.post('/api/dashboards/run-widget', { widget })).body.status).toBe('unavailable');
      expect((await t.api.get('/api/dashboards/switched-off-types')).body.types).toContain('strategic_measure');
    } finally {
      expect((await t.api.patch('/api/admin/features', { features: { strategy: true } })).status).toBe(200);
    }
  });
});
