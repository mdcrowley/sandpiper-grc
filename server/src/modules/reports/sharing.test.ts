import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { fixtureModule, loadFixture } from './testing.ts';

let t: Awaited<ReturnType<typeof testApp>>;
type Client = Awaited<ReturnType<typeof t.as>>;
let lead: Client;
let lead2: Client;
let agent: Client;
let pm: Client;

const spec = { type: 'rt_thing', groupBy: [{ field: 'status' }] };

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule] });
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await loadFixture(t.ctx, admin);
  lead = await t.as('security_lead');   // reports.* and dashboards.*
  lead2 = await t.as('security_lead');
  agent = await t.as('agent');          // reports.view, dashboards.view
  pm = await t.as('project_manager');   // reports.view, dashboards.view
});
afterAll(async () => { await t.close(); });

describe('saved reports: permissions and sharing', () => {
  it('checks reports.create / edit / delete and validates the specification', async () => {
    expect((await agent.post('/api/reports', { name: 'Mine', spec })).status).toBe(403);
    expect((await (await t.as('auditor')).get('/api/reports')).status).toBe(403);
    const bad = await lead.post('/api/reports', { name: 'Broken', spec: { type: 'rt_thing', columns: ['nope'] } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.spec).toContain('nope');
    const made = await lead.post('/api/reports', { name: 'By status', spec, chart: { kind: 'bar', nonsense: true } });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ record_type: 'rt_thing', owner_id: lead.userId, sharing: 'private', chart: { kind: 'bar' } });
    // The owner cannot be set or changed by the client.
    const stolen = await lead.patch(`/api/reports/${made.body.id}`, { owner_id: agent.userId, name: 'By status (renamed)' });
    expect(stolen.body.owner_id).toBe(lead.userId);
    const audit = await t.db.query(`select action from audit_events where record_id = $1 order by id`, [made.body.id]);
    expect(audit.map((a: any) => a.action)).toEqual(['report_definition.create', 'report_definition.update']);
  });

  it('keeps a private report to its owner, in lists, counts, single reads and runs', async () => {
    const made = (await lead.post('/api/reports', { name: 'Private one', spec })).body;
    for (const other of [agent, lead2]) {
      const list = await other.get('/api/reports?pageSize=500');
      expect(list.body.rows.map((r: any) => r.id)).not.toContain(made.id);
      expect(list.body.total).toBe(list.body.rows.length);
      expect((await other.get(`/api/reports?f.id=${made.id}`)).body.total).toBe(0);
      expect((await other.get('/api/reports/stats?group=sharing')).body.groups.find((g: any) => g.value === 'private')).toBeUndefined();
      expect((await other.get(`/api/reports/${made.id}`)).status).toBe(404);
      expect((await other.get(`/api/reports/${made.id}/run`)).status).toBe(404);
      expect((await other.get(`/api/reports/${made.id}/export?format=csv`)).status).not.toBe(200);
    }
    expect((await lead2.patch(`/api/reports/${made.id}`, { name: 'x' })).status).toBe(404);
    expect((await lead2.del(`/api/reports/${made.id}`)).status).toBe(404);
    expect((await lead.get('/api/reports?pageSize=500')).body.rows.map((r: any) => r.id)).toContain(made.id);
    // Administrators can look after a report whose owner has left.
    expect((await t.api.get(`/api/reports/${made.id}`)).status).toBe(200);
  });

  it('shares with chosen roles or with everyone, for viewing only', async () => {
    const made = (await lead.post('/api/reports', { name: 'For agents', spec })).body;
    expect((await lead.patch(`/api/reports/${made.id}`, { sharing: 'roles', shared_roles: ['no_such_role'] })).status).toBe(400);
    expect((await lead.patch(`/api/reports/${made.id}`, { sharing: 'roles', shared_roles: ['agent'] })).status).toBe(200);
    expect((await agent.get(`/api/reports/${made.id}`)).status).toBe(200);
    expect((await pm.get(`/api/reports/${made.id}`)).status).toBe(404);
    expect((await lead2.get(`/api/reports/${made.id}`)).status).toBe(404);

    await lead.patch(`/api/reports/${made.id}`, { sharing: 'everyone' });
    expect((await pm.get(`/api/reports/${made.id}`)).status).toBe(200);
    // Seeing is not changing: another person with reports.edit still cannot alter or delete it.
    expect((await lead2.patch(`/api/reports/${made.id}`, { name: 'Taken over' })).status).toBe(403);
    expect((await lead2.del(`/api/reports/${made.id}`)).status).toBe(403);
    expect((await lead.del(`/api/reports/${made.id}`)).status).toBe(200);
  });

  it('runs a shared report with the viewer\'s permissions, not the author\'s', async () => {
    const made = (await lead.post('/api/reports', { name: 'Shared count', spec: { type: 'rt_thing', aggregates: [{ fn: 'count' }] }, sharing: 'everyone' })).body;
    expect((await lead.get(`/api/reports/${made.id}/run`)).body.result.rows[0].v.a0).toBe(6);
    expect((await agent.get(`/api/reports/${made.id}/run`)).body.result.rows[0].v.a0).toBe(5);
    expect((await agent.get(`/api/reports/${made.id}/run?g.department=Finance`)).body.result.rows[0].v.a0).toBe(2);
    // A viewer with no access to the record type is refused, whoever shared the report.
    expect((await (await t.as('executive_viewer')).get(`/api/reports/${made.id}/run`)).status).toBe(403);
  });
});

describe('dashboards: permissions, sharing, widgets and the home choice', () => {
  const widgets = [
    { id: 'n', kind: 'number', title: 'Things', x: 0, y: 0, w: 3, h: 2, config: { spec: { type: 'rt_thing' } } },
    { id: 'c', kind: 'chart', title: 'By status', x: 3, y: 0, w: 6, h: 4, config: { spec, chart: { kind: 'bar' } } },
    { id: 'gone', kind: 'chart', title: 'Not loaded', x: 0, y: 4, w: 6, h: 4, config: { spec: { type: 'no_such_type', groupBy: [{ field: 'x' }] } } },
  ];

  it('checks dashboards.* and validates widgets and filters', async () => {
    expect((await agent.post('/api/dashboards', { name: 'Mine', widgets })).status).toBe(403);
    expect((await lead.post('/api/dashboards', { name: 'Bad', widgets: [{ kind: 'explode' }] })).status).toBe(400);
    expect((await lead.post('/api/dashboards', { name: 'Bad', widgets: [{ kind: 'chart', config: { spec: { type: 'rt_thing', groupBy: [{ field: 'nope' }] } } }] })).status).toBe(400);
    expect((await lead.post('/api/dashboards', { name: 'Bad', filters: [{ kind: 'colour' }] })).status).toBe(400);
    const made = await lead.post('/api/dashboards', { name: 'Team board', widgets: [...widgets, { id: 'n', kind: 'text', x: 99, y: -4, w: 40, h: 99, config: { markdown: 'hi' } }], filters: [{ kind: 'department', label: 'Department' }] });
    expect(made.status).toBe(201);
    const last = made.body.widgets[3];
    expect(last).toMatchObject({ x: 0, y: 0, w: 12, h: 12 });
    expect(last.id).not.toBe('n');
  });

  it('applies sharing to dashboards and lets each person choose a home dashboard they can see', async () => {
    const dash = (await lead.post('/api/dashboards', { name: 'Private board', widgets })).body;
    expect((await agent.get(`/api/dashboards/${dash.id}`)).status).toBe(404);
    expect((await agent.get('/api/dashboards')).body.rows.map((r: any) => r.id)).not.toContain(dash.id);
    expect((await agent.post('/api/dashboards/home', { dashboard_id: dash.id })).status).toBe(404);
    expect((await agent.get('/api/dashboards/home')).body).toEqual({ dashboard: null, route: null });

    await lead.patch(`/api/dashboards/${dash.id}`, { sharing: 'roles', shared_roles: ['agent'] });
    const set = await agent.post('/api/dashboards/home', { dashboard_id: dash.id });
    expect(set.body.route).toBe(`/dashboards/${dash.id}`);
    expect((await agent.get('/api/dashboards/home')).body.dashboard.name).toBe('Private board');
    expect((await lead.get('/api/dashboards/home')).body.dashboard).toBeNull();
    // When the dashboard stops being shared, the choice quietly stops applying.
    await lead.patch(`/api/dashboards/${dash.id}`, { sharing: 'private' });
    expect((await agent.get('/api/dashboards/home')).body.dashboard).toBeNull();
    // People without dashboards.view get an empty answer, not an error (the Overview page asks for everyone).
    const auditor = await t.as('auditor');
    expect((await auditor.get('/api/dashboards/home')).body).toEqual({ dashboard: null, route: null });
    expect((await auditor.post('/api/dashboards/home', { dashboard_id: dash.id })).status).toBe(403);
    expect((await agent.post('/api/dashboards/home', { dashboard_id: null })).body.dashboard).toBeNull();
  });

  it('works out every widget with the viewer\'s permissions and degrades gracefully', async () => {
    const widget = (w: unknown, extra: object = {}) => ({ widget: w, ...extra });
    expect((await agent.post('/api/dashboards/run-widget', widget(widgets[0]))).body).toMatchObject({ status: 'ok', value: 5 });
    expect((await lead.post('/api/dashboards/run-widget', widget(widgets[0]))).body.value).toBe(6);
    expect((await agent.post('/api/dashboards/run-widget', widget(widgets[0], { globals: { department: 'Operations' } }))).body.value).toBe(2);
    expect((await agent.post('/api/dashboards/run-widget', widget(widgets[2]))).body.status).toBe('unavailable');
    expect((await agent.post('/api/dashboards/run-widget', widget({ kind: 'chart', config: { spec: { type: 'rt_box', groupBy: [{ field: 'colour' }] } } }))).body.status).toBe('forbidden');
    expect((await (await t.as('auditor')).post('/api/dashboards/run-widget', widget(widgets[0]))).status).toBe(403);

    // Gauge: a share of a wider set. Progress: one figure out of another.
    const gauge = { kind: 'gauge', config: { spec: { type: 'rt_thing', filters: { op: 'and', items: [{ field: 'status', op: 'in', value: ['done'] }] } }, of: null } };
    expect((await agent.post('/api/dashboards/run-widget', widget(gauge))).body).toMatchObject({ value: 2, denominator: 5 });
    const progress = { kind: 'progress', config: { spec: { type: 'rt_thing', aggregates: [{ fn: 'sum', field: 'qty' }] }, denominator: { type: 'rt_thing', aggregates: [{ fn: 'sum', field: 'amount' }] } } };
    expect((await lead.post('/api/dashboards/run-widget', widget(progress))).body).toMatchObject({ value: 25, denominator: 2000 });
    // Calendar: one month, counted by day.
    const cal = await lead.post('/api/dashboards/run-widget', widget({ kind: 'calendar', config: { spec: { type: 'rt_thing' }, dateField: 'opened_on' } }, { month: '2026-02' }));
    expect(cal.body.result.rows.map((r: any) => [r.v.g0, r.v.a0])).toEqual([['2026-02-10', 1], ['2026-02-11', 1]]);
    // Trend: this period against the one before, on the widget's date field.
    const trend = await lead.post('/api/dashboards/run-widget', widget({ kind: 'number', config: { spec: { type: 'rt_thing' }, trend: { field: 'created_at', days: 30 } } }));
    expect(trend.body.trend).toEqual({ current: 6, previous: 0, days: 30 });
  });

  it('runs a saved report on a dashboard only for people it is shared with', async () => {
    const report = (await lead.post('/api/reports', { name: 'Private on a board', spec: { type: 'rt_thing', aggregates: [{ fn: 'count' }] } })).body;
    const w = { id: 'r', kind: 'report', title: 'Saved', x: 0, y: 0, w: 4, h: 3, config: { reportId: report.id } };
    const dash = (await lead.post('/api/dashboards', { name: 'Shared board', widgets: [w], sharing: 'everyone' })).body;
    // On a shared dashboard, a private report shows "not shared with you" to everyone else.
    const off = await agent.post('/api/dashboards/run-widget', { widget: w, dashboardId: dash.id });
    expect(off.body).toMatchObject({ status: 'unavailable' });
    expect(off.body.message).toContain('not shared with you');
    expect(off.body.result).toBeUndefined();
    expect((await lead.post('/api/dashboards/run-widget', { widget: w, dashboardId: dash.id })).body.status).toBe('ok');
    // The printed dashboard leaves it out in the same way.
    const doc = await lead.get(`/api/dashboards/${dash.id}/export`);
    expect(doc.status).toBe(200);
    await lead.patch(`/api/reports/${report.id}`, { sharing: 'everyone' });
    const on = await agent.post('/api/dashboards/run-widget', { widget: w, dashboardId: dash.id });
    expect(on.body.status).toBe('ok');
    expect(on.body.result.rows[0].v.a0).toBe(5);
  });

  it('refuses a dashboard or pack that points at someone else\'s private report', async () => {
    const lead2 = await t.as('security_lead');
    const secret = (await lead.post('/api/reports', { name: 'Only mine', spec: { type: 'rt_thing', aggregates: [{ fn: 'count' }] } })).body;
    const w = { id: 'r', kind: 'report', title: 'Borrowed', x: 0, y: 0, w: 4, h: 3, config: { reportId: secret.id } };
    const bad = await lead2.post('/api/dashboards', { name: 'Borrowing', widgets: [w] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.widgets).toContain('not shared with you');
    const mine = (await lead2.post('/api/dashboards', { name: 'Mine', widgets: [] })).body;
    expect((await lead2.patch(`/api/dashboards/${mine.id}`, { widgets: [w] })).status).toBe(400);
    const pack = await lead2.post('/api/report-packs', { name: 'Borrowed pack', sections: [{ kind: 'report', reportId: secret.id }] });
    expect(pack.status).toBe(400);
    expect(pack.body.error.fields.sections).toContain('not shared with you');
    // The owner may place it, and a later edit by the same person keeps it.
    const own = (await lead.post('/api/dashboards', { name: 'Own board', widgets: [w] }));
    expect(own.status).toBe(201);
    expect((await lead.patch(`/api/dashboards/${own.body.id}`, { name: 'Own board, renamed', widgets: own.body.widgets })).status).toBe(200);
  });
});
