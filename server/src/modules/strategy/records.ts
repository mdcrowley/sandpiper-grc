// The record types of the strategic plan register and the statistics (wave 26). Every one is a normal
// record type, so lists, filters, exports, imports (CSV and Excel), the report builder, dashboards, MCP
// and data load mode work on them as on any other.
import type { FastifyRequest } from 'fastify';
import { actorOf, isDataLoad } from '../../core/dataload.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { FREQUENCIES, measureState, normalizePeriod, periodRange, type FiscalYear } from './periods.ts';
import { AGGREGATIONS, followSeries, pullMeasure, refreshMeasure, refreshStatus, valueRowFor } from './service.ts';
import { readFiscalYear } from './settings.ts';

/** What to type for a period of a frequency, on the organization's year. */
export function periodHint(frequency: string | null | undefined, fy: FiscalYear): string {
  const fiscal = fy.startMonth > 1;
  if (frequency === 'monthly') return 'Give the month as YYYY-MM.';
  if (frequency === 'yearly') return fiscal ? 'Give the fiscal year as FYYYYY (or YYYY), or a date inside it.' : 'Give the year as YYYY.';
  return fiscal ? 'Give the fiscal quarter as FYYYYY-Q1 to FYYYYY-Q4 (or YYYY-Q1), or a date inside it.' : 'Give the quarter as YYYY-Q1 to YYYY-Q4.';
}

/** Coarse to fine: a measure can take its values from a series of the same or a finer frequency. */
const GRAIN: Record<string, number> = { monthly: 1, quarterly: 2, yearly: 3 };

export const T = {
  plan: 'strategic_plan', goal: 'strategic_goal', objective: 'strategic_objective', measure: 'strategic_measure',
  value: 'measure_value', initiative: 'strategic_initiative', update: 'strategy_update',
  series: 'stat_series', stat: 'stat_value', submission: 'stat_submission',
} as const;

const day = (v: unknown) => (v == null || v === '' ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerRecords(ctx: ModuleContext) {
  const { db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const one = (table: string, id: unknown) => (id && UUID.test(String(id))
    ? db.one<Row>(`select * from ${table} where id = $1 and deleted_at is null`, [String(id)]) : Promise.resolve(undefined));
  const actor = (req: FastifyRequest | null) => actorOf(req);

  // ---------- plans, goals, objectives ----------

  function planRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Row {
    const m = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if (day(m.period_start) && day(m.period_end) && day(m.period_end)! < day(m.period_start)!) errors.period_end = 'The plan cannot end before it starts.';
    if (Object.keys(errors).length) invalid(errors);
    // Adopting a plan records the day, unless it is given (or a load leaves it as written).
    if (patch.status === 'adopted' && !m.adopted_on && !isDataLoad(req)) patch.adopted_on = todayInZone();
    if (!existing && !m.owner_id && req) patch.owner_id = actor(req).id;
    return patch;
  }

  ctx.defineResource({
    type: T.plan, table: 'strategy_plans', module: 'strategy', label: 'Strategic plan', plural: 'Strategic plans',
    path: '/api/strategy/plans', route: '/strategy/plans', titleField: 'title',
    ref: { field: 'ref', prefix: 'SP-' },
    searchable: ['title', 'description', 'notes'],
    defaultSort: { field: 'period_start', dir: 'desc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      title: { label: 'Title', type: 'text', required: true, help: 'The plan\'s name, for example "Strategic plan 2026 to 2030".' },
      description: { label: 'Vision and summary', type: 'longtext', personal: false },
      period_start: { label: 'Period from', type: 'date', required: true, help: 'The first day the plan covers.' },
      period_end: { label: 'Period to', type: 'date', required: true, help: 'The last day the plan covers.' },
      status: { label: 'Status', type: 'lookup', list: 'strategy_plan_status', default: 'draft' },
      adopted_on: { label: 'Adopted on', type: 'date' },
      decision_id: { label: 'Board decision', type: 'ref', to: 'meeting_decision', help: 'The decision of the board or committee that adopted the plan.' },
      document_id: { label: 'Plan document', type: 'ref', to: 'policy', help: 'The controlled document that holds the plan as adopted.' },
      owner_id: { label: 'Owner', type: 'user' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => planRules(req, null, data),
      beforeUpdate: (req, existing, patch) => planRules(req, existing, patch),
    },
  });

  ctx.defineResource({
    type: T.goal, table: 'strategy_goals', module: 'strategy', label: 'Strategic goal', plural: 'Strategic goals',
    path: '/api/strategy/goals', route: '/strategy/goals', titleField: 'title',
    searchable: ['code', 'title', 'description'],
    defaultSort: { field: 'sort', dir: 'asc' },
    fields: {
      plan_id: { label: 'Plan', type: 'ref', to: T.plan, required: true },
      code: { label: 'Code', type: 'text', help: 'A short code used in the plan, for example G1.' },
      title: { label: 'Goal', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext', personal: false },
      owner_id: { label: 'Owner', type: 'user' },
      sort: { label: 'Order', type: 'number', default: 100 },
    },
  });

  async function objectiveRules(existing: Row | null, patch: Row): Promise<Row> {
    if ('goal_id' in patch || !existing) {
      const goal = await one('strategy_goals', patch.goal_id ?? existing?.goal_id);
      if (!goal) invalid({ goal_id: 'Choose the goal this objective serves.' });
      patch.plan_id = goal!.plan_id;
    }
    return patch;
  }

  ctx.defineResource({
    type: T.objective, table: 'strategy_objectives', module: 'strategy', label: 'Strategic objective', plural: 'Strategic objectives',
    path: '/api/strategy/objectives', route: '/strategy/objectives', titleField: 'title',
    ref: { field: 'ref', prefix: 'OBJ-' },
    scope: { department: 'department_id' },
    searchable: ['code', 'title', 'description'],
    defaultSort: { field: 'sort', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      goal_id: { label: 'Goal', type: 'ref', to: T.goal, required: true },
      plan_id: { label: 'Plan', type: 'ref', to: T.plan, readOnly: true },
      code: { label: 'Code', type: 'text', help: 'A short code used in the plan, for example 1.2.' },
      title: { label: 'Objective', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext', personal: false },
      owner_id: { label: 'Owner', type: 'user' },
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      target_date: { label: 'Target date', type: 'date' },
      status: { label: 'Status', type: 'lookup', list: 'strategy_rag', readOnly: true, help: 'The status of the latest quarterly update.' },
      status_period: { label: 'Status as of', type: 'text', readOnly: true },
      sort: { label: 'Order', type: 'number', default: 100 },
    },
    hooks: {
      beforeCreate: (_req, data) => objectiveRules(null, data),
      beforeUpdate: (_req, existing, patch) => objectiveRules(existing, patch),
    },
  });

  // ---------- measures and their values ----------

  async function measureRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if ('objective_id' in patch || !existing) {
      const objective = await one('strategy_objectives', m.objective_id);
      if (!objective) errors.objective_id = 'Choose the objective this measure tracks.';
      else patch.plan_id = objective.plan_id;
    }
    if (m.frequency && !FREQUENCIES.includes(m.frequency)) errors.frequency = 'Choose monthly, quarterly or yearly.';
    const source = m.source ?? 'manual';
    if (source === 'metric') {
      const metric = metricsAvailable(ctx.app, ctx.resources).find((x) => x.key === m.metric_key);
      const def = metric?.recordType ? ctx.resources.get(metric.recordType) : undefined;
      // Choosing a metric needs sight of its area, as reading it does (GET /api/metrics).
      if (!metric || (req && 'metric_key' in patch && def && !ctx.can(req.user, `${def.module}.view`))) errors.metric_key = 'Choose a metric from the list.';
    } else if (source === 'figure') {
      const figure = m.figure_id && UUID.test(String(m.figure_id)) && ctx.resources.get('report_definition')
        ? await db.one('select id from tracked_figures where id = $1 and deleted_at is null', [m.figure_id]).catch(() => undefined) : undefined;
      if (!figure) errors.figure_id = 'Choose a figure recorded over time.';
    } else if (source === 'series') {
      // A statistics series (E46-59): of the same or a finer frequency, with one of its breakdowns or the total.
      const series = await one('strategy_stat_series', m.series_id);
      if (!series) errors.series_id = 'Choose a statistics series.';
      else {
        if ((GRAIN[series.frequency] ?? 1) > (GRAIN[m.frequency ?? 'quarterly'] ?? 2)) {
          errors.series_id = `This series is kept ${series.frequency === 'yearly' ? 'by year' : 'by quarter'}: give the measure the same or a longer frequency, or choose a series kept more often.`;
        }
        const b = String(m.series_breakdown ?? '').trim();
        const match = breakdownsOf(series.breakdowns).find((x) => x.toLowerCase() === b.toLowerCase());
        if (b && !match) errors.series_breakdown = `Choose one of the series' breakdowns (${breakdownsOf(series.breakdowns).join(', ') || 'it has none'}), or leave it empty for the total.`;
        else if ('series_breakdown' in patch || 'series_id' in patch) patch.series_breakdown = match ?? null;
      }
      if (!m.series_aggregation) patch.series_aggregation = 'sum';
      else if (!(AGGREGATIONS as readonly string[]).includes(String(m.series_aggregation))) errors.series_aggregation = 'Choose sum, average, latest, lowest or highest.';
    }
    if (Object.keys(errors).length) invalid(errors);
    if (source === 'manual' && ('source' in patch)) { patch.metric_key = null; patch.figure_id = null; }
    if (source !== 'series' && ('source' in patch)) { patch.series_id = null; patch.series_breakdown = null; patch.series_aggregation = null; }
    if (!existing && !m.owner_id && req) patch.owner_id = actor(req).id;
    return patch;
  }

  ctx.defineResource({
    type: T.measure, table: 'strategy_measures', module: 'strategy', label: 'Measure', plural: 'Measures',
    path: '/api/strategy/measures', route: '/strategy/measures', titleField: 'title',
    ref: { field: 'ref', prefix: 'KPI-' },
    searchable: ['title', 'description', 'unit'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      objective_id: { label: 'Objective', type: 'ref', to: T.objective, required: true },
      plan_id: { label: 'Plan', type: 'ref', to: T.plan, readOnly: true },
      title: { label: 'Measure', type: 'text', required: true, help: 'What is measured, for example "On-time performance".' },
      description: { label: 'Definition', type: 'longtext', personal: false, help: 'How the measure is worked out, so every period is counted the same way.' },
      unit: { label: 'Unit', type: 'text', help: 'For example %, trips, minutes, per 100,000 miles.' },
      direction: { label: 'Better when', type: 'lookup', list: 'measure_direction', default: 'increase' },
      tolerance_pct: { label: 'Near the target within (%)', type: 'number', default: 5, help: 'How far short of the target, as a percentage of the target, still counts as near it.' },
      frequency: { label: 'Frequency', type: 'lookup', list: 'stat_frequency', default: 'quarterly', required: true },
      baseline_value: { label: 'Baseline', type: 'number' },
      baseline_period: { label: 'Baseline period', type: 'text', help: 'The period the baseline is from, for example 2025.' },
      source: { label: 'Data source', type: 'lookup', list: 'measure_source', default: 'manual', help: 'Entered by hand, or taken from a metric, a figure recorded over time or a statistics series.' },
      metric_key: { label: 'Metric', type: 'text', help: 'With data source Metric: the key of a metric of GET /api/metrics, for example actions.overdue.' },
      figure_id: { label: 'Figure over time', type: 'text', help: 'With data source Figure over time: the id of a figure under Reports > Figures over time.' },
      series_id: { label: 'Statistics series', type: 'ref', to: T.series, help: 'With data source Statistics series: the series under Strategy > Statistics whose values give the actual, kept as often as the measure or more often (a monthly series for a quarterly measure).' },
      series_breakdown: { label: 'Breakdown', type: 'text', help: 'With a statistics series: one of its breakdown values, for example Bus; empty for the total (the total entered, or else the breakdowns added up).' },
      series_aggregation: { label: 'Combine the series\' values by', type: 'lookup', list: 'measure_aggregation', help: 'With a statistics series: how its values within one of the measure\'s periods make the actual: sum (the default), average, latest, lowest or highest.' },
      owner_id: { label: 'Owner', type: 'user' },
      latest_period: { label: 'Latest period', type: 'text', readOnly: true },
      latest_value: { label: 'Latest actual', type: 'number', readOnly: true },
      latest_target: { label: 'Target for that period', type: 'number', readOnly: true },
      latest_state: { label: 'Against target', type: 'lookup', list: 'measure_state', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => measureRules(req, null, data),
      beforeUpdate: (req, existing, patch) => measureRules(req, existing, patch),
      // A measure that takes its values from a series fills in every period the series has values for.
      afterCreate: async (_req, row) => { if (row.source === 'series') await backfillFromSeries(row); },
      afterUpdate: async (_req, before, after) => {
        if (after.source === 'series' && (before.source !== 'series' || before.series_id !== after.series_id || before.series_breakdown !== after.series_breakdown
          || before.series_aggregation !== after.series_aggregation || before.frequency !== after.frequency)) await backfillFromSeries(after);
      },
    },
  });

  /** Takes the actual of each of the measure's periods (at most 120) that its series has values in. */
  async function backfillFromSeries(measure: Row): Promise<void> {
    if (!measure.series_id) return;
    const fy = await readFiscalYear(ctx);
    const starts = await db.query<Row>(
      `select distinct period_start from strategy_stat_values where series_id = $1 and deleted_at is null and period_start is not null
       order by period_start desc limit 1000`, [measure.series_id]);
    const periods = [...new Set(starts.map((r) => normalizePeriod(measure.frequency ?? 'quarterly', day(r.period_start), fy)).filter((p): p is string => Boolean(p)))].slice(0, 120);
    for (const p of periods) await pullMeasure(ctx, measure, p, fy);
  }

  async function valueRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    const measure = await one('strategy_measures', m.measure_id);
    if (!measure) invalid({ measure_id: 'Choose the measure.' });
    const errors: Record<string, string> = {};
    // A period kept as it was (a calendar quarter entered before the fiscal year was set) stays as it is.
    const samePeriod = existing && patch.period === existing.period && (!('measure_id' in patch) || patch.measure_id === existing.measure_id);
    if (('period' in patch || 'measure_id' in patch || !existing) && !samePeriod) {
      const fy = await readFiscalYear(ctx);
      const period = normalizePeriod(measure!.frequency ?? 'quarterly', m.period, fy);
      if (!period) errors.period = periodHint(measure!.frequency, fy);
      else {
        const r = periodRange(period, fy)!;
        // The same days under the other kind of year count as the same period.
        if (await valueRowFor(db, String(measure!.id), period, r, existing?.id ?? null)) errors.period = 'This period has a value already: change that one.';
        Object.assign(patch, { period, period_start: r.start, period_end: r.end });
      }
    }
    if (Object.keys(errors).length) invalid(errors);
    if ('actual' in patch && patch.actual !== null && patch.actual !== undefined && patch.actual !== ''
      && (!existing || Number(existing.actual) !== Number(patch.actual) || existing.actual === null)) {
      const who = actor(req);
      Object.assign(patch, { entered_by: who.id, entered_by_name: who.name, entered_at: new Date().toISOString() });
      if (!patch.value_source) patch.value_source = req ? 'manual' : (measure!.source ?? 'manual');
    }
    const after = { ...m, ...patch };
    patch.state = measureState(measure!.direction, after.target, after.actual, measure!.tolerance_pct);
    return patch;
  }

  ctx.defineResource({
    type: T.value, table: 'strategy_measure_values', module: 'strategy', label: 'Measure value', plural: 'Measure values',
    path: '/api/strategy/measure-values', route: '/strategy/measure-values', titleField: 'period',
    searchable: ['period', 'note'],
    defaultSort: { field: 'period_start', dir: 'desc' },
    fields: {
      measure_id: { label: 'Measure', type: 'ref', to: T.measure, required: true },
      period: { label: 'Period', type: 'text', required: true, help: 'After the measure\'s frequency: YYYY, YYYY-Q1 to YYYY-Q4, or YYYY-MM; on a fiscal year (Strategy > Settings) FYYYYY or FYYYYY-Q1 to FYYYYY-Q4. A date inside the period is accepted too.' },
      period_start: { label: 'Period from', type: 'date', readOnly: true },
      period_end: { label: 'Period to', type: 'date', readOnly: true },
      target: { label: 'Target', type: 'number' },
      actual: { label: 'Actual', type: 'number' },
      state: { label: 'Against target', type: 'lookup', list: 'measure_state', readOnly: true },
      note: { label: 'Note', type: 'longtext', personal: false },
      value_source: { label: 'Actual from', type: 'lookup', list: 'measure_source', readOnly: true },
      entered_by: { label: 'Entered by', type: 'user', readOnly: true },
      entered_by_name: { label: 'Entered by (name)', type: 'text', readOnly: true, personal: true },
      entered_at: { label: 'Entered at', type: 'datetime', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => valueRules(req, null, data),
      beforeUpdate: (req, existing, patch) => valueRules(req, existing, patch),
      afterCreate: async (_req, row) => { await refreshMeasure(db, String(row.measure_id)); },
      afterUpdate: async (_req, before, after) => {
        await refreshMeasure(db, String(after.measure_id));
        if (before.measure_id !== after.measure_id) await refreshMeasure(db, String(before.measure_id));
      },
    },
  });

  // ---------- initiatives ----------

  async function initiativeRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    if ('objective_id' in patch || !existing) {
      const objective = await one('strategy_objectives', m.objective_id);
      if (!objective) invalid({ objective_id: 'Choose the objective this initiative serves.' });
      patch.plan_id = objective!.plan_id;
    }
    if (day(m.start_on) && day(m.end_on) && day(m.end_on)! < day(m.start_on)!) invalid({ end_on: 'It cannot end before it starts.' });
    if (!existing && !m.owner_id && req) patch.owner_id = actor(req).id;
    return patch;
  }

  ctx.defineResource({
    type: T.initiative, table: 'strategy_initiatives', module: 'strategy', label: 'Initiative', plural: 'Initiatives',
    path: '/api/strategy/initiatives', route: '/strategy/initiatives', titleField: 'title',
    ref: { field: 'ref', prefix: 'INI-' },
    searchable: ['title', 'description', 'budget_reference'],
    defaultSort: { field: 'ref', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      objective_id: { label: 'Objective', type: 'ref', to: T.objective, required: true },
      plan_id: { label: 'Plan', type: 'ref', to: T.plan, readOnly: true },
      title: { label: 'Initiative', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext', personal: false },
      owner_id: { label: 'Owner', type: 'user' },
      stage: { label: 'Stage', type: 'lookup', list: 'initiative_stage', default: 'planned' },
      start_on: { label: 'Starts', type: 'date' },
      end_on: { label: 'Ends', type: 'date' },
      project_id: { label: 'Project', type: 'ref', to: 'project', help: 'The project that delivers the initiative, when there is one.' },
      // The procurement module's budget lines, when it is installed (record type budget_line); the
      // field is hidden while that type is missing or switched off. The reference as text works anyway.
      budget_line_id: { label: 'Budget line', type: 'ref', to: 'budget_line' },
      budget_reference: { label: 'Budget reference', type: 'text', help: 'The budget line or cost center funding it, as your budget names it.' },
      budget_amount: { label: 'Budget', type: 'currency' },
      status: { label: 'Status', type: 'lookup', list: 'strategy_rag', readOnly: true, help: 'The status of the latest quarterly update.' },
      status_period: { label: 'Status as of', type: 'text', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => initiativeRules(req, null, data),
      beforeUpdate: (req, existing, patch) => initiativeRules(req, existing, patch),
    },
  });

  // ---------- quarterly updates ----------

  async function updateRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    const errors: Record<string, string> = {};
    if ('objective_id' in patch || 'initiative_id' in patch || !existing) {
      if (Boolean(m.objective_id) === Boolean(m.initiative_id)) errors.objective_id = 'Choose an objective or an initiative (one of the two).';
      else {
        const subject = m.objective_id ? await one('strategy_objectives', m.objective_id) : await one('strategy_initiatives', m.initiative_id);
        if (!subject) errors[m.objective_id ? 'objective_id' : 'initiative_id'] = 'Not found.';
        else patch.plan_id = subject.plan_id;
      }
    }
    if (!existing && !m.reported_on && !isDataLoad(req)) patch.reported_on = todayInZone();
    if (('period' in patch || !existing) && !(existing && patch.period === existing.period)) {
      const fy = await readFiscalYear(ctx);
      const given = m.period || (patch.reported_on ?? m.reported_on ?? todayInZone());
      const period = normalizePeriod('quarterly', given instanceof Date ? day(given) : given, fy);
      if (!period) errors.period = periodHint('quarterly', fy);
      else {
        const r = periodRange(period, fy)!;
        Object.assign(patch, { period, period_start: r.start, period_end: r.end });
      }
    }
    if (Object.keys(errors).length) invalid(errors);
    if (!existing) {
      const who = actor(req);
      patch.reported_by = who.id;
      patch.reported_by_name = who.name;
    }
    return patch;
  }

  const refreshSubjects = async (...rows: Row[]) => {
    for (const r of rows) {
      if (r.objective_id) await refreshStatus(db, 'objective', String(r.objective_id));
      if (r.initiative_id) await refreshStatus(db, 'initiative', String(r.initiative_id));
    }
  };

  ctx.defineResource({
    type: T.update, table: 'strategy_updates', module: 'strategy', label: 'Status update', plural: 'Status updates',
    path: '/api/strategy/updates', route: '/strategy/updates', titleField: 'period',
    searchable: ['narrative', 'period'],
    defaultSort: { field: 'period_start', dir: 'desc' },
    fields: {
      objective_id: { label: 'Objective', type: 'ref', to: T.objective, help: 'The objective reported on (or give an initiative instead).' },
      initiative_id: { label: 'Initiative', type: 'ref', to: T.initiative, help: 'The initiative reported on (or give an objective instead).' },
      plan_id: { label: 'Plan', type: 'ref', to: T.plan, readOnly: true },
      period: { label: 'Quarter', type: 'text', help: 'YYYY-Q1 to YYYY-Q4 (FYYYYY-Q1 to FYYYYY-Q4 on a fiscal year set under Strategy > Settings); the quarter of the report date when left out.' },
      period_start: { label: 'Quarter from', type: 'date', readOnly: true },
      period_end: { label: 'Quarter to', type: 'date', readOnly: true },
      status: { label: 'Status', type: 'lookup', list: 'strategy_rag', required: true },
      narrative: { label: 'Narrative', type: 'longtext', help: 'What was done, what is in the way and what happens next.' },
      reported_on: { label: 'Reported on', type: 'date' },
      reported_by: { label: 'Reported by', type: 'user', readOnly: true },
      reported_by_name: { label: 'Reported by (name)', type: 'text', readOnly: true, personal: true },
    },
    hooks: {
      beforeCreate: (req, data) => updateRules(req, null, data),
      beforeUpdate: (req, existing, patch) => updateRules(req, existing, patch),
      afterCreate: async (_req, row) => refreshSubjects(row),
      afterUpdate: async (_req, before, after) => refreshSubjects(before, after),
    },
  });

  // ---------- statistics ----------

  /** The allowed breakdown values of a series: one per line (or separated by commas), trimmed, unique. */
  const breakdownsOf = (v: unknown): string[] => [...new Set(String(v ?? '').split(/[\n,;]/).map((s) => s.trim()).filter(Boolean))];

  async function seriesRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    // The series are the organization's set-up: defining or changing one needs strategy.administer.
    if (req && !ctx.can(req.user, 'strategy.administer')) ctx.fail(403, 'forbidden', 'Defining statistics series needs the strategy administration permission.');
    const m = { ...(existing ?? {}), ...patch };
    if (!FREQUENCIES.includes(m.frequency)) invalid({ frequency: 'Choose monthly, quarterly or yearly.' });
    if (existing && 'frequency' in patch && patch.frequency !== existing.frequency) {
      // Values already entered are kept by their period, so the frequency cannot change under them.
      const used = await db.one('select 1 from strategy_stat_values where series_id = $1 and deleted_at is null limit 1', [existing.id]);
      if (used) invalid({ frequency: 'Values have been entered for this series: its frequency cannot change. Define a new series instead.' });
    }
    if ('breakdowns' in patch) patch.breakdowns = breakdownsOf(patch.breakdowns).join('\n') || null;
    if (m.decimals !== null && m.decimals !== undefined && m.decimals !== '' && !(Number(m.decimals) >= 0 && Number(m.decimals) <= 6)) invalid({ decimals: 'Give 0 to 6.' });
    return patch;
  }

  ctx.defineResource({
    type: T.series, table: 'strategy_stat_series', module: 'strategy', label: 'Statistics series', plural: 'Statistics series',
    path: '/api/strategy/stat-series', route: '/strategy/statistics', titleField: 'name',
    searchable: ['code', 'name', 'description'],
    defaultSort: { field: 'sort', dir: 'asc' },
    fields: {
      code: { label: 'Code', type: 'text', help: 'A short code for imports, for example RIDERSHIP.' },
      name: { label: 'Name', type: 'text', required: true, help: 'For example "Unlinked passenger trips" or "Revenue miles".' },
      description: { label: 'Definition', type: 'longtext', personal: false, help: 'How the statistic is counted, so every period is counted the same way.' },
      unit: { label: 'Unit', type: 'text', help: 'For example trips, miles, hours, vehicles, per 100,000 miles.' },
      frequency: { label: 'Frequency', type: 'lookup', list: 'stat_frequency', default: 'monthly', required: true },
      breakdown_label: { label: 'Broken down by', type: 'text', help: 'What the breakdowns are, for example Mode or Service.' },
      breakdowns: { label: 'Breakdown values', type: 'longtext', personal: false, help: 'One per line, for example Bus, Light rail, Paratransit. Leave empty for a single total.' },
      decimals: { label: 'Decimal places', type: 'number', default: 0 },
      active: { label: 'Active', type: 'boolean', default: true },
      owner_id: { label: 'Owner', type: 'user' },
      sort: { label: 'Order', type: 'number', default: 100 },
    },
    hooks: {
      beforeCreate: (req, data) => seriesRules(req, null, data),
      beforeUpdate: (req, existing, patch) => seriesRules(req, existing, patch),
    },
  });

  async function statRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Promise<Row> {
    const m = { ...(existing ?? {}), ...patch };
    const series = await one('strategy_stat_series', m.series_id);
    if (!series) invalid({ series_id: 'Choose the statistics series.' });
    const errors: Record<string, string> = {};
    const allowed = breakdownsOf(series!.breakdowns);
    if ('breakdown' in patch || !existing) {
      const b = String(m.breakdown ?? '').trim();
      const match = allowed.find((x) => x.toLowerCase() === b.toLowerCase());
      if (b && !match) errors.breakdown = allowed.length ? `Choose one of: ${allowed.join(', ')}; or leave it empty for the total.` : 'This series has no breakdowns: leave it empty.';
      patch.breakdown = match ?? '';
    }
    const samePeriod = existing && patch.period === existing.period && (!('series_id' in patch) || patch.series_id === existing.series_id);
    if (('period' in patch || 'series_id' in patch || !existing) && !samePeriod) {
      const fy = await readFiscalYear(ctx);
      const period = normalizePeriod(series!.frequency, m.period, fy);
      if (!period) errors.period = periodHint(series!.frequency, fy);
      else {
        const r = periodRange(period, fy)!;
        Object.assign(patch, { period, period_start: r.start, period_end: r.end });
      }
    }
    if (m.value === null || m.value === undefined || m.value === '' || !Number.isFinite(Number(m.value))) errors.value = 'Give the value as a number.';
    if (!errors.period && !errors.breakdown) {
      const after = { ...m, ...patch };
      // The same days under the other kind of year count as the same period.
      const clash = await db.one(`select id from strategy_stat_values where series_id = $1 and breakdown = $3 and deleted_at is null and id <> coalesce($4::uuid, gen_random_uuid())
          and (period = $2 or (period_start = $5::date and period_end = $6::date))`,
        [series!.id, after.period, after.breakdown ?? '', existing?.id ?? null, day(after.period_start), day(after.period_end)]);
      if (clash) errors.period = 'A value for this period (and breakdown) is entered already: change that one.';
    }
    if (Object.keys(errors).length) invalid(errors);
    if (!existing || ('value' in patch && Number(patch.value) !== Number(existing.value))) {
      const who = actor(req);
      Object.assign(patch, { entered_by: who.id, entered_by_name: who.name, entered_at: new Date().toISOString() });
    }
    return patch;
  }

  ctx.defineResource({
    type: T.stat, table: 'strategy_stat_values', module: 'strategy', label: 'Statistic value', plural: 'Statistic values',
    path: '/api/strategy/stat-values', route: '/strategy/stat-values', titleField: 'period',
    searchable: ['period', 'breakdown', 'note'],
    defaultSort: { field: 'period_start', dir: 'desc' },
    fields: {
      series_id: { label: 'Series', type: 'ref', to: T.series, required: true },
      period: { label: 'Period', type: 'text', required: true, help: 'After the series\' frequency: YYYY-MM, YYYY-Q1 to YYYY-Q4, or YYYY. A date inside the period is accepted too.' },
      breakdown: { label: 'Breakdown', type: 'text', help: 'One of the series\' breakdown values, for example Bus; empty for the total.' },
      value: { label: 'Value', type: 'number', required: true },
      note: { label: 'Note', type: 'longtext', personal: false },
      period_start: { label: 'Period from', type: 'date', readOnly: true },
      period_end: { label: 'Period to', type: 'date', readOnly: true },
      entered_by: { label: 'Entered by', type: 'user', readOnly: true },
      entered_by_name: { label: 'Entered by (name)', type: 'text', readOnly: true, personal: true },
      entered_at: { label: 'Entered at', type: 'datetime', readOnly: true },
    },
    hooks: {
      beforeCreate: (req, data) => statRules(req, null, data),
      beforeUpdate: (req, existing, patch) => statRules(req, existing, patch),
      // Measures taking their values from the series follow at once (E46-59).
      afterCreate: async (_req, row) => followSeries(ctx, String(row.series_id), row.period_start),
      afterUpdate: async (_req, before, after) => {
        await followSeries(ctx, String(after.series_id), after.period_start);
        if (before.series_id !== after.series_id || day(before.period_start) !== day(after.period_start)) await followSeries(ctx, String(before.series_id), before.period_start);
      },
    },
  });

  // ---------- submissions to outside bodies ----------

  function submissionRules(req: FastifyRequest | null, existing: Row | null, patch: Row): Row {
    const m = { ...(existing ?? {}), ...patch };
    if (!existing && !m.owner_id && req) patch.owner_id = actor(req).id;
    const submitted = ['submitted', 'accepted', 'returned'].includes(String(m.status));
    if (submitted && 'status' in patch && !m.submitted_on && !isDataLoad(req)) patch.submitted_on = todayInZone();
    if (submitted && 'status' in patch && !m.submitted_by && req) patch.submitted_by = actor(req).id;
    if (m.submitted_on && !submitted && 'submitted_on' in patch && !('status' in patch)) patch.status = 'submitted';
    // A new due date is a new occasion for the reminders.
    if (existing && 'due_on' in patch && day(patch.due_on) !== day(existing.due_on)) patch.reminded_for = null;
    return patch;
  }

  ctx.defineResource({
    type: T.submission, table: 'strategy_submissions', module: 'strategy', label: 'Statistical submission', plural: 'Statistical submissions',
    path: '/api/strategy/submissions', route: '/strategy/submissions', titleField: 'report_name',
    ref: { field: 'ref', prefix: 'SUB-' },
    evidence: true,
    searchable: ['report_name', 'recipient', 'period', 'confirmation', 'notes'],
    defaultSort: { field: 'due_on', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      report_name: { label: 'Report', type: 'text', required: true, help: 'The name of the periodic statistical report, as the body that receives it names it.' },
      recipient: { label: 'Submitted to', type: 'text', help: 'The outside body that receives the report.' },
      period: { label: 'Period covered', type: 'text', help: 'For example 2026-Q1, 2026-03 or 2025.' },
      due_on: { label: 'Due', type: 'date', required: true },
      owner_id: { label: 'Prepared by', type: 'user', help: 'Who prepares it; reminded before the due date.' },
      status: { label: 'Status', type: 'lookup', list: 'submission_status', default: 'planned' },
      submitted_on: { label: 'Submitted on', type: 'date' },
      submitted_by: { label: 'Submitted by', type: 'user' },
      confirmation: { label: 'Confirmation', type: 'text', help: 'The confirmation number or receipt the body gave.' },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => submissionRules(req, null, data),
      beforeUpdate: (req, existing, patch) => submissionRules(req, existing, patch),
    },
  });

  // Deleting an update or a value changes what is current.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (action !== 'delete' && action !== 'purge') return;
    if (def.type === T.update) await refreshSubjects(row);
    if (def.type === T.value) await refreshMeasure(db, String(row.measure_id));
    if (def.type === T.stat) await followSeries(ctx, String(row.series_id), row.period_start);
  });
}
