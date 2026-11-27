import type { FastifyRequest } from 'fastify';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { dayInZone, TIME_ZONE } from '../../core/timezone.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import { hazardScale } from './hazards.ts';
import { targetsByYear } from './targets.ts';

/**
 * Safety performance indicators and the safety dashboard.
 *
 * An indicator counts the safety events that match its filters (types, severities, modes) in
 * each month. As a `count` that number is the value; as a `rate` it is divided by the month's
 * exposure (vehicle-miles, vehicle-hours or boardings, entered by the operator) and multiplied
 * by `per_units` (for example events per 100,000 vehicle-miles). A target is met when the value
 * is at most (or at least) the target. Every figure counts every event, restricted or not, so all
 * readers see the same numbers; restriction protects an event's details, which are never returned here.
 *
 * Wave 10 (E25-07 to E25-10) adds three measures that are not counts of events: `manual` (a value
 * entered for each month), `computed` (a metric another module offers, core/metrics.ts, read by its
 * key) and `distance_between` (revenue miles divided by major failures, both from the exposure); and a
 * target per year (targets.ts), which takes the place of the indicator's own target in that year.
 */

export const MEASURES = ['count', 'rate', 'manual', 'computed', 'distance_between'];
/** Measures worked out from the safety events, which the event filters apply to. */
export const EVENT_MEASURES = ['count', 'rate'];
const PERIOD = /^\d{4}-\d{2}$/;
const DONE_ACTION = ['done', 'cancelled'];

export const monthsBack = (n: number, end = dayInZone().slice(0, 7)): string[] => {
  const [y, m] = end.split('-').map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
};

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export function registerIndicators(ctx: ModuleContext) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const scale = hazardScale(ctx);

  async function checkIndicator(merged: Row): Promise<void> {
    const errors: Record<string, string> = {};
    const known = async (list: string) => (await ctx.lookups.values(list)).map((v) => v.value);
    for (const [field, list] of [['event_types', 'safety_event_type'], ['severities', 'safety_event_severity'], ['modes', 'vehicle_mode']] as const) {
      const v = merged[field];
      if (v !== undefined && v !== null && !Array.isArray(v)) { errors[field] = 'Give a list.'; continue; }
      const allowed = await known(list);
      const bad = strList(v).filter((x) => !allowed.includes(x));
      if (bad.length) errors[field] = `Not known: ${bad.join(', ')}.`;
    }
    if (!MEASURES.includes(merged.measure ?? 'count')) errors.measure = 'Choose how the indicator is measured.';
    if (merged.measure === 'computed') {
      const keys = metricsAvailable(app, ctx.resources).map((m) => m.key);
      if (!merged.metric_key) errors.metric_key = 'Choose the figure the indicator is computed from.';
      else if (!keys.includes(merged.metric_key)) errors.metric_key = 'That figure is not available on this installation.';
    }
    if ((merged.measure ?? 'count') === 'rate') {
      if (!(await known('safety_exposure_measure')).includes(merged.exposure)) errors.exposure = 'Choose what the rate is per (vehicle-miles, vehicle-hours or boardings).';
      if (!(Number(merged.per_units) > 0)) errors.per_units = 'Give a number above zero, for example 100000.';
    }
    if (!['at_most', 'at_least'].includes(merged.target_direction ?? 'at_most')) errors.target_direction = 'Choose at most or at least.';
    if (merged.target !== null && merged.target !== undefined && !(Number(merged.target) >= 0)) errors.target = 'Give zero or more.';
    if (Object.keys(errors).length) invalid(errors);
  }

  ctx.defineResource({
    type: 'safety_indicator', table: 'safety_indicators', module: 'safety', label: 'Safety indicator', plural: 'Safety indicators',
    path: '/api/safety-indicators', route: '/safety/indicators', titleField: 'name',
    searchable: ['name', 'description'],
    defaultSort: { field: 'sort', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      description: { label: 'Description', type: 'longtext' },
      event_types: { label: 'Event types counted', type: 'json', default: [] },
      severities: { label: 'Severities counted', type: 'json', default: [] },
      modes: { label: 'Modes counted', type: 'json', default: [] },
      measure: { label: 'Measure', type: 'text', default: 'count' },
      metric_key: { label: 'Computed from', type: 'text' },
      exposure: { label: 'Per', type: 'lookup', list: 'safety_exposure_measure' },
      per_units: { label: 'Per how many', type: 'number' },
      target: { label: 'Target', type: 'number' },
      target_direction: { label: 'Target is', type: 'text', default: 'at_most' },
      active: { label: 'Shown on the dashboard', type: 'boolean', default: true },
      sort: { label: 'Order', type: 'number', default: 100 },
    },
    hooks: {
      beforeCreate: async (_req, data) => { await checkIndicator(data); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkIndicator({ ...existing, ...patch }); return patch; },
    },
  });

  // ---------- exposure ----------

  app.get('/api/safety/exposure', { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
    const q = req.query as Record<string, string>;
    const months = Math.min(60, Math.max(1, Number(q.months) || 12));
    const periods = monthsBack(months);
    const rows = await db.query<Row>(
      `select to_char(period, 'YYYY-MM') as period, mode, vehicle_miles, vehicle_hours, boardings, revenue_miles, major_failures, updated_at
       from safety_exposure where period >= $1::date order by period, mode`, [`${periods[0]}-01`]);
    return {
      periods,
      rows: rows.map((r) => ({
        ...r, vehicle_miles: num(r.vehicle_miles), vehicle_hours: num(r.vehicle_hours), boardings: num(r.boardings),
        revenue_miles: num(r.revenue_miles), major_failures: num(r.major_failures),
      })),
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/safety/exposure', summary: 'Exposure entered per month and mode', permission: 'safety.view', query: { months: 'How many months back (default 12)' } });

  /** Body: { period: 'YYYY-MM', mode?: '' | vehicle mode, vehicle_miles?, vehicle_hours?, boardings? } */
  app.put('/api/safety/exposure', { preHandler: ctx.requirePerm('safety.edit') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const errors: Record<string, string> = {};
    const period = String(b.period ?? '');
    if (!PERIOD.test(period) || Number(period.slice(5)) < 1 || Number(period.slice(5)) > 12) errors.period = 'Give the month as YYYY-MM.';
    else if (period > dayInZone().slice(0, 7)) errors.period = 'Exposure cannot be entered for a future month.';
    const mode = String(b.mode ?? '');
    if (mode && !(await ctx.lookups.values('vehicle_mode')).some((m) => m.value === mode)) errors.mode = 'Not a vehicle mode.';
    const values: Row = {};
    for (const k of EXPOSURE_COLUMNS) {
      if (b[k] === undefined || b[k] === null || b[k] === '') { values[k] = null; continue; }
      const n = Number(b[k]);
      if (!Number.isFinite(n) || n < 0) errors[k] = 'Give zero or more.';
      else if (k === 'major_failures' && !Number.isInteger(n)) errors[k] = 'Give a whole number, zero or more.';
      else values[k] = n;
    }
    if (Object.keys(errors).length) invalid(errors);
    const before = await db.one<Row>(`select ${EXPOSURE_COLUMNS.join(', ')} from safety_exposure where period = $1::date and mode = $2`, [`${period}-01`, mode]);
    await db.query(
      `insert into safety_exposure (period, mode, vehicle_miles, vehicle_hours, boardings, revenue_miles, major_failures, updated_by) values ($1::date,$2,$3,$4,$5,$6,$7,$8)
       on conflict (period, mode) do update set vehicle_miles = excluded.vehicle_miles, vehicle_hours = excluded.vehicle_hours,
         boardings = excluded.boardings, revenue_miles = excluded.revenue_miles, major_failures = excluded.major_failures,
         updated_at = now(), updated_by = excluded.updated_by`,
      [`${period}-01`, mode, values.vehicle_miles, values.vehicle_hours, values.boardings, values.revenue_miles, values.major_failures, req.user!.id]);
    await ctx.audit(req, {
      action: 'safety.exposure', recordType: 'safety_exposure', recordId: `${period}:${mode || 'all'}`,
      summary: `Exposure for ${period}${mode ? ` (${mode})` : ''} recorded`, before: before ?? undefined, after: values,
    });
    return { period, mode, ...values };
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/safety/exposure', summary: 'Record vehicle-miles, vehicle-hours, boardings, revenue miles and major failures for a month', permission: 'safety.edit',
    body: '{ period: "YYYY-MM", mode?: "" | mode, vehicle_miles?, vehicle_hours?, boardings?, revenue_miles?, major_failures? }',
  });

  // ---------- trend ----------

  /** Exposure in one column for each period: per mode when the indicator names modes, else the whole operation (or the modes added up). */
  async function exposureBy(col: string, modes: string[], periods: string[]): Promise<Map<string, number | null>> {
    const rows = await db.query<Row>(
      `select to_char(period, 'YYYY-MM') as m, mode, ${col} as v from safety_exposure where period >= $1::date and ${col} is not null`, [`${periods[0]}-01`]);
    return new Map(periods.map((p) => {
      const of = rows.filter((r) => r.m === p);
      if (modes.length) {
        const hit = of.filter((r) => modes.includes(r.mode));
        return [p, hit.length ? hit.reduce((n, r) => n + Number(r.v), 0) : null];
      }
      const whole = of.find((r) => r.mode === '');
      if (whole) return [p, Number(whole.v)];
      return [p, of.length ? of.reduce((n, r) => n + Number(r.v), 0) : null];
    }));
  }

  /** The target in force each period: the year's target (unless rejected), else the indicator's own. */
  async function targetsFor(ind: Row) {
    const years = await targetsByYear(ctx, ind.id);
    const own = { target: ind.target === null || ind.target === undefined ? null : Number(ind.target), direction: String(ind.target_direction ?? 'at_most') };
    return (p: string) => years.get(Number(p.slice(0, 4))) ?? own;
  }

  async function otherTrend(ind: Row, periods: string[]) {
    const target = await targetsFor(ind);
    let values = new Map<string, { value: number | null; events: number | null; exposure: number | null }>();
    if (ind.measure === 'manual') {
      const rows = await db.query<Row>(
        `select to_char(period, 'YYYY-MM') as m, value from safety_indicator_values where indicator_id = $1 and period >= $2::date`, [ind.id, `${periods[0]}-01`]);
      values = new Map(rows.map((r) => [r.m, { value: Number(r.value), events: null, exposure: null }]));
    } else if (ind.measure === 'computed') {
      // Figures from another module's metric: the same for everyone, worked out for each month.
      const metric = metricsAvailable(app, ctx.resources).find((m) => m.key === ind.metric_key);
      for (const p of periods) {
        let value: number | null = null;
        if (metric) {
          try { value = await metric.compute(ctx, `${p}-01`); } catch (err) { console.error(`[safety] metric ${metric.key} for ${p}:`, err); }
        }
        values.set(p, { value: value === null || value === undefined || !Number.isFinite(Number(value)) ? null : round(Number(value)), events: null, exposure: null });
      }
    } else {
      // distance_between: revenue miles divided by major failures, from the exposure.
      const modes = strList(ind.modes);
      const miles = await exposureBy('revenue_miles', modes, periods);
      const failures = await exposureBy('major_failures', modes, periods);
      for (const p of periods) {
        const m = miles.get(p) ?? null;
        const f = failures.get(p) ?? null;
        values.set(p, { value: m !== null && f !== null && f > 0 ? Math.round(m / f) : null, events: f, exposure: m });
      }
    }
    return periods.map((p) => {
      const v = values.get(p) ?? { value: null, events: null, exposure: null };
      const t = target(p);
      const met = v.value === null || t.target === null ? null : t.direction === 'at_least' ? v.value >= t.target : v.value <= t.target;
      return { period: p, events: v.events, exposure: v.exposure, value: v.value, target: t.target, direction: t.direction, met };
    });
  }

  /**
   * E18-79: the current month is not over, so its figure is month to date: marked `partial` and never
   * judged against the target (a month of events half counted would look "on target").
   */
  async function trend(ind: Row, user: SessionUser | null, periods: string[]) {
    const current = dayInZone().slice(0, 7);
    return (await fullTrend(ind, user, periods)).map((p) => (p.period === current ? { ...p, partial: true, met: null } : { ...p, partial: false }));
  }

  async function fullTrend(ind: Row, user: SessionUser | null, periods: string[]) {
    if (!EVENT_MEASURES.includes(ind.measure ?? 'count')) return otherTrend(ind, periods);
    const types = strList(ind.event_types);
    const sevs = strList(ind.severities);
    const modes = strList(ind.modes);
    const params: unknown[] = [TIME_ZONE, `${periods[0]}-01`];
    const where = [`e.deleted_at is null`, `(e.occurred_at at time zone $1) >= $2::date`];
    if (types.length) { params.push(types); where.push(`e.event_type = any($${params.length}::text[])`); }
    if (sevs.length) { params.push(sevs); where.push(`e.severity = any($${params.length}::text[])`); }
    let join = '';
    if (modes.length) {
      params.push(modes);
      if (ctx.resources.get('vehicle')) {
        join = 'left join vehicles v on v.id = e.vehicle_id left join services s on s.id = e.service_id';
        where.push(`coalesce(v.mode, s.mode) = any($${params.length}::text[])`);
      } else where.push('false');
    }
    const counts = new Map((await db.query<Row>(
      `select to_char(e.occurred_at at time zone $1, 'YYYY-MM') as m, count(*)::int as c from safety_events e ${join}
       where ${where.join(' and ')} group by 1`, params)).map((r) => [r.m, r.c as number]));

    const rate = ind.measure === 'rate';
    const exposure = rate
      ? await exposureBy(['vehicle_miles', 'vehicle_hours', 'boardings'].includes(ind.exposure) ? ind.exposure : 'vehicle_miles', modes, periods)
      : new Map<string, number | null>();
    const target = await targetsFor(ind);
    return periods.map((p) => {
      const events = counts.get(p) ?? 0;
      const exp = rate ? exposure.get(p) ?? null : null;
      const value = rate ? (exp && exp > 0 ? round((events / exp) * Number(ind.per_units)) : null) : events;
      const t = target(p);
      const met = value === null || t.target === null ? null : t.direction === 'at_least' ? value >= t.target : value <= t.target;
      return { period: p, events, exposure: exp, value, target: t.target, direction: t.direction, met };
    });
  }

  const indicatorFor = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find('safety_indicator', (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', 'Indicator not found.');

  app.get('/api/safety-indicators/:id/trend', { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
    const ind = await indicatorFor(req);
    const months = Math.min(60, Math.max(2, Number((req.query as Row).months) || 12));
    return { indicator: { id: ind.id, name: ind.name, measure: ind.measure, metric_key: ind.metric_key ?? null, exposure: ind.exposure, per_units: num(ind.per_units), target: num(ind.target), target_direction: ind.target_direction }, points: await trend(ind, req.user, monthsBack(months)) };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/safety-indicators/:id/trend', summary: 'An indicator month by month, with its target', permission: 'safety.view', query: { months: 'How many months (default 12)' } });

  // ---------- dashboard ----------

  app.get('/api/safety/summary', { preHandler: ctx.requirePerm('safety.view') }, async (req) => {
    const user = req.user;
    const periods = monthsBack(12);
    const today = dayInZone();
    // Figures are the same for everyone: count every event (no details are returned).
    const vis = 'true';
    const types = await ctx.lookups.values('safety_event_type');
    const sevs = await ctx.lookups.values('safety_event_severity');
    const finals = (await ctx.lookups.values('safety_event_status')).filter((s) => s.meta?.final === true).map((s) => s.value);
    const notifying = sevs.filter((s) => s.meta?.notify === true).map((s) => s.value);
    const events = await db.query<Row>(
      `select e.id, to_char(e.occurred_at at time zone $1, 'YYYY-MM') as m, e.event_type, e.severity, e.status, e.investigation_due::text as due
       from safety_events e where e.deleted_at is null and ${vis} and ((e.occurred_at at time zone $1) >= $2::date or not (coalesce(e.status, '') = any($3::text[])))`,
      [TIME_ZONE, `${periods[0]}-01`, finals]);
    const inWindow = events.filter((e) => e.m >= periods[0]);
    const open = events.filter((e) => !finals.includes(e.status));

    let corrective = { open: 0, overdue: 0 };
    if (ctx.resources.get('action')) {
      const r = await db.one<Row>(
        `select count(*)::int as open, count(*) filter (where a.due_on < $2::date)::int as overdue
         from actions a join safety_events e on e.id::text = a.source_id::text and e.deleted_at is null and ${vis}
         where a.deleted_at is null and a.source_type = 'safety_event' and not (coalesce(a.status, '') = any($1::text[]))
        `, [DONE_ACTION, today]);
      corrective = { open: r?.open ?? 0, overdue: r?.overdue ?? 0 };
    }

    const closedHazard = (await ctx.lookups.values('hazard_status')).filter((s) => s.meta?.closed === true).map((s) => s.value);
    const hazards = await db.query<Row>(
      `select id, coalesce(residual_likelihood, likelihood) as l, coalesce(residual_severity, severity) as s,
              coalesce(residual_rating, rating) as rating, review_date::text as review
       from hazards where deleted_at is null and not (coalesce(status, '') = any($1::text[]))`, [closedHazard]);
    const m = await scale.get();
    const matrix = m ? {
      scale: m,
      cells: m.likelihood_levels.flatMap((l) => m.impact_levels.map((i) => {
        const key = m.matrix[String(l.value)]?.[String(i.value)] ?? null;
        return {
          likelihood: l.value, severity: i.value, rating: key, color: m.ratings.find((r) => r.key === key)?.color ?? 'gray',
          count: hazards.filter((h) => Number(h.l) === l.value && Number(h.s) === i.value).length,
        };
      })),
      totals: m.ratings.map((r) => ({ rating: r.key, label: r.label, color: r.color, count: hazards.filter((h) => h.rating === r.key).length })),
      unscored: hazards.filter((h) => h.l === null || h.s === null).length,
    } : null;
    const worst = m ? m.ratings.filter((r) => ['high', 'critical'].includes(r.summary_level)).map((r) => r.key) : [];

    const indicators = await db.query<Row>(`select * from safety_indicators where deleted_at is null and active order by sort, name`);
    const shown = [];
    for (const ind of indicators) {
      const pts = await trend(ind, user, periods);
      // The latest complete month with a figure; the month to date only when there is none (E18-79).
      const last = [...pts].reverse().find((p) => p.value !== null && !p.partial) ?? [...pts].reverse().find((p) => p.value !== null) ?? null;
      shown.push({
        id: ind.id, name: ind.name, measure: ind.measure, metric_key: ind.metric_key ?? null, exposure: ind.exposure, per_units: num(ind.per_units),
        target: num(ind.target), target_direction: ind.target_direction, latest: last, points: pts,
      });
    }

    return {
      today, periods,
      totals: {
        events: inWindow.length,
        serious: inWindow.filter((e) => notifying.includes(e.severity)).length,
        open: open.length,
        investigations_overdue: open.filter((e) => e.due && e.due < today).length,
        corrective_open: corrective.open,
        corrective_overdue: corrective.overdue,
        hazards_open: hazards.length,
        hazards_high: hazards.filter((h) => worst.includes(h.rating)).length,
        hazards_review_overdue: hazards.filter((h) => h.review && h.review < today).length,
      },
      by_month: periods.map((p) => {
        const of = inWindow.filter((e) => e.m === p);
        return { period: p, total: of.length, by_type: Object.fromEntries(types.map((t) => [t.value, of.filter((e) => e.event_type === t.value).length])) };
      }),
      by_type: types.map((t) => ({ value: t.value, label: t.label, color: t.color, count: inWindow.filter((e) => e.event_type === t.value).length })),
      by_severity: sevs.map((s) => ({ value: s.value, label: s.label, color: s.color, count: inWindow.filter((e) => e.severity === s.value).length })),
      matrix,
      indicators: shown,
    };
  });
  ctx.describeRoute({ method: 'GET', path: '/api/safety/summary', summary: 'The safety dashboard: events, investigations, corrective actions, hazards and indicators', permission: 'safety.view' });
}

const EXPOSURE_COLUMNS = ['vehicle_miles', 'vehicle_hours', 'boardings', 'revenue_miles', 'major_failures'];
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const round = (n: number) => Math.round(n * 100) / 100;
