// Seeds the standard dashboards, reports and starter pack. Idempotent: an item is created once,
// found again by its key, and never overwritten, so edits made in the application are kept (and a
// standard item someone deleted stays deleted). The same in both profiles: nothing here is
// specific to an organization.
import { addMonths } from '../../../../shared/dates.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { BOARD_SUMMARY_EARLIER, CHANGE_SUCCESS_GAUGE_BEFORE, STANDARD_DASHBOARDS, STANDARD_FIGURES, STANDARD_PACK, STANDARD_REPORTS } from './standard.ts';

export async function seedStandard(ctx: ModuleContext, profile: 'pilot' | 'dev' = 'pilot'): Promise<string> {
  const exists = async (table: string, key: string) => ctx.db.one<{ id: string }>(`select id from ${table} where key = $1`, [key]);
  let reports = 0;
  let dashboards = 0;
  let packs = 0;
  let figures = 0;

  // Figures recorded over time (E41-04). Found again by key, deleted ones included, so a standard
  // figure someone removed stays removed.
  for (const f of STANDARD_FIGURES) {
    if (await exists('tracked_figures', f.key)) continue;
    await ctx.db.query(
      `insert into tracked_figures (key, name, description, source, metric_key, record_type, filters, group_field, sort) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
      [f.key, f.name, f.description, f.source, f.metric_key ?? null, f.record_type ?? null, f.filters ? JSON.stringify(f.filters) : null, f.group_field ?? null, (STANDARD_FIGURES.indexOf(f) + 1) * 10],
    );
    figures += 1;
  }
  if (profile === 'dev') await sampleFigureHistory(ctx);

  for (const r of STANDARD_REPORTS) {
    if (await exists('report_definitions', r.key)) continue;
    await ctx.resources.create('report_definition', {
      key: r.key, name: r.name, description: r.description, record_type: r.spec.type, spec: r.spec, chart: r.chart, sharing: 'everyone',
    });
    reports += 1;
  }

  for (const d of STANDARD_DASHBOARDS) {
    if (await exists('dashboards', d.key)) continue;
    await ctx.resources.create('dashboard', {
      key: d.key, name: d.name, description: d.description, widgets: d.widgets, filters: d.filters,
      layout: { columns: 12 }, refresh_seconds: d.refresh_seconds ?? null, sharing: 'everyone',
    });
    dashboards += 1;
  }

  if (!(await exists('report_packs', STANDARD_PACK.key))) {
    const sections = [];
    for (const s of STANDARD_PACK.sections) {
      if (s.kind === 'figure') {
        const figure = await exists('tracked_figures', s.figureKey);
        if (figure) sections.push({ kind: 'figure', figureId: figure.id, months: s.months ?? 12 });
        continue;
      }
      if (s.kind !== 'report') { sections.push(s); continue; }
      const report = await exists('report_definitions', s.reportKey);
      if (report) sections.push({ kind: 'report', reportId: report.id });
    }
    await ctx.resources.create('report_pack', {
      key: STANDARD_PACK.key, name: STANDARD_PACK.name, description: STANDARD_PACK.description,
      cover_title: STANDARD_PACK.cover_title, cover_subtitle: STANDARD_PACK.cover_subtitle, sections, sharing: 'everyone',
    });
    packs += 1;
  }
  return `${dashboards} dashboards, ${reports} reports, ${packs} packs, ${figures} figures added`;
}

/**
 * Invented month-end values for the eleven months before this one, for the `dev` profile only, so
 * the charts of the standard figures have a history to show. Only a figure with no values at all
 * gets them; the current month is left to be recorded for real. The numbers follow a gentle
 * pseudo-random walk from the figure's key, so a second seed gives the same history.
 */
async function sampleFigureHistory(ctx: ModuleContext): Promise<void> {
  const thisMonth = `${todayInZone().slice(0, 7)}-01`;
  for (const f of await ctx.db.query<Row>('select * from tracked_figures where key is not null and deleted_at is null')) {
    if (await ctx.db.one('select 1 from figure_values where figure_id = $1', [f.id])) continue;
    let seed = [...String(f.key)].reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) % 2147483647, 7);
    const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    const def = f.record_type ? ctx.resources.get(String(f.record_type)) : undefined;
    const list = f.group_field && def ? def.fields[String(f.group_field)]?.list : undefined;
    const groups = list ? (await ctx.lookups.values(list)).slice(0, 6) : [];
    const percent = String(f.metric_key ?? '').endsWith('_pct');
    let level = percent ? 70 + rand() * 15 : 4 + rand() * 10;
    const shares = groups.map(() => 0.5 + rand());
    for (let i = 11; i >= 1; i--) {
      const period = addMonths(thisMonth, -i);
      level = percent ? Math.min(99, Math.max(40, level + (rand() - 0.4) * 5)) : Math.max(0, level + (rand() - 0.55) * 3);
      const value = percent ? Math.round(level * 10) / 10 : Math.round(level);
      const sum = shares.reduce((a, b) => a + b, 0) || 1;
      let left = value;
      const parts = groups.map((g, k) => {
        const n = k === groups.length - 1 ? left : Math.min(left, Math.round((value * shares[k]) / sum));
        left -= n;
        return { value: g.value, label: g.label, color: g.color ?? null, count: n };
      }).filter((p) => p.count > 0);
      await ctx.db.query(
        `insert into figure_values (figure_id, period, kind, value, groups, recorded_at) values ($1, $2, 'month_end', $3, $4::jsonb, $5) on conflict do nothing`,
        [f.id, period, value, groups.length ? JSON.stringify(parts) : null, `${addMonths(period, 1)}T06:00:00Z`],
      );
    }
  }
}

/** JSON with object keys in order, so a stored dashboard (jsonb reorders keys) compares with a definition. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as Row).sort().filter((k) => (v as Row)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Brings an unedited Board summary up to the current standard one (wave 26: safety and operations first;
 * wave 27: the safety performance indicators, E46-68). Only while its widgets and description still read
 * exactly as one earlier version shipped; an edited board is left alone. Runs at every start (the module's
 * register), and changes the record through the registry, so it is audited.
 */
export async function refreshBoardSummary(ctx: ModuleContext): Promise<boolean> {
  // While the reports area is switched off its types are not in the registry: try again at the next start.
  if (!ctx.resources.get('dashboard')) return false;
  const board = await ctx.db.one<Row>(`select id, description, widgets from dashboards where key = 'board_summary' and deleted_at is null`);
  if (!board) return false;
  if (!BOARD_SUMMARY_EARLIER().some((b) => board.description === b.description && stable(board.widgets) === stable(b.widgets))) return false;
  const now = STANDARD_DASHBOARDS.find((d) => d.key === 'board_summary')!;
  await ctx.resources.update('dashboard', board.id, { description: now.description, widgets: now.widgets }, null, { via: 'the standard Board summary of this version' });
  return true;
}

/**
 * Wave 27 (E46-54): the IT leadership overview's change success gauge counted outcomes only. A gauge that
 * still reads exactly as it shipped becomes the one from the changes module's success rate, which also
 * counts a change that caused an incident as not successful. Any other widget, or an edited gauge, is
 * left alone. Runs at every start, through the registry (audited).
 */
export async function refreshChangeSuccessGauge(ctx: ModuleContext): Promise<boolean> {
  if (!ctx.resources.get('dashboard')) return false;
  const board = await ctx.db.one<Row>(`select id, widgets from dashboards where key = 'cio_overview' and deleted_at is null`);
  if (!board || !Array.isArray(board.widgets)) return false;
  const before = stable(CHANGE_SUCCESS_GAUGE_BEFORE);
  const i = (board.widgets as Row[]).findIndex((w) => stable(w) === before);
  if (i < 0) return false;
  const now = STANDARD_DASHBOARDS.find((d) => d.key === 'cio_overview')!.widgets.find((w) => w.id === CHANGE_SUCCESS_GAUGE_BEFORE.id)!;
  const widgets = (board.widgets as Row[]).map((w, k) => (k === i ? now : w));
  await ctx.resources.update('dashboard', board.id, { widgets }, null, { via: 'the change success rate of this version' });
  return true;
}
