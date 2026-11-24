import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerAccounts, registerImport } from './accounts.ts';
import { registerCampaigns } from './campaigns.ts';
import { seedAccessReviewLists, seedSharedValues } from './lists.ts';
import { registerOverview, registerReminders } from './overview.ts';
import { seedAccessReviews } from './seed.ts';

/**
 * User access reviews (E41-02): the register of accounts on each system (entered, or imported from
 * each system's own export), with each holder matched to the staff roster and leavers, people on leave
 * and unknown holders flagged; and review campaigns in which each system's owner keeps or removes every
 * account, with due dates, reminders, a decision file, removals tracked to done and the finished
 * campaign recorded as a control test. It shares the `systems` permissions (like OT security). Feature
 * area `accessreviews` (Administration > Features): while it is off its routes answer 404 and its record
 * types, lists, notifications and calendar source are hidden everywhere.
 */

async function register(ctx: ModuleContext) {
  await seedSharedValues(ctx);
  registerAccounts(ctx);
  const campaigns = registerCampaigns(ctx);
  registerImport(ctx, campaigns.confirmByImport);
  registerOverview(ctx);
  await registerReminders(ctx);
}

const mod: ModuleDef = {
  key: 'accessreviews',
  seedDefaults: seedAccessReviewLists,
  register,
  seed: seedAccessReviews,
};
export default mod;
