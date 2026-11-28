// What the strategy pages read: the current status of objectives and initiatives, the latest value of
// each measure, the scorecard and the quarterly matrix of a plan, and the figures of the area.
import type { Queryable } from '../../core/db.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { normalizePeriod, periodRange, quartersBetween } from './periods.ts';

const day = (v: unknown) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** An objective's or initiative's status becomes that of its latest update (latest quarter, then latest report). */
export async function refreshStatus(db: Queryable, kind: 'objective' | 'initiative', id: string): Promise<void> {
  const col = kind === 'objective' ? 'objective_id' : 'initiative_id';
  const table = kind === 'objective' ? 'strategy_objectives' : 'strategy_initiatives';
  const latest = await db.one<Row>(
    `select status, period from strategy_updates where ${col} = $1 and deleted_at is null
     order by period desc, reported_on desc nulls last, created_at desc limit 1`, [id]);
  await db.query(`update ${table} set status = $2, status_period = $3 where id = $1`, [id, latest?.status ?? null, latest?.period ?? null]);
}

/** A measure's latest actual (latest period with an actual), its target and how it compares. */
export async function refreshMeasure(db: Queryable, id: string): Promise<void> {
  const latest = await db.one<Row>(
    `select period, actual, target, state from strategy_measure_values
     where measure_id = $1 and deleted_at is null and actual is not null order by period_start desc limit 1`, [id]);
  await db.query('update strategy_measures set latest_period = $2, latest_value = $3, latest_target = $4, latest_state = $5 where id = $1',
    [id, latest?.period ?? null, latest?.actual ?? null, latest?.target ?? null, latest?.state ?? null]);
}

// ---------- automatic measures ----------

/** The value of a metric or a figure over time for a period: its last month's value. null when none. */
export async function sourceValue(ctx: ModuleContext, measure: Row, period: string): Promise<number | null> {
  const range = periodRange(period);
  if (!range) return null;
  const today = todayInZone();
  if (range.start > today) return null;
  const lastMonth = `${(range.end < today ? range.end : today).slice(0, 7)}-01`;
  if (measure.source === 'metric') {
    const metric = metricsAvailable(ctx.app, ctx.resources).find((m) => m.key === measure.metric_key);
    if (!metric) return null;
    const v = await metric.compute(ctx, lastMonth);
    return v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v);
  }
  if (measure.source === 'figure' && measure.figure_id && ctx.resources.get('report_definition')) {
    const row = await ctx.db.one<Row>(
      `select v.value from figure_values v join tracked_figures f on f.id = v.figure_id and f.deleted_at is null
       where v.figure_id = $1 and v.period = $2::date order by (v.kind = 'month_end') desc, v.recorded_at desc limit 1`,
      [measure.figure_id, lastMonth]).catch(() => undefined);
    return row?.value === null || row?.value === undefined ? null : Number(row.value);
  }
  return null;
}

/**
 * Takes the actual of an automatic measure for a period from its source and stores it as the
 * period's value (system work: audited, no person). Answers the value, or null when there is none.
 */
export async function pullMeasure(ctx: ModuleContext, measure: Row, period: string): Promise<{ value: number | null; row: Row | null }> {
  const p = normalizePeriod(measure.frequency ?? 'quarterly', period);
  if (!p) ctx.fail(400, 'validation', 'Check the highlighted fields.', { period: 'Give a period that suits the measure\'s frequency.' });
  const value = await sourceValue(ctx, measure, p!);
  if (value === null) return { value: null, row: null };
  const existing = await ctx.db.one<Row>('select id, actual from strategy_measure_values where measure_id = $1 and period = $2 and deleted_at is null', [measure.id, p]);
  if (existing && Number(existing.actual) === value && existing.actual !== null) return { value, row: existing };
  const row = existing
    ? await ctx.resources.update('measure_value', String(existing.id), { actual: value, value_source: measure.source })
    : await ctx.resources.create('measure_value', { measure_id: measure.id, period: p, actual: value, value_source: measure.source });
  return { value, row };
}

/** The daily job: the current and the previous period of every automatic measure. */
export async function pullAll(ctx: ModuleContext): Promise<{ measures: number; values: number }> {
  if (!ctx.resources.get('strategic_measure')) return { measures: 0, values: 0 };
  const measures = await ctx.db.query<Row>(`select * from strategy_measures where deleted_at is null and source in ('metric', 'figure')`);
  const today = todayInZone();
  let values = 0;
  for (const m of measures) {
    const now = normalizePeriod(m.frequency ?? 'quarterly', today)!;
    const before = normalizePeriod(m.frequency ?? 'quarterly', addDays(periodRange(now)!.start, -1))!;
    for (const p of [before, now]) {
      try { if ((await pullMeasure(ctx, m, p)).value !== null) values += 1; } catch (err) { console.error(`[strategy] measure ${m.ref} for ${p}:`, err); }
    }
  }
  return { measures: measures.length, values };
}

// ---------- figures: the same for every viewer ----------

const STATES = ['on_track', 'at_risk', 'off_track'];
const tally = (rows: Row[]) => {
  const out: Record<string, number> = { on_track: 0, at_risk: 0, off_track: 0, not_reported: 0, total: 0 };
  for (const r of rows) {
    const key = STATES.includes(r.status) ? r.status : 'not_reported';
    out[key] += Number(r.n); out.total += Number(r.n);
  }
  return out;
};

/** The area's figures for the Overview and the pages: plans in force, objectives and initiatives by status, measures against target, submissions due. */
export async function summary(ctx: ModuleContext, dueSoonDays: number) {
  const { db } = ctx;
  const today = todayInZone();
  // Plans in force: adopted, and today within their period (or no period end).
  const inForce = `p.deleted_at is null and p.status = 'adopted' and (p.period_end is null or p.period_end >= $1::date)`;
  const plans = await db.one<Row>(`select count(*)::int as n from strategy_plans p where ${inForce}`, [today]);
  const objectives = tally(await db.query<Row>(
    `select o.status, count(*)::int as n from strategy_objectives o join strategy_plans p on p.id = o.plan_id
     where o.deleted_at is null and ${inForce} group by o.status`, [today]));
  const initiatives = tally(await db.query<Row>(
    `select i.status, count(*)::int as n from strategy_initiatives i join strategy_plans p on p.id = i.plan_id
     where i.deleted_at is null and coalesce(i.stage, '') not in ('completed', 'canceled') and ${inForce} group by i.status`, [today]));
  const measures = await db.one<Row>(
    `select count(*) filter (where m.latest_state = 'met')::int as met, count(*) filter (where m.latest_state = 'near')::int as near,
            count(*) filter (where m.latest_state = 'missed')::int as missed, count(*) filter (where m.latest_value is null)::int as no_value, count(*)::int as total
     from strategy_measures m join strategy_plans p on p.id = m.plan_id where m.deleted_at is null and ${inForce}`, [today]);
  const open = `s.deleted_at is null and s.submitted_on is null and coalesce(s.status, '') not in ('submitted', 'accepted', 'returned')`;
  const submissions = await db.one<Row>(
    `select count(*) filter (where s.due_on < $1::date)::int as overdue,
            count(*) filter (where s.due_on >= $1::date and s.due_on <= $2::date)::int as due_soon,
            count(*)::int as open
     from strategy_submissions s where ${open}`, [today, addDays(today, dueSoonDays)]);
  const series = await db.one<Row>('select count(*)::int as n from strategy_stat_series where deleted_at is null and active');
  return {
    today, due_soon_days: dueSoonDays, plans_in_force: Number(plans?.n ?? 0),
    objectives, initiatives, measures, submissions, series: Number(series?.n ?? 0),
  };
}

// ---------- the scorecard of one plan ----------

export async function scorecard(ctx: ModuleContext, plan: Row, opts: { canSeeProjects: boolean }) {
  const { db } = ctx;
  const goals = await db.query<Row>('select * from strategy_goals where plan_id = $1 and deleted_at is null order by sort, code nulls last, title', [plan.id]);
  const objectives = await db.query<Row>(
    `select o.*, u.display_name as owner_name from strategy_objectives o left join users u on u.id = o.owner_id
     where o.plan_id = $1 and o.deleted_at is null order by o.sort, o.code nulls last, o.title`, [plan.id]);
  const measures = await db.query<Row>(
    `select m.*, u.display_name as owner_name from strategy_measures m left join users u on u.id = m.owner_id
     where m.plan_id = $1 and m.deleted_at is null order by m.ref`, [plan.id]);
  const initiatives = await db.query<Row>(
    `select i.*, u.display_name as owner_name from strategy_initiatives i left join users u on u.id = i.owner_id
     where i.plan_id = $1 and i.deleted_at is null order by i.ref`, [plan.id]);
  const latest = await db.query<Row>(
    `select distinct on (coalesce(objective_id, initiative_id)) objective_id, initiative_id, period, status, narrative, reported_on, reported_by_name
     from strategy_updates where plan_id = $1 and deleted_at is null
     order by coalesce(objective_id, initiative_id), period desc, reported_on desc nulls last, created_at desc`, [plan.id]);
  const latestOf = (col: string, id: string) => latest.find((u) => u[col] === id) ?? null;
  // Up to the last eight periods of each measure, oldest first, for the trend.
  const values = await db.query<Row>(
    `select measure_id, period, target, actual, state from (
       select v.*, row_number() over (partition by v.measure_id order by v.period_start desc) as n
       from strategy_measure_values v join strategy_measures m on m.id = v.measure_id
       where m.plan_id = $1 and v.deleted_at is null and m.deleted_at is null) x
     where n <= 8 order by period_start`, [plan.id]);
  const projectLabel = async (id: unknown) => (id && opts.canSeeProjects && ctx.resources.get('project') ? await ctx.resources.labelFor('project', String(id)) : null);
  const update = (u: Row | null) => (u ? { period: u.period, status: u.status, narrative: u.narrative ?? null, reported_on: day(u.reported_on), reported_by: u.reported_by_name ?? null } : null);
  const out = [];
  for (const g of goals) {
    const objs = [];
    for (const o of objectives.filter((x) => x.goal_id === g.id)) {
      const inits = [];
      for (const i of initiatives.filter((x) => x.objective_id === o.id)) {
        inits.push({
          id: i.id, ref: i.ref, title: i.title, stage: i.stage, status: i.status, owner_name: i.owner_name ?? null,
          start_on: day(i.start_on), end_on: day(i.end_on), budget_amount: num(i.budget_amount),
          project_id: opts.canSeeProjects ? i.project_id ?? null : null, project: await projectLabel(i.project_id),
          latest: update(latestOf('initiative_id', i.id)),
        });
      }
      objs.push({
        id: o.id, ref: o.ref, code: o.code, title: o.title, status: o.status, status_period: o.status_period, owner_name: o.owner_name ?? null,
        target_date: day(o.target_date), latest: update(latestOf('objective_id', o.id)),
        measures: measures.filter((m) => m.objective_id === o.id).map((m) => ({
          id: m.id, ref: m.ref, title: m.title, unit: m.unit, direction: m.direction, frequency: m.frequency, source: m.source,
          baseline_value: num(m.baseline_value), baseline_period: m.baseline_period, owner_name: m.owner_name ?? null,
          latest_period: m.latest_period, latest_value: num(m.latest_value), latest_target: num(m.latest_target), latest_state: m.latest_state,
          trend: values.filter((v) => v.measure_id === m.id).map((v) => ({ period: v.period, target: num(v.target), actual: num(v.actual), state: v.state })),
        })),
        initiatives: inits,
      });
    }
    out.push({ id: g.id, code: g.code, title: g.title, description: g.description ?? null, objectives: objs });
  }
  const count = (rows: Row[]) => tally(Object.entries(rows.reduce<Record<string, number>>((a, r) => { const k = r.status ?? ''; a[k] = (a[k] ?? 0) + 1; return a; }, {}))
    .map(([status, n]) => ({ status: status || null, n })));
  return {
    plan: { id: plan.id, ref: plan.ref, title: plan.title, description: plan.description ?? null, status: plan.status, period_start: day(plan.period_start), period_end: day(plan.period_end), adopted_on: day(plan.adopted_on) },
    totals: {
      objectives: count(objectives), initiatives: count(initiatives.filter((i) => !['completed', 'canceled'].includes(i.stage))),
      measures: {
        met: measures.filter((m) => m.latest_state === 'met').length, near: measures.filter((m) => m.latest_state === 'near').length,
        missed: measures.filter((m) => m.latest_state === 'missed').length, no_value: measures.filter((m) => m.latest_value === null).length, total: measures.length,
      },
    },
    goals: out,
  };
}

// ---------- the action-item matrix: objectives (and initiatives) by quarter ----------

export async function matrix(ctx: ModuleContext, plan: Row, from?: string | null, to?: string | null) {
  const { db } = ctx;
  const today = todayInZone();
  const start = from && /^\d{4}-Q[1-4]$/.test(from) ? periodRange(from)!.start : day(plan.period_start) ?? `${today.slice(0, 4)}-01-01`;
  // By default up to today, or to the plan's end when that is earlier; a plan that has not started yet shows its whole period.
  const planEnd = day(plan.period_end) ?? today;
  let endDefault = planEnd < today ? planEnd : today;
  if (endDefault < start) endDefault = planEnd;
  const end = to && /^\d{4}-Q[1-4]$/.test(to) ? periodRange(to)!.end : endDefault;
  let quarters = quartersBetween(start, end < start ? start : end);
  if (quarters.length > 12) quarters = quarters.slice(-12);
  const rows = await db.query<Row>(
    `select o.id, o.ref, o.code, o.title, o.goal_id, g.title as goal_title, g.code as goal_code, 'objective' as kind, null::uuid as objective_id
     from strategy_objectives o join strategy_goals g on g.id = o.goal_id
     where o.plan_id = $1 and o.deleted_at is null
     union all
     select i.id, i.ref, null, i.title, o.goal_id, g.title, g.code, 'initiative', i.objective_id
     from strategy_initiatives i join strategy_objectives o on o.id = i.objective_id join strategy_goals g on g.id = o.goal_id
     where i.plan_id = $1 and i.deleted_at is null`, [plan.id]);
  const goalOrder = await db.query<Row>('select id from strategy_goals where plan_id = $1 and deleted_at is null order by sort, code nulls last, title', [plan.id]);
  const objOrder = await db.query<Row>('select id from strategy_objectives where plan_id = $1 and deleted_at is null order by sort, code nulls last, title', [plan.id]);
  const updates = await db.query<Row>(
    `select distinct on (coalesce(objective_id, initiative_id), period) objective_id, initiative_id, period, status, narrative, reported_on, reported_by_name
     from strategy_updates where plan_id = $1 and deleted_at is null and period = any($2::text[])
     order by coalesce(objective_id, initiative_id), period, reported_on desc nulls last, created_at desc`, [plan.id, quarters]);
  const idx = (list: Row[], id: string) => list.findIndex((x) => x.id === id);
  const ordered = rows.sort((a, b) => idx(goalOrder, a.goal_id) - idx(goalOrder, b.goal_id)
    || idx(objOrder, a.kind === 'objective' ? a.id : a.objective_id) - idx(objOrder, b.kind === 'objective' ? b.id : b.objective_id)
    || (a.kind === 'objective' ? -1 : 1) - (b.kind === 'objective' ? -1 : 1) || String(a.ref).localeCompare(String(b.ref)));
  return {
    quarters,
    rows: ordered.map((r) => ({
      kind: r.kind, id: r.id, ref: r.ref, code: r.code, title: r.title, goal: [r.goal_code, r.goal_title].filter(Boolean).join(' '),
      cells: Object.fromEntries(quarters.map((q) => {
        const u = updates.find((x) => (r.kind === 'objective' ? x.objective_id : x.initiative_id) === r.id && x.period === q);
        return [q, u ? { status: u.status, narrative: u.narrative ?? null, reported_on: day(u.reported_on), reported_by: u.reported_by_name ?? null } : null];
      })),
    })),
  };
}

// ---------- statistics: a series' values by period and breakdown ----------

export async function seriesValues(ctx: ModuleContext, series: Row, from?: string | null, to?: string | null) {
  const params: unknown[] = [series.id];
  let where = 'series_id = $1 and deleted_at is null';
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { params.push(from); where += ` and period_end >= $${params.length}::date`; }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { params.push(to); where += ` and period_start <= $${params.length}::date`; }
  const rows = await ctx.db.query<Row>(`select period, breakdown, value from strategy_stat_values where ${where} order by period_start, breakdown limit 5000`, params);
  const periods = [...new Set(rows.map((r) => String(r.period)))];
  const breakdowns = [...new Set(rows.map((r) => String(r.breakdown ?? '')))].sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  const values: Record<string, (number | null)[]> = {};
  for (const b of breakdowns) values[b] = periods.map((p) => num(rows.find((r) => r.period === p && (r.breakdown ?? '') === b)?.value));
  return { periods, breakdowns, values };
}
