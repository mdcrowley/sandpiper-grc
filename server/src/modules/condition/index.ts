import type { FastifyRequest } from 'fastify';
import type { ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { registerFigures } from './dashboard.ts';
import { registerReminders } from './reminders.ts';
import { seedCondition } from './seed.ts';
import { followTargets, isTarget, recompute, refreshRating, TARGET_TYPES, TARGETS } from './service.ts';
import { registerTargets } from './targets.ts';

/**
 * Asset condition and state of good repair (E32, area `condition`): asset classes with a
 * useful-life benchmark, dated condition assessments of assets, vehicles and sites, yearly targets
 * for the share past useful life, the dashboard and the aging list. Permission module `assets`
 * (vehicles also need `fleet`, sites `sites`). The rated records belong to inventory and fleet:
 * their condition fields are declared in `inventory/fields-condition.ts` and
 * `fleet/fields-condition.ts`, and kept up to date here.
 */

async function seedDefaults(ctx: ModuleContext) {
  const own = { module: 'assets' };
  await ctx.lookups.ensure('asset_class_category', [
    { value: 'rolling_stock', label: 'Rolling stock', color: 'blue', sort: 10 },
    { value: 'equipment', label: 'Equipment', color: 'teal', sort: 20 },
    { value: 'facilities', label: 'Facilities', color: 'purple', sort: 30 },
    { value: 'infrastructure', label: 'Infrastructure', color: 'orange', sort: 40 },
    { value: 'it_technology', label: 'IT and technology', color: 'gray', sort: 50 },
  ], own);
  await ctx.lookups.ensure('condition_target_type', [
    { value: 'vehicle', label: 'Vehicle', sort: 10 },
    { value: 'asset', label: 'Asset', sort: 20 },
    { value: 'site', label: 'Site', sort: 30 },
  ], own);
  await ctx.lookups.ensure('condition_method', [
    { value: 'visual', label: 'Visual', sort: 10 },
    { value: 'measured', label: 'Measured', sort: 20 },
    { value: 'inspection_report', label: 'Inspection report', sort: 30 },
    { value: 'desktop_review', label: 'Desktop review', sort: 40 },
  ], own);
}

const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

function checkClass(ctx: ModuleContext, patch: Row) {
  const fields: Record<string, string> = {};
  for (const f of ['useful_life_years', 'useful_life_miles']) {
    if (patch[f] !== undefined && patch[f] !== null && !(Number(patch[f]) > 0)) fields[f] = 'Enter a number above zero, or leave it empty.';
  }
  if (patch.poor_rating_at !== undefined && patch.poor_rating_at !== null) {
    const n = Number(patch.poor_rating_at);
    if (!Number.isInteger(n) || n < 1 || n > 5) fields.poor_rating_at = 'Enter a whole number from 1 to 5.';
  }
  if (patch.assessment_every_months !== undefined && patch.assessment_every_months !== null) {
    const n = Number(patch.assessment_every_months);
    if (!Number.isInteger(n) || n < 1 || n > 240) fields.assessment_every_months = 'Enter a whole number of months from 1 to 240.';
  }
  if (patch.matches !== undefined && patch.matches !== null) {
    const m = patch.matches;
    const ok = typeof m === 'object' && !Array.isArray(m)
      && Object.entries(m as Row).every(([k, v]) => ['vehicle_mode', 'asset_type', 'site_kind'].includes(k) && Array.isArray(v) && v.every((x) => typeof x === 'string'));
    if (!ok) fields.matches = 'Give lists of values under vehicle_mode, asset_type or site_kind, for example {"vehicle_mode": ["bus"]}.';
  }
  if (patch.applies_to !== undefined && !isTarget(patch.applies_to)) fields.applies_to = 'Choose one of the kinds of record offered.';
  if (Object.keys(fields).length) invalid(ctx, fields);
}

async function checkAssessment(ctx: ModuleContext, req: FastifyRequest | null, data: Row): Promise<Row> {
  const type = data.target_type;
  if (!isTarget(type) || !ctx.resources.get(type)) invalid(ctx, { target_type: 'Choose a record that can be rated.' });
  if (req && !ctx.can(req.user, `${TARGETS[type as keyof typeof TARGETS].module}.view`)) invalid(ctx, { target_id: 'You may not see that record.' });
  const target = typeof data.target_id === 'string' && /^[0-9a-f-]{36}$/i.test(data.target_id)
    ? await ctx.resources.find(type, data.target_id, req?.user ?? null) : undefined;
  if (!target) invalid(ctx, { target_id: 'Choose a record that exists and that you may see.' });
  data.target_label = (await ctx.resources.labelFor(type, data.target_id)) ?? null;
  data.class_id = target!.asset_class_id ?? null;
  if (data.assessed_on && String(data.assessed_on).slice(0, 10) > dayInZone()) invalid(ctx, { assessed_on: 'An assessment cannot be dated in the future.' });
  if (req && !data.assessor_id && !data.assessor_name) data.assessor_id = req.user!.id;
  return data;
}

async function register(ctx: ModuleContext) {
  // Corrective actions raised from a condition finding are filed under "Asset condition" (C8). Done
  // here, not in seedDefaults: modules seed their defaults in name order, and the risks module's
  // action_source list may not exist yet when this module's run on a new database.
  if (await ctx.db.one(`select 1 from lookups where list_key = 'action_source' limit 1`)) {
    await ctx.lookups.ensure('action_source', [{ value: 'condition', label: 'Asset condition', sort: 149 }]);
  }

  ctx.defineResource({
    type: 'asset_class', table: 'asset_classes', module: 'assets', label: 'Asset class', plural: 'Asset classes',
    path: '/api/asset-classes', route: '/condition/classes', titleField: 'name',
    ref: { field: 'ref', prefix: 'ACL-' },
    searchable: ['name', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    // A class that rates a kind of record that is switched off (vehicles while fleet is off) is not
    // shown anywhere: lists, search, links, pickers (E18-64). The same for everyone, so figures match.
    rowRule: {
      where: (_user, col) => {
        const off = TARGET_TYPES.filter((t) => !ctx.resources.get(t));
        return off.length ? `${col('applies_to')} not in (${off.map((t) => `'${t}'`).join(', ')})` : 'true';
      },
      figures: 'filter',
    },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      name: { label: 'Name', type: 'text', required: true },
      category: { label: 'Category', type: 'lookup', list: 'asset_class_category' },
      applies_to: { label: 'Rates', type: 'lookup', list: 'condition_target_type', required: true, default: 'asset' },
      useful_life_years: { label: 'Useful life (years)', type: 'number' },
      useful_life_miles: { label: 'Useful life (miles)', type: 'number' },
      poor_rating_at: { label: 'Poor at or below rating', type: 'number', default: 2 },
      assessment_every_months: { label: 'Assess every (months)', type: 'number' },
      owner_id: { label: 'Owner', type: 'user' },
      active: { label: 'Active', type: 'boolean', default: true },
      matches: { label: 'Suggested for', type: 'json', default: {} },
      description: { label: 'Description', type: 'longtext', personal: false },
    },
    hooks: {
      beforeCreate: (_req, data) => { checkClass(ctx, data); return data; },
      beforeUpdate: async (_req, existing, patch) => {
        checkClass(ctx, patch);
        if (patch.applies_to !== undefined && patch.applies_to !== existing.applies_to) {
          const info = TARGETS[existing.applies_to as keyof typeof TARGETS];
          const used = info && ctx.resources.get(existing.applies_to)
            ? await ctx.db.one<{ n: number }>(`select count(*)::int as n from ${info.table} where asset_class_id = $1 and deleted_at is null`, [existing.id]) : null;
          if (used && used.n > 0) ctx.fail(409, 'class_in_use', `${used.n} record(s) belong to this class. Move them to another class before changing what it rates.`);
        }
        return patch;
      },
      afterUpdate: async (_req, before, after) => {
        if (Number(before.useful_life_years ?? 0) !== Number(after.useful_life_years ?? 0)
          || Number(before.useful_life_miles ?? 0) !== Number(after.useful_life_miles ?? 0)) await recompute(ctx, after.id);
      },
    },
  });

  ctx.defineResource({
    type: 'condition_assessment', table: 'condition_assessments', module: 'assets', label: 'Condition assessment', plural: 'Condition assessments',
    path: '/api/condition-assessments', route: '/condition/assessments', titleField: 'target_label',
    // Role grants scoped to departments or sites (E41-01, core/scope.ts).
    scope: { site: (col) => `case when ${col('target_type')} = 'site' then ${col('target_id')} end` },
    ref: { field: 'ref', prefix: 'CND-' },
    searchable: ['target_label', 'notes', 'assessor_name'],
    defaultSort: { field: 'assessed_on', dir: 'desc' },
    evidence: true,
    // A vehicle's assessment needs fleet.view as well, a site's sites.view: core applies this to
    // every reader (lists, search, links, exports). Figures still count every assessment.
    rowRule: {
      where: (user, col) => {
        const shut = (['vehicle', 'site', 'asset'] as const).filter((t) => !ctx.can(user, `${TARGETS[t].module}.view`));
        return shut.length ? `${col('target_type')} not in (${shut.map((t) => `'${t}'`).join(', ')})` : 'true';
      },
      figures: 'mask',
      hidden: (col) => `${col('target_type')} in ('vehicle', 'site')`,
    },
    fields: {
      ref: { label: 'Reference', type: 'text', readOnly: true },
      target_type: { label: 'Rates a', type: 'lookup', list: 'condition_target_type', required: true },
      target_id: { label: 'Rated record', type: 'text', required: true },
      target_label: { label: 'Rated record', type: 'text', readOnly: true },
      class_id: { label: 'Asset class', type: 'ref', to: 'asset_class', readOnly: true },
      assessed_on: { label: 'Assessed on', type: 'date', required: true },
      rating: { label: 'Condition', type: 'lookup', list: 'condition_rating', required: true },
      method: { label: 'Method', type: 'lookup', list: 'condition_method' },
      assessor_id: { label: 'Assessor', type: 'user' },
      assessor_name: { label: 'Assessor (name, when not a user)', type: 'text', personal: true },
      notes: { label: 'Notes', type: 'longtext' },
    },
    hooks: {
      beforeCreate: (req, data) => checkAssessment(ctx, req, data),
      beforeUpdate: async (_req, existing, patch) => {
        for (const f of ['target_type', 'target_id']) {
          if (patch[f] !== undefined && String(patch[f]) !== String(existing[f])) invalid(ctx, { [f]: 'An assessment stays with the record it rates. Record a new assessment instead.' });
        }
        if (patch.assessed_on && String(patch.assessed_on).slice(0, 10) > dayInZone()) invalid(ctx, { assessed_on: 'An assessment cannot be dated in the future.' });
        return patch;
      },
      afterCreate: async (_req, row) => { await refreshRating(ctx, row.target_type, row.target_id); },
      afterUpdate: async (_req, _before, after) => { await refreshRating(ctx, after.target_type, after.target_id); },
    },
  });

  // A deleted assessment no longer counts: the record shows the newest one left.
  ctx.resources.onChange?.(async ({ action, def, row }) => {
    if (def.type === 'condition_assessment' && (action === 'delete' || action === 'purge')) await refreshRating(ctx, row.target_type, row.target_id);
  });

  // The asset, vehicle and site types are defined by modules that register after this one.
  ctx.app.addHook('onReady', async () => { followTargets(ctx); });

  /** Corrective action from an assessment (a poor rating, a finding): action source "Asset condition". */
  ctx.app.post('/api/condition-assessments/:id/action', { preHandler: ctx.requirePerm('actions.create') }, async (req, reply) => {
    if (!ctx.resources.get('action')) ctx.fail(404, 'not_found', 'Actions are not available.');
    const { id } = req.params as { id: string };
    const a = await ctx.resources.find('condition_assessment', id, req.user);
    if (!a) ctx.fail(404, 'not_found', 'Condition assessment not found.');
    const b = (req.body ?? {}) as Row;
    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 300) : `Condition finding: ${a!.target_label ?? a!.ref}`;
    reply.code(201);
    return ctx.resources.create('action', {
      title, description: typeof b.description === 'string' ? b.description : a!.notes ?? null,
      owner_id: typeof b.owner_id === 'string' ? b.owner_id : null, due_on: typeof b.due_on === 'string' ? b.due_on : null,
      source: 'condition', source_type: 'condition_assessment', source_id: a!.id,
    }, req);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/condition-assessments/:id/action', permission: 'actions.create',
    summary: 'Raise a corrective action from a condition assessment (source "Asset condition")',
    body: '{ title?, description?, owner_id?, due_on? }', response: 'The new action',
  });

  ctx.app.post('/api/asset-classes/:id/recompute', { preHandler: ctx.requirePerm('assets.edit') }, async (req) => {
    const { id } = req.params as { id: string };
    const cls = await ctx.resources.find('asset_class', id, req.user);
    if (!cls) ctx.fail(404, 'not_found', 'Asset class not found.');
    const changed = await recompute(ctx, id);
    await ctx.audit(req, { action: 'asset_class.recompute', recordType: 'asset_class', recordId: id, summary: `Useful-life ends recomputed: ${changed} changed` });
    return { changed };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-classes/:id/recompute', permission: 'assets.edit',
    summary: "Recompute the end of useful life of every record in an asset class", response: '{ changed }',
  });

  ctx.app.get('/api/asset-classes/suggest', { preHandler: ctx.requirePerm('assets.view') }, async (req) => {
    const q = req.query as Row;
    if (!isTarget(q.type)) ctx.fail(400, 'validation', 'Give type= one of the kinds of record an asset class applies to.');
    const key = TARGETS[q.type as keyof typeof TARGETS].matchKey;
    const value = typeof q.value === 'string' ? q.value : '';
    const rows = await ctx.db.query<Row>(
      `select id, ref, name, useful_life_years, useful_life_miles, coalesce((matches -> $2) ? $3, false) as suggested
       from asset_classes where deleted_at is null and active and applies_to = $1 order by 6 desc, lower(name)`, [q.type, key, value]);
    return rows.map((r) => ({ ...r, suggested: r.suggested === true }));
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-classes/suggest', permission: 'assets.view',
    summary: 'Active asset classes for one kind of record, the suggested ones first',
    description: 'A class is suggested when its `matches` lists the value (the mode, type or kind of the record).',
    query: { type: 'A kind of record an asset class applies to (its applies_to values)', value: 'The mode, type or kind of the record' },
    response: '[{ id, ref, name, useful_life_years, useful_life_miles, suggested }]',
  });

  registerTargets(ctx);
  registerFigures(ctx);
  await registerReminders(ctx);
}

const mod: ModuleDef = {
  key: 'condition',
  seedDefaults,
  register,
  seed: seedCondition,
};
export default mod;
