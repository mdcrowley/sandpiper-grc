// Approval workflows (E14-06): administrator-defined, ordered approval steps on any record type.
// Always on (not a feature area); a workflow on a record type whose area is switched off does
// nothing until the area is back on. Modules hand their own approvals to it as approval kinds
// (core/approval-kinds.ts; docs/development.md, "Approval workflows"), and approvers name
// stand-ins for a period (E14-32).
import type { FastifyRequest } from 'fastify';
import { setApprovalEngine } from '../../core/approval-kinds.ts';
import { ensureJobs, scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, ResourceDef, Row } from '../../core/module.ts';
import { registerRoutes } from './routes.ts';
import { makeService, type Service } from './service.ts';

const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * Follows record creation and changes through each record type's after-hooks, added once every
 * module (and any test module) has defined its types. The module's own hook runs first; the
 * engine never makes a record change fail.
 */
function follow(ctx: ModuleContext, svc: Service) {
  const wrapped = new WeakSet<ResourceDef>();
  const safely = async (what: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { console.error(`[workflows] ${what}:`, err); }
  };
  ctx.app.addHook('onReady', async () => {
    for (const def of ctx.resources.all()) {
      if (wrapped.has(def)) continue;
      wrapped.add(def);
      const own = def.hooks ?? {};
      const afterCreate = own.afterCreate;
      const afterUpdate = own.afterUpdate;
      def.hooks = {
        ...own,
        afterCreate: async (req: FastifyRequest | null, row: Row) => {
          await afterCreate?.(req, row);
          await safely(`${def.type} created`, () => svc.recordCreated(def, row, req));
        },
        afterUpdate: async (req: FastifyRequest | null, before: Row, after: Row) => {
          await afterUpdate?.(req, before, after);
          await safely(`${def.type} changed`, () => svc.recordUpdated(def, before, after, req));
        },
      };
    }
  });
}

const mod: ModuleDef = {
  key: 'workflows',
  async register(ctx) {
    const svc = makeService(ctx);
    registerRoutes(ctx, svc);
    follow(ctx, svc);
    // A deleted record's running workflows end (BS-1): none waits forever on a record nobody can open.
    ctx.resources.onChange?.(async ({ action, def, row, req }) => {
      if (action === 'delete' || action === 'purge') await svc.recordDeleted(def.type, String(row.id), req);
    });
    setApprovalEngine(ctx.app, svc.engine);
    // Lifecycle moves that wait for an approval workflow (E14-37) are held and made here.
    ctx.app.lifecycles.setHolder(svc.holder);
    // Every module has declared its approval kinds by now: each installs once (its workflows, and
    // the approvals that were waiting when it moved to workflows).
    ctx.app.addHook('onReady', async () => { await svc.installed(); });
    const jobs = await ensureJobs(ctx);
    // A due step queues its own escalation for its due time; the sweep catches anything missed.
    jobs.register('workflows.escalate', async () => svc.escalateDue(), { maxAttempts: 3 });
    await scheduleWork(ctx, 'workflows.escalations', () => svc.escalateDue(), { every: FIFTEEN_MINUTES, firstRunInMs: 120_000 });
    // For tests and the MCP tool: the service, without importing this module's files.
    if (!ctx.app.hasDecorator('workflows')) ctx.app.decorate('workflows', svc);
  },
};

declare module 'fastify' {
  interface FastifyInstance {
    /** The approval workflow service (workflows module); guard with `app.hasDecorator('workflows')`. */
    workflows?: Service;
  }
}

export default mod;
