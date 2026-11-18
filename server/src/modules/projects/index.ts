import type { ModuleDef } from '../../core/module.ts';
import { seedProjectDefaults } from './defaults.ts';
import { defineProject } from './resource.ts';
import { registerProjectRoutes } from './routes.ts';
import { seedSampleProjects } from './seed.ts';
import { makeService } from './service.ts';

// Projects and portfolio: intake, tiers, stages and gates, scoring,
// status reports, project risks and issues, milestones.
const mod: ModuleDef = {
  key: 'projects',
  async seedDefaults(ctx) {
    await seedProjectDefaults(ctx);
  },
  async register(ctx) {
    const svc = makeService(ctx);
    defineProject(ctx, svc);
    registerProjectRoutes(ctx, svc);
  },
  async seed(ctx) {
    return seedSampleProjects(ctx, makeService(ctx));
  },
};

export default mod;
