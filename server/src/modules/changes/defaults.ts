import type { ModuleContext } from '../../core/module.ts';
import { DEFAULT_TRANSITIONS } from './rules.ts';

const next = (status: string) => ({ next: DEFAULT_TRANSITIONS[status] });

/** Configurable lists. `ensure` adds what is missing and never overwrites an edited value. */
export async function seedChangeDefaults(ctx: ModuleContext): Promise<void> {
  await ctx.lookups.ensure('change_type', [
    { value: 'standard', label: 'Standard', color: 'teal', sort: 10 },
    { value: 'normal', label: 'Normal', color: 'blue', sort: 20 },
    { value: 'emergency', label: 'Emergency', color: 'red', sort: 30 },
  ]);
  await ctx.lookups.ensure('change_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10, meta: next('draft') },
    { value: 'submitted', label: 'Awaiting approval', color: 'blue', sort: 20, meta: next('submitted') },
    { value: 'approved', label: 'Approved', color: 'teal', sort: 30, meta: next('approved') },
    { value: 'rejected', label: 'Rejected', color: 'red', sort: 40, meta: next('rejected') },
    { value: 'scheduled', label: 'Scheduled', color: 'purple', sort: 50, meta: next('scheduled') },
    { value: 'in_progress', label: 'In progress', color: 'amber', sort: 60, meta: next('in_progress') },
    { value: 'completed', label: 'Completed', color: 'green', sort: 70, meta: next('completed') },
    { value: 'reviewed', label: 'Reviewed', color: 'green', sort: 80, meta: next('reviewed') },
    { value: 'closed', label: 'Closed', color: 'gray', sort: 90, meta: next('closed') },
    { value: 'cancelled', label: 'Cancelled', color: 'gray', sort: 100, meta: next('cancelled') },
  ]);
  await ctx.lookups.ensure('change_risk', [
    { value: 'low', label: 'Low', color: 'green', sort: 10 },
    { value: 'medium', label: 'Medium', color: 'amber', sort: 20 },
    { value: 'high', label: 'High', color: 'red', sort: 30 },
  ]);
  // meta.pir: a post-implementation review is needed before a change with this outcome is closed.
  await ctx.lookups.ensure('change_outcome', [
    { value: 'successful', label: 'Successful', color: 'green', sort: 10 },
    { value: 'successful_with_issues', label: 'Successful with issues', color: 'amber', sort: 20 },
    { value: 'failed', label: 'Failed', color: 'red', sort: 30, meta: { pir: true } },
    { value: 'backed_out', label: 'Backed out', color: 'orange', sort: 40, meta: { pir: true } },
    { value: 'cancelled', label: 'Cancelled', color: 'gray', sort: 50 },
  ]);
}
