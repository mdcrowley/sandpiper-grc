import type { ModuleDef } from '../../core/module.ts';
import { seedChangeDefaults } from './defaults.ts';
import { registerStartSweep } from './notify.ts';
import { defineChange } from './resource.ts';
import { registerChangeRoutes } from './routes.ts';
import { seedSampleChanges } from './seed.ts';
import { registerSuccessRate } from './success.ts';
import { makeService } from './service.ts';

// Change enablement: changes with a risk questionnaire, approvals by type and risk,
// standard change templates, a calendar with blackout periods and conflict detection,
// and post-implementation reviews.
const mod: ModuleDef = {
  key: 'changes',
  async seedDefaults(ctx) {
    await seedChangeDefaults(ctx);
  },
  async register(ctx) {
    const svc = makeService(ctx);
    // Fixed paths are registered before the generated `/api/changes/:id`.
    registerChangeRoutes(ctx, svc);
    registerSuccessRate(ctx);
    defineChange(ctx, svc.base);
    await registerStartSweep(ctx);
  },
  async seed(ctx, opts) {
    // Invented samples only: a pilot installation starts with no pretend changes (E18-69).
    if (opts.profile !== 'dev') return 'nothing to load (sample changes are dev profile only)';
    return seedSampleChanges(ctx, makeService(ctx));
  },
};

export default mod;
