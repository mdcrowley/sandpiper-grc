// Documents (document control, E43) and exceptions: the register of every controlled document
// (policies, plans, standards, programs, procedures, SOPs, work instructions, forms, bulletins,
// external and reference documents) with numbering, a hierarchy, controlled distribution, versions,
// reviews, acknowledgment tracking, mapping to framework outcomes, and a register of time-limited
// exceptions. The record type key stays `policy` and the permission module `policies`.
import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { isDataLoad } from '../../core/dataload.ts';
import { accessDiffers, accessRule, audienceOutside, checkAccessInput, mayChangeAccess, isController, type AccessTables } from './access.ts';
import { DEFAULT_REMINDER_INTERVAL, REMINDER_SETTING, reminderInterval, runPolicyReminders } from './acknowledgments.ts';
import { registerAckRoutes } from './ackRoutes.ts';
import { registerDocumentFiles } from './convert/index.ts';
import { closeUnreadable, registerDocumentRoutes } from './documents.ts';
import { registerExceptions, runExceptionExpiry } from './exceptions.ts';
import { registerGroups } from './groups.ts';
import { registerDocumentImports } from './import/index.ts';
import { runDocumentDailyChecks } from './lifecycle.ts';
import { registerDocumentMetrics } from './metrics.ts';
import { cleanNumber, nextNumber, numberTaken } from './numbering.ts';
import { registerOutcomeRoutes } from './outcomes.ts';
import { registerPersonAcks } from './personAcks.ts';
import { registerPlans } from './plans.ts';
import { registerPrintRoutes } from './print.ts';
import { registerReviews } from './reviews.ts';
import { seedPolicies } from './seed.ts';
import { registerTranslations } from './translations.ts';
import { DOCUMENT_TYPES, typeInfo } from './types.ts';
import { registerVersionRoutes } from './versions.ts';

export { runPolicyReminders } from './acknowledgments.ts';
export { runExceptionExpiry } from './exceptions.ts';
export { renderPolicyMarkdown } from './markdown.ts';
export { refreshSearchText, setSearchTextFromFile } from './search.ts';
export { runDocumentDailyChecks } from './lifecycle.ts';

const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mod: ModuleDef = {
  key: 'policies',

  async seedDefaults(ctx) {
    await ctx.lookups.ensure('policy_status', [
      { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
      { value: 'in_review', label: 'In review', color: 'amber', sort: 20 },
      { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
      { value: 'published', label: 'Published', color: 'green', sort: 40 },
      { value: 'retired', label: 'Obsolete', color: 'purple', sort: 50 },
    ]);
    // E43: a retired document is called obsolete (document-control practice), unless the label was changed.
    await ctx.db.query(`update lookups set label = 'Obsolete' where list_key = 'policy_status' and value = 'retired' and label = 'Retired'`);
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
    // Document types (E29-08, contract C6; E43 adds tiers, number prefixes, acknowledgment defaults
    // and the new kinds). meta.review_months is the type's review cycle; meta.plan a plan (E28).
    await ctx.lookups.ensure('policy_document_type', DOCUMENT_TYPES, { module: 'policies', public: true });
    // Values that existed before E43 get the new meta keys; keys an administrator set are kept.
    for (const t of DOCUMENT_TYPES) {
      await ctx.db.query(
        `update lookups set meta = $3::jsonb || coalesce(meta, '{}'::jsonb) where list_key = $1 and value = $2 and not (coalesce(meta, '{}'::jsonb) ? 'tier')`,
        ['policy_document_type', t.value, JSON.stringify(t.meta ?? {})]);
    }
    await ctx.lookups.ensure('document_access', [
      { value: 'organization', label: 'Everyone in the organization', color: 'green', sort: 10 },
      { value: 'restricted', label: 'Only named readers', color: 'amber', sort: 20 },
    ], { module: 'policies', public: true });
    await ctx.lookups.ensure('policy_version_status', [
      { value: 'draft', label: 'Draft', color: 'gray', sort: 10 },
      { value: 'in_review', label: 'In review', color: 'amber', sort: 20 },
      { value: 'approved', label: 'Approved', color: 'blue', sort: 30 },
      { value: 'published', label: 'Effective', color: 'green', sort: 40 },
      { value: 'superseded', label: 'Superseded', color: 'purple', sort: 50 },
      { value: 'withdrawn', label: 'Withdrawn', color: 'red', sort: 60 },
    ], { module: 'policies', public: true });
    await ctx.lookups.ensure('document_review_result', [
      { value: 'no_change', label: 'No change', color: 'green', sort: 10 },
      { value: 'revise', label: 'Revise', color: 'amber', sort: 20 },
      { value: 'retire', label: 'Make obsolete', color: 'red', sort: 30 },
    ], { module: 'policies' });
    // Relations of links between a document and other records (core record_links).
    await ctx.lookups.ensure('document_link_relation', [
      { value: 'implements', label: 'Implements', color: 'blue', sort: 10 },
      { value: 'references', label: 'References', color: 'teal', sort: 20 },
      { value: 'replaces', label: 'Replaces', color: 'purple', sort: 30 },
      { value: 'meets', label: 'Meets obligation', color: 'green', sort: 40 },
      { value: 'applies_to', label: 'Applies to', color: 'gray', sort: 50 },
      { value: 'taught_by', label: 'Taught by', color: 'amber', sort: 60 },
      { value: 'treats', label: 'Treats risk or hazard', color: 'red', sort: 70 },
      { value: 'produces', label: 'Produces records of', color: 'orange', sort: 80 },
      { value: 'retention', label: 'Kept under', color: 'gray', sort: 90 },
      { value: 'based_on', label: 'Based on', color: 'blue', sort: 100 },
    ], { module: 'policies' });
    await ctx.lookups.ensure('person_ack_method', [
      { value: 'sign_in_sheet', label: 'Sign-in sheet', color: 'blue', sort: 10 },
      { value: 'kiosk', label: 'Kiosk', color: 'teal', sort: 20 },
      { value: 'recorded', label: 'Recorded by hand', color: 'gray', sort: 30 },
    ], { module: 'policies' });
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
    // The roster (people module) gives people their departments too, when it is there.
    const tables: AccessTables = { people: () => !!ctx.resources.get('person') };

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
      if ('audience_positions' in data) {
        const v = data.audience_positions ?? [];
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) invalid({ audience_positions: 'Choose from the list.' });
        const wanted = [...new Set(v as string[])];
        // Positions belong to the people module (always on, but guarded: it may not be loaded).
        if (wanted.length) {
          if (!ctx.resources.get('position')) invalid({ audience_positions: 'Positions are not available.' });
          const known = await db.query<{ k: string }>('select id::text as k from positions where deleted_at is null and id::text = any($1::text[])', [wanted]);
          if (known.length !== wanted.length) invalid({ audience_positions: 'One of the positions does not exist.' });
        }
        data.audience_positions = wanted;
      }
      if ('audience_everyone' in data && data.audience_everyone === null) data.audience_everyone = false;
      if ('ack_roster' in data && data.ack_roster === null) data.ack_roster = false;
      if ('ack_required' in data && data.ack_required === null) data.ack_required = false;
      if ('ack_days' in data) {
        const n = Number(data.ack_days);
        if (data.ack_days === null || !Number.isInteger(n) || n < 1 || n > 365) invalid({ ack_days: 'Days to acknowledge must be a whole number from 1 to 365.' });
      }
      if (data.reminder_interval_days !== undefined && data.reminder_interval_days !== null) {
        const n = Number(data.reminder_interval_days);
        if (!Number.isInteger(n) || n < 1 || n > 90) invalid({ reminder_interval_days: 'Days between reminders must be a whole number from 1 to 90, or empty for the usual interval.' });
      }
      if (data.review_months !== undefined && data.review_months !== null) {
        const n = Number(data.review_months);
        if (!Number.isInteger(n) || n < 1 || n > 120) invalid({ review_months: 'The review cycle must be a whole number of months from 1 to 120, or empty for the type\'s cycle.' });
      }
      if (data.source_url !== undefined && data.source_url !== null && data.source_url !== '' && !/^https?:\/\/\S+$/i.test(String(data.source_url))) {
        invalid({ source_url: 'Enter a web address starting with http:// or https://.' });
      }
      await checkAccessInput(ctx, data);
      void merged;
    }

    /** The parent must be another document the person can read, and must not sit below this one. */
    async function checkParent(req: FastifyRequest | null, id: string | null, parentId: unknown) {
      if (parentId === null || parentId === undefined || parentId === '') return;
      if (typeof parentId !== 'string' || !UUID.test(parentId)) invalid({ parent_id: 'Choose a document from the list.' });
      if (id && parentId === id) invalid({ parent_id: 'A document cannot be under itself.' });
      const parent = await ctx.resources.find('policy', String(parentId), req?.user ?? undefined);
      if (!parent) invalid({ parent_id: 'Choose a document from the list.' });
      if (id) {
        // Refuse a cycle: walk up from the new parent.
        const up = await db.query<{ id: string }>(
          `with recursive up(id, parent_id, depth) as (select id, parent_id, 0 from policies where id = $1
             union select p.id, p.parent_id, up.depth + 1 from policies p join up on p.id = up.parent_id where up.depth < 50)
           select id from up`, [parentId]);
        if (up.some((u) => u.id === id)) invalid({ parent_id: 'That document is below this one, so it cannot be its parent.' });
      }
    }

    /** Numbers typed by hand: controllers only (and data loads); unique among undeleted documents. */
    async function checkNumber(req: FastifyRequest | null, data: Row, existing: Row | null) {
      if (!('doc_number' in data)) return;
      const n = cleanNumber(data.doc_number);
      data.doc_number = n ?? null;
      if ((n ?? null) === (existing?.doc_number ?? null)) return;
      if (req && !isController(req.user) && !isDataLoad(req)) invalid({ doc_number: 'Only a document controller can set the document number.' });
      if (n && n.length > 60) invalid({ doc_number: 'The document number is too long (60 characters at most).' });
      if (n && await numberTaken(ctx, n, existing?.id ?? null)) invalid({ doc_number: 'Another document already has this number.' });
    }

    const accessKeys = ['access', 'access_departments', 'access_roles', 'access_groups', 'access_users'];
    const audienceKeys = ['audience_everyone', 'audience_roles', 'audience_departments', 'ack_required'];

    ctx.defineResource({
      type: 'policy', table: 'policies', module: 'policies', label: 'Document', plural: 'Documents',
      path: '/api/policies', route: '/policies', titleField: 'title', ref: { field: 'ref', prefix: 'POL-' },
      searchable: ['title', 'summary', 'doc_number', 'approver_name', 'search_text'],
      omit: ['search_text'],
      defaultSort: { field: 'title', dir: 'asc' },
      // Who may read (E43, access.ts): part of the visibility rule everywhere; figures masked.
      rowRule: accessRule(tables),
      // A role scoped to its departments works with its departments' documents (E41-01).
      scope: { department: 'owning_department_id' },
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        doc_number: { label: 'Document number', type: 'text' },
        title: { label: 'Title', type: 'text', required: true },
        summary: { label: 'Summary', type: 'longtext' },
        category: { label: 'Category', type: 'lookup', list: 'policy_category' },
        // Contract C6: the review cycle comes from the type's meta.review_months; 'plan' is a plan.
        document_type: { label: 'Document type', type: 'lookup', list: 'policy_document_type', default: 'policy' },
        // Status follows the versions (draft, in review, approved, published) and the retire action.
        status: { label: 'Status', type: 'lookup', list: 'policy_status', default: 'draft', readOnly: true },
        parent_id: { label: 'Under', type: 'ref', to: 'policy' },
        owner_id: { label: 'Owner', type: 'user' },
        owning_department_id: { label: 'Owning department', type: 'ref', to: 'department' },
        approver_name: { label: 'Approver', type: 'text' },
        approver_role: { label: 'Approver role', type: 'text' },
        review_months: { label: 'Review cycle in months (empty: the type\'s cycle)', type: 'number' },
        review_date: { label: 'Next review', type: 'date' },
        last_reviewed_on: { label: 'Last reviewed', type: 'date', readOnly: true },
        current_version: { label: 'Published version', type: 'number', readOnly: true },
        access: { label: 'Who may read', type: 'lookup', list: 'document_access', default: 'organization' },
        access_departments: { label: 'Reader departments', type: 'json' },
        access_roles: { label: 'Reader roles', type: 'json' },
        access_groups: { label: 'Reader distribution groups', type: 'json' },
        access_users: { label: 'Reader people', type: 'json' },
        ack_required: { label: 'Readers must acknowledge', type: 'boolean' },
        audience_everyone: { label: 'Everyone must acknowledge', type: 'boolean', default: false },
        audience_roles: { label: 'Roles that must acknowledge', type: 'json' },
        audience_departments: { label: 'Departments that must acknowledge', type: 'json' },
        // E29-09: roster people (who may have no account) in these positions are asked too.
        audience_positions: { label: 'Positions that must acknowledge', type: 'json' },
        ack_roster: { label: 'Ask roster people (sign-in sheet or kiosk)', type: 'boolean', default: false },
        ack_days: { label: 'Days to acknowledge', type: 'number', default: 14 },
        // E10-18: empty uses the module setting (policies.reminder_interval_days).
        reminder_interval_days: { label: 'Days between reminders (empty: the usual interval)', type: 'number' },
        retired_on: { label: 'Obsolete since', type: 'date', readOnly: true },
        retire_reason: { label: 'Reason made obsolete', type: 'text', readOnly: true, personal: false },
        replaced_by_id: { label: 'Replaced by', type: 'ref', to: 'policy', readOnly: true },
        // External documents (standards, regulations, guidance, vendor manuals).
        publisher: { label: 'Publisher', type: 'text' },
        edition: { label: 'Edition', type: 'text' },
        published_on: { label: 'Publication date', type: 'date' },
        source_url: { label: 'Source address', type: 'text' },
        license_note: { label: 'License note', type: 'text', personal: false },
        framework_id: { label: 'Source of framework', type: 'ref', to: 'framework' },
        expires_on: { label: 'Expires', type: 'date' },
      },
      hooks: {
        beforeCreate: async (req, data) => {
          await checkPolicy(data, data);
          await checkParent(req, null, data.parent_id);
          await checkNumber(req, data, null);
          // Readers must acknowledge: the type's default, or yes when an audience is named.
          if (data.ack_required === undefined) {
            const info = await typeInfo(ctx, data.document_type ?? 'policy');
            const named = data.audience_everyone === true || ['audience_roles', 'audience_departments', 'audience_positions'].some((k) => Array.isArray(data[k]) && data[k].length > 0);
            data.ack_required = info.ackDefault || named;
          }
          const outside = await audienceOutside(ctx, { access: 'organization', ...data });
          if (Object.keys(outside).length) ctx.fail(400, 'audience_outside', 'The people asked to acknowledge must be able to read the document.', outside);
          if (!data.doc_number) data.doc_number = await nextNumber(ctx, data);
          return data;
        },
        beforeUpdate: async (req, existing, patch) => {
          await checkPolicy(patch, { ...existing, ...patch });
          if ('parent_id' in patch && patch.parent_id !== existing.parent_id) await checkParent(req, existing.id, patch.parent_id);
          await checkNumber(req, patch, existing);
          const merged = { ...existing, ...patch };
          if (accessKeys.some((k) => k in patch) && accessDiffers(existing, merged) && req && !isDataLoad(req) && !mayChangeAccess(req.user, existing)) {
            ctx.fail(403, 'forbidden', 'Only the document\'s owner or a document controller can change who may read it.');
          }
          if ([...accessKeys, ...audienceKeys].some((k) => k in patch)) {
            const outside = await audienceOutside(ctx, merged);
            if (Object.keys(outside).length) ctx.fail(400, 'audience_outside', 'The people asked to acknowledge must be able to read the document.', outside);
          }
          return patch;
        },
        afterUpdate: async (req, before, after) => {
          // Narrowing who may read closes the requests of people who can no longer read it.
          if (accessDiffers(before, after)) {
            await closeUnreadable(ctx, tables, req, after);
          }
        },
      },
    });

    registerVersionRoutes(ctx, tables);
    registerAckRoutes(ctx, tables);
    registerOutcomeRoutes(ctx);
    registerExceptions(ctx, tables);
    // Acknowledgments by roster people (E29) and plans (E28).
    registerPersonAcks(ctx, tables);
    registerPlans(ctx);
    // Translations of versions, read in the portal, on the kiosk and in the app (E41-07).
    registerTranslations(ctx);
    // Document control (E43): library, hierarchy, access, numbering, groups, reviews, printing, metrics.
    registerDocumentRoutes(ctx, tables);
    registerGroups(ctx);
    registerReviews(ctx, tables);
    registerPrintRoutes(ctx, tables);
    registerDocumentMetrics(ctx);
    // Word conversion, PDF text and stamping, chunked uploads and package imports (E43-06, -07, -11).
    await registerDocumentFiles(ctx);
    await registerDocumentImports(ctx);

    // ---------- settings: the acknowledgment reminder interval ----------

    ctx.app.get('/api/policies/settings', { preHandler: ctx.requirePerm('policies.view') }, async () => ({
      reminder_interval_days: await reminderInterval(ctx),
    }));
    ctx.app.put('/api/policies/settings', { preHandler: ctx.requirePerm('policies.administer') }, async (req) => {
      const raw = (req.body as Row | null)?.reminder_interval_days;
      const n = Number(raw);
      if (raw === null || raw === undefined || raw === '' || !Number.isInteger(n) || n < 1 || n > 90) {
        invalid({ reminder_interval_days: 'Enter a whole number of days from 1 to 90.' });
      }
      const before = await reminderInterval(ctx);
      if (before !== n) await ctx.settings.set(REMINDER_SETTING, n, req); // the settings service writes the audit event
      return { reminder_interval_days: n };
    });

    // ---------- daily checks: reminders, exception expiry, effective dates, reviews ----------

    // Daily on the job queue (Administration > Background jobs); tests call the runs directly.
    await scheduleWork(ctx, 'policies.daily_checks', async () => {
      let failed: Error | null = null;
      const expired = await runExceptionExpiry(ctx).catch((err: Error) => { failed = err; return []; });
      // Versions whose effective date has come are published first, so their requests are made today.
      const documents = await runDocumentDailyChecks(ctx, tables).catch((err: Error) => { failed = err; return null; });
      const reminders = await runPolicyReminders(ctx);
      if (failed) throw failed;
      return { exceptionsExpired: expired.length, reminders: reminders.length, documents };
    }, { every: DAY, firstRunInMs: 60_000 });
  },

  seed: (ctx: ModuleContext, opts) => seedPolicies(ctx, opts),
};

export default mod;
