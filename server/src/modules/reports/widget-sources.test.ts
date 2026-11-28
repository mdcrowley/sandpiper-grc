import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { refreshChangeSuccessGauge, seedStandard } from './seed.ts';
import { CHANGE_SUCCESS_GAUGE_BEFORE, STANDARD_DASHBOARDS } from './standard.ts';

// Wave 27: dashboard widgets whose figures come from another module (widget-sources.ts). E46-54: the
// standard "Change success rate" gauge counts a change that caused an incident as not successful, like
// the home widget. E46-68: the Board summary shows where each safety performance indicator stands, only
// while safety is on. Everything here is invented.

let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;
const run = (widget: unknown, globals: Record<string, string> = {}) => t.api.post('/api/dashboards/run-widget', { widget, globals });
const board = (key: string) => STANDARD_DASHBOARDS.find((d) => d.key === key)!;
const widget = (key: string, id: string) => board(key).widgets.find((w) => w.id === id)!;

beforeAll(async () => {
  process.env.GRC_MODULES = 'reports,changes,tickets,safety,fleet,admin,notifications,workflows';
  t = await testApp();
  await t.db.query('update sessions set confirmed_at = now()');
}, 120_000);
afterAll(async () => {
  await t?.close();
  process.env.GRC_MODULES = before;
});

describe('change success rate gauge (E46-54)', () => {
  const finished = async (title: string, outcome: string) => {
    const res = await t.api.post('/api/changes', {
      title, description: 'x', reason: 'y', implementation_plan: 'a', test_plan: 'b', backout_plan: 'c',
      status: 'completed', outcome, planned_start: `${dayInZone(-3)}T18:00:00Z`, planned_end: `${dayInZone(-3)}T20:00:00Z`, actual_end: `${dayInZone(-3)}T20:00:00Z`,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };

  it('counts a change that caused an incident as not successful, the same as the home figure', async () => {
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const caused = await finished('Invented depot router update', 'successful');
    await finished('Invented timetable import', 'successful');
    await finished('Invented kiosk swap', 'failed');
    expect((await t.api.post('/api/admin/data-load', { on: false })).status).toBeLessThan(300);
    const ticket = (await t.api.post('/api/tickets', { title: 'Invented depot network down', type: 'incident' })).body;
    expect((await t.api.post('/api/links', { from_type: 'change', from_id: caused, to_type: 'ticket', to_id: ticket.id, relation: 'caused' })).status).toBe(201);

    const g = widget('cio_overview', 'g2');
    expect(g.config).toMatchObject({ source: 'change_success', spec: { type: 'change' } });
    const res = await run(g);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', value: 1, denominator: 3 });
    const figure = (await t.api.get('/api/changes/success-rate')).body;
    expect([figure.successful, figure.finished, figure.caused_incident]).toEqual([1, 3, 1]);
    // The gauge as it shipped counted the outcome only: two of three.
    const old = (await run(CHANGE_SUCCESS_GAUGE_BEFORE)).body;
    expect([old.value, old.denominator]).toEqual([2, 3]);
    // The dashboard's dates narrow it: nothing finished in a window a year ago.
    const past = (await run(g, { from: dayInZone(-400), to: dayInZone(-370) })).body;
    expect(past).toMatchObject({ status: 'ok', value: 0, denominator: 0 });
    expect(past.result.globalsApplied).toEqual(['date']);
  });

  it('needs view permission on changes, like any widget about changes', async () => {
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('dash_reader_probe', 'Dashboard reader') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'dashboards.view'), ($1, 'reports.view')`, [role!.id]);
    const reader = await t.as('dash_reader_probe');
    const res = await reader.post('/api/dashboards/run-widget', { widget: widget('cio_overview', 'g2') });
    expect(res.body.status).toBe('forbidden');
  });

  it('brings an unedited gauge up to date and leaves an edited one alone', async () => {
    await seedStandard(t.ctx);
    const row = await t.db.one<{ id: string; widgets: any[] }>(`select id, widgets from dashboards where key = 'cio_overview'`);
    const old = row!.widgets.map((w) => (w.id === 'g2' ? CHANGE_SUCCESS_GAUGE_BEFORE : w));
    await t.db.query('update dashboards set widgets = $2::jsonb where id = $1', [row!.id, JSON.stringify(old)]);
    expect(await refreshChangeSuccessGauge(t.ctx)).toBe(true);
    const now = await t.db.one<{ widgets: any[] }>('select widgets from dashboards where id = $1', [row!.id]);
    expect(now!.widgets.find((w) => w.id === 'g2').config.source).toBe('change_success');
    expect(now!.widgets).toHaveLength(old.length);
    expect(await refreshChangeSuccessGauge(t.ctx)).toBe(false);
    const edited = old.map((w) => (w.id === 'g2' ? { ...CHANGE_SUCCESS_GAUGE_BEFORE, config: { ...CHANGE_SUCCESS_GAUGE_BEFORE.config, target: 90 } } : w));
    await t.db.query('update dashboards set widgets = $2::jsonb where id = $1', [row!.id, JSON.stringify(edited)]);
    expect(await refreshChangeSuccessGauge(t.ctx)).toBe(false);
  });
});

describe('safety indicators on the Board summary (E46-68)', () => {
  const b6 = () => widget('board_summary', 'b6');
  const b7 = () => widget('board_summary', 'b7');

  it('sits under the safety events and names safety_indicator as its type', () => {
    const ids = board('board_summary').widgets.map((w) => w.id);
    expect(ids.indexOf('b6')).toBe(ids.indexOf('b5') + 1);
    expect(ids.indexOf('b7')).toBe(ids.indexOf('b6') + 1);
    for (const w of [b6(), b7()]) expect(w.config).toMatchObject({ source: 'safety_indicators', spec: { type: 'safety_indicator' } });
    // Nothing overlaps: every later widget moved down.
    const cells = new Set<string>();
    for (const w of board('board_summary').widgets) {
      for (let x = w.x; x < w.x + w.w; x++) for (let y = w.y; y < w.y + w.h; y++) {
        expect(cells.has(`${x},${y}`), `${w.id} overlaps at ${x},${y}`).toBe(false);
        cells.add(`${x},${y}`);
      }
    }
  });

  it('counts the indicators that missed their target and lists each one', async () => {
    expect(t.app.hasDecorator('safetyIndicatorStatus')).toBe(true);
    const lastMonth = dayInZone(-40).slice(0, 7);
    const make = async (name: string, target: number) => (await t.api.post('/api/safety-indicators', { name, measure: 'count', event_types: ['near_miss'], target, target_direction: 'at_most' })).body;
    const tight = await make('Invented near misses (tight target)', 0);
    const loose = await make('Invented near misses (loose target)', 10);
    expect(tight.id && loose.id).toBeTruthy();
    const ev = await t.api.post('/api/safety-events', { title: 'Invented slip on the platform', event_type: 'near_miss', severity: 'minor', occurred_at: `${lastMonth}-10T09:00:00Z` });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const number = (await run(b6())).body;
    expect(number).toMatchObject({ status: 'ok', value: 1 });
    expect(number.result.route).toBe('/safety/indicators');
    const table = (await run(b7())).body;
    expect(table.status).toBe('ok');
    const row = (id: string) => table.result.rows.find((r: any) => r.id === id);
    expect(row(tight.id).v).toMatchObject({ c0: 'Invented near misses (tight target)', c4: 'Missed the target' });
    expect(row(tight.id).c.c4).toBe('red');
    expect(row(loose.id).v.c4).toBe('On target');
    // An indicator not shown on the dashboard is left out.
    await t.api.patch(`/api/safety-indicators/${loose.id}`, { active: false });
    expect((await run(b7())).body.result.rows.some((r: any) => r.id === loose.id)).toBe(false);
  });

  it('is not available while safety is off, and needs safety.view', async () => {
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('board_reader_probe', 'Board reader') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'dashboards.view')`, [role!.id]);
    const reader = await t.as('board_reader_probe');
    expect((await reader.post('/api/dashboards/run-widget', { widget: b7() })).body.status).toBe('forbidden');
    await t.ctx.settings.set('features', { safety: false });
    try {
      expect((await run(b6())).body.status).toBe('unavailable');
      expect((await t.api.get('/api/dashboards/switched-off-types')).body.types).toContain('safety_indicator');
    } finally {
      await t.ctx.settings.set('features', { safety: true });
    }
  });
});
