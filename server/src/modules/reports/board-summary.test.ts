import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../test/helpers.ts';
import { refreshBoardSummary, seedStandard } from './seed.ts';
import { BOARD_SUMMARY_BEFORE, BOARD_SUMMARY_EARLIER, STANDARD_DASHBOARDS } from './standard.ts';

// Wave 26: the Board summary is organization-wide, with safety and operations first; an unedited board
// from an earlier version is brought up to it, an edited one is left alone. Wave 27 (E46-68): the safety
// performance indicators follow the safety events.

let t: Awaited<ReturnType<typeof testApp>>;
const before = process.env.GRC_MODULES;

beforeAll(async () => {
  process.env.GRC_MODULES = 'reports,safety,fleet,audits,continuity,tickets,risks,projects,inventory,admin,secincidents,vulnerabilities,vendors,frameworks,notifications,workflows';
  t = await testApp();
}, 120_000);
afterAll(async () => {
  await t?.close();
  process.env.GRC_MODULES = before;
});

describe('the Board summary', () => {
  it('leads with safety, then operations, and names no area in its own text', () => {
    const board = STANDARD_DASHBOARDS.find((d) => d.key === 'board_summary')!;
    const types = board.widgets.filter((w) => w.kind !== 'text').map((w) => (w.config as any).spec.type);
    expect(types.slice(0, 5)).toEqual(['safety_event', 'safety_event', 'hazard', 'safety_event', 'safety_event']);
    expect(types.slice(5, 7)).toEqual(['safety_indicator', 'safety_indicator']);
    expect(types.slice(7, 11)).toEqual(['vehicle', 'inspection', 'emergency_activation', 'continuity_plan']);
    const intro = String((board.widgets[0].config as any).markdown);
    expect(intro).not.toMatch(/technology|security|safety/i);
  });

  it('runs every widget for an administrator', async () => {
    await seedStandard(t.ctx);
    const board = await t.db.one<{ id: string; widgets: any[] }>(`select id, widgets from dashboards where key = 'board_summary'`);
    for (const w of board!.widgets) {
      const res = await t.api.post('/api/dashboards/run-widget', { widget: w });
      expect(res.status, w.id).toBe(200);
      expect(res.body.status, `${w.id}: ${JSON.stringify(res.body)}`).toBe('ok');
    }
  });

  it('brings an unedited earlier board up to date, and leaves an edited one alone', async () => {
    const board = await t.db.one<{ id: string }>(`select id from dashboards where key = 'board_summary'`);
    await t.db.query('update dashboards set description = $2, widgets = $3::jsonb where id = $1', [board!.id, BOARD_SUMMARY_BEFORE.description, JSON.stringify(BOARD_SUMMARY_BEFORE.widgets)]);
    expect(await refreshBoardSummary(t.ctx)).toBe(true);
    const now = await t.db.one<{ widgets: any[]; description: string }>('select widgets, description from dashboards where id = $1', [board!.id]);
    expect(now!.widgets.map((w) => w.id)).toContain('b1');
    expect(await refreshBoardSummary(t.ctx)).toBe(false);
    // The wave 26 board, unedited, gets the safety indicators.
    const wave26 = BOARD_SUMMARY_EARLIER()[1];
    await t.db.query('update dashboards set description = $2, widgets = $3::jsonb where id = $1', [board!.id, wave26.description, JSON.stringify(wave26.widgets)]);
    expect(await refreshBoardSummary(t.ctx)).toBe(true);
    expect((await t.db.one<{ widgets: any[] }>('select widgets from dashboards where id = $1', [board!.id]))!.widgets.map((w) => w.id)).toContain('b7');

    const edited = [...BOARD_SUMMARY_BEFORE.widgets.slice(1)];
    await t.db.query('update dashboards set description = $2, widgets = $3::jsonb where id = $1', [board!.id, BOARD_SUMMARY_BEFORE.description, JSON.stringify(edited)]);
    expect(await refreshBoardSummary(t.ctx)).toBe(false);
    const audit = await t.db.one<{ n: number }>(`select count(*)::int as n from audit_events where record_type = 'dashboard' and record_id = $1`, [board!.id]);
    expect(audit!.n).toBeGreaterThan(0);
  });
});
