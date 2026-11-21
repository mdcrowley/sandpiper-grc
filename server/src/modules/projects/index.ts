import { addStateGrant } from '../../core/auth.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleDef } from '../../core/module.ts';
import { seedProjectDefaults } from './defaults.ts';
import { registerGateApproval } from './gate-approval.ts';
import { runOverdueReminders } from './overdue-reminders.ts';
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
    // The web app shows "New project request" only to people who may send one (BW-06).
    addStateGrant(ctx.app, async (user) => ((await svc.mayRequest(user)) ? ['projects.request'] : []));
    // Gate decisions may run on the shared approval workflows (E11-25).
    registerGateApproval(ctx, svc);

    // Reminders for due status reports and waiting gates, and for overdue milestones and
    // register items: several times a day on the job queue (Administration > Background jobs).
    await scheduleWork(ctx, 'projects.reminders', () => svc.runReminders(), { every: 6 * 3_600_000, firstRunInMs: 90_000 });
    await scheduleWork(ctx, 'projects.overdue_reminders', () => runOverdueReminders(ctx), { every: 6 * 3_600_000, firstRunInMs: 100_000 });
  },
  async seed(ctx) {
    return seedSampleProjects(ctx, makeService(ctx));
  },
};

export default mod;
