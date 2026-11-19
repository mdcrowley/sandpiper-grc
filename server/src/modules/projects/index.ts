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

    // Reminders for due status reports and waiting gates. In-process timer (single process);
    // none under the test runner or with a throwaway in-memory database.
    if (!process.env.VITEST && process.env.GRC_DATA_DIR !== 'memory') {
      const run = () => { svc.runReminders().catch((err) => console.error('[projects] reminders failed:', err)); };
      const first = setTimeout(run, 90_000);
      const timer = setInterval(run, 6 * 3_600_000);
      first.unref();
      timer.unref();
      ctx.app.addHook('onClose', async () => { clearTimeout(first); clearInterval(timer); });
    }
  },
  async seed(ctx) {
    return seedSampleProjects(ctx, makeService(ctx));
  },
};

export default mod;
