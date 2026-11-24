// Routes for figures over time (E41-04): the figures an organization follows, their values month
// by month, recording them now, and exporting one. The month-end job is scheduled here too.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';
import { describeSpecFilters } from './files.ts';
import { FigureError, type Figures } from './figures.ts';

const FIGURE_SHAPE = {
  type: 'object',
  properties: {
    id: { type: 'string' }, key: { type: ['string', 'null'] }, name: { type: 'string' }, description: { type: ['string', 'null'] },
    source: { type: 'string', enum: ['count', 'metric'] }, metric_key: { type: ['string', 'null'] }, record_type: { type: ['string', 'null'] },
    filters: { type: ['object', 'null'] }, group_field: { type: ['string', 'null'] }, active: { type: 'boolean' },
    unit: { type: 'string', enum: ['count', 'percent', 'number'] }, type_label: { type: ['string', 'null'] }, group_label: { type: ['string', 'null'] },
    metric_label: { type: ['string', 'null'] }, what: { type: 'string' },
    latest: { type: ['object', 'null'], description: '{ period, kind (month_end | on_demand), value, groups, recorded_at }' },
  },
};
const BODY = {
  type: 'object',
  properties: {
    name: { type: 'string' }, description: { type: ['string', 'null'] }, source: { type: 'string', enum: ['count', 'metric'] },
    metric_key: { type: 'string', description: 'source = metric: a key from GET /api/metrics' },
    record_type: { type: 'string', description: 'source = count: the record type to count' },
    filters: { type: ['object', 'null'], description: 'source = count: a filter tree as the report builder saves it ({ op, items })' },
    group_field: { type: ['string', 'null'], description: 'source = count: a list (lookup) field to break the count down by' },
    active: { type: 'boolean', description: 'Recorded at each month end' },
  },
};

export function registerFigureRoutes(ctx: ModuleContext, figures: Figures, exportFigure: (req: FastifyRequest, reply: FastifyReply, id: string, months: number, format: string) => Promise<unknown>) {
  const { app, db } = ctx;
  const viewer = async (req: FastifyRequest) => {
    if (!ctx.can(req.user, 'reports.view') && !ctx.can(req.user, 'dashboards.view')) ctx.fail(403, 'forbidden', 'You do not have permission to do that.');
  };
  const bad = (err: unknown): never => {
    if (err instanceof FigureError) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [err.field]: err.message });
    throw err;
  };
  const need = async (req: FastifyRequest) => (await figures.visible(req.user ?? null, (req.params as { id: string }).id))
    ?? ctx.fail(404, 'not_found', 'This figure was not found, or it is not available to you here.');
  const writable = (f: Row) => ['name', 'description', 'source', 'metric_key', 'record_type', 'filters', 'group_field', 'active'].reduce<Row>((o, k) => ({ ...o, [k]: k === 'filters' && typeof f[k] === 'string' ? JSON.parse(f[k]) : f[k] }), {});

  app.get('/api/figures', { preHandler: viewer }, async (req) => {
    const q = (req.query ?? {}) as Row;
    const months = q.months !== undefined ? figures.monthsOf(q.months) : 0;
    const now = new Date();
    const out: Row[] = [];
    for (const f of await figures.all()) {
      if (!figures.mayRead(req.user ?? null, f)) continue;
      const item = await figures.summary(f);
      if (months) item.result = await figures.result(f, months, now);
      out.push(item);
    }
    return out;
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/figures', tag: 'Reports', permission: 'reports.view',
    summary: 'The figures recorded over time (E41-04), with their latest values',
    description: 'Figures the caller may see: those about a record type need view permission on its module (a figure counts every record, restricted or not, and is the same for everyone). Figures of switched-off areas are left out. Also open to `dashboards.view`. With `months`, each carries its values month by month as a report result.',
    query: { months: 'Optional: include the last n months (1 to 60) as `result`' },
    response: { type: 'array', items: FIGURE_SHAPE },
  });

  app.get('/api/figures/:id', { preHandler: viewer }, async (req) => {
    const f = await need(req);
    const months = figures.monthsOf((req.query as Row).months);
    const now = new Date();
    const filters = f.source === 'count' && f.record_type ? await describeSpecFilters(ctx, { type: f.record_type, filters: typeof f.filters === 'string' ? JSON.parse(f.filters) : f.filters ?? undefined }) : [];
    return { ...(await figures.summary(f)), months, filters_text: filters, result: await figures.result(f, months, now), values: await figures.values(f, months, now) };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/figures/:id', tag: 'Reports', permission: 'reports.view',
    summary: 'One figure over time: its values month by month',
    description: 'The month-end value of each month, or the latest one recorded on demand where the month has none (the current month is "so far"). `result` has the shape of a report result (one row per month, or a month-by-value table for a breakdown), so it can be drawn like a grouped report.',
    query: { months: 'Months to include, 1 to 60 (default 12)' },
  });

  app.post('/api/figures', { preHandler: ctx.requirePerm('reports.create') }, async (req, reply) => {
    const data = await figures.clean(req.user ?? null, (req.body ?? {}) as Row, null).catch(bad);
    const row = await db.one<Row>(
      `insert into tracked_figures (name, description, source, metric_key, record_type, filters, group_field, active, created_by, updated_by)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $9) returning *`,
      [data.name, data.description ?? null, data.source, data.metric_key ?? null, data.record_type ?? null, data.filters ?? null, data.group_field ?? null, data.active ?? true, req.user!.id],
    );
    await ctx.audit(req, { action: 'tracked_figure.create', recordType: 'tracked_figure', recordId: row!.id, summary: `Added the figure "${row!.name}" to the figures recorded over time`, after: writable(row!) });
    reply.code(201);
    return figures.summary(row!);
  });
  ctx.describeRoute({ method: 'POST', path: '/api/figures', tag: 'Reports', permission: 'reports.create', summary: 'Adds a figure to record over time', body: BODY, response: FIGURE_SHAPE });

  app.patch('/api/figures/:id', { preHandler: ctx.requirePerm('reports.edit') }, async (req) => {
    const f = await need(req);
    const data = await figures.clean(req.user ?? null, (req.body ?? {}) as Row, f).catch(bad);
    const cols = Object.keys(data);
    const row = await db.one<Row>(
      `update tracked_figures set ${cols.map((c, i) => `${c} = $${i + 2}${c === 'filters' ? '::jsonb' : ''}`).join(', ')}, updated_at = now(), updated_by = $${cols.length + 2}
       where id = $1 returning *`,
      [f.id, ...cols.map((c) => data[c]), req.user!.id],
    );
    await ctx.audit(req, { action: 'tracked_figure.update', recordType: 'tracked_figure', recordId: f.id, summary: `Changed the figure "${row!.name}"`, before: writable(f), after: writable(row!) });
    return figures.summary(row!);
  });
  ctx.describeRoute({ method: 'PATCH', path: '/api/figures/:id', tag: 'Reports', permission: 'reports.edit', summary: 'Changes a figure (what it counts, its name, whether it is recorded)', body: BODY, response: FIGURE_SHAPE });

  app.delete('/api/figures/:id', { preHandler: ctx.requirePerm('reports.delete') }, async (req) => {
    const f = await need(req);
    await db.query('update tracked_figures set deleted_at = now(), updated_at = now(), updated_by = $2 where id = $1', [f.id, req.user!.id]);
    await ctx.audit(req, { action: 'tracked_figure.delete', recordType: 'tracked_figure', recordId: f.id, summary: `Stopped recording the figure "${f.name}" and removed it`, before: writable(f) });
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/figures/:id', tag: 'Reports', permission: 'reports.delete', summary: 'Removes a figure; its recorded values are kept but no longer shown' });

  app.post('/api/figures/record', { preHandler: ctx.requirePerm('reports.edit') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    const ids = Array.isArray(b.ids) ? b.ids.map(String).slice(0, 200) : null;
    const done = await figures.recordNow(req.user as SessionUser, ids, new Date());
    await ctx.audit(req, {
      action: 'tracked_figure.record', recordType: 'tracked_figure',
      summary: `Recorded ${done.recorded.length} figure${done.recorded.length === 1 ? '' : 's'} for the month so far (${done.period.slice(0, 7)})`,
      after: { period: done.period, figures: done.recorded },
    });
    return { period: done.period, recorded: done.recorded.length };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/figures/record', tag: 'Reports', permission: 'reports.edit',
    summary: 'Records the figures now, for the month so far',
    description: 'Works out every active figure the caller may see (or the ones named in `ids`) and keeps the value for the current month as "on demand". A month-end value, recorded by the month-end job, always takes its place once the month has ended.',
    body: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' }, description: 'Optional: only these figures' } } },
    response: '{ period: "YYYY-MM-01", recorded: number }',
  });

  app.get('/api/figures/:id/export', { preHandler: ctx.requirePerm('reports.export') }, async (req, reply) => {
    const f = await need(req);
    const q = (req.query ?? {}) as Row;
    return exportFigure(req, reply, f.id, figures.monthsOf(q.months), String(q.format ?? 'pdf'));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/figures/:id/export', tag: 'Reports', permission: 'reports.export',
    summary: 'One figure over time as a PDF, Excel, CSV or print-ready document',
    query: { format: 'pdf (default), xlsx, csv or html', months: 'Months to include, 1 to 60 (default 12)' },
  });

  // The month end: every active figure is recorded once the month is over (hourly; job type
  // reports.figures_month_end, skipped while Dashboards and reports is switched off).
  return scheduleWork(ctx, 'reports.figures_month_end', async () => figures.monthEnd(new Date()), { every: 60 * 60_000, firstRunInMs: 5 * 60_000 });
}
