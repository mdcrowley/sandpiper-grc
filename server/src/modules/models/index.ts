import type { FastifyRequest } from 'fastify';
import type { FieldDef, ModuleContext, ModuleDef, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import {
  BACKGROUND_SETTING, blank, changeRow, cleanOverrides, fieldLabels, INHERITED_CUSTOM_SETTING, inheritedCustom, inheritedFields, KINDS,
  memberCustomFields, memberLabel, memberValue, modelValue, prepareMember, previewChange, refusalText, runChange, same, startChange,
  type ModelKind, type Refusal,
} from './engine.ts';
import { registerModelEquipment } from './equipment.ts';
import { seedModels } from './seed.ts';

/**
 * Vehicle and asset models (E39): shared specifications that vehicles and assets inherit. A vehicle
 * model belongs to Fleet and services (permission `fleet`, switched off with it); an asset model to
 * the inventory (permission `assets`, always on). Members are the fleet's vehicles and the
 * inventory's assets: their `model_id` and `model_overrides` fields are declared in
 * `fleet/fields-models.ts` and `inventory/fields-models.ts`; this module fills their inherited
 * fields when they are saved (`prepare` hook) and when their model changes.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

const COMMON: Record<string, FieldDef> = {
  description: { label: 'Description', type: 'longtext', personal: false },
  active: { label: 'Active', type: 'boolean', default: true },
  inherited_custom: { label: 'Values of inherited custom fields', type: 'json' },
};

const VEHICLE_MODEL_FIELDS: Record<string, FieldDef> = {
  name: { label: 'Name', type: 'text', required: true },
  mode: { label: 'Mode', type: 'lookup', list: 'vehicle_mode' },
  make: { label: 'Make', type: 'text' },
  model: { label: 'Model', type: 'text' },
  // Stored as a whole number; declared as text so it is shown as "2016", not "2,016" (as on vehicles).
  model_year: { label: 'Model year', type: 'text' },
  capacity: { label: 'Passenger capacity', type: 'number' },
  asset_class_id: { label: 'Asset class', type: 'ref', to: 'asset_class' },
  funding_source: { label: 'Funding source', type: 'lookup', list: 'funding_source' },
  ...COMMON,
};

const ASSET_MODEL_FIELDS: Record<string, FieldDef> = {
  name: { label: 'Name', type: 'text', required: true },
  asset_type: { label: 'Type', type: 'lookup', list: 'asset_type' },
  make: { label: 'Make', type: 'text' },
  model: { label: 'Model', type: 'text' },
  vendor_id: { label: 'Vendor', type: 'ref', to: 'vendor' },
  asset_class_id: { label: 'Asset class', type: 'ref', to: 'asset_class' },
  funding_source: { label: 'Funding source', type: 'lookup', list: 'funding_source' },
  support_end: { label: 'Support end', type: 'date' },
  ...COMMON,
};

/** A model's own rules: a unique name, a sensible year and capacity, custom values kept as an object. */
async function checkModel(ctx: ModuleContext, kind: ModelKind, patch: Row, existing: Row | null) {
  if (typeof patch.name === 'string') {
    patch.name = patch.name.trim();
    const clash = await ctx.db.one<{ id: string }>(
      `select id from ${kind.modelTable} where lower(name) = lower($1) and deleted_at is null and ($2::uuid is null or id <> $2::uuid)`,
      [patch.name, existing?.id ?? null]);
    if (clash) invalid(ctx, { name: `${kind.key === 'asset' ? 'An' : 'A'} ${kind.label.toLowerCase()} called ${patch.name} already exists.` });
  }
  if (patch.model_year === '') patch.model_year = null;
  if (patch.model_year !== undefined && patch.model_year !== null) {
    const y = String(patch.model_year).trim();
    if (!/^\d{4}$/.test(y) || Number(y) < 1900 || Number(y) > Number(dayInZone().slice(0, 4)) + 2) invalid(ctx, { model_year: 'Enter a four-digit year.' });
    patch.model_year = Number(y);
  }
  if (patch.capacity !== undefined && patch.capacity !== null && Number(patch.capacity) < 0) invalid(ctx, { capacity: 'Enter zero or more.' });
  if (patch.inherited_custom !== undefined) {
    const v = patch.inherited_custom;
    if (v === null) patch.inherited_custom = {};
    else if (typeof v !== 'object' || Array.isArray(v)) invalid(ctx, { inherited_custom: 'Give the values as an object keyed by custom field.' });
  }
}

/** A model's save may carry inheritable custom values as `cf_<key>`: they are kept in `inherited_custom`. */
async function prepareModel(ctx: ModuleContext, kind: ModelKind, input: Row, existing: Row | null): Promise<Row> {
  const custom = await inheritedCustom(ctx, kind);
  let values: Row | null = null;
  for (const f of custom) {
    if (!(f.name in input)) continue;
    values ??= { ...((existing?.inherited_custom ?? {}) as Row), ...((input.inherited_custom ?? {}) as Row) };
    const v = input[f.name];
    delete input[f.name];
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) { delete values[f.key]; continue; }
    if ((f.type === 'number' || f.type === 'currency') && !Number.isFinite(Number(v))) invalid(ctx, { [f.name]: `${f.label} must be a number.` });
    if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) invalid(ctx, { [f.name]: `${f.label} must be a date (YYYY-MM-DD).` });
    values[f.key] = f.type === 'number' || f.type === 'currency' ? Number(v) : f.type === 'boolean' ? v === true || v === 'true' : v;
  }
  if (values) input.inherited_custom = values;
  return input;
}

function defineModel(ctx: ModuleContext, kind: ModelKind) {
  const path = kind.key === 'vehicle' ? '/api/vehicle-models' : '/api/asset-models';
  ctx.defineResource({
    type: kind.modelType, table: kind.modelTable, module: kind.module,
    label: kind.label, plural: `${kind.label}s`, path, route: kind.key === 'vehicle' ? '/vehicle-models' : '/asset-models',
    titleField: 'name', searchable: ['name', 'make', 'model', 'description'],
    defaultSort: { field: 'name', dir: 'asc' },
    pickerWhere: 'active',
    fields: kind.key === 'vehicle' ? VEHICLE_MODEL_FIELDS : ASSET_MODEL_FIELDS,
    hooks: {
      prepare: (_req, input, existing) => prepareModel(ctx, kind, input, existing),
      beforeCreate: async (_req, data) => { await checkModel(ctx, kind, data, null); return data; },
      beforeUpdate: async (_req, existing, patch) => { await checkModel(ctx, kind, patch, existing); return patch; },
      // The change reaches every member that does not override it (E39-03). The answer carries the
      // change's log row as `_model_change` (the web app shows what happened, and follows a job).
      afterUpdate: async (req, before, after) => {
        const changed = (await inheritedFields(ctx, kind)).filter((f) => !same(modelValue(before, f), modelValue(after, f)));
        const change = await startChange(ctx, kind, after, changed, req);
        if (change) after._model_change = change;
      },
    },
  });
  return path;
}

/** Makes a member type take its model's values on every save (ResourceDef.hooks.prepare). */
function wireMembers(ctx: ModuleContext, kind: ModelKind) {
  const def = ctx.resources.get(kind.memberType);
  if (!def) return;
  // A required inherited field (a vehicle's mode) may come from the model: an import naming the model needs no column for it.
  const required = kind.inherited.filter((f) => def.fields[f]?.required);
  if (required.length) def.filledBy = { ...(def.filledBy ?? {}), ...Object.fromEntries(required.map((f) => [f, 'model_id'])) };
  const own = def.hooks ?? {};
  def.hooks = {
    ...own,
    prepare: async (req, input, existing) => prepareMember(ctx, kind, own.prepare ? await own.prepare(req, input, existing) : input, existing),
  };
}

function registerRoutes(ctx: ModuleContext, kind: ModelKind, base: string) {
  const { app, db } = ctx;
  const view = `${kind.module}.view`;
  const edit = `${kind.module}.edit`;
  const modelOf = async (req: FastifyRequest): Promise<Row> =>
    (await ctx.resources.find(kind.modelType, (req.params as { id: string }).id, req.user)) ?? ctx.fail(404, 'not_found', `${kind.label} not found.`);
  const memberDef = () => ctx.resources.get(kind.memberType) ?? ctx.fail(404, 'not_found', `${kind.label}s need the ${kind.memberPlural}, which are not available.`);
  const tag = kind.key === 'vehicle' ? 'Vehicle models' : 'Asset models';

  // A model with members cannot be deleted (E39-01); the generic DELETE (and bulk delete) comes here.
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'DELETE' || req.routeOptions?.url !== `${base}/:id`) return;
    const id = (req.params as { id?: string }).id;
    if (!id || !UUID.test(id)) return;
    const n = await db.one<{ c: number }>(`select count(*)::int c from ${kind.memberTable} where model_id = $1 and deleted_at is null`, [id]);
    if (n && n.c > 0) {
      ctx.fail(409, 'model_in_use', `This ${kind.label.toLowerCase()} has ${n.c} ${n.c === 1 ? kind.memberLabel : kind.memberPlural}. Assign them another model or remove theirs first, or make the model inactive.`);
    }
  });

  /** The fields members inherit, and the member type's custom fields with whether each is inherited. */
  app.get(`${base}/inherited-fields`, { preHandler: ctx.requirePerm(view) }, async () => {
    memberDef();
    const labels = await fieldLabels(ctx, kind);
    const fields = await inheritedFields(ctx, kind);
    return {
      fields: fields.map((f) => ({ field: f, label: labels[f] ?? f, custom: f.startsWith('cf_') })),
      custom: (await memberCustomFields(ctx, kind)).map(({ key, name, label, type, list_key, ref_type, inherited }) => ({ key, name, label, type, list_key, ref_type, inherited })),
    };
  });
  ctx.describeRoute({ method: 'GET', path: `${base}/inherited-fields`, tag, summary: `Fields ${kind.memberPlural} inherit from their model, and which custom fields are inherited`, permission: view });

  app.put(`${base}/inherited-fields`, { preHandler: ctx.requirePerm('admin.administer') }, async (req) => {
    memberDef();
    const body = (req.body ?? {}) as Row;
    const known = await memberCustomFields(ctx, kind);
    const keys = Array.isArray(body.custom) ? [...new Set(body.custom.map(String))] : null;
    if (!keys) invalid(ctx, { custom: 'Send { custom: [custom field keys] }.' });
    const bad = keys!.filter((k) => !known.some((f) => f.key === k));
    if (bad.length) invalid(ctx, { custom: `Not a custom field of ${kind.memberPlural}: ${bad.join(', ')}.` });
    const all = { ...(await ctx.settings.get<Record<string, string[]>>(INHERITED_CUSTOM_SETTING, {})) };
    const before = all[kind.key] ?? [];
    all[kind.key] = keys!.sort();
    await ctx.settings.set(INHERITED_CUSTOM_SETTING, all, req);
    await ctx.audit(req, {
      action: `${kind.modelType}.inherited_fields`, recordType: kind.modelType,
      summary: `Custom fields of ${kind.memberPlural} inherited from the model: ${keys!.map((k) => known.find((f) => f.key === k)?.label ?? k).join(', ') || 'none'}`,
      before: { custom: before }, after: { custom: all[kind.key] },
    });
    return { custom: all[kind.key] };
  });
  ctx.describeRoute({ method: 'PUT', path: `${base}/inherited-fields`, tag, summary: `Mark which custom fields of ${kind.memberPlural} are inherited from the model`, permission: 'admin.administer', body: '{ custom: [custom field key, ...] }' });

  /** The Members tab: counts by status and which inherited fields members override. */
  app.get(`${base}/:id/summary`, { preHandler: ctx.requirePerm(view) }, async (req) => {
    const model = await modelOf(req);
    const def = memberDef();
    const statusList = def.fields.status?.list;
    // A figure: every member counts, whoever asks (docs/security.md); members are not restricted types.
    const rows = await db.query<{ status: string | null; c: number }>(
      `select status, count(*)::int c from ${kind.memberTable} where model_id = $1 and deleted_at is null group by status`, [model.id]);
    const statuses = statusList ? await ctx.lookups.values(statusList) : [];
    const labels = await fieldLabels(ctx, kind);
    const fields = await inheritedFields(ctx, kind);
    const overridden = await db.query<{ field: string; c: number }>(
      `select o.field, count(*)::int c from ${kind.memberTable} m, jsonb_array_elements_text(m.model_overrides) as o(field)
       where m.model_id = $1 and m.deleted_at is null group by o.field`, [model.id]);
    const changes = await db.query<{ id: string }>(
      'select id from model_changes where model_type = $1 and model_id = $2 order by created_at desc limit 5', [kind.modelType, model.id]);
    return {
      members: rows.reduce((n, r) => n + r.c, 0),
      by_status: rows.map((r) => {
        const s = statuses.find((x) => x.value === r.status);
        return { value: r.status, label: s?.label ?? r.status ?? 'None', color: s?.color ?? 'gray', count: r.c, sort: s ? statuses.indexOf(s) : 999 };
      }).sort((a, b) => a.sort - b.sort).map(({ sort: _s, ...r }) => r),
      overridden: overridden.filter((o) => fields.includes(o.field)).map((o) => ({ field: o.field, label: labels[o.field] ?? o.field, count: o.c })),
      changes: (await Promise.all(changes.map((c) => changeRow(ctx, c.id)))).filter(Boolean),
    };
  });
  ctx.describeRoute({ method: 'GET', path: `${base}/:id/summary`, tag, summary: `Members of a ${kind.label.toLowerCase()}: counts by status, overridden fields and recent changes`, permission: view });

  /** Before a model is saved: how many members change and which keep their own value (E39-03). */
  app.post(`${base}/:id/preview`, { preHandler: ctx.requirePerm(edit) }, async (req) => {
    const model = await modelOf(req);
    memberDef();
    const body = (req.body ?? {}) as Row;
    const changes = body.changes && typeof body.changes === 'object' ? body.changes as Row : body;
    return previewChange(ctx, kind, model, changes);
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/preview`, tag, permission: edit,
    summary: `What saving a change to a ${kind.label.toLowerCase()} would do to its members`,
    body: '{ changes: { <field>: value, ... } }',
    response: '{ members, changing, fields: [{ field, label, changes, keeps }], keeping: [{ id, label, fields }], keepingTotal, background }',
  });

  app.get(`${base}/:id/changes`, { preHandler: ctx.requirePerm(view) }, async (req) => {
    const model = await modelOf(req);
    const ids = await db.query<{ id: string }>('select id from model_changes where model_type = $1 and model_id = $2 order by created_at desc limit 20', [kind.modelType, model.id]);
    return (await Promise.all(ids.map((c) => changeRow(ctx, c.id)))).filter(Boolean);
  });
  ctx.describeRoute({ method: 'GET', path: `${base}/:id/changes`, tag, summary: `Changes of a ${kind.label.toLowerCase()} applied to its members, newest first`, permission: view });

  app.get(`${base}/:id/changes/:changeId`, { preHandler: ctx.requirePerm(view) }, async (req) => {
    const model = await modelOf(req);
    const id = (req.params as { changeId: string }).changeId;
    const row = UUID.test(id) ? await changeRow(ctx, id) : undefined;
    if (!row || row.model_id !== model.id) ctx.fail(404, 'not_found', 'Change not found.');
    return row;
  });
  ctx.describeRoute({ method: 'GET', path: `${base}/:id/changes/:changeId`, tag, summary: 'One change applied to the members (follow a background change by its progress)', permission: view });

  // ---------- assigning a model (E39-05) ----------

  const selected = async (req: FastifyRequest): Promise<Row[]> => {
    const body = (req.body ?? {}) as Row;
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String).filter((s: string) => UUID.test(s)))] : [];
    if (!ids.length) invalid(ctx, { ids: `Choose the ${kind.memberPlural} to assign.` });
    if (ids.length > 1000) invalid(ctx, { ids: `Assign at most 1,000 ${kind.memberPlural} at once.` });
    return db.query<Row>(
      `select * from ${kind.memberTable} where id = any($1::uuid[]) and deleted_at is null and ${ctx.resources.visibleWhere(kind.memberType, req.user)}`, [ids]);
  };

  app.post(`${base}/:id/assign/preview`, { preHandler: ctx.requirePerm(edit) }, async (req) => {
    const model = await modelOf(req);
    const def = memberDef();
    const members = await selected(req);
    const fields = await inheritedFields(ctx, kind);
    const labels = await fieldLabels(ctx, kind);
    const joining = members.filter((m) => m.model_id !== model.id);
    return {
      selected: members.length,
      already: members.length - joining.length,
      from_other_model: joining.filter((m) => m.model_id).length,
      inactive: model.active === false,
      fields: fields.map((f) => ({
        field: f, label: labels[f] ?? f, model_value: modelValue(model, f) ?? null,
        differ: blank(modelValue(model, f)) ? 0 : joining.filter((m) => !same(memberValue(m, f), modelValue(model, f))).length,
        examples: blank(modelValue(model, f)) ? [] : joining.filter((m) => !same(memberValue(m, f), modelValue(model, f))).slice(0, 3).map((m) => ({ id: m.id, label: memberLabel(def, m), value: memberValue(m, f) ?? null })),
      })),
    };
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/assign/preview`, tag, permission: edit,
    summary: `Before giving ${kind.memberPlural} this model: which of their values differ from the model's`,
    body: '{ ids: [member id, ...] }', response: '{ selected, already, from_other_model, inactive, fields: [{ field, label, model_value, differ, examples }] }',
  });

  app.post(`${base}/:id/assign`, { preHandler: ctx.requirePerm(edit) }, async (req) => {
    const model = await modelOf(req);
    const def = memberDef();
    if (model.active === false) invalid(ctx, { model_id: `${kind.label} ${model.name} is inactive and is not offered for new ${kind.memberPlural}.` });
    const members = await selected(req);
    const fields = await inheritedFields(ctx, kind);
    const keep = cleanOverrides(((req.body ?? {}) as Row).keep ?? [], fields);
    const via = `${kind.label.toLowerCase()} ${model.name}`;
    const refused: Refusal[] = [];
    let applied = 0;
    const joining = members.filter((m) => m.model_id !== model.id);
    for (const m of joining) {
      // Values that differ become overrides only when the person chose to keep them.
      const own = keep.filter((f) => !blank(modelValue(model, f)) && !same(memberValue(m, f), modelValue(model, f)));
      try {
        await ctx.resources.update(kind.memberType, m.id, { model_id: model.id, model_overrides: own }, req, { via });
        applied++;
      } catch (err) {
        refused.push({ id: m.id, label: memberLabel(def, m), message: refusalText(err) });
      }
    }
    const log = (await db.one<{ id: string }>(
      `insert into model_changes (model_type, model_id, kind, fields, status, total, applied, kept, refused, created_by, finished_at)
       values ($1, $2, 'assign', $3::jsonb, 'done', $4, $5, $6, $7::jsonb, $8, now()) returning id`,
      [kind.modelType, model.id, JSON.stringify(keep), joining.length, applied, keep.length ? joining.length : 0, JSON.stringify(refused), req.user!.id]))!;
    await ctx.audit(req, {
      action: `${kind.modelType}.assign`, recordType: kind.modelType, recordId: model.id,
      summary: `${kind.label} ${model.name} given to ${applied} ${applied === 1 ? kind.memberLabel : kind.memberPlural}${refused.length ? `; ${refused.length} refused` : ''}`,
      after: { applied, refused: refused.length, keep },
    });
    return { selected: members.length, already: members.length - joining.length, applied, refused, change: await changeRow(ctx, log.id) };
  });
  ctx.describeRoute({
    method: 'POST', path: `${base}/:id/assign`, tag, permission: edit,
    summary: `Give ${kind.memberPlural} this model; the fields named in keep stay as each one's own value where it differs`,
    body: '{ ids: [member id, ...], keep?: [field, ...] }', response: '{ selected, already, applied, refused: [{ id, label, message }], change }',
  });

  /** Existing members with no model whose make and model name (and year, for vehicles) match a model. */
  app.get(`${base}/suggestions`, { preHandler: ctx.requirePerm(view) }, async (req) => {
    memberDef();
    const year = kind.key === 'vehicle' ? 'and (m.model_year is null or x.model_year = m.model_year)' : '';
    const rows = await db.query<{ model_id: string; name: string; count: number; ids: string[] }>(
      `select m.id as model_id, m.name, count(x.id)::int as count, (array_agg(x.id order by x.id))[1:500] as ids
       from ${kind.modelTable} m
       join ${kind.memberTable} x on lower(trim(x.make)) = lower(trim(m.make)) and lower(trim(x.model)) = lower(trim(m.model)) ${year}
       where m.deleted_at is null and m.active and coalesce(trim(m.make), '') <> '' and coalesce(trim(m.model), '') <> ''
         and x.deleted_at is null and x.model_id is null and ${ctx.resources.visibleWhere(kind.memberType, req.user, 'x')}
       group by m.id, m.name order by count(x.id) desc, m.name limit 50`);
    return rows;
  });
  ctx.describeRoute({
    method: 'GET', path: `${base}/suggestions`, tag, permission: view,
    summary: `${kind.label}s that existing ${kind.memberPlural} with no model match by make and model name${kind.key === 'vehicle' ? ' (and year)' : ''}`,
    response: '[{ model_id, name, count, ids }]',
  });

  // A large change runs as a background job with progress (E39-03).
  app.jobs.register(kind.jobType, async (payload, job) => {
    const id = String((payload as Row).changeId ?? '');
    const row = await runChange(ctx, kind, id, null, (done, of) => job.progress({ done, of }));
    return row ? { applied: row.applied, refused: Array.isArray(row.refused) ? row.refused.length : 0, total: row.total } : null;
  }, { maxAttempts: 1 });
}

async function register(ctx: ModuleContext) {
  for (const kind of Object.values(KINDS)) {
    if (!ctx.resources.get(kind.memberType)) continue; // fleet or inventory not loaded
    const base = defineModel(ctx, kind);
    wireMembers(ctx, kind);
    registerRoutes(ctx, kind, base);
  }
  if (ctx.resources.get('vehicle_model')) registerModelEquipment(ctx);
}

const mod: ModuleDef = {
  key: 'models',
  register,
  seed: seedModels,
};
export default mod;

export { BACKGROUND_SETTING };
