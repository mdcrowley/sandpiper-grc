// Hand-written routes of the strategy area: figures, the scorecard and matrix of a plan, its board PDF,
// the sources a measure can take its values from, a series' values for charts, and the settings.
import { UUID_RE } from '../../core/errors.ts';
import { metricsAvailable } from '../../core/metrics.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { scorecardPdf } from './pdf.ts';
import { matrix, pullMeasure, scorecard, seriesValues, summary } from './service.ts';
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
    return matrix(ctx, plan, q.from ? String(q.from) : null, q.to ? String(q.to) : null);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/plans/:id/matrix', tag: TAG, permission: 'strategy.view',
    summary: 'The action-item matrix of a plan: each objective and initiative by quarter, with the status of that quarter\'s update',
    query: { from: 'First quarter, YYYY-Qn (default: the plan\'s start)', to: 'Last quarter, YYYY-Qn (default: today or the plan\'s end); at most 12 quarters' },
    response: '{ quarters: [YYYY-Qn], rows: [{ kind: "objective" | "initiative", id, ref, code, title, goal, cells: { [quarter]: { status, narrative, reported_on, reported_by } | null } }] }',
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
    return { metrics, figures };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/strategy/measure-sources', tag: TAG, permission: 'strategy.view',
    summary: 'What a measure can take its values from: the metrics the caller may read, and the figures recorded over time (for callers who may view reports)',
    response: '{ metrics: [{ key, label, unit, description }], figures: [{ id, name }] }',
  });

  app.post('/api/strategy/measures/:id/pull', { preHandler: ctx.requirePerm('strategy.edit') }, async (req) => {
    const id = idOf(req);
    const measure = UUID_RE.test(id) ? await ctx.resources.find('strategic_measure', id, req.user) : undefined;
    if (!measure) ctx.fail(404, 'not_found', 'Measure not found.');
    if (!['metric', 'figure'].includes(String(measure!.source))) ctx.fail(400, 'validation', 'Check the highlighted fields.', { source: 'This measure is entered by hand.' });
    const b = (req.body ?? {}) as Row;
    const { value, row } = await pullMeasure(ctx, measure!, String(b.period ?? ''));
    return { value, value_id: row?.id ?? null };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/strategy/measures/:id/pull', tag: TAG, permission: 'strategy.edit',
    summary: 'Takes the actual of a measure for one period from its metric or figure over time and stores it (a daily job does this for the current and previous period)',
    body: '{ period: "YYYY" | "YYYY-Qn" | "YYYY-MM" }', response: '{ value: number | null, value_id }',
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
    summary: 'The strategy area\'s settings: reminder steps before a statistical submission is due, and the "due soon" window',
    response: '{ submission_reminder_days: number[], due_soon_days }',
  });
  app.put('/api/strategy/settings', { preHandler: ctx.requirePerm('strategy.administer') }, async (req) => writeSettings(ctx, req, (req.body ?? {}) as Row));
  ctx.describeRoute({
    method: 'PUT', path: '/api/strategy/settings', tag: TAG, permission: 'strategy.administer',
    summary: 'Changes the strategy area\'s settings (audited)', body: '{ submission_reminder_days?: number[], due_soon_days?: number }',
    response: '{ submission_reminder_days, due_soon_days }',
  });
}
