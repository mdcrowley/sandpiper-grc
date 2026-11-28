import type { ModuleContext, ModuleDef } from '../../core/module.ts';
import { registerStrategyMetrics } from './metrics.ts';
import { registerRecords } from './records.ts';
import { registerReminders } from './reminders.ts';
import { registerRoutes } from './routes.ts';
import { seedStrategy } from './seed.ts';

/**
 * Strategy and performance (wave 26, feature area `strategy`, permission module `strategy`).
 *
 * The strategic plan register: plans for a period, adopted by a board decision (governance) and kept
 * as a controlled document (policies); their goals, the objectives under each goal, the measures of
 * each objective (unit, direction, baseline, targets and actuals per period, entered by hand or taken
 * from a metric or a figure recorded over time), and the initiatives that deliver them, linked to a
 * project, a budget line and actions. Objectives and initiatives get quarterly status updates (on
 * track, at risk, off track, with a narrative, by whom and when); the plan has a scorecard, a quarterly
 * matrix and a board-ready PDF.
 *
 * Statistics: operating statistics an administrator defines as series (unit, frequency, breakdowns
 * such as mode or service) with values entered per period (or imported from CSV), charts, and a log
 * of the periodic statistical reports submitted to outside bodies, with reminders before they are
 * due. No outside body, program or form is built in.
 *
 * Every part is a normal record type, so the report builder, dashboards, report packs, imports,
 * exports, MCP and data load mode work on it. Figures count every record and are the same for everyone.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'strategy' };
  await ctx.lookups.ensure('strategy_plan_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'adopted', label: 'Adopted', color: 'green', sort: 20 },
    { value: 'superseded', label: 'Superseded', color: 'blue', sort: 30 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('strategy_rag', [
    { value: 'on_track', label: 'On track', color: 'green', sort: 10 },
    { value: 'at_risk', label: 'At risk', color: 'amber', sort: 20 },
    { value: 'off_track', label: 'Off track', color: 'red', sort: 30 },
  ], own);
  await ctx.lookups.ensure('measure_direction', [
    { value: 'increase', label: 'Higher is better', sort: 10 },
    { value: 'decrease', label: 'Lower is better', sort: 20 },
    { value: 'maintain', label: 'Close to the target', sort: 30 },
  ], own);
  await ctx.lookups.ensure('stat_frequency', [
    { value: 'monthly', label: 'Monthly', sort: 10 },
    { value: 'quarterly', label: 'Quarterly', sort: 20 },
    { value: 'yearly', label: 'Yearly', sort: 30 },
  ], own);
  await ctx.lookups.ensure('measure_source', [
    { value: 'manual', label: 'Entered by hand', sort: 10 },
    { value: 'metric', label: 'Metric', sort: 20 },
    { value: 'figure', label: 'Figure over time', sort: 30 },
  ], own);
  await ctx.lookups.ensure('measure_state', [
    { value: 'met', label: 'Meets target', color: 'green', sort: 10 },
    { value: 'near', label: 'Near target', color: 'amber', sort: 20 },
    { value: 'missed', label: 'Misses target', color: 'red', sort: 30 },
    { value: 'no_target', label: 'No target', color: 'gray', sort: 40 },
  ], own);
  await ctx.lookups.ensure('initiative_stage', [
    { value: 'planned', label: 'Planned', color: 'gray', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'blue', sort: 20 },
    { value: 'on_hold', label: 'On hold', color: 'amber', sort: 30 },
    { value: 'completed', label: 'Completed', color: 'green', sort: 40 },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 50 },
  ], own);
  await ctx.lookups.ensure('submission_status', [
    { value: 'planned', label: 'Planned', color: 'gray', sort: 10 },
    { value: 'in_preparation', label: 'In preparation', color: 'blue', sort: 20 },
    { value: 'submitted', label: 'Submitted', color: 'green', sort: 30 },
    { value: 'accepted', label: 'Accepted', color: 'green', sort: 40 },
    { value: 'returned', label: 'Returned for correction', color: 'amber', sort: 50 },
  ], own);
  // Actions raised for an initiative (the action tracker's list, seeded by the risks module first).
  await ctx.lookups.ensure('action_source', [{ value: 'strategy', label: 'Strategy', sort: 170 }]);
}

async function register(ctx: ModuleContext) {
  registerRecords(ctx);
  registerRoutes(ctx);
  registerStrategyMetrics(ctx);
  await registerReminders(ctx);
}

const mod: ModuleDef = {
  key: 'strategy',
  seedDefaults,
  register,
  seed: seedStrategy,
};
export default mod;
