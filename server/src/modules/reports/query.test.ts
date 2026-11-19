import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { fixtureModule, loadFixture } from './testing.ts';

let t: Awaited<ReturnType<typeof testApp>>;
let ids: Awaited<ReturnType<typeof loadFixture>>;
let adminId: string;

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtureModule] });
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  ids = await loadFixture(t.ctx, adminId);
});
afterAll(async () => { await t.close(); });

const run = (api: { post: typeof t.api.post }, spec: unknown, extra: object = {}) => api.post('/api/reports/run', { spec, ...extra });
const byLabel = (body: any, key = 'a0') => Object.fromEntries(body.rows.map((r: any) => [r.d.g0, r.v[key]]));

describe('report query: validation', () => {
  it('refuses unknown record types, fields, comparisons and shapes', async () => {
    const bad = async (spec: unknown) => { const r = await run(t.api, spec); expect(r.status, JSON.stringify(spec)).toBe(400); return r.body.error; };
    expect((await bad({ type: 'nothing' })).code).toBe('bad_report');
    await bad({});
    await bad({ type: 'rt_thing', columns: ['nope'] });
    await bad({ type: 'rt_thing', columns: ['name; drop table rt_things'] });
    await bad({ type: 'rt_thing', columns: ['name"'] });
    await bad({ type: 'rt_thing', columns: ['site_id.password_hash'] });
    await bad({ type: 'rt_thing', columns: ['owner_id.password_hash'] });
    await bad({ type: 'rt_thing', columns: ['site_id.region.name'] });
    await bad({ type: 'rt_thing', filters: { op: 'and', items: [{ field: 'amount', op: 'gt', value: 'lots' }] } });
    await bad({ type: 'rt_thing', filters: { op: 'and', items: [{ field: 'name', op: 'sideways', value: 'x' }] } });
    await bad({ type: 'rt_thing', filters: { op: 'and', items: [{ field: 'opened_on', op: 'eq', value: "2026-01-01'; --" }] } });
    await bad({ type: 'rt_thing', filters: { op: 'and', items: [{ field: 'owner_id', op: 'in', value: ['not-an-id'] }] } });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'notes' }] });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status' }, { field: 'department' }, { field: 'active' }] });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status', bucket: 'month' }] });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status' }], aggregates: [{ fn: 'sum', field: 'name' }] });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status' }], aggregates: [{ fn: 'median', field: 'amount' }] });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status' }], pivot: true });
    await bad({ type: 'rt_thing', groupBy: [{ field: 'status' }], sort: [{ by: 'a0; drop table x' }] });
    // The reporting module's own records are not reportable (their sharing rules are not row rules).
    await bad({ type: 'report_definition' });
    expect((await t.db.one<{ n: number }>('select count(*)::int n from rt_things'))!.n).toBe(6);
  });

  it('treats values as values, never as SQL', async () => {
    const r = await run(t.api, { type: 'rt_thing', filters: { op: 'and', items: [{ field: 'name', op: 'contains', value: "%' or 1=1 --" }] } });
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(0);
  });

  it('caps the number of rows and says so', async () => {
    const r = await run(t.api, { type: 'rt_thing', columns: ['name'], sort: [{ by: 'name' }], limit: 2 });
    expect(r.body.rows.map((x: any) => x.v.c0)).toEqual(['A', 'B']);
    expect(r.body.truncated).toBe(true);
    expect(r.body.total).toBe(6);
    expect((await run(t.api, { type: 'rt_thing', columns: ['name'], limit: 999999 })).body.rows.length).toBe(6);
  });
});

describe('report query: permissions and restricted records', () => {
  it('needs permission to run reports and to view the record type', async () => {
    expect((await run(t.anon, { type: 'rt_thing' })).status).toBe(401);
    // Auditor: neither reports.view nor dashboards.view.
    expect((await run(await t.as('auditor'), { type: 'rt_thing' })).status).toBe(403);
    // Executive viewer: may run reports, but holds no permission on the fixture's module.
    const exec = await t.as('executive_viewer');
    const r = await run(exec, { type: 'rt_thing' });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain('Amount');
    // A wholly restricted type needs security.view as well as its module.
    expect((await run(await t.as('agent'), { type: 'rt_box' })).status).toBe(403);
  });

  it('hides restricted rows, and every count that would reveal them, without security.view', async () => {
    const agent = await t.as('agent');
    const lead = await t.as('security_lead');
    const rows = await run(agent, { type: 'rt_thing', columns: ['name'] });
    expect(rows.body.total).toBe(5);
    expect(rows.body.rows.map((x: any) => x.v.c0)).not.toContain('R');
    expect((await run(lead, { type: 'rt_thing', columns: ['name'] })).body.total).toBe(6);

    const spec = { type: 'rt_thing', groupBy: [{ field: 'status' }], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'amount' }, { fn: 'max', field: 'amount' }, { fn: 'pct' }] };
    const a = (await run(agent, spec)).body;
    expect(byLabel(a)).toEqual({ 'Brand new': 1, 'In hand': 2, Finished: 2 });
    expect(byLabel(a, 'a1')['In hand']).toBe(500);
    expect(byLabel(a, 'a2')['In hand']).toBe(300);
    expect(byLabel(a, 'a3')['In hand']).toBe(40);
    const l = (await run(lead, spec)).body;
    expect(byLabel(l)['In hand']).toBe(3);
    expect(byLabel(l, 'a1')['In hand']).toBe(1500);

    // The same answer as the generic list and stats give.
    expect((await agent.get('/api/rt-things')).body.total).toBe(5);
    expect((await agent.get('/api/rt-things/stats?group=status')).body.total).toBe(5);

    // Totals, pivots and a filter aimed at the hidden row.
    expect((await run(agent, { type: 'rt_thing', aggregates: [{ fn: 'sum', field: 'amount' }] })).body.rows[0].v.a0).toBe(1000);
    expect((await run(agent, { type: 'rt_thing', filters: { op: 'and', items: [{ field: 'amount', op: 'gte', value: 1000 }] } })).body.total).toBe(0);
    expect((await run(agent, { type: 'rt_thing', filters: { op: 'or', items: [{ field: 'restricted', op: 'true' }, { field: 'name', op: 'eq', value: 'R' }] } })).body.total).toBe(0);
    const p = (await run(agent, { type: 'rt_thing', groupBy: [{ field: 'department' }, { field: 'status' }], pivot: true })).body.pivot;
    expect(p.grand).toBe(5);
  });

  it('does not join, label or group by related records the caller may not see', async () => {
    const agent = await t.as('agent');
    // Fields of a restricted related type are refused outright.
    expect((await run(agent, { type: 'rt_thing', columns: ['name', 'box_id.colour'] })).status).toBe(400);
    expect((await run(agent, { type: 'rt_thing', groupBy: [{ field: 'box_id.colour' }] })).status).toBe(400);
    // Someone with security.view but without the other module is refused too.
    const lead = await t.as('security_lead');
    const ok = await run(lead, { type: 'rt_thing', columns: ['name', 'box_id', 'box_id.colour'], filters: { op: 'and', items: [{ field: 'name', op: 'eq', value: 'R' }] } });
    expect(ok.status).toBe(200);
    expect(ok.body.rows[0].d.c1).toBe('Sealed box');
    expect(ok.body.rows[0].v.c2).toBe('red');
    expect(ok.body.restricted).toBe(true);
    expect(ok.body.recordTypes.sort()).toEqual(['rt_box', 'rt_thing']);
    // The catalogue offers only what the caller may use.
    const cat = (await agent.get('/api/reports/catalogue')).body.types;
    expect(cat.find((x: any) => x.type === 'rt_box')).toBeUndefined();
    const thing = cat.find((x: any) => x.type === 'rt_thing');
    expect(thing.fields.some((f: any) => f.path === 'site_id.region')).toBe(true);
    expect(thing.fields.some((f: any) => f.path.startsWith('box_id.'))).toBe(false);
    expect(cat.some((x: any) => x.type === 'report_definition')).toBe(false);
  });
});

describe('report query: grouping, buckets and aggregates on the fixed data set', () => {
  it('counts, sums, averages, minimum, maximum and share of total', async () => {
    const r = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'status' }], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'amount' }, { fn: 'avg', field: 'amount' }, { fn: 'min', field: 'amount' }, { fn: 'max', field: 'amount' }, { fn: 'pct' }] });
    expect(r.status).toBe(200);
    // Lookup groups come back in the list's configured order, with labels and colours.
    expect(r.body.rows.map((x: any) => x.d.g0)).toEqual(['Brand new', 'In hand', 'Finished']);
    expect(r.body.rows[1].c.g0).toBe('amber');
    expect(r.body.rows[1].v).toEqual({ g0: 'open', a0: 3, a1: 1500, a2: 500, a3: 200, a4: 1000, a5: 50 });
    expect(r.body.rows[2].v).toMatchObject({ a0: 2, a1: 400, a2: 400, a5: 33.3 });
    expect(r.body.total).toBe(6);
    expect(r.body.rows[1].drill).toBe('f.status=open');
    const share = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'department' }], aggregates: [{ fn: 'pct', field: 'amount' }] });
    expect(byLabel(share.body)).toEqual({ Finance: 65, Operations: 35, None: null });
  });

  it('buckets dates by day, week, month, quarter and year in the organisation time zone', async () => {
    const by = async (field: string, bucket: string) => (await run(t.api, { type: 'rt_thing', groupBy: [{ field, bucket }] })).body;
    // "B" (03:00 UTC on 1 February) belongs to January where the organisation is.
    expect(byLabel(await by('opened_at', 'month'))).toEqual({ 'Jan 2026': 2, 'Feb 2026': 2, 'Apr 2026': 2 });
    expect(byLabel(await by('opened_on', 'month'))).toEqual({ 'Jan 2026': 2, 'Feb 2026': 2, 'Apr 2026': 2 });
    expect(byLabel(await by('opened_at', 'quarter'))).toEqual({ 'Q1 2026': 4, 'Q2 2026': 2 });
    expect(byLabel(await by('opened_at', 'year'))).toEqual({ 2026: 6 });
    const days = await by('opened_at', 'day');
    expect(byLabel(days)['31 Jan 2026']).toBe(1);
    expect(byLabel(days)['1 Feb 2026']).toBeUndefined();
    const weeks = await by('opened_on', 'week');
    expect(byLabel(weeks)).toMatchObject({ 'Week of 5 Jan 2026': 1, 'Week of 9 Feb 2026': 2, 'Week of 30 Mar 2026': 2 });
    // A bucket drills down to the list with a half-open date range.
    const feb = (await by('opened_at', 'month')).rows.find((x: any) => x.d.g0 === 'Feb 2026');
    expect(decodeURIComponent(feb.drill)).toBe('f.opened_at.gte=2026-02-01&f.opened_at.lt=2026-03-01');
    const behind = await t.api.get(`/api/rt-things?${feb.drill}`);
    expect(behind.body.rows.map((x: any) => x.name).sort()).toEqual(['C', 'R']);
  });

  it('filters with AND and OR groups and the comparison that suits each field type', async () => {
    const count = async (filters: unknown) => { const r = await run(t.api, { type: 'rt_thing', filters }); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body.total; };
    const c = (field: string, op: string, value?: unknown) => ({ field, op, value });
    expect(await count({ op: 'or', items: [c('status', 'in', ['new']), c('amount', 'gte', 400)] })).toBe(3);
    expect(await count({ op: 'and', items: [c('status', 'in', ['open']), { op: 'or', items: [c('department', 'eq', 'Operations'), c('amount', 'gt', 500)] }] })).toBe(2);
    expect(await count({ op: 'and', items: [c('amount', 'empty')] })).toBe(1);
    expect(await count({ op: 'and', items: [c('amount', 'between', [200, 400])] })).toBe(3);
    expect(await count({ op: 'and', items: [c('name', 'starts', 'a')] })).toBe(1);
    expect(await count({ op: 'and', items: [c('status', 'nin', ['done'])] })).toBe(4);
    expect(await count({ op: 'and', items: [c('active', 'false')] })).toBe(1);
    expect(await count({ op: 'and', items: [c('owner_id', 'me')] })).toBe(1);
    expect(await count({ op: 'and', items: [c('site_id', 'in', [ids.s2.id])] })).toBe(2);
    expect(await count({ op: 'and', items: [c('opened_on', 'between', ['2026-01-20', '2026-02-10'])] })).toBe(2);
    expect(await count({ op: 'and', items: [c('opened_at', 'lt', '2026-02-01')] })).toBe(2);
    expect(await count({ op: 'and', items: [c('opened_at', 'eq', '2026-01-31')] })).toBe(1);
    expect(await count({ op: 'and', items: [c('site_id.region', 'eq', 'Coast')] })).toBe(2);
    const relative = await t.api.post('/api/reports/run', { spec: { type: 'rt_thing', filters: { op: 'and', items: [c('created_at', 'last_days', 7)] } } });
    expect(relative.body.total).toBe(6);
  });

  it('selects, groups and sorts by fields of directly related records', async () => {
    const g = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'site_id.region' }], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'qty' }] });
    expect(byLabel(g.body)).toEqual({ Upland: 3, Coast: 2, None: 1 });
    expect(byLabel(g.body, 'a1')).toEqual({ Upland: 13, Coast: 7, None: 5 });
    const rows = await run(t.api, { type: 'rt_thing', columns: ['name', 'site_id', 'site_id.region', 'owner_id', 'owner_id.email', 'status', 'opened_on'], sort: [{ by: 'site_id.region', dir: 'asc' }, { by: 'name', dir: 'desc' }] });
    expect(rows.body.rows[0].v).toMatchObject({ c0: 'D', c2: 'Coast' });
    const a = rows.body.rows.find((x: any) => x.v.c0 === 'A');
    expect(a.d).toMatchObject({ c1: 'North', c3: 'Test Admin', c5: 'Brand new', c6: '5 Jan 2026' });
    expect(a.v.c4).toBe('admin@example.test');
    expect(a.id).toBeTruthy();
  });

  it('pivots two dimensions into a matrix with totals', async () => {
    const r = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'department' }, { field: 'status' }], pivot: true, sort: [{ by: 'g0' }] });
    const p = r.body.pivot;
    expect(p.cols.map((x: any) => x.label)).toEqual(['Brand new', 'In hand', 'Finished']);
    expect(p.rows.map((x: any) => x.label)).toEqual(['Finance', 'Operations', 'None']);
    expect(p.cells.map((line: any[]) => line.map((x) => x?.v ?? null))).toEqual([[1, 2, null], [null, 1, 1], [null, null, 1]]);
    expect(p.rowTotals).toEqual([3, 2, 1]);
    expect(p.colTotals).toEqual([1, 3, 2]);
    expect(p.grand).toBe(6);
    expect(decodeURIComponent(p.cells[0][1].drill)).toBe('f.department=Finance&f.status=open');
    const months = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'status' }, { field: 'opened_on', bucket: 'quarter' }], aggregates: [{ fn: 'sum', field: 'amount' }], pivot: true });
    expect(months.body.pivot.cols.map((x: any) => x.label)).toEqual(['Q1 2026', 'Q2 2026']);
    expect(months.body.pivot.grand).toBe(2000);
  });

  it('applies dashboard-wide filters only where the record type has the field', async () => {
    const dept = await run(t.api, { type: 'rt_thing' }, { globals: { department: 'Finance' } });
    expect(dept.body.total).toBe(3);
    expect(dept.body.globalsApplied).toEqual(['department']);
    expect(decodeURIComponent(dept.body.drill)).toBe('f.department=Finance');
    const dated = await run(t.api, { type: 'rt_thing' }, { globals: { from: '2026-04-01', to: '2026-04-30' }, dateField: 'opened_on' });
    expect(dated.body.total).toBe(2);
    const site = await run(t.api, { type: 'rt_site' }, { globals: { department: 'Finance', owner: 'me' } });
    expect(site.body.total).toBe(2);
    expect(site.body.globalsApplied).toEqual([]);
  });
});

describe('report query: custom fields', () => {
  it('offers, filters, groups and totals fields an administrator added', async () => {
    const zone = await t.api.post('/api/admin/custom-fields', { record_type: 'rt_thing', label: 'Zone', key: 'zone', type: 'select', options: [{ value: 'north', label: 'North zone', color: 'blue' }, { value: 'south', label: 'South zone', color: 'teal' }] });
    expect(zone.status, JSON.stringify(zone.body)).toBe(201);
    expect((await t.api.post('/api/admin/custom-fields', { record_type: 'rt_thing', label: 'Score', key: 'score', type: 'number' })).status).toBe(201);
    const things = await t.db.query<{ id: string; name: string }>('select id, name from rt_things where deleted_at is null order by name');
    for (const [i, th] of things.entries()) {
      await t.ctx.resources.update('rt_thing', th.id, { cf_zone: i % 2 ? 'south' : 'north', cf_score: (i + 1) * 10 });
    }

    const cat = (await t.api.get('/api/reports/catalogue')).body.types.find((x: any) => x.type === 'rt_thing');
    expect(cat.fields.find((f: any) => f.path === 'cf_zone')).toMatchObject({ label: 'Zone', type: 'lookup', custom: true, group: true });
    expect(cat.fields.find((f: any) => f.path === 'cf_score')).toMatchObject({ type: 'number', sum: true });

    const g = await run(t.api, { type: 'rt_thing', groupBy: [{ field: 'cf_zone' }], aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'cf_score' }] });
    expect(g.status, JSON.stringify(g.body)).toBe(200);
    const n = things.length;
    expect(byLabel(g.body)).toEqual({ 'North zone': Math.ceil(n / 2), 'South zone': Math.floor(n / 2) });
    const total = things.reduce((s, _, i) => s + (i + 1) * 10, 0);
    expect(Object.values(byLabel(g.body, 'a1')).reduce((s: number, v: any) => s + Number(v), 0)).toBe(total);
    expect(decodeURIComponent(g.body.rows[0].drill)).toMatch(/^f\.cf_zone=(north|south)$/);

    const f = await run(t.api, { type: 'rt_thing', columns: ['name', 'cf_score', 'cf_zone'], filters: { op: 'and', items: [{ field: 'cf_score', op: 'gte', value: 40 }] }, sort: [{ by: 'cf_score', dir: 'desc' }] });
    expect(f.body.total).toBe(n - 3);
    expect(f.body.rows[0].v.c1).toBe(n * 10);
    // A saved report may use them; an injected key is still refused.
    expect((await t.api.post('/api/reports', { name: 'By zone', spec: { type: 'rt_thing', groupBy: [{ field: 'cf_zone' }] } })).status).toBe(201);
    expect((await run(t.api, { type: 'rt_thing', columns: ["cf_zone'||1"] })).status).toBe(400);
  });
});
