import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { normalizePeriod } from './periods.ts';
import { runSubmissionReminders } from './reminders.ts';

// Wave 26: the strategic plan register (plans, goals, objectives, measures with targets and actuals,
// initiatives, quarterly updates, scorecard, matrix and board PDF) and the statistics (series, values,
// submissions with reminders). Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const ok = async (p: Promise<{ status: number; body: any; text: string }>, status = 201) => {
  const r = await p;
  expect(r.status, r.text).toBe(status);
  return r.body;
};
const today = () => dayInZone();
const thisQuarter = () => normalizePeriod('quarterly', today())!;
const ids: Record<string, string> = {};

beforeAll(async () => {
  t = await testApp();
  const year = Number(today().slice(0, 4));
  ids.plan = (await ok(t.api.post('/api/strategy/plans', { title: 'Invented plan', period_start: `${year - 1}-01-01`, period_end: `${year + 3}-12-31` }))).id;
  ids.goal = (await ok(t.api.post('/api/strategy/goals', { plan_id: ids.plan, code: 'G1', title: 'Invented reliable service' }))).id;
  ids.objective = (await ok(t.api.post('/api/strategy/objectives', { goal_id: ids.goal, code: '1.1', title: 'Invented on-time running' }))).id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('the strategic plan register', () => {
  it('adopts a plan with its day, and objectives take their plan from the goal', async () => {
    const plan = await ok(t.api.patch(`/api/strategy/plans/${ids.plan}`, { status: 'adopted' }), 200);
    expect(plan.adopted_on.slice(0, 10)).toBe(today());
    expect(plan.ref).toMatch(/^SP-/);
    const obj = (await t.api.get(`/api/strategy/objectives/${ids.objective}`)).body;
    expect(obj.plan_id).toBe(ids.plan);
    expect(obj.ref).toMatch(/^OBJ-/);
    expect((await t.api.post('/api/strategy/objectives', { title: 'No goal' })).status).toBe(400);
    const bad = await t.api.post('/api/strategy/plans', { title: 'Backwards', period_start: '2026-01-01', period_end: '2025-01-01' });
    expect(bad.body.error.fields.period_end).toBeTruthy();
  });

  it('keeps targets and actuals per period and compares them', async () => {
    const m = await ok(t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'Invented on-time performance', unit: '%', direction: 'increase', frequency: 'quarterly', baseline_value: 80 }));
    ids.measure = m.id;
    expect(m.plan_id).toBe(ids.plan);
    const v1 = await ok(t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2025-q1', target: 85, actual: 86 }));
    expect(v1).toMatchObject({ period: '2025-Q1', state: 'met' });
    expect(v1.entered_by).toBeTruthy();
    expect(v1.period_start.slice(0, 10)).toBe('2025-01-01');
    await ok(t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2025-06-30', target: 86, actual: 82 }));
    // Targets for later periods, with no actual yet.
    await ok(t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2025-Q3', target: 87 }));
    const dup = await t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2025-Q1', target: 1 });
    expect(dup.status).toBe(400);
    expect(dup.body.error.fields.period).toMatch(/already/);
    expect((await t.api.post('/api/strategy/measure-values', { measure_id: m.id, period: '2025', target: 1 })).body.error.fields.period).toMatch(/quarter/);
    const after = (await t.api.get(`/api/strategy/measures/${m.id}`)).body;
    expect(after).toMatchObject({ latest_period: '2025-Q2', latest_state: 'near' });
    expect(Number(after.latest_value)).toBe(82);
  });

  it('takes the status of objectives and initiatives from their latest quarterly update', async () => {
    const ini = await ok(t.api.post('/api/strategy/initiatives', { objective_id: ids.objective, title: 'Invented signal priority', budget_amount: 100000 }));
    ids.initiative = ini.id;
    expect(ini).toMatchObject({ plan_id: ids.plan, stage: 'planned' });
    const u1 = await ok(t.api.post('/api/strategy/updates', { objective_id: ids.objective, period: '2025-Q4', status: 'at_risk', narrative: 'Invented: behind on hiring.' }));
    expect(u1.reported_by).toBeTruthy();
    expect(u1.reported_on.slice(0, 10)).toBe(today());
    const u2 = await ok(t.api.post('/api/strategy/updates', { objective_id: ids.objective, status: 'off_track', narrative: 'Invented: further behind.' }));
    expect(u2.period).toBe(thisQuarter());
    expect((await t.api.get(`/api/strategy/objectives/${ids.objective}`)).body).toMatchObject({ status: 'off_track', status_period: thisQuarter() });
    // Deleting the latest one brings back the one before.
    expect((await t.api.del(`/api/strategy/updates/${u2.id}`)).status).toBe(200);
    expect((await t.api.get(`/api/strategy/objectives/${ids.objective}`)).body.status).toBe('at_risk');
    await ok(t.api.post('/api/strategy/updates', { initiative_id: ini.id, period: '2025-Q4', status: 'on_track' }));
    expect((await t.api.get(`/api/strategy/initiatives/${ini.id}`)).body.status).toBe('on_track');
    // One subject, not two and not none.
    expect((await t.api.post('/api/strategy/updates', { status: 'on_track' })).status).toBe(400);
    expect((await t.api.post('/api/strategy/updates', { objective_id: ids.objective, initiative_id: ini.id, status: 'on_track' })).status).toBe(400);
  });

  it('shows the scorecard, the quarterly matrix and a tagged board PDF', async () => {
    const card = await ok(t.api.get(`/api/strategy/plans/${ids.plan}/scorecard`), 200);
    expect(card.goals[0].objectives[0]).toMatchObject({ id: ids.objective, status: 'at_risk' });
    expect(card.goals[0].objectives[0].measures[0].trend.length).toBe(3);
    expect(card.goals[0].objectives[0].initiatives[0].id).toBe(ids.initiative);
    expect(card.totals.objectives).toMatchObject({ at_risk: 1, total: 1 });
    const grid = await ok(t.api.get(`/api/strategy/plans/${ids.plan}/matrix?from=2025-Q3&to=2026-Q1`), 200);
    expect(grid.quarters).toEqual(['2025-Q3', '2025-Q4', '2026-Q1']);
    const row = grid.rows.find((r: Row) => r.id === ids.objective);
    expect(row.cells['2025-Q4']).toMatchObject({ status: 'at_risk' });
    expect(row.cells['2025-Q3']).toBeNull();
    expect(grid.rows.find((r: Row) => r.id === ids.initiative).kind).toBe('initiative');

    const res = await t.app.inject({ method: 'GET', url: `/api/strategy/plans/${ids.plan}/scorecard.pdf`, headers: { cookie: await adminCookie() } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const { checkPdfUa } = await import('../../core/export/pdfua.ts');
    expect((await checkPdfUa(res.rawPayload)).failures).toEqual([]);
    const { pdfText } = await import('../../core/export/testing.ts');
    const text = (await pdfText(res.rawPayload)).replace(/\s+/g, ' ');
    expect(text).toContain('Invented on-time running');
    expect(text).toContain('Invented on-time performance');
  });

  it('takes a measure from a metric', async () => {
    const sources = await ok(t.api.get('/api/strategy/measure-sources'), 200);
    expect(sources.metrics.map((m: Row) => m.key)).toContain('strategy.objectives_at_risk');
    const bad = await t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'Invented', source: 'metric', metric_key: 'nothing.here' });
    expect(bad.body.error.fields.metric_key).toBeTruthy();
    const m = await ok(t.api.post('/api/strategy/measures', { objective_id: ids.objective, title: 'Invented objectives at risk', source: 'metric', metric_key: 'strategy.objectives_at_risk', frequency: 'monthly', direction: 'decrease' }));
    const month = today().slice(0, 7);
    const pulled = await ok(t.api.post(`/api/strategy/measures/${m.id}/pull`, { period: month }), 200);
    expect(pulled.value).toBe(1);
    const v = (await t.api.get(`/api/strategy/measure-values?f.measure_id=${m.id}`)).body.rows[0];
    expect(v).toMatchObject({ period: month, value_source: 'metric' });
    // A hand-entered measure has nothing to pull.
    expect((await t.api.post(`/api/strategy/measures/${ids.measure}/pull`, { period: '2025-Q1' })).status).toBe(400);
  });
});

async function adminCookie() {
  const { createSession, SESSION_COOKIE } = await import('../../core/auth.ts');
  const admin = (await t.db.one<Row>(`select id from users where username = $1`, [ADMIN.username]))!;
  return `${SESSION_COOKIE}=${await createSession(t.db, admin.id)}`;
}

describe('statistics', () => {
  it('needs the administration permission to define a series', async () => {
    const viewer = await t.as('executive_viewer');
    expect((await viewer.get('/api/strategy/stat-series')).status).toBe(200);
    expect((await viewer.post('/api/strategy/stat-series', { name: 'Invented', frequency: 'monthly' })).status).toBe(403);
    const s = await ok(t.api.post('/api/strategy/stat-series', { name: 'Invented passenger trips', unit: 'trips', frequency: 'monthly', breakdown_label: 'Mode', breakdowns: 'Bus\nLight rail, Bus' }));
    expect(s.breakdowns).toBe('Bus\nLight rail');
    ids.series = s.id;
  });

  it('takes one value per period and breakdown, with who and when', async () => {
    const v = await ok(t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026-01-15', breakdown: 'bus', value: 1000 }));
    expect(v).toMatchObject({ period: '2026-01', breakdown: 'Bus' });
    expect(v.entered_by).toBeTruthy();
    expect(v.entered_at).toBeTruthy();
    await ok(t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026-01', breakdown: 'Light rail', value: 400 }));
    await ok(t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026-02', breakdown: 'Bus', value: 1100 }));
    expect((await t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026-01', breakdown: 'Bus', value: 1 })).body.error.fields.period).toMatch(/already/);
    expect((await t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026-01', breakdown: 'Ferry', value: 1 })).body.error.fields.breakdown).toMatch(/Bus, Light rail/);
    expect((await t.api.post('/api/strategy/stat-values', { series_id: ids.series, period: '2026', value: 1 })).body.error.fields.period).toMatch(/month/);
    // Values entered fix the frequency.
    expect((await t.api.patch(`/api/strategy/stat-series/${ids.series}`, { frequency: 'yearly' })).body.error.fields.frequency).toBeTruthy();
    const chart = await ok(t.api.get(`/api/strategy/stat-series/${ids.series}/values`), 200);
    expect(chart.periods).toEqual(['2026-01', '2026-02']);
    expect(chart.values.Bus).toEqual([1000, 1100]);
    expect(chart.values['Light rail']).toEqual([400, null]);
  });

  it('imports values from a CSV file', async () => {
    const csv = 'Series,Period,Breakdown,Value\nInvented passenger trips,2026-03,Bus,1200\nInvented passenger trips,2026-03,Light rail,450\n';
    const body = { fileName: 'trips.csv', content: Buffer.from(csv, 'utf8').toString('base64'), mapping: { Series: 'series_id', Period: 'period', Breakdown: 'breakdown', Value: 'value' }, mode: 'create', dryRun: false };
    const res = await t.api.post('/api/import/stat_value', body);
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ created: 2, errors: 0 });
    expect((await t.api.get(`/api/strategy/stat-series/${ids.series}/values`)).body.periods).toContain('2026-03');
  });

  it('logs submissions, fills in when they were made, and reminds the preparer once per step', async () => {
    const due = await ok(t.api.post('/api/strategy/submissions', { report_name: 'Invented monthly ridership report', recipient: 'Invented statistics office', period: '2026-02', due_on: addDays(today(), 5) }));
    expect(due).toMatchObject({ status: 'planned' });
    expect(due.owner_id).toBeTruthy();
    const notes = () => t.db.query<Row>('select title from notifications where record_id = $1', [due.id]);
    await runSubmissionReminders(t.ctx);
    expect((await notes()).map((n) => n.title)).toEqual([`Statistical report due in 5 days: ${due.ref} Invented monthly ridership report`]);
    await runSubmissionReminders(t.ctx);
    expect(await notes()).toHaveLength(1);
    const done = await ok(t.api.patch(`/api/strategy/submissions/${due.id}`, { status: 'submitted', confirmation: 'INV-1' }), 200);
    expect(done.submitted_on.slice(0, 10)).toBe(today());
    expect(done.submitted_by).toBeTruthy();
    const overdue = await ok(t.api.post('/api/strategy/submissions', { report_name: 'Invented quarterly safety report', period: '2025-Q4', due_on: addDays(today(), -2) }));
    const s = (await t.api.get('/api/strategy/summary')).body;
    expect(s.submissions).toMatchObject({ overdue: 1 });
    expect(s.objectives.at_risk).toBe(1);
    // My work lists it for its preparer.
    const work = await t.api.get('/api/work/mine');
    if (work.status === 200) expect(JSON.stringify(work.body)).toContain(overdue.id);
    // Submitted ones are not reminded about.
    await runSubmissionReminders(t.ctx);
    expect(await notes()).toHaveLength(1);
  });
});
