import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { addDays, addMonths } from '../../../../shared/dates.ts';
import { normalizePeriod, periodRange } from './periods.ts';

/**
 * Every profile: a standard report of the plan's measures and a "Strategy and performance" dashboard
 * (reference content, like the reports module's own), so measures feed dashboards and report packs.
 *
 * Dev profile only, all invented: one adopted strategic plan with goals, objectives, measures with
 * targets and actuals, initiatives and four quarters of updates; statistics series (trips, revenue
 * miles and hours by mode, safety events per 100,000 miles) with eighteen months of values; and a few
 * statistical submissions to an invented outside body.
 */

export const STRATEGY_REPORT_KEY = 'strategy_measures';
export const STRATEGY_DASHBOARD_KEY = 'strategy_overview';

const all = (...items: Row[]) => ({ op: 'and', items });
const c = (field: string, op: string, value?: unknown) => ({ field, op, value });

async function seedReporting(ctx: ModuleContext): Promise<string[]> {
  const out: string[] = [];
  if (!ctx.resources.get('report_definition') || !ctx.resources.get('dashboard')) return out;
  const has = async (table: string, key: string) => ctx.db.one<Row>(`select id from ${table} where key = $1`, [key]);
  if (!(await has('report_definitions', STRATEGY_REPORT_KEY))) {
    await ctx.resources.create('report_definition', {
      key: STRATEGY_REPORT_KEY, name: 'Strategic plan measures', record_type: 'strategic_measure', sharing: 'everyone',
      description: 'Every measure of the strategic plans with its latest actual, the target for that period and how it compares. Add it to a report pack for the board.',
      spec: { type: 'strategic_measure', columns: ['ref', 'title', 'objective_id', 'unit', 'baseline_value', 'latest_period', 'latest_target', 'latest_value', 'latest_state', 'owner_id'], sort: [{ by: 'ref', dir: 'asc' }] },
      chart: { kind: 'table' },
    });
    out.push('report');
  }
  if (!(await has('dashboards', STRATEGY_DASHBOARD_KEY))) {
    const w = (id: string, kind: string, title: string, x: number, y: number, ww: number, h: number, config: Row) => ({ id, kind, title, x, y, w: ww, h, config });
    await ctx.resources.create('dashboard', {
      key: STRATEGY_DASHBOARD_KEY, name: 'Strategy and performance', sharing: 'everyone', layout: { columns: 12 }, filters: [],
      description: 'Objectives and initiatives by status, measures against target and statistical reports coming due.',
      widgets: [
        w('n1', 'number', 'Objectives off track', 0, 0, 3, 2, { spec: { type: 'strategic_objective', filters: all(c('status', 'in', ['off_track'])) }, tone: 'bad' }),
        w('n2', 'number', 'Objectives at risk', 3, 0, 3, 2, { spec: { type: 'strategic_objective', filters: all(c('status', 'in', ['at_risk'])) } }),
        w('n3', 'number', 'Measures missing target', 6, 0, 3, 2, { spec: { type: 'strategic_measure', filters: all(c('latest_state', 'in', ['missed'])) }, tone: 'bad' }),
        w('n4', 'number', 'Statistical reports overdue', 9, 0, 3, 2, { spec: { type: 'stat_submission', filters: all(c('submitted_on', 'empty'), c('due_on', 'past')) }, tone: 'bad' }),
        w('c1', 'chart', 'Objectives by status', 0, 2, 4, 4, { spec: { type: 'strategic_objective', groupBy: [{ field: 'status' }] }, chart: { kind: 'donut' } }),
        w('c2', 'chart', 'Measures against target', 4, 2, 4, 4, { spec: { type: 'strategic_measure', groupBy: [{ field: 'latest_state' }] }, chart: { kind: 'bar' } }),
        w('c3', 'chart', 'Initiatives by stage', 8, 2, 4, 4, { spec: { type: 'strategic_initiative', groupBy: [{ field: 'stage' }] }, chart: { kind: 'hbar' } }),
        w('l1', 'list', 'Statistical reports due', 0, 6, 12, 4, { spec: { type: 'stat_submission', columns: ['report_name', 'recipient', 'period', 'due_on', 'status', 'owner_id'], filters: all(c('submitted_on', 'empty')), sort: [{ by: 'due_on', dir: 'asc' }] }, dateField: 'due_on' }),
      ],
    });
    out.push('dashboard');
  }
  return out;
}

const firstUser = async (ctx: ModuleContext) => (await ctx.db.one<Row>(`select id from users where status = 'active' and deleted_at is null order by created_at limit 1`))?.id ?? null;

/** The last `n` quarters ending with the current one, oldest first. */
function lastQuarters(n: number): string[] {
  const out: string[] = [];
  let d = dayInZone();
  for (let i = 0; i < n; i++) { const q = normalizePeriod('quarterly', d)!; out.unshift(q); d = addDays(periodRange(q)!.start, -1); }
  return out;
}

/** Ten days after the quarter ends, or today for the quarter still running. */
const reportedOn = (q: string, today: string) => { const d = addDays(periodRange(q)!.end, 10); return d > today ? today : d; };

const PLAN_TITLE ='[Sample] Strategic plan';

interface SampleObjective { code: string; title: string; statuses: string[]; measures: { title: string; unit: string; direction: string; baseline: number; targets: number[]; actuals: (number | null)[] }[]; initiatives: { title: string; stage: string; statuses: string[]; budget?: number }[] }
const SAMPLE_GOALS: { code: string; title: string; description: string; objectives: SampleObjective[] }[] = [
  {
    code: 'G1', title: '[Sample] Reliable service riders can count on', description: 'Run the service we publish, on time, every day.',
    objectives: [
      { code: '1.1', title: '[Sample] Improve on-time performance', statuses: ['at_risk', 'at_risk', 'on_track', 'on_track'],
        measures: [{ title: '[Sample] Bus on-time performance', unit: '%', direction: 'increase', baseline: 81.5, targets: [83, 84, 85, 86], actuals: [82.1, 83.4, 85.2, null] }],
        initiatives: [{ title: '[Sample] Transit signal priority on two corridors', stage: 'in_progress', statuses: ['on_track', 'at_risk', 'at_risk', 'on_track'], budget: 1200000 }] },
      { code: '1.2', title: '[Sample] Reduce missed trips', statuses: ['off_track', 'off_track', 'at_risk', 'at_risk'],
        measures: [{ title: '[Sample] Trips missed for lack of an operator', unit: '%', direction: 'decrease', baseline: 2.4, targets: [2.2, 2.0, 1.8, 1.6], actuals: [2.6, 2.3, 1.9, null] }],
        initiatives: [{ title: '[Sample] Operator recruitment and training academy', stage: 'in_progress', statuses: ['at_risk', 'at_risk', 'on_track', 'on_track'], budget: 450000 }] },
    ],
  },
  {
    code: 'G2', title: '[Sample] A safe system for riders and staff', description: 'Fewer safety events, and a strong safety culture.',
    objectives: [
      { code: '2.1', title: '[Sample] Reduce collisions per 100,000 revenue miles', statuses: ['on_track', 'on_track', 'on_track', 'on_track'],
        measures: [{ title: '[Sample] Collisions per 100,000 revenue miles', unit: 'per 100,000 miles', direction: 'decrease', baseline: 1.9, targets: [1.8, 1.8, 1.7, 1.7], actuals: [1.7, 1.6, 1.7, null] }],
        initiatives: [{ title: '[Sample] Collision avoidance training refresh', stage: 'completed', statuses: ['on_track', 'on_track', 'on_track', 'on_track'] }] },
    ],
  },
  {
    code: 'G3', title: '[Sample] Grow ridership and value for money', description: 'Win back riders and spend well.',
    objectives: [
      { code: '3.1', title: '[Sample] Grow ridership', statuses: ['on_track', 'at_risk', 'at_risk', 'off_track'],
        measures: [{ title: '[Sample] Unlinked passenger trips (millions a quarter)', unit: 'million trips', direction: 'increase', baseline: 4.1, targets: [4.2, 4.3, 4.4, 4.5], actuals: [4.2, 4.2, 4.1, null] }],
        initiatives: [{ title: '[Sample] Network redesign consultation', stage: 'planned', statuses: ['on_track', 'on_track', 'at_risk', 'off_track'], budget: 300000 }] },
    ],
  },
];

const SAMPLE_SERIES = [
  { code: 'UPT', name: '[Sample] Unlinked passenger trips', unit: 'trips', frequency: 'monthly', breakdown_label: 'Mode', breakdowns: ['Bus', 'Light rail', 'Paratransit'], base: [1100000, 380000, 21000] },
  { code: 'VRM', name: '[Sample] Revenue vehicle miles', unit: 'miles', frequency: 'monthly', breakdown_label: 'Mode', breakdowns: ['Bus', 'Light rail', 'Paratransit'], base: [1450000, 210000, 160000] },
  { code: 'VRH', name: '[Sample] Revenue vehicle hours', unit: 'hours', frequency: 'monthly', breakdown_label: 'Mode', breakdowns: ['Bus', 'Light rail', 'Paratransit'], base: [102000, 11500, 10400] },
  { code: 'SEV', name: '[Sample] Safety events per 100,000 revenue miles', unit: 'per 100,000 miles', frequency: 'quarterly', breakdown_label: '', breakdowns: [], base: [1.7], decimals: 2 },
  { code: 'VOMS', name: '[Sample] Vehicles operated in maximum service', unit: 'vehicles', frequency: 'yearly', breakdown_label: 'Mode', breakdowns: ['Bus', 'Light rail', 'Paratransit'], base: [312, 28, 64] },
];

export async function seedStrategy(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  const made = await seedReporting(ctx);
  if (opts.profile !== 'dev') return made.length ? `standard ${made.join(' and ')}` : 'nothing to load (sample plans and statistics are dev profile only)';
  const owner = await firstUser(ctx);
  const today = dayInZone();
  const year = Number(today.slice(0, 4));
  const quarters = lastQuarters(4);
  let created = 0;

  let plan = await ctx.db.one<Row>('select * from strategy_plans where title = $1 and deleted_at is null', [PLAN_TITLE]);
  if (!plan) {
    plan = await ctx.resources.create('strategic_plan', {
      title: PLAN_TITLE, status: 'adopted', owner_id: owner, adopted_on: `${year - 1}-01-15`,
      period_start: `${year - 1}-01-01`, period_end: `${year + 3}-12-31`,
      description: 'An invented five-year plan for an invented bus and light-rail operator: reliable, safe service that more people ride.',
      notes: 'Invented sample plan.',
    });
    for (const [gi, g] of SAMPLE_GOALS.entries()) {
      const goal = await ctx.resources.create('strategic_goal', { plan_id: plan.id, code: g.code, title: g.title, description: g.description, sort: (gi + 1) * 10, owner_id: owner });
      for (const [oi, o] of g.objectives.entries()) {
        const obj = await ctx.resources.create('strategic_objective', { goal_id: goal.id, code: o.code, title: o.title, owner_id: owner, sort: (oi + 1) * 10, target_date: `${year + 3}-12-31` });
        created += 1;
        for (const m of o.measures) {
          const measure = await ctx.resources.create('strategic_measure', {
            objective_id: obj.id, title: m.title, unit: m.unit, direction: m.direction, frequency: 'quarterly', baseline_value: m.baseline,
            baseline_period: String(year - 2), source: 'manual', owner_id: owner,
          });
          for (const [qi, q] of quarters.entries()) {
            await ctx.resources.create('measure_value', { measure_id: measure.id, period: q, target: m.targets[qi], actual: m.actuals[qi], note: m.actuals[qi] === null ? null : 'Invented figure.' });
          }
        }
        for (const [qi, q] of quarters.entries()) {
          await ctx.resources.create('strategy_update', {
            objective_id: obj.id, period: q, status: o.statuses[qi], reported_on: reportedOn(q, today),
            narrative: `[Sample] Invented update for ${q}: progress against the measures, what is in the way and what happens next quarter.`,
          });
        }
        for (const i of o.initiatives) {
          const ini = await ctx.resources.create('strategic_initiative', {
            objective_id: obj.id, title: i.title, stage: i.stage, owner_id: owner, start_on: `${year - 1}-04-01`, end_on: `${year + 1}-06-30`,
            budget_amount: i.budget ?? null, budget_reference: i.budget ? '[Sample] Capital program' : null,
          });
          for (const [qi, q] of quarters.entries()) {
            await ctx.resources.create('strategy_update', { initiative_id: ini.id, period: q, status: i.statuses[qi], narrative: `[Sample] Invented update for ${q}.`, reported_on: reportedOn(q, today) });
          }
        }
      }
    }
  }

  // Statistics: eighteen months (six quarters, two years) of invented values with a gentle trend.
  let values = 0;
  for (const [si, s] of SAMPLE_SERIES.entries()) {
    let series = await ctx.db.one<Row>('select * from strategy_stat_series where name = $1 and deleted_at is null', [s.name]);
    if (series) continue;
    series = await ctx.resources.create('stat_series', {
      code: s.code, name: s.name, unit: s.unit, frequency: s.frequency, breakdown_label: s.breakdown_label || null, breakdowns: s.breakdowns.join('\n') || null,
      decimals: s.decimals ?? 0, owner_id: owner, sort: (si + 1) * 10, description: 'Invented sample series.',
    });
    const periods: string[] = [];
    const count = s.frequency === 'monthly' ? 18 : s.frequency === 'quarterly' ? 6 : 2;
    let d = periodRange(normalizePeriod(s.frequency, today)!)!.start;
    for (let i = 0; i < count; i++) {
      d = s.frequency === 'monthly' ? addMonths(d, -1) : s.frequency === 'quarterly' ? addMonths(d, -3) : addMonths(d, -12);
      periods.unshift(normalizePeriod(s.frequency, d)!);
    }
    for (const [pi, p] of periods.entries()) {
      const parts = s.breakdowns.length ? s.breakdowns : [''];
      for (const [bi, b] of parts.entries()) {
        const season = 1 + 0.06 * Math.sin(((pi % 12) / 12) * 2 * Math.PI);
        const raw = s.base[bi] * season * (1 + pi * 0.004);
        const value = (s.decimals ?? 0) > 0 ? Math.round(raw * 100) / 100 : Math.round(raw);
        await ctx.resources.create('stat_value', { series_id: series.id, period: p, breakdown: b, value });
        values += 1;
      }
    }
  }

  // A measure that takes its actuals from a statistics series (E46-59): bus trips a quarter, the sum
  // of the monthly bus values; it fills in every quarter the series has values for. The standard
  // dashboard shows it as a measure widget (E46-60).
  const SERIES_MEASURE = '[Sample] Bus trips a quarter (from statistics)';
  const upt = await ctx.db.one<Row>(`select id from strategy_stat_series where code = 'UPT' and name like '[Sample]%' and deleted_at is null`);
  const growth = await ctx.db.one<Row>(`select o.id from strategy_objectives o where o.plan_id = $1 and o.code = '3.1' and o.deleted_at is null`, [plan.id]);
  let fromSeries = await ctx.db.one<Row>('select id from strategy_measures where title = $1 and deleted_at is null', [SERIES_MEASURE]);
  if (upt && growth && !fromSeries) {
    fromSeries = await ctx.resources.create('strategic_measure', {
      objective_id: growth.id, title: SERIES_MEASURE, unit: 'trips', direction: 'increase', frequency: 'quarterly', source: 'series',
      series_id: upt.id, series_breakdown: 'Bus', series_aggregation: 'sum', owner_id: owner, baseline_period: String(year - 2), baseline_value: 3200000,
      description: 'Invented: the bus breakdown of the unlinked passenger trips series, added up over the quarter.',
    });
    for (const q of quarters) {
      const row = await ctx.db.one<Row>('select id from strategy_measure_values where measure_id = $1 and period = $2 and deleted_at is null', [fromSeries.id, q]);
      if (row) await ctx.resources.update('measure_value', String(row.id), { target: 3400000 });
      else await ctx.resources.create('measure_value', { measure_id: fromSeries.id, period: q, target: 3400000 });
    }
  }
  const dash = await ctx.db.one<Row>('select id, widgets from dashboards where key = $1 and deleted_at is null', [STRATEGY_DASHBOARD_KEY]);
  const widgets = (dash?.widgets as Row[] | undefined) ?? [];
  if (dash && fromSeries && !widgets.some((x) => x.kind === 'measure')) {
    await ctx.resources.update('dashboard', String(dash.id), {
      widgets: [...widgets, { id: 'm1', kind: 'measure', title: 'Bus trips a quarter', x: 0, y: 10, w: 6, h: 4, config: { measureId: fromSeries.id, recordType: 'strategic_measure', periods: 8 } }],
    });
  }

  // Submissions to an invented outside body: one submitted, one coming due, one overdue.
  let submissions = 0;
  const SUBS = [
    { report_name: '[Sample] Monthly ridership and service report', period: normalizePeriod('monthly', addMonths(today, -2))!, due: addDays(today, -35), submitted: addDays(today, -37), status: 'accepted', confirmation: 'INV-2291' },
    { report_name: '[Sample] Monthly ridership and service report', period: normalizePeriod('monthly', addMonths(today, -1))!, due: addDays(today, 6), status: 'in_preparation' },
    { report_name: '[Sample] Quarterly safety and security report', period: lastQuarters(2)[0], due: addDays(today, -4), status: 'planned' },
    { report_name: '[Sample] Annual asset and fleet inventory', period: String(year - 1), due: addDays(today, 60), status: 'planned' },
  ];
  for (const s of SUBS) {
    if (await ctx.db.one('select 1 from strategy_submissions where report_name = $1 and period = $2 and deleted_at is null', [s.report_name, s.period])) continue;
    await ctx.resources.create('stat_submission', {
      report_name: s.report_name, recipient: '[Sample] Regional transit data office', period: s.period, due_on: s.due, owner_id: owner,
      status: s.status, submitted_on: s.submitted ?? null, submitted_by: s.submitted ? owner : null, confirmation: s.confirmation ?? null,
      notes: 'Invented sample submission.',
    });
    submissions += 1;
  }
  return `${made.length ? `standard ${made.join(' and ')}, ` : ''}objectives ${created}, statistic values ${values}, submissions ${submissions}`;
}
