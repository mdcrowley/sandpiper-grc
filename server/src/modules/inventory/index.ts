import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { departmentPrepare, mayChangeScopeSources, SCOPE_SOURCE_MESSAGE } from '../../core/scope.ts';
import { registerDisposalRequests, ROUTED_ONLY } from './disposal.ts';
import { CONDITION_ASSET_FIELDS, CONDITION_SITE_FIELDS, ensureConditionLists } from './fields-condition.ts';
import { ASSET_MODEL_FIELDS } from './fields-models.ts';
import { ensureOtLists, OT_ASSET_FIELDS, OT_SYSTEM_FIELDS } from './fields-ot.ts';
import { ensurePrivacyLists, PRIVACY_DATA_CATEGORY_FIELDS } from './fields-privacy.ts';
import { registerInventoryTaggables, TAG_NUMBER_FIELDS } from './fields-tags.ts';
import { DATA_WIPE_ASSET_FIELDS, registerWipeCertificate, seedWipeMethods } from './fields-wiping.ts';
import { registerImport } from './importer.ts';
import { registerReminders } from './reminders.ts';
import { disposalProblem, funderRuleOn, registerLifecycle, today } from './lifecycle.ts';
import { registerRelations } from './relations.ts';
import { registerReports } from './reports.ts';
import { seedInventory } from './seed.ts';

/**
 * Inventory: systems, assets, sites and data categories, the relationships
 * between them, the asset lifecycle, canned reports and asset import.
 */

async function seedDefaults(ctx: ModuleContext) {
  // Explicit sorts: values added in a later release slot in among the existing ones (ensure only adds what is missing).
  await ctx.lookups.ensure('asset_type', [
    { value: 'workstation', label: 'Workstation', sort: 10 },
    { value: 'server', label: 'Server', sort: 20 },
    { value: 'network_device', label: 'Network device', sort: 30 },
    { value: 'mobile_device', label: 'Mobile device', sort: 40 },
    { value: 'printer', label: 'Printer', sort: 50 },
    // Equipment on and around vehicles.
    { value: 'onboard_computer', label: 'Onboard computer', sort: 51 },
    { value: 'cad_avl_unit', label: 'CAD/AVL unit', sort: 52 },
    { value: 'farebox', label: 'Farebox', sort: 53 },
    { value: 'validator', label: 'Card validator', sort: 54 },
    { value: 'vehicle_router', label: 'On-vehicle router', sort: 55 },
    { value: 'camera', label: 'Camera', sort: 56 },
    { value: 'radio', label: 'Radio', sort: 57 },
    { value: 'passenger_info_display', label: 'Passenger information display', sort: 58 },
    { value: 'software_licence', label: 'Software license', sort: 60 },
    { value: 'subscription', label: 'Subscription', sort: 70 },
    { value: 'other', label: 'Other', sort: 80 },
  ], { module: 'assets' });
  await ctx.lookups.ensure('asset_status', [
    { value: 'ordered', label: 'Ordered', color: 'purple' },
    { value: 'in_stock', label: 'In stock', color: 'blue' },
    { value: 'in_use', label: 'In use', color: 'green' },
    { value: 'in_repair', label: 'In repair', color: 'amber' },
    { value: 'retired', label: 'Retired', color: 'gray' },
    { value: 'disposed', label: 'Disposed', color: 'gray', meta: { final: true } },
  ], { module: 'assets' });
  await ctx.lookups.ensure('disposal_request_status', [
    { value: 'pending', label: 'Awaiting approval', color: 'amber' },
    { value: 'approved', label: 'Disposal approved', color: 'green' },
    { value: 'refused', label: 'Disposal refused', color: 'red' },
  ], { module: 'assets' });
  await ctx.lookups.ensure('funding_source', [
    { value: 'operating', label: 'Operating budget' },
    { value: 'capital', label: 'Capital budget' },
    { value: 'grant', label: 'Grant or outside funder' },
    { value: 'mixed', label: 'Mixed (own funds and outside funder)' },
    { value: 'other', label: 'Other' },
  ], { module: 'assets' });
  await ctx.lookups.ensure('hosting_type', [
    { value: 'on_premises', label: 'On-premises', color: 'blue' },
    { value: 'vendor_hosted', label: 'Vendor-hosted', color: 'purple' },
    { value: 'cloud', label: 'Cloud', color: 'teal' },
    { value: 'hybrid', label: 'Hybrid', color: 'gray', sort: 40 },
    // Equipment that runs on the vehicles themselves (fare, location, video and passenger information units).
    { value: 'on_vehicle', label: 'On-vehicle', color: 'orange', sort: 50 },
  ], { module: 'systems' });
  await ctx.lookups.ensure('criticality_tier', [
    { value: 'tier_1', label: 'Tier 1 - Critical', color: 'red' },
    { value: 'tier_2', label: 'Tier 2 - High', color: 'orange' },
    { value: 'tier_3', label: 'Tier 3 - Normal', color: 'blue' },
    { value: 'tier_4', label: 'Tier 4 - Low', color: 'gray' },
  ], { module: 'systems' });
  await ctx.lookups.ensure('system_status', [
    { value: 'planned', label: 'Planned', color: 'purple' },
    { value: 'in_use', label: 'In use', color: 'green' },
    { value: 'being_replaced', label: 'Being replaced', color: 'amber' },
    { value: 'retired', label: 'Retired', color: 'gray' },
  ], { module: 'systems' });
  // meta.satisfied: the system does not appear on the "sensitive data without multi-factor" report.
  await ctx.lookups.ensure('mfa_status', [
    { value: 'enforced', label: 'Enforced', color: 'green', meta: { satisfied: true } },
    { value: 'optional', label: 'Available, not enforced', color: 'amber' },
    { value: 'none', label: 'Not in place', color: 'red' },
    { value: 'not_applicable', label: 'Not applicable', color: 'gray', meta: { satisfied: true } },
    { value: 'unknown', label: 'Not known', color: 'gray' },
  ], { module: 'systems' });
  // meta.sensitive: counts as sensitive data on reports. Unclassified categories also count.
  await ctx.lookups.ensure('sensitivity_level', [
    { value: 'public', label: 'Public', color: 'green', meta: { sensitive: false } },
    { value: 'internal', label: 'Internal', color: 'blue', meta: { sensitive: false } },
    { value: 'confidential', label: 'Confidential', color: 'amber', meta: { sensitive: true } },
    { value: 'restricted', label: 'Restricted', color: 'red', meta: { sensitive: true } },
  ], { module: 'data' });
  await ctx.lookups.ensure('integration_direction', [
    { value: 'one_way', label: 'One way' },
    { value: 'two_way', label: 'Both ways' },
  ], { module: 'systems' });
  await ctx.lookups.ensure('integration_method', [
    { value: 'api', label: 'API' },
    { value: 'file_transfer', label: 'File transfer' },
    { value: 'database', label: 'Database link' },
    { value: 'data_feed', label: 'Data feed' },
    { value: 'single_sign_on', label: 'Single sign-on' },
    { value: 'manual', label: 'Manual re-entry' },
    { value: 'other', label: 'Other' },
  ], { module: 'systems' });
  // Lists of the inventory extensions (wave 11): each file is owned by one piece of work.
  await ensureOtLists(ctx);
  await ensureConditionLists(ctx);
  await seedWipeMethods(ctx);
  await ensurePrivacyLists(ctx);
}

async function register(ctx: ModuleContext) {
  ctx.defineResource({
    type: 'site', table: 'sites', module: 'sites', label: 'Site', plural: 'Sites',
    path: '/api/sites', route: '/sites', titleField: 'name',
    searchable: ['name', 'address', 'function', 'technology'],
    defaultSort: { field: 'name', dir: 'asc' },
    // Role grants scoped to sites (E41-01) show a person their own sites and those within them.
    scope: { site: 'id' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      address: { label: 'Address', type: 'text' },
      function: { label: 'Function', type: 'longtext' },
      technology: { label: 'Technology on site', type: 'longtext' },
      power_protection: { label: 'Power protection', type: 'longtext' },
      physical_security: { label: 'Physical security', type: 'longtext' },
      protection_notes: { label: 'Power and physical protection (as recorded)', type: 'longtext' },
      third_parties: { label: 'Third parties on site', type: 'longtext' },
      network_links: { label: 'Network links', type: 'longtext' },
      to_confirm: { label: 'To confirm', type: 'longtext' },
      notes: { label: 'Notes', type: 'longtext' },
      // E41-01: a site may sit within another one, and its manager is scoped to it and those within it.
      parent_id: { label: 'Part of', type: 'ref', to: 'site' },
      manager_id: { label: 'Site manager', type: 'user' },
      ...CONDITION_SITE_FIELDS,
      ...TAG_NUMBER_FIELDS,
    },
    hooks: {
      // A site's manager and the site it sits within decide whose scope it is in (core/scope.ts): someone
      // whose roles are scoped may not move them, or they could widen their own reach (wave 23 A1).
      beforeUpdate: (req, existing, patch) => {
        if (mayChangeScopeSources(req?.user)) return patch;
        const fields: Record<string, string> = {};
        for (const k of ['manager_id', 'parent_id']) {
          if (k in patch && String(patch[k] ?? '') !== String(existing[k] ?? '')) fields[k] = SCOPE_SOURCE_MESSAGE;
        }
        if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
        return patch;
      },
    },
  });

  ctx.defineResource({
    type: 'data_category', table: 'data_categories', module: 'data', label: 'Data category', plural: 'Data categories',
    path: '/api/data-categories', route: '/data-categories', titleField: 'name',
    searchable: ['name', 'contains', 'where_held', 'custodian'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      name: { label: 'Name', type: 'text', required: true },
      contains: { label: 'What it contains', type: 'longtext' },
      where_held: { label: 'Where held', type: 'longtext' },
      custodian: { label: 'Custodian', type: 'text' },
      shared_with: { label: 'Shared with', type: 'longtext' },
      governing_rule: { label: 'Governing rule or agreement', type: 'longtext' },
      retention_period: { label: 'Retention period', type: 'text' },
      sensitivity_level: { label: 'Sensitivity', type: 'lookup', list: 'sensitivity_level' },
      gaps: { label: 'Gaps', type: 'longtext' },
      notes: { label: 'Notes', type: 'longtext' },
      ...PRIVACY_DATA_CATEGORY_FIELDS,
    },
  });

  ctx.defineResource({
    type: 'system', table: 'systems', module: 'systems', label: 'System', plural: 'Systems',
    path: '/api/systems', route: '/systems', titleField: 'name',
    ref: { field: 'ref', prefix: 'SYS-' },
    searchable: ['name', 'vendor_name', 'function', 'system_group'],
    defaultSort: { field: 'name', dir: 'asc' },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      system_group: { label: 'Group', type: 'text' },
      status: { label: 'Status', type: 'lookup', list: 'system_status', default: 'in_use' },
      criticality_tier: { label: 'Criticality', type: 'lookup', list: 'criticality_tier' },
      function: { label: 'Function', type: 'longtext' },
      users: { label: 'Users', type: 'text' },
      business_owner_id: { label: 'Business owner', type: 'user' },
      technical_owner_id: { label: 'Technical owner', type: 'user' },
      vendor_name: { label: 'Vendor (as recorded)', type: 'text' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      hosting_type: { label: 'Hosting', type: 'lookup', list: 'hosting_type' },
      hosting_provider: { label: 'Hosting provider', type: 'text' },
      hosting_region: { label: 'Hosting region', type: 'text' },
      hosting_notes: { label: 'Hosting (as recorded)', type: 'text' },
      rto_hours: { label: 'Recovery time objective (hours)', type: 'number' },
      rpo_hours: { label: 'Recovery point objective (hours)', type: 'number' },
      manual_fallback: { label: 'Manual fallback', type: 'longtext' },
      authentication_method: { label: 'Authentication method', type: 'text' },
      mfa_status: { label: 'Multi-factor', type: 'lookup', list: 'mfa_status', default: 'unknown' },
      planned_replacement: { label: 'Planned replacement', type: 'text' },
      status_outlook: { label: 'Status and outlook', type: 'longtext' },
      sensitive_data_held: { label: 'Sensitive data held (as recorded)', type: 'longtext' },
      agreement_on_file: { label: 'Agreement on file', type: 'longtext' },
      source: { label: 'Source', type: 'longtext' },
      to_confirm: { label: 'To confirm', type: 'longtext' },
      notes: { label: 'Notes', type: 'longtext' },
      ...OT_SYSTEM_FIELDS,
      ...TAG_NUMBER_FIELDS,
    },
    hooks: {
      beforeCreate: (_req, data) => checkSystem(ctx, data, data),
      beforeUpdate: (_req, existing, patch) => checkSystem(ctx, { ...existing, ...patch }, patch),
    },
  });

  ctx.defineResource({
    type: 'asset', table: 'assets', module: 'assets', label: 'Asset', plural: 'Assets',
    path: '/api/assets', route: '/assets', titleField: 'name',
    ref: { field: 'tag', prefix: 'AST-' },
    searchable: ['name', 'serial', 'make', 'model', 'assigned_to_name', 'location'],
    defaultSort: { field: 'tag', dir: 'asc' },
    fields: {
      tag: { label: 'Tag', type: 'text' },
      name: { label: 'Name', type: 'text', required: true },
      asset_type: { label: 'Type', type: 'lookup', list: 'asset_type' },
      status: { label: 'Status', type: 'lookup', list: 'asset_status', default: 'in_stock' },
      make: { label: 'Make', type: 'text' },
      model: { label: 'Model', type: 'text' },
      serial: { label: 'Serial number', type: 'text' },
      owner_id: { label: 'Owner', type: 'user' },
      user_id: { label: 'User', type: 'user' },
      assigned_to_name: { label: 'Assigned to (name)', type: 'text' },
      // E41-01: a reference to the organization's departments; `department` keeps its name (set by the database).
      department_id: { label: 'Department', type: 'ref', to: 'department' },
      department: { label: 'Department name', type: 'text', readOnly: true },
      site_id: { label: 'Site', type: 'ref', to: 'site' },
      location: { label: 'Location', type: 'text' },
      purchase_date: { label: 'Purchase date', type: 'date' },
      cost: { label: 'Cost', type: 'currency' },
      funding_source: { label: 'Funding source', type: 'lookup', list: 'funding_source' },
      funder_interest: { label: 'Funder interest', type: 'boolean', default: false },
      funder_interest_pct: { label: 'Funder interest (%)', type: 'number' },
      warranty_end: { label: 'Warranty end', type: 'date' },
      support_end: { label: 'Support end', type: 'date' },
      os: { label: 'Operating system', type: 'text' },
      os_version: { label: 'Operating system version', type: 'text' },
      ip_address: { label: 'IP address', type: 'text' },
      mac_address: { label: 'MAC address', type: 'text' },
      vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
      contract_id: { label: 'Contract', type: 'ref', to: 'contract' },
      system_id: { label: 'System', type: 'ref', to: 'system' },
      disposal_approved_by: { label: 'Disposal approved by', type: 'text' },
      disposal_approved_on: { label: 'Disposal approved on', type: 'date' },
      disposal_approval_ref: { label: 'Disposal approval reference', type: 'text' },
      disposal_method: { label: 'Disposal method', type: 'text' },
      disposed_on: { label: 'Disposed on', type: 'date' },
      disposal_request_status: { label: 'Disposal approval', type: 'lookup', list: 'disposal_request_status', readOnly: true },
      notes: { label: 'Notes', type: 'longtext' },
      ...OT_ASSET_FIELDS,
      ...CONDITION_ASSET_FIELDS,
      ...ASSET_MODEL_FIELDS,
      ...DATA_WIPE_ASSET_FIELDS,
    },
    scope: { department: 'department_id', site: 'site_id' },
    hooks: {
      // A department may still be given by name (`department` or `department_id`), as before E41-01.
      prepare: departmentPrepare(ctx.db),
      beforeCreate: async (req, data) => {
        await checkAsset(ctx, data, data, null, !!req);
        return data;
      },
      beforeUpdate: async (req, existing, patch) => {
        await checkAsset(ctx, { ...existing, ...patch }, patch, existing, !!req);
        return patch;
      },
    },
  });

  /** The organization's departments, for the asset department choice (the admin list needs admin rights). */
  ctx.app.get('/api/inventory/departments', { preHandler: ctx.requirePerm('assets.view') }, async () =>
    ctx.db.query<{ id: string; name: string }>('select id, name from departments where deleted_at is null order by lower(name)'));

  registerRelations(ctx);
  registerLifecycle(ctx);
  registerDisposalRequests(ctx);
  registerWipeCertificate(ctx);
  await registerReminders(ctx);
  registerReports(ctx);
  registerImport(ctx);
  registerInventoryTaggables(ctx);
}

function checkSystem(ctx: ModuleContext, merged: Row, patch: Row): Row {
  const fields: Record<string, string> = {};
  for (const f of ['rto_hours', 'rpo_hours']) {
    if (patch[f] !== undefined && patch[f] !== null && Number(patch[f]) < 0) fields[f] = 'Enter zero or more hours.';
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  void merged;
  return patch;
}

/** Rules that hold however an asset is written: unique tag, sensible percentage, and the disposal gate. */
async function checkAsset(ctx: ModuleContext, merged: Row, patch: Row, existing: Row | null, _byPerson: boolean) {
  if (patch.tag) {
    const clash = await ctx.db.one<{ id: string }>(
      `select id from assets where lower(tag) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)`,
      [patch.tag, existing?.id ?? null],
    );
    if (clash) ctx.fail(400, 'validation', 'Check the highlighted fields.', { tag: `Tag ${patch.tag} is already in use.` });
  }
  // A cost below zero would distort the cost reports and dashboards (BW-10); imports and MCP tools come through here too.
  if (patch.cost !== undefined && patch.cost !== null && Number(patch.cost) < 0) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { cost: 'Enter zero or more.' });
  }
  const pct = patch.funder_interest_pct;
  if (pct !== undefined && pct !== null && (pct < 0 || pct > 100)) {
    ctx.fail(400, 'validation', 'Check the highlighted fields.', { funder_interest_pct: 'Enter a percentage between 0 and 100.' });
  }
  if (merged.status === 'disposed' && existing?.status !== 'disposed') {
    const problem = disposalProblem(merged, (await ctx.settings.get<boolean>(ROUTED_ONLY, false)) === true, await funderRuleOn(ctx));
    if (problem) ctx.fail(problem.status, problem.code, problem.message, problem.fields);
    if (!merged.disposed_on) patch.disposed_on = today();
  }
}

const mod: ModuleDef = {
  key: 'inventory',
  seedDefaults,
  register,
  seed: seedInventory,
};
export default mod;
