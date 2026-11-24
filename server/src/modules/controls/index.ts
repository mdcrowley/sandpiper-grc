import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerControlResource } from './controls.ts';
import { registerCoverage } from './coverage.ts';
import { registerCoverageImport } from './coverage-import.ts';
import { registerSteps } from './steps.ts';
import { seedControlLists, seedSharedValues } from './lists.ts';
import { registerReminders } from './reminders.ts';
import { seedControls } from './seed.ts';
import { registerSummary } from './summary.ts';
import { registerTests } from './tests.ts';

/**
 * Control library and control testing (E26). One library of controls; what each control covers
 * (risks, hazards, framework outcomes, obligations, policies) as generic record links with relation
 * `covers`; tests of design and operation on a schedule, with sampled items, evidence files and an
 * independent reviewer's sign-off; ratings rolled up from the newest reviewed tests; an ineffective
 * result flags the covered risks and hazards for review and can raise a corrective action plan.
 * Permission module `controls`; feature area `controls` (Administration > Features).
 */

async function register(ctx: ModuleContext) {
  await seedSharedValues(ctx);
  registerControlResource(ctx);
  registerTests(ctx);
  registerCoverage(ctx);
  registerCoverageImport(ctx);
  registerSteps(ctx);
  registerSummary(ctx);
  await registerReminders(ctx);
}

const mod: ModuleDef = {
  key: 'controls',
  seedDefaults: seedControlLists,
  register,
  seed: seedControls,
};
export default mod;
