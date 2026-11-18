// Policies and exceptions: a policy library with versions, acknowledgement tracking,
// mapping to framework outcomes, and a register of time-limited exceptions.
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { DEFAULT_REMINDER_INTERVAL, REMINDER_SETTING, runPolicyReminders } from './acknowledgements.ts';
import { registerAckRoutes } from './ackRoutes.ts';
import { registerExceptions, runExceptionExpiry } from './exceptions.ts';
import { registerOutcomeRoutes } from './outcomes.ts';
import { seedPolicies } from './seed.ts';
import { registerVersionRoutes } from './versions.ts';

export { runPolicyReminders } from './acknowledgements.ts';
export { runExceptionExpiry } from './exceptions.ts';
export { renderPolicyMarkdown } from './markdown.ts';

const DAY = 24 * 60 * 60 * 1000;

const mod: ModuleDef = {
  key: 'policies',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('policy_status', [
      { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
      { value: 'in_review', label: 'In review', color: 'amber', sort: 20 },
      { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
      { value: 'published', label: 'Published', color: 'green', sort: 40 },
      { value: 'retired', label: 'Retired', color: 'purple', sort: 50 },
    ]);
    await ctx.lookups.ensure('policy_category', [
      { value: 'governance', label: 'Governance', color: 'purple', sort: 10 },
      { value: 'acceptable_use', label: 'Acceptable use', color: 'blue', sort: 20 },
      { value: 'access', label: 'Access and identity', color: 'teal', sort: 30 },
      { value: 'data_protection', label: 'Data protection', color: 'green', sort: 40 },
      { value: 'operations', label: 'Operations and resilience', color: 'amber', sort: 50 },
      { value: 'incident', label: 'Incident management', color: 'red', sort: 60 },
      { value: 'third_party', label: 'Suppliers', color: 'orange', sort: 70 },
      { value: 'other', label: 'Other', color: 'gray', sort: 80 },
    ]);
    await ctx.lookups.ensure('exception_status', [
      { value: 'requested', label: 'Requested', color: 'blue', sort: 10 },
      { value: 'approved', label: 'Approved', color: 'green', sort: 20 },
      { value: 'rejected', label: 'Rejected', color: 'red', sort: 30 },
      { value: 'expired', label: 'Expired', color: 'amber', sort: 40 },
      { value: 'withdrawn', label: 'Withdrawn', color: 'gray', sort: 50 },
    ]);
    if ((await ctx.settings.get<unknown>(REMINDER_SETTING, null)) === null) {
      await ctx.settings.set(REMINDER_SETTING, DEFAULT_REMINDER_INTERVAL);
    }
  },

  async register(ctx) {
    const { db } = ctx;
    const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

    /** Audience lists must name real roles and departments; an empty value means none. */
    async function checkPolicy(data: Row, merged: Row) {
      for (const key of ['audience_roles', 'audience_departments'] as const) {
        if (!(key in data)) continue;
        const v = data[key] ?? [];
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) invalid({ [key]: 'Choose from the list.' });
        const wanted = [...new Set(v as string[])];
        const known = key === 'audience_roles'
          ? await db.query<{ k: string }>('select key as k from roles where key = any($1::text[])', [wanted])
          : await db.query<{ k: string }>('select id::text as k from departments where deleted_at is null and id::text = any($1::text[])', [wanted]);
        if (known.length !== wanted.length) invalid({ [key]: key === 'audience_roles' ? 'One of the roles does not exist.' : 'One of the departments does not exist.' });
        data[key] = wanted;
      }
      if ('audience_everyone' in data && data.audience_everyone === null) data.audience_everyone = false;
      if ('ack_days' in data) {
        const n = Number(data.ack_days);
        if (data.ack_days === null || !Number.isInteger(n) || n < 1 || n > 365) invalid({ ack_days: 'Days to acknowledge must be a whole number from 1 to 365.' });
      }
      void merged;
    }

    ctx.defineResource({
      type: 'policy', table: 'policies', module: 'policies', label: 'Policy', plural: 'Policies',
      path: '/api/policies', route: '/policies', titleField: 'title', ref: { field: 'ref', prefix: 'POL-' },
      searchable: ['title', 'summary', 'approver_name'],
      defaultSort: { field: 'title', dir: 'asc' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        title: { label: 'Title', type: 'text', required: true },
        summary: { label: 'Summary', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'policy_category' },
        // Status follows the versions (draft, in review, approved, published) and the retire action.
        status: { label: 'Status', type: 'lookup', list: 'policy_status', default: 'draft', readOnly: true },
        owner_id: { label: 'Owner', type: 'user' },
        approver_name: { label: 'Approver', type: 'text' },
        approver_role: { label: 'Approver role', type: 'text' },
        review_date: { label: 'Review date', type: 'date' },
        current_version: { label: 'Published version', type: 'number', readOnly: true },
        audience_everyone: { label: 'Everyone must acknowledge', type: 'boolean', default: false },
        audience_roles: { label: 'Roles that must acknowledge', type: 'json' },
        audience_departments: { label: 'Departments that must acknowledge', type: 'json' },
        ack_days: { label: 'Days to acknowledge', type: 'number', default: 14 },
      },
      hooks: {
        beforeCreate: async (_req, data) => {
          await checkPolicy(data, data);
          return data;
        },
        beforeUpdate: async (_req, existing, patch) => {
          await checkPolicy(patch, { ...existing, ...patch });
          return patch;
        },
      },
    });

    registerVersionRoutes(ctx);
    registerAckRoutes(ctx);
    registerOutcomeRoutes(ctx);
    registerExceptions(ctx);

    // ---------- daily checks: acknowledgement reminders and exception expiry ----------

    const safeRun = async () => {
      try {
        await runExceptionExpiry(ctx);
        await runPolicyReminders(ctx);
      } catch (err) {
        console.error('[policies] daily checks failed:', (err as Error).message);
      }
    };
    let timer: ReturnType<typeof setInterval> | undefined;
    ctx.app.addHook('onReady', async () => {
      await safeRun();
      timer = setInterval(safeRun, DAY);
      timer.unref();
    });
    ctx.app.addHook('onClose', async () => {
      if (timer) clearInterval(timer);
    });
  },

  seed: (ctx: ModuleContext, opts) => seedPolicies(ctx, opts),
};

export default mod;
