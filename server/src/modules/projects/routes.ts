import type { ModuleContext, Row } from '../../core/module.ts';
import type { ProjectService } from './service.ts';

/** Hand-written routes beside the generated CRUD for `project`. */
export function registerProjectRoutes(ctx: ModuleContext, svc: ProjectService): void {
  const { app } = ctx;
  const view = { preHandler: ctx.requirePerm('projects.view') };
  const edit = { preHandler: ctx.requirePerm('projects.edit') };
  const approve = { preHandler: ctx.requirePerm('projects.approve') };
  const administer = { preHandler: ctx.requirePerm('projects.administer') };
  const params = (req: { params: unknown }) => req.params as Record<string, string>;
  const body = (req: { body: unknown }) => (req.body ?? {}) as Row;

  // ---------- portfolio and settings ----------

  app.get('/api/projects/portfolio', view, async () => svc.portfolio());

  app.get('/api/projects/settings', view, async () => svc.getSettings());
  // PUT is the documented method; PATCH is accepted too because the shared web api client
  // and the test client offer get/post/patch/del only. Both take a partial body.
  app.route({
    method: ['PUT', 'PATCH'], url: '/api/projects/settings', ...administer,
    handler: async (req) => svc.putSettings(req, body(req)),
  });

  // ---------- requests (open to whoever the setting names; no projects permission needed to read your own) ----------

  app.get('/api/projects/intake', async (req) => {
    const s = await svc.getSettings();
    return {
      allowed: await svc.mayRequest(req.user),
      can_open: ctx.can(req.user, 'projects.view'),
      tiers: s.tiers,
      systems_available: Boolean(ctx.resources.get('system')) && ctx.can(req.user, 'systems.view'),
      funding_sources: (await ctx.lookups.values('project_funding_source')).map((v) => ({ value: v.value, label: v.label, color: v.color })),
      requests: await svc.myRequests(req.user!),
    };
  });

  app.post('/api/projects/requests', async (req, reply) => {
    const row = await svc.createRequest(req, body(req));
    reply.code(201);
    return row;
  });

  // The daily sweep for due status reports and waiting gates; also run by a timer (see index.ts).
  app.post('/api/projects/reminders/run', administer, async () => svc.runReminders());

  app.get('/api/projects/gate-definitions', view, async () => svc.gateDefinitions());
  app.route({
    method: ['PUT', 'PATCH'], url: '/api/projects/gate-definitions/:key', ...administer,
    handler: async (req) => svc.putGateDefinition(req, params(req).key, body(req)),
  });

  // ---------- gates ----------

  app.get('/api/projects/:id/gates', view, async (req) => svc.gatesFor(await svc.needProject(params(req).id, req), req.user));

  app.get('/api/projects/:id/systems', view, async (req) => svc.systemsFor(await svc.needProject(params(req).id, req), req.user));

  app.post('/api/projects/:id/rollback', approve, async (req) =>
    svc.rollbackStage(req, await svc.needProject(params(req).id, req), body(req)));

  app.post('/api/projects/:id/gates/:gateId/documents/:index/waive', approve, async (req) => {
    const p = params(req);
    return svc.waiveGateDocument(req, await svc.needProject(p.id, req), p.gateId, Number(p.index), body(req));
  });

  app.patch('/api/projects/:id/gates/:gateId', edit, async (req) => {
    const p = params(req);
    return svc.setGateChange(req, await svc.needProject(p.id, req), p.gateId, body(req));
  });

  app.patch('/api/projects/:id/gates/:gateId/items/:itemId', edit, async (req) => {
    const p = params(req);
    return svc.setChecklistItem(req, await svc.needProject(p.id, req), p.gateId, p.itemId, body(req));
  });

  app.patch('/api/projects/:id/gates/:gateId/documents/:index', edit, async (req) => {
    const p = params(req);
    return svc.setGateDocument(req, await svc.needProject(p.id, req), p.gateId, Number(p.index), body(req));
  });

  app.post('/api/projects/:id/gates/:gateId/decide', approve, async (req) => {
    const p = params(req);
    return svc.decideGate(req, await svc.needProject(p.id, req), p.gateId, body(req));
  });

  // ---------- status reports ----------

  app.get('/api/projects/:id/status-reports', view, async (req) =>
    svc.listReports((await svc.needProject(params(req).id, req)).id));

  app.post('/api/projects/:id/status-reports', edit, async (req, reply) => {
    const row = await svc.addReport(req, await svc.needProject(params(req).id, req), body(req));
    reply.code(201);
    return row;
  });

  app.patch('/api/projects/:id/status-reports/:reportId', edit, async (req) => {
    const p = params(req);
    return svc.updateReport(req, await svc.needProject(p.id, req), p.reportId, body(req));
  });

  app.delete('/api/projects/:id/status-reports/:reportId', edit, async (req) => {
    const p = params(req);
    const project = await svc.needProject(p.id, req);
    await svc.removeChild(req, project, 'status_reports', 'Status report', 'project.status_report_delete', p.reportId,
      (r) => `period ending ${r.period_end}`);
    await svc.refreshRag(req, project.id);
    return { ok: true };
  });

  app.get('/api/projects/:id/status-trend', view, async (req) =>
    svc.statusTrend(await svc.needProject(params(req).id, req)));

  // ---------- risks, issues, decisions and change requests ----------

  app.get('/api/projects/:id/items', view, async (req) => {
    const project = await svc.needProject(params(req).id, req);
    return svc.listItems(project.id, (req.query as Record<string, string>).kind || undefined);
  });

  app.post('/api/projects/:id/items', edit, async (req, reply) => {
    const row = await svc.addItem(req, await svc.needProject(params(req).id, req), body(req));
    reply.code(201);
    return row;
  });

  app.patch('/api/projects/:id/items/:itemId', edit, async (req) => {
    const p = params(req);
    return svc.updateItem(req, await svc.needProject(p.id, req), p.itemId, body(req));
  });

  app.delete('/api/projects/:id/items/:itemId', edit, async (req) => {
    const p = params(req);
    await svc.removeChild(req, await svc.needProject(p.id, req), 'project_items', 'Item', 'project.item_delete', p.itemId, (r) => r.title);
    return { ok: true };
  });

  app.post('/api/projects/:id/items/:itemId/escalate', edit, async (req, reply) => {
    const p = params(req);
    // Escalating adds a risk to the organization's register, so it needs the right to create one
    // there as well as the right to edit the project (E18-30).
    if (ctx.resources.get('risk') && !ctx.can(req.user, 'risks.create')) {
      ctx.fail(403, 'forbidden', 'Escalating adds a risk to the risk register, so you need permission to create risks. Ask someone who manages the risk register to escalate it.');
    }
    const result = await svc.escalateItem(req, await svc.needProject(p.id, req), p.itemId);
    reply.code(201);
    return result;
  });

  // ---------- milestones ----------

  app.get('/api/projects/:id/milestones', view, async (req) =>
    svc.listMilestones((await svc.needProject(params(req).id, req)).id));

  app.post('/api/projects/:id/milestones', edit, async (req, reply) => {
    const row = await svc.addMilestone(req, await svc.needProject(params(req).id, req), body(req));
    reply.code(201);
    return row;
  });

  app.patch('/api/projects/:id/milestones/:milestoneId', edit, async (req) => {
    const p = params(req);
    return svc.updateMilestone(req, await svc.needProject(p.id, req), p.milestoneId, body(req));
  });

  app.delete('/api/projects/:id/milestones/:milestoneId', edit, async (req) => {
    const p = params(req);
    await svc.removeChild(req, await svc.needProject(p.id, req), 'project_milestones', 'Milestone', 'project.milestone_delete', p.milestoneId, (r) => r.name);
    return { ok: true };
  });
}
