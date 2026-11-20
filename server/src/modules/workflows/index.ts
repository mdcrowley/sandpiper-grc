// Approval workflows (E14-06): administrator-defined, ordered approval steps on any record type.
// Always on (not a feature area); a workflow on a record type whose area is switched off does
// nothing until the area is back on. Modules keep their own approval rules; how one moves to this
// engine is in docs/development.md ("Approval workflows").
import type { FastifyRequest } from 'fastify';
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
