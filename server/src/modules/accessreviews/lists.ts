import type { ModuleContext } from '../../core/module.ts';

/**
 * The configurable lists of user access reviews (E41-02). Meanings the application relies on are
 * values, not labels, so an administrator may rename them:
 *  - `system_account_status`: `active` accounts are reviewed and flagged; `removed` is set when a
 *    removal is done or an account is no longer in its system's file.
 *  - `system_account_attention`: set by the application only.
 *  - `access_review_status`: draft, in_progress, complete, canceled (managed by the application).
 */
export async function seedAccessReviewLists(ctx: ModuleContext): Promise<void> {
  const own = { module: 'systems' };
  await ctx.lookups.ensure('system_account_status', [
    { value: 'active', label: 'Active', color: 'green', sort: 10 },
    { value: 'disabled', label: 'Disabled', color: 'gray', sort: 20 },
    { value: 'removed', label: 'Removed', color: 'gray', sort: 30, meta: { final: true } },
  ], own);
  await ctx.lookups.ensure('system_account_kind', [
    { value: 'person', label: 'Personal', color: 'blue', sort: 10 },
    { value: 'shared', label: 'Shared', color: 'orange', sort: 20 },
    { value: 'service', label: 'Service or system', color: 'purple', sort: 30 },
    { value: 'vendor', label: 'Supplier', color: 'teal', sort: 40 },
  ], own);
  await ctx.lookups.ensure('system_account_attention', [
    { value: 'leaver', label: 'Holder has left', color: 'red', sort: 10 },
    { value: 'on_leave', label: 'Holder on leave', color: 'amber', sort: 20 },
    { value: 'unmatched', label: 'Not on the staff roster', color: 'orange', sort: 30 },
  ], { ...own, public: true }); // shown to reviewers on their review page, who need not view systems
  await ctx.lookups.ensure('system_account_match', [
    { value: 'employee_number', label: 'Employee number', sort: 10 },
    { value: 'email', label: 'Email', sort: 20 },
    { value: 'name', label: 'Name', sort: 30 },
    { value: 'manual', label: 'Chosen by hand', sort: 40 },
  ], own);
  await ctx.lookups.ensure('system_account_source', [
    { value: 'manual', label: 'Entered by hand', color: 'gray', sort: 10 },
    { value: 'import', label: 'Imported', color: 'blue', sort: 20 },
  ], own);
  await ctx.lookups.ensure('access_review_status', [
    { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
    { value: 'in_progress', label: 'In progress', color: 'blue', sort: 20 },
    { value: 'complete', label: 'Complete', color: 'green', sort: 30, meta: { final: true } },
    { value: 'canceled', label: 'Canceled', color: 'gray', sort: 40, meta: { final: true } },
  ], { ...own, public: true });
}

/** Values this module adds to lists other modules own (seeded after this module's own defaults). */
export async function seedSharedValues(ctx: ModuleContext): Promise<void> {
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'access_review', label: 'Access review', sort: 149 }]);
  }
  if (await ctx.db.one(`select 1 from lookups where list_key = 'notification_kind' limit 1`)) {
    await ctx.lookups.ensure('notification_kind', [
      { value: 'access_review', label: 'Access reviews', color: 'blue', sort: 78, meta: { description: 'You are asked to review the accounts on a system, a review is due, or an account\'s holder has left or is on leave.' } },
    ]);
  }
}
