import type { ModuleContext } from '../../core/module.ts';

/**
 * The control library's lists, all owned by the `controls` permission module. Administrators can
 * rename and recolor every value under Administration > Lists; the meanings in `meta` are what the
 * code reads:
 * - `control_status`: `meta.closed` = retired (no longer tested, left out of coverage and figures).
 * - `control_test_result`: `meta.failed` = ineffective (flags the covered risks and hazards for
 *   review), `meta.partial` = partly effective. A corrective action plan can be raised for either.
 * - `control_test_status`: `meta.done` = the testing is finished (needs a result and the date it was
 *   performed), `meta.final` = reviewed (set only by the review, by someone other than the tester).
 */
export async function seedControlLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'controls' };
  await ctx.lookups.ensure('control_type', [
    { value: 'preventive', label: 'Preventive', color: 'blue', sort: 10 },
    { value: 'detective', label: 'Detective', color: 'purple', sort: 20 },
    { value: 'corrective', label: 'Corrective', color: 'teal', sort: 30 },
  ], own);
  await ctx.lookups.ensure('control_automation', [
    { value: 'manual', label: 'Manual', sort: 10 },
    { value: 'automated', label: 'Automated', sort: 20 },
    { value: 'it_dependent_manual', label: 'IT-dependent manual', sort: 30 },
  ], own);
  await ctx.lookups.ensure('control_frequency', [
    { value: 'continuous', label: 'Continuous', sort: 10 },
    { value: 'daily', label: 'Daily', sort: 20 },
    { value: 'weekly', label: 'Weekly', sort: 30 },
    { value: 'monthly', label: 'Monthly', sort: 40 },
    { value: 'quarterly', label: 'Quarterly', sort: 50 },
    { value: 'yearly', label: 'Yearly', sort: 60 },
    { value: 'as_needed', label: 'As needed', sort: 70 },
  ], own);
  await ctx.lookups.ensure('control_domain', [
    { value: 'cyber', label: 'Cybersecurity', color: 'blue', sort: 10 },
    { value: 'safety', label: 'Safety', color: 'orange', sort: 20 },
    { value: 'financial', label: 'Financial', color: 'green', sort: 30 },
    { value: 'operational', label: 'Operational', color: 'teal', sort: 40 },
    { value: 'compliance', label: 'Compliance', color: 'purple', sort: 50 },
  ], own);
  await ctx.lookups.ensure('control_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'active', label: 'Active', color: 'green', sort: 20 },
    { value: 'retired', label: 'Retired', color: 'gray', sort: 30, meta: { closed: true } },
  ], own);
  await ctx.lookups.ensure('control_test_type', [
    { value: 'design', label: 'Design', color: 'blue', sort: 10 },
    { value: 'operating', label: 'Operating', color: 'purple', sort: 20 },
  ], own);
  await ctx.lookups.ensure('control_test_method', [
    { value: 'inquiry', label: 'Inquiry', sort: 10 },
    { value: 'observation', label: 'Observation', sort: 20 },
    { value: 'inspection', label: 'Inspection of records', sort: 30 },
    { value: 'reperformance', label: 'Reperformance', sort: 40 },
  ], own);
  await ctx.lookups.ensure('control_test_result', [
    { value: 'effective', label: 'Effective', color: 'green', sort: 10 },
    { value: 'partly_effective', label: 'Partly effective', color: 'amber', sort: 20, meta: { partial: true } },
    { value: 'ineffective', label: 'Ineffective', color: 'red', sort: 30, meta: { failed: true } },
  ], own);
  await ctx.lookups.ensure('control_test_status', [
    { value: 'planned', label: 'Planned', color: 'gray', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'blue', sort: 20 },
    { value: 'complete', label: 'Awaiting review', color: 'amber', sort: 30, meta: { done: true } },
    { value: 'reviewed', label: 'Reviewed', color: 'green', sort: 40, meta: { done: true, final: true } },
  ], own);
  await ctx.lookups.ensure('control_sample_result', [
    { value: 'pass', label: 'No exception', color: 'green', sort: 10 },
    { value: 'exception', label: 'Exception', color: 'red', sort: 20 },
  ], own);
}

/**
 * The values this module adds to shared lists (contract C8): corrective actions and plans filed under
 * "Control" in the action tracker, and a notification kind people can switch off. Run from
 * `register`, after every module's defaults, because the lists belong to the risks and notifications
 * modules, which seed after this one; each is added only when its list exists.
 */
export async function seedSharedValues(ctx: ModuleContext): Promise<void> {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'control', label: 'Control test', sort: 147 }]);
  }
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'controls', label: 'Controls', color: 'purple', sort: 77, meta: { description: 'A control test is due or overdue, or a control covering your record failed its test.' } },
    ]);
  }
}

/** Values of a list whose `meta` carries `flag`; `fallback` when an administrator has removed every one. */
export async function valuesWith(ctx: ModuleContext, list: string, flag: string, fallback: string[]): Promise<string[]> {
  const found = (await ctx.lookups.values(list)).filter((v) => v.meta?.[flag] === true).map((v) => v.value);
  return found.length ? found : fallback;
}

/** The meanings the code reads, with the shipped values as fallbacks. */
export async function meanings(ctx: ModuleContext) {
  const [retired, failed, partial, done, final] = await Promise.all([
    valuesWith(ctx, 'control_status', 'closed', ['retired']),
    valuesWith(ctx, 'control_test_result', 'failed', ['ineffective']),
    valuesWith(ctx, 'control_test_result', 'partial', ['partly_effective']),
    valuesWith(ctx, 'control_test_status', 'done', ['complete', 'reviewed']),
    valuesWith(ctx, 'control_test_status', 'final', ['reviewed']),
  ]);
  return { retired, failed, partial, done, final, reviewed: final[0] };
}
