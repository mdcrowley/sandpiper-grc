import type { FastifyInstance } from 'fastify';
import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerAdminRoutes } from './admin.ts';
import { makeRegisters, type Registers } from './definitions.ts';
import { registerRecordRoutes } from './routes.ts';
import { seedRegisters } from './seed.ts';
import { registerTemplateRoutes } from './templates.ts';

/**
 * Registers an administrator defines (E41-06). Administration > Registers makes a new kind of record
 * (its names, reference numbering, menu group and icon) while the application runs; its fields are
 * custom fields, its statuses a list, its permissions a permission module of its own and it is an area
 * of its own under Administration > Features. The resource engine does the rest, as for a built-in
 * type: lists, record pages, search, history, attachments, imports, exports, lifecycles and reports.
 * The module itself is always on; each register follows its own switch. See definitions.ts.
 */

/** Each application's registers (tests build several applications in one process). */
const byApp = new WeakMap<FastifyInstance, Registers>();

async function register(ctx: ModuleContext) {
  const regs = makeRegisters(ctx);
  byApp.set(ctx.app, regs);
  registerRecordRoutes(ctx, regs);
  const admin = registerAdminRoutes(ctx, regs);
  registerTemplateRoutes(ctx, regs, admin.shape);
  // Every register is in the registry before the application is ready, so core indexes it for search
  // and every module that reads the record types at start-up sees it.
  await regs.load(false);
  ctx.app.addHook('onReady', async () => { regs.markReady(); });
}

const mod: ModuleDef = {
  key: 'registers',
  register,
  seed: async (ctx, opts) => {
    const regs = byApp.get(ctx.app);
    return regs ? seedRegisters(ctx, regs, opts) : undefined;
  },
};
export default mod;
