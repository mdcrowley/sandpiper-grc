import type { ModuleContext, Row } from '../../core/module.ts';
import type { ChangeService } from './service.ts';

/** Hand-written routes beside the generated CRUD for `change`. */
export function registerChangeRoutes(ctx: ModuleContext, svc: ChangeService): void {
  const { app } = ctx;
  const view = { preHandler: ctx.requirePerm('changes.view') };
  const create = { preHandler: ctx.requirePerm('changes.create') };
  const edit = { preHandler: ctx.requirePerm('changes.edit') };
  const approve = { preHandler: ctx.requirePerm('changes.approve') };
  const administer = { preHandler: ctx.requirePerm('changes.administer') };
  const params = (req: { params: unknown }) => req.params as Record<string, string>;
  const query = (req: { query: unknown }) => req.query as Record<string, string>;
  const body = (req: { body: unknown }) => (req.body ?? {}) as Row;

  // ---------- register, calendar and live conflict check ----------

  app.get('/api/changes/overview', view, async (req) => svc.overview(query(req).week_from, query(req).week_to));
  app.get('/api/changes/calendar', view, async (req) => svc.calendar(query(req).from, query(req).to, query(req).system_id));
  // A read, sent as POST because it carries a list of systems.
  app.post('/api/changes/conflicts/check', view, async (req) => ({ conflicts: await svc.check(body(req)) }));

  // ---------- settings: questionnaire and approval rules ----------

  app.get('/api/changes/settings', view, async () => svc.getSettings());
  app.route({
    method: ['PUT', 'PATCH'], url: '/api/changes/settings', ...administer,
    handler: async (req) => svc.putSettings(req, body(req)),
  });

  // ---------- standard change templates ----------

  app.get('/api/changes/templates', view, async (req) =>
    svc.listTemplates(query(req).all === 'true' && ctx.can(req.user, 'changes.administer')));
  app.post('/api/changes/templates', administer, async (req, reply) => {
    reply.code(201);
    return svc.addTemplate(req, body(req));
  });
  app.patch('/api/changes/templates/:templateId', administer, async (req) => svc.updateTemplate(req, params(req).templateId, body(req)));
  app.delete('/api/changes/templates/:templateId', administer, async (req) => svc.removeTemplate(req, params(req).templateId));
  app.post('/api/changes/templates/:templateId/raise', create, async (req, reply) => {
    reply.code(201);
    return svc.createFromTemplate(req, params(req).templateId, body(req));
  });

  // ---------- blackout periods ----------

  app.get('/api/changes/blackouts', view, async () => svc.listBlackouts());
  app.post('/api/changes/blackouts', administer, async (req, reply) => {
    reply.code(201);
    return svc.addBlackout(req, body(req));
  });
  app.patch('/api/changes/blackouts/:blackoutId', administer, async (req) => svc.updateBlackout(req, params(req).blackoutId, body(req)));
  app.delete('/api/changes/blackouts/:blackoutId', administer, async (req) => svc.removeBlackout(req, params(req).blackoutId));

  // ---------- one change: workflow, approvals, conflicts, review ----------

  // Changes waiting for the reader's own decision.
  app.get('/api/changes/waiting', view, async (req) => ({ rows: await svc.waitingFor(req.user!) }));

  app.get('/api/changes/:id/workflow', view, async (req) => svc.workflowFor(await svc.needChange(params(req).id, req), req.user));

  app.post('/api/changes/:id/transition', edit, async (req) => svc.transition(req, await svc.needChange(params(req).id, req), body(req)));

  app.get('/api/changes/:id/approvals', view, async (req) => svc.approvalsFor(await svc.needChange(params(req).id, req), req.user));
  app.post('/api/changes/:id/approvals', approve, async (req, reply) => {
    const result = await svc.recordApproval(req, await svc.needChange(params(req).id, req), body(req));
    reply.code(201);
    return result;
  });

  app.get('/api/changes/:id/conflicts', view, async (req) => ({ conflicts: await svc.conflictsFor(await svc.needChange(params(req).id, req)) }));
  app.post('/api/changes/:id/conflicts/acknowledge', approve, async (req) =>
    ({ conflicts: await svc.acknowledge(req, await svc.needChange(params(req).id, req), body(req)) }));

  app.post('/api/changes/:id/review', edit, async (req) => svc.saveReview(req, await svc.needChange(params(req).id, req), body(req)));
  app.post('/api/changes/:id/actions', edit, async (req, reply) => {
    const action = await svc.raiseAction(req, await svc.needChange(params(req).id, req), body(req));
    reply.code(201);
    return action;
  });
}
