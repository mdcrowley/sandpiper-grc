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

  app.get('/api/projects/gate-definitions', view, async () => svc.gateDefinitions());
  app.route({
    method: ['PUT', 'PATCH'], url: '/api/projects/gate-definitions/:key', ...administer,
    handler: async (req) => svc.putGateDefinition(req, params(req).key, body(req)),
  });

  // ---------- gates ----------

  app.get('/api/projects/:id/gates', view, async (req) => svc.gatesFor(await svc.needProject(params(req).id, req)));

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
