// Hand-written routes of the strategy area: figures, the scorecard and matrix of a plan, its board PDF,
// the sources a measure can take its values from, a series' values for charts, and the settings.
import { UUID_RE } from '../../core/errors.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { scorecardPdf } from './pdf.ts';
import { AUTOMATIC_SOURCES, matrix, pullMeasure, scorecard, seriesValues, summary } from './service.ts';
import { readSettings, writeSettings } from './settings.ts';

const TAG = 'Strategy';

export function registerRoutes(ctx: ModuleContext) {
  const { app, db } = ctx;
  const view = ctx.requirePerm('strategy.view');
  const idOf = (req: { params: unknown }) => String((req.params as Row).id ?? '');
  const findPlan = async (req: { params: unknown; user?: unknown }) => {
    const id = idOf(req);
    const plan = UUID_RE.test(id) ? await ctx.resources.find('strategic_plan', id, (req as Row).user) : undefined;
    return plan ?? ctx.fail(404, 'not_found', 'Strategic plan not found.');
  };

  app.get('/api/strategy/summary', { preHandler: view }, async () => summary(ctx, (await readSettings(ctx)).due_soon_days));
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/summary', tag: TAG, permission: 'strategy.view',
    summary: 'Figures of the strategy area, the same for every viewer: plans in force, objectives and initiatives by status, measures against target, statistical submissions due and overdue',
    response: '{ today, due_soon_days, plans_in_force, objectives: { on_track, at_risk, off_track, not_reported, total }, initiatives: {...}, measures: { met, near, missed, no_value, total }, submissions: { overdue, due_soon, open }, series }',
  });

  app.get('/api/strategy/plans/:id/scorecard', { preHandler: view }, async (req) => {
    const plan = await findPlan(req);
    return scorecard(ctx, plan, { canSeeProjects: ctx.can(req.user, 'projects.view') });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/plans/:id/scorecard', tag: TAG, permission: 'strategy.view',
    summary: 'The scorecard of a plan: goals, their objectives with status, latest update, measures (latest actual against target, recent trend) and initiatives',
    description: 'Project names are given only to callers who may view projects.',
    response: '{ plan, totals: { objectives, initiatives, measures }, goals: [{ id, code, title, objectives: [{ id, ref, code, title, status, latest, measures: [...], initiatives: [...] }] }] }',
  });

  app.get('/api/strategy/plans/:id/matrix', { preHandler: view }, async (req) => {
    const plan = await findPlan(req);
    const q = req.query as Row;
    return matrix(ctx, plan, { from: q.from ? String(q.from) : null, to: q.to ? String(q.to) : null, year: q.year ? String(q.year) : null });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/plans/:id/matrix', tag: TAG, permission: 'strategy.view',
    summary: 'The action-item matrix of a plan: each objective and initiative by quarter of the organization\'s fiscal year, with the status of that quarter\'s update',
    description: 'On a fiscal year that starts in a month other than January, quarters are written FYYYYY-Qn. An update entered on the calendar year shows in the column of the quarter its own quarter ends in.',
    query: {
      year: 'One year of the plan as `years` lists it (YYYY, or FYYYYY on a fiscal year): its four quarters',
      from: 'First quarter, YYYY-Qn or FYYYYY-Qn (default: the plan\'s start)', to: 'Last quarter (default: today or the plan\'s end); at most 12 quarters',
    },
    response: '{ quarters: [period], spans: { [quarter]: "July to September 2026" }, years: [{ key, quarters }], year, fiscal_year: { start_month, named_for }, rows: [{ kind: "objective" | "initiative", id, ref, code, title, goal, cells: { [quarter]: { status, narrative, reported_on, reported_by, period } | null } }] }',
  });

  app.get('/api/strategy/plans/:id/scorecard.pdf', { preHandler: [view, ctx.requirePerm('strategy.export')] }, async (req, reply) => {
    const plan = await findPlan(req);
    const file = await scorecardPdf(ctx, req, plan);
    await ctx.audit(req, { action: 'strategic_plan.scorecard_pdf', recordType: 'strategic_plan', recordId: plan.id, summary: `Board scorecard PDF made for ${plan.ref ?? plan.title}` });
    reply.header('content-type', 'application/pdf');
    reply.header('content-disposition', `attachment; filename="plan-scorecard-${String(plan.ref ?? 'plan').replace(/[^A-Za-z0-9-]/g, '')}.pdf"`);
    reply.header('cache-control', 'no-store');
    return reply.send(file);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/plans/:id/scorecard.pdf', tag: TAG, permission: 'strategy.export',
    summary: 'The board-ready scorecard of a plan as a tagged PDF (PDF/UA) with the organization\'s branding', description: 'Audited.', response: 'application/pdf',
  });

  app.get('/api/strategy/measure-sources', { preHandler: view }, async (req) => {
    const metrics = metricsAvailable(app, ctx.resources).filter((m) => {
      const def = m.recordType ? ctx.resources.get(m.recordType) : undefined;
      return !def || ctx.can(req.user, `${def.module}.view`);
    }).map((m) => ({ key: m.key, label: m.label, unit: m.unit, description: m.description }));
    const figures = ctx.resources.get('report_definition') && ctx.can(req.user, 'reports.view')
      ? (await db.query<Row>(`select id, name from tracked_figures where deleted_at is null order by sort, name`).catch(() => [])).map((f) => ({ id: f.id, name: f.name }))
      : [];
    const series = (await db.query<Row>('select id, code, name, unit, frequency, breakdown_label, breakdowns, active from strategy_stat_series where deleted_at is null order by active desc, sort, name'))
      .map((r) => ({ id: r.id, code: r.code, name: r.name, unit: r.unit, frequency: r.frequency, breakdown_label: r.breakdown_label, active: r.active, breakdowns: String(r.breakdowns ?? '').split('\n').filter(Boolean) }));
    return { metrics, figures, series };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/measure-sources', tag: TAG, permission: 'strategy.view',
    summary: 'What a measure can take its values from: the metrics the caller may read, the figures recorded over time (for callers who may view reports) and the statistics series',
    response: '{ metrics: [{ key, label, unit, description }], figures: [{ id, name }], series: [{ id, code, name, unit, frequency, breakdown_label, active, breakdowns: [string] }] }',
  });

  app.post('/api/strategy/measures/:id/pull', { preHandler: ctx.requirePerm('strategy.edit') }, async (req) => {
    const id = idOf(req);
    const measure = UUID_RE.test(id) ? await ctx.resources.find('strategic_measure', id, req.user) : undefined;
    if (!measure) ctx.fail(404, 'not_found', 'Measure not found.');
    if (!AUTOMATIC_SOURCES.includes(String(measure!.source))) ctx.fail(400, 'validation', 'Check the highlighted fields.', { source: 'This measure is entered by hand.' });
    const b = (req.body ?? {}) as Row;
    const { value, row } = await pullMeasure(ctx, measure!, String(b.period ?? ''));
    return { value, value_id: row?.id ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/strategy/measures/:id/pull', tag: TAG, permission: 'strategy.edit',
    summary: 'Takes the actual of a measure for one period from its metric, figure over time or statistics series and stores it (a daily job does this for the current and previous period, and a series\' measures follow each value entered)',
    body: '{ period: "YYYY" | "YYYY-Qn" | "FYYYYY" | "FYYYYY-Qn" | "YYYY-MM" | a date inside the period }', response: '{ value: number | null, value_id }',
  });

  app.get('/api/strategy/stat-series/:id/values', { preHandler: view }, async (req) => {
    const id = idOf(req);
    const series = UUID_RE.test(id) ? await ctx.resources.find('stat_series', id, req.user) : undefined;
    if (!series) ctx.fail(404, 'not_found', 'Statistics series not found.');
    const q = req.query as Row;
    return { series: { id: series!.id, name: series!.name, unit: series!.unit, frequency: series!.frequency, breakdown_label: series!.breakdown_label, decimals: series!.decimals }, ...(await seriesValues(ctx, series!, q.from ? String(q.from) : null, q.to ? String(q.to) : null)) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/stat-series/:id/values', tag: TAG, permission: 'strategy.view',
    summary: 'A statistics series\' values by period and breakdown, for charts',
    query: { from: 'Optional first day, YYYY-MM-DD', to: 'Optional last day, YYYY-MM-DD' },
    response: '{ series: { id, name, unit, frequency, breakdown_label, decimals }, periods: [period], breakdowns: [""=total, ...], values: { [breakdown]: [number|null per period] } }',
  });

  app.get('/api/strategy/settings', { preHandler: view }, async () => readSettings(ctx));
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/settings', tag: TAG, permission: 'strategy.view',
    summary: 'The strategy area\'s settings: reminder steps before a statistical submission is due, the "due soon" window, and the organization\'s fiscal year',
    response: '{ submission_reminder_days: number[], due_soon_days, fiscal_year_start_month: 1-12, fiscal_year_named_for: "end" | "start", fiscal_year_text, fiscal_periods_in_use }',
  });
  app.put('/api/strategy/settings', { preHandler: ctx.requirePerm('strategy.administer') }, async (req) => writeSettings(ctx, req, (req.body ?? {}) as Row));
  ctx.describeRoute({
    method: 'PUT', path: '/api/strategy/settings', tag: TAG, permission: 'strategy.administer',
    summary: 'Changes the strategy area\'s settings and the organization\'s fiscal year (audited)',
    description: 'The fiscal year cannot change while measure values, statistics or updates are kept on its fiscal periods (FY...); periods on the calendar year are never affected.',
    body: '{ submission_reminder_days?: number[], due_soon_days?: number, fiscal_year_start_month?: 1-12, fiscal_year_named_for?: "end" | "start" }', response: 'as GET',
  });
}
