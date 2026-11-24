import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addMonths } from '../../../../shared/dates.ts';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import { pdfText } from '../../core/export/testing.ts';
import { defineMetric } from '../../core/metrics.ts';
import type { ModuleDef } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { makeFigures } from './figures.ts';
import { seedStandard } from './seed.ts';
import { fixtureModule, loadFixture } from './testing.ts';

// E41-04: figures recorded at each month end (and on demand), the same for everyone, charted over
// time in reports, dashboards and board packs.
let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let agent: Client;
let byStatus: any;

const thisMonth = () => `${todayInZone().slice(0, 7)}-01`;
const metricModule: ModuleDef = {
  key: 'rtmetric',
  async register(ctx) {
    defineMetric(ctx.app, { key: 'rtmetric.things', label: 'Things counted by the test metric', unit: 'count', recordType: 'rt_thing', description: 'Always seven.', compute: async () => 7 });
  },
};

async function raw(client: Client | null, url: string) {
  const id = client ? client.userId : (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  const cookie = await createSession(t.db, id);
  const res = await t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
  return { status: res.statusCode, body: res.rawPayload, type: String(res.headers['content-type'] ?? '') };
}

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule, metricModule] });
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await loadFixture(t.ctx, admin);
  lead = await t.as('security_lead');
  agent = await t.as('agent');
});
afterAll(async () => { await t.close(); });

describe('figures recorded over time', () => {
  it('adds a count broken down by a list field, and checks what it is given', async () => {
    const res = await t.api.post('/api/figures', {
      name: 'Things not finished, by status', source: 'count', record_type: 'rt_thing', group_field: 'status',
      filters: { op: 'and', items: [{ field: 'status', op: 'nin', value: ['done'] }] },
    });
    expect(res.status).toBe(201);
    byStatus = res.body;
    expect(byStatus).toMatchObject({ source: 'count', record_type: 'rt_thing', group_field: 'status', group_label: 'Status', unit: 'count', active: true, latest: null });
    expect((await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'tracked_figure.create' order by at desc limit 1`))!.summary).toContain('Things not finished, by status');

    const bad = async (body: object, field: string) => {
      const r = await t.api.post('/api/figures', { name: 'X', source: 'count', record_type: 'rt_thing', ...body });
      expect(r.status).toBe(400);
      expect(Object.keys(r.body.error.fields)).toEqual([field]);
    };
    await bad({ group_field: 'department' }, 'group_field'); // words, not a list
    await bad({ filters: { op: 'and', items: [{ field: 'owner_id', op: 'me' }] } }, 'filters');
    await bad({ record_type: 'no_such_type' }, 'record_type');
    await bad({ source: 'metric', metric_key: 'no.such' }, 'metric_key');
    await bad({ name: '' }, 'name');
    // Only people who may create reports add figures.
    expect((await agent.post('/api/figures', { name: 'X', source: 'count', record_type: 'rt_thing' })).status).toBe(403);
  });

  it('records the figures now, counting every record, restricted ones included, the same for everyone', async () => {
    expect((await agent.post('/api/figures/record', {})).status).toBe(403);
    const rec = await t.api.post('/api/figures/record', { ids: [byStatus.id] });
    expect(rec.status).toBe(200);
    expect(rec.body).toEqual({ period: thisMonth(), recorded: 1 });
    // A, B, C and the restricted R are not finished: 1 brand new, 3 in hand.
    const mine = (await t.api.get(`/api/figures/${byStatus.id}?months=3`)).body;
    expect(mine.latest).toMatchObject({ period: thisMonth(), kind: 'on_demand', value: 4 });
    expect(mine.latest.groups).toEqual([
      { value: 'new', label: 'Brand new', color: 'blue', count: 1 },
      { value: 'open', label: 'In hand', color: 'amber', count: 3 },
    ]);
    expect(mine.filters_text).toEqual(['Status is none of Finished']);
    // The agent cannot see the restricted thing in lists, but the figure is the same.
    expect((await agent.get('/api/rt-things?pageSize=50')).body.rows.some((r: any) => r.name === 'R')).toBe(false);
    const theirs = (await agent.get(`/api/figures/${byStatus.id}?months=3`)).body;
    expect(theirs.result).toEqual({ ...mine.result, generatedAt: theirs.result.generatedAt });
    // The result is drawn like a grouped report: months as rows, statuses as columns, no totals across months.
    expect(mine.result.mode).toBe('groups');
    expect(mine.result.columns.map((c: any) => c.label)).toEqual(['Month', 'Status', 'Things not finished, by status']);
    expect(mine.result.pivot.rows).toHaveLength(1);
    expect(mine.result.pivot.rows[0].label).toMatch(/\(so far\)$/);
    expect(mine.result.pivot.colTotals).toEqual([null, null]);
    expect(mine.result.restricted).toBe(false);
  });

  it('records each active figure once at the month end, and only figures that existed then', async () => {
    const figures = makeFigures(t.ctx);
    const created = (await t.api.post('/api/figures', { name: 'All things', source: 'count', record_type: 'rt_thing' })).body;
    // Added this month: nothing to record for last month.
    let run = await figures.monthEnd(new Date());
    expect(run.period).toBe(addMonths(thisMonth(), -1));
    const lastMonth = run.period;
    const has = async (id: string) => Boolean(await t.db.one(`select 1 from figure_values where figure_id = $1 and period = $2 and kind = 'month_end'`, [id, lastMonth]));
    expect(await has(created.id)).toBe(false);
    await t.db.query(`update tracked_figures set created_at = now() - interval '62 days' where id = any($1::uuid[])`, [[created.id, byStatus.id]]);
    run = await figures.monthEnd(new Date());
    expect(await has(created.id)).toBe(true);
    expect(await has(byStatus.id)).toBe(true);
    // Once only.
    expect((await figures.monthEnd(new Date())).recorded).toBe(0);
    const all = (await t.api.get(`/api/figures/${created.id}?months=2`)).body;
    expect(all.values.map((v: any) => [v.period, v.value.kind, v.value.value])).toEqual([[lastMonth, 'month_end', 6]]);
    // A figure that is switched off from recording is skipped.
    await t.api.patch(`/api/figures/${created.id}`, { active: false });
    await t.db.query(`delete from figure_values where figure_id = $1`, [created.id]);
    await figures.monthEnd(new Date());
    expect(await has(created.id)).toBe(false);
    expect((await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'tracked_figure.update' order by at desc limit 1`))!.summary).toContain('All things');
  });

  it('runs the month end from the job queue', async () => {
    const before = (await t.db.query(`select 1 from figure_values`)).length;
    await t.app.jobs.enqueue('reports.figures_month_end', {});
    await t.app.jobs.runDue();
    const job = await t.db.one<{ status: string }>(`select status from jobs where type = 'reports.figures_month_end' order by created_at desc limit 1`);
    expect(job?.status).toBe('done');
    expect((await t.db.query(`select 1 from figure_values`)).length).toBeGreaterThanOrEqual(before);
  });

  it('follows a metric another module offers', async () => {
    const res = await t.api.post('/api/figures', { name: 'Test metric', source: 'metric', metric_key: 'rtmetric.things' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ unit: 'count', metric_label: 'Things counted by the test metric', what: 'Always seven.' });
    await t.api.post('/api/figures/record', { ids: [res.body.id] });
    expect((await t.api.get(`/api/figures/${res.body.id}`)).body.latest).toMatchObject({ value: 7, groups: null });
  });

  it('shows a figure only to people who may view what it counts', async () => {
    const boxes = (await t.api.post('/api/figures', { name: 'Boxes', source: 'count', record_type: 'rt_box' })).body;
    expect((await agent.get(`/api/figures/${boxes.id}`)).status).toBe(404);
    expect((await agent.get('/api/figures')).body.map((f: any) => f.id)).not.toContain(boxes.id);
    expect((await lead.get('/api/figures')).body.map((f: any) => f.id)).toContain(boxes.id);
    // Removing it keeps its values but shows it nowhere.
    expect((await t.api.del(`/api/figures/${boxes.id}`)).status).toBe(200);
    expect((await lead.get(`/api/figures/${boxes.id}`)).status).toBe(404);
  });

  it('charts a figure on a dashboard and in a board pack, and exports it as a tagged PDF', async () => {
    const widget = await lead.post('/api/dashboards/run-widget', { widget: { kind: 'figure', config: { figureId: byStatus.id, months: 6 } } });
    expect(widget.body).toMatchObject({ status: 'ok', chart: { kind: 'line' } });
    expect(widget.body.result.pivot.cols.map((c: any) => c.label)).toEqual(['Brand new', 'In hand']);
    const gone = await lead.post('/api/dashboards/run-widget', { widget: { kind: 'figure', config: { figureId: '00000000-0000-4000-8000-000000000000' } } });
    expect(gone.body.status).toBe('unavailable');

    const pack = await lead.post('/api/report-packs', {
      name: 'Board pack', cover_title: 'Board report', sharing: 'everyone',
      sections: [{ kind: 'text', title: 'Summary', body: 'Fine.' }, { kind: 'figure', figureId: byStatus.id, months: 12 }],
    });
    expect(pack.status).toBe(201);
    expect(pack.body.sections[1]).toEqual({ kind: 'figure', figureId: byStatus.id, months: 12 });
    const preview = (await lead.get(`/api/report-packs/${pack.body.id}/preview`)).body;
    expect(preview.sections[1]).toMatchObject({ kind: 'figure', title: 'Things not finished, by status', chart: { kind: 'line' } });
    const file = await raw(lead, `/api/report-packs/${pack.body.id}/export?format=pdf`);
    expect(file.status).toBe(200);
    const ua = await checkPdfUa(file.body);
    expect(ua.failures).toEqual([]);
    expect(ua.figures.some((a) => a.startsWith('Line chart:') && a.includes('Brand new 1, In hand 3'))).toBe(true);

    const pdf = await raw(lead, `/api/figures/${byStatus.id}/export?format=pdf&months=12`);
    expect(pdf.status).toBe(200);
    expect(pdf.type).toBe('application/pdf');
    expect((await checkPdfUa(pdf.body)).failures).toEqual([]);
    expect(pdfText(pdf.body)).toContain('Status is none of Finished');
    const csv = await raw(lead, `/api/figures/${byStatus.id}/export?format=csv`);
    expect(csv.body.toString('utf8')).toContain('Month,Brand new,In hand,Total');
    expect((await raw(lead, `/api/figures/${byStatus.id}/export?format=doc`)).status).toBe(400);
    expect((await t.db.one<{ summary: string }>(`select summary from audit_events where action = 'tracked_figure.export' order by at desc limit 1`))!.summary).toContain('Things not finished, by status');
  });

  it('seeds the standard figures once, with an invented history in the dev profile only', async () => {
    await seedStandard(t.ctx, 'dev');
    await seedStandard(t.ctx, 'dev');
    const std = await t.db.query<{ key: string; id: string }>(`select key, id from tracked_figures where key is not null`);
    expect(std.map((r) => r.key)).toEqual(expect.arrayContaining(['open_risks_by_level', 'overdue_actions', 'open_findings_by_rating']));
    expect(new Set(std.map((r) => r.key)).size).toBe(std.length);
    const risk = std.find((r) => r.key === 'open_risks_by_level')!;
    const history = await t.db.query(`select period from figure_values where figure_id = $1 and kind = 'month_end'`, [risk.id]);
    expect(history).toHaveLength(11);
    // The standard pack includes the risk figure over time.
    const pack = await t.db.one<{ sections: any[] }>(`select sections from report_packs where key = 'governing_body_pack'`);
    expect(pack!.sections.some((s) => s.kind === 'figure' && s.figureId === risk.id)).toBe(true);
  });
});
