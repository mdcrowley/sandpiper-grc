import type { FastifyRequest } from 'fastify';
import { loadUser } from '../../core/auth.ts';
import { CUSTOM_PREFIX } from '../../core/customfields.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';

/**
 * Vehicle and asset models (E39): what members inherit, how a member's save takes its model's values
 * (with overrides), and how a change to a model reaches its members.
 *
 * Storage: a member keeps every inherited value in its own column (so lists, filters, sorting,
 * reports, exports and search work unchanged), plus `model_id` and `model_overrides` (the inherited
 * fields it keeps its own value for). A model keeps the shared values in columns of the same names,
 * and the values of inheritable custom fields in `inherited_custom` (by custom field key).
 */

export type MemberKind = 'vehicle' | 'asset';

export interface ModelKind {
  key: MemberKind;
  memberType: MemberKind;
  modelType: 'vehicle_model' | 'asset_model';
  memberTable: string;
  modelTable: string;
  /** Permission module of both the members and the model. */
  module: 'fleet' | 'assets';
  /** Built-in fields a member inherits (the same names on the model). */
  inherited: string[];
  /** Job type for a change applied in the background (its prefix follows the area's switch). */
  jobType: string;
  label: string;
  memberLabel: string;
  memberPlural: string;
}

export const KINDS: Record<MemberKind, ModelKind> = {
  vehicle: {
    key: 'vehicle', memberType: 'vehicle', modelType: 'vehicle_model', memberTable: 'vehicles', modelTable: 'vehicle_models',
    module: 'fleet', inherited: ['mode', 'make', 'model', 'model_year', 'capacity', 'asset_class_id', 'funding_source'],
    jobType: 'fleet.model_apply', label: 'Vehicle model', memberLabel: 'vehicle', memberPlural: 'vehicles',
  },
  asset: {
    key: 'asset', memberType: 'asset', modelType: 'asset_model', memberTable: 'assets', modelTable: 'asset_models',
    module: 'assets', inherited: ['asset_type', 'make', 'model', 'vendor_id', 'asset_class_id', 'funding_source', 'support_end'],
    jobType: 'inventory.model_apply', label: 'Asset model', memberLabel: 'asset', memberPlural: 'assets',
  },
};

export const kindOfModel = (type: string): ModelKind | undefined => Object.values(KINDS).find((k) => k.modelType === type);

/** Setting: the custom field keys of vehicles and of assets marked "Inherited from the model" (E39-06). */
export const INHERITED_CUSTOM_SETTING = 'models.inherited_custom';
/** Setting: a change reaching more members than this runs as a background job with progress. */
export const BACKGROUND_SETTING = 'models.background_after';
export const BACKGROUND_DEFAULT = 200;

export interface CustomInfo { key: string; name: string; label: string; type: string; list_key: string | null; ref_type: string | null }

/** Active custom fields of the member type, with whether each is inherited from the model. */
export async function memberCustomFields(ctx: ModuleContext, kind: ModelKind): Promise<(CustomInfo & { inherited: boolean })[]> {
  const rows = await ctx.db.query<{ key: string; label: string; type: string; list_key: string | null; ref_type: string | null }>(
    `select key, label, type, list_key, ref_type from custom_fields where record_type = $1 and active order by position, label`, [kind.memberType]);
  const marked = await inheritedCustomKeys(ctx, kind);
  return rows.map((r) => ({ ...r, name: `${CUSTOM_PREFIX}${r.key}`, inherited: marked.includes(r.key) }));
}

export async function inheritedCustomKeys(ctx: ModuleContext, kind: ModelKind): Promise<string[]> {
  const all = await ctx.settings.get<Record<string, unknown>>(INHERITED_CUSTOM_SETTING, {});
  const keys = all && typeof all === 'object' ? (all as Record<string, unknown>)[kind.key] : null;
  return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
}

/** The inheritable custom fields in use (marked and still active), as `cf_<key>` names with their details. */
export async function inheritedCustom(ctx: ModuleContext, kind: ModelKind): Promise<CustomInfo[]> {
  return (await memberCustomFields(ctx, kind)).filter((f) => f.inherited);
}

/**
 * The fields members of this kind inherit now: the built-in ones both types still show (a field of a
 * switched-off area, such as the asset class while Asset condition is off, is neither shown nor
 * inherited) and the custom fields marked as inherited.
 */
export async function inheritedFields(ctx: ModuleContext, kind: ModelKind): Promise<string[]> {
  const member = ctx.resources.get(kind.memberType);
  const model = ctx.resources.get(kind.modelType);
  if (!member || !model) return [];
  const builtIn = kind.inherited.filter((f) => member.fields[f] && model.fields[f]);
  return [...builtIn, ...(await inheritedCustom(ctx, kind)).map((f) => f.name)];
}

export async function fieldLabels(ctx: ModuleContext, kind: ModelKind): Promise<Record<string, string>> {
  const member = ctx.resources.get(kind.memberType);
  const out: Record<string, string> = {};
  for (const f of kind.inherited) if (member?.fields[f]) out[f] = member.fields[f].label;
  for (const f of await inheritedCustom(ctx, kind)) out[f.name] = f.label;
  return out;
}

const isCustom = (f: string) => f.startsWith(CUSTOM_PREFIX);
const customKey = (f: string) => f.slice(CUSTOM_PREFIX.length);

/** A member's value of an inherited field (custom values live in `custom`). */
export const memberValue = (row: Row, f: string): unknown => (isCustom(f) ? (row.custom ?? {})[customKey(f)] : row[f]);
/** A model's value of an inherited field (custom values live in `inherited_custom`). */
export const modelValue = (row: Row, f: string): unknown => (isCustom(f) ? (row.inherited_custom ?? {})[customKey(f)] : row[f]);

/** Values compared the way people see them: empty is empty, numbers and text by their text, lists in any order. */
export function same(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (Array.isArray(v)) return v.length ? JSON.stringify(v.map(String).sort()) : null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return null;
      return /^-?\d+(\.\d+)?$/.test(t) ? String(Number(t)) : t;
    }
    if (typeof v === 'number') return String(v);
    return typeof v === 'object' ? JSON.stringify(v) : String(v);
  };
  return norm(a) === norm(b);
}

/** A model value that says nothing: an empty field on a model is not inherited (members keep their own). */
export const blank = (v: unknown): boolean => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** A stored or sent overrides list, cleaned: unique names of inherited fields. */
export function cleanOverrides(v: unknown, fields: string[]): string[] {
  let list: unknown = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = v.split(','); } }
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((x) => String(x).trim()).filter((x) => fields.includes(x)))].sort();
}

const invalid = (ctx: ModuleContext, fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);

async function modelRow(ctx: ModuleContext, kind: ModelKind, id: unknown): Promise<Row | undefined> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return ctx.db.one<Row>(`select * from ${kind.modelTable} where id = $1 and deleted_at is null`, [id]);
}

/**
 * A member's save (create: `existing` null), before validation (ResourceDef.hooks.prepare): takes the
 * model's value for every inherited field that is not overridden. A field the caller sends with a
 * value other than the model's becomes an override; sent with the model's value, it is no longer one
 * (unless the caller's own `model_overrides` lists it). `model_overrides` sent alone clears an
 * override: the field takes the model's value again. Removing the model keeps the current values as
 * the member's own.
 */
export async function prepareMember(ctx: ModuleContext, kind: ModelKind, input: Row, existing: Row | null): Promise<Row> {
  const touchesModel = 'model_id' in input || 'model_overrides' in input;
  if (!touchesModel && !existing?.model_id) return input;
  if (!ctx.resources.get(kind.modelType)) return input; // models switched off or not loaded: values stay as sent
  const fields = await inheritedFields(ctx, kind);
  const sentId = 'model_id' in input ? (input.model_id === '' ? null : input.model_id ?? null) : undefined;
  const modelId = sentId !== undefined ? sentId : existing?.model_id ?? null;
  if (!modelId) {
    if (existing?.model_id || 'model_overrides' in input) input.model_overrides = [];
    return input;
  }
  const model = await modelRow(ctx, kind, modelId);
  if (!model) invalid(ctx, { model_id: `${kind.label} not found.` });
  if (modelId !== existing?.model_id && model!.active === false) {
    invalid(ctx, { model_id: `${kind.label} ${model!.name} is inactive and is not offered for new ${kind.memberPlural}.` });
  }
  const explicit = 'model_overrides' in input ? cleanOverrides(input.model_overrides, fields) : null;
  const overrides = new Set(explicit ?? cleanOverrides(existing?.model_overrides ?? [], fields));
  for (const f of fields) {
    const from = modelValue(model!, f);
    if (blank(from)) { overrides.delete(f); continue; }
    if (f in input) {
      if (same(input[f], from)) { if (!explicit?.includes(f)) overrides.delete(f); } else overrides.add(f);
      continue;
    }
    if (overrides.has(f)) continue;
    if (!existing || !same(memberValue(existing, f), from)) input[f] = from ?? null;
  }
  input.model_overrides = [...overrides].sort();
  return input;
}

// ---------- members and changes ----------

export interface Refusal { id: string; label: string; message: string }

/** Members of one model with the values that matter for a change. */
export async function membersOf(ctx: ModuleContext, kind: ModelKind, modelId: string, ids?: string[]): Promise<Row[]> {
  const def = ctx.resources.get(kind.memberType);
  if (!def) return [];
  return ctx.db.query<Row>(
    `select * from ${kind.memberTable} where deleted_at is null and ${ids ? 'id = any($1::uuid[])' : 'model_id = $1'} order by ${def.titleField}`,
    [ids ?? modelId]);
}

export const memberLabel = (def: ResourceDef, row: Row) =>
  [def.ref && row[def.ref.field], row[def.titleField]].filter(Boolean).join(' ') || row.id;

/** The patch a change of `fields` makes to one member: the fields it does not override whose value differs. */
export function memberPatch(member: Row, model: Row, fields: string[]): Row {
  const overrides = Array.isArray(member.model_overrides) ? member.model_overrides : [];
  const patch: Row = {};
  for (const f of fields) {
    if (overrides.includes(f)) continue;
    const to = modelValue(model, f);
    if (!blank(to) && !same(memberValue(member, f), to)) patch[f] = to;
  }
  return patch;
}

/**
 * What saving `changes` to a model would do: the fields that change, how many members take each and
 * how many keep their own value (an override). `changes` uses the model's field names (custom values
 * as `cf_<key>`).
 */
export async function previewChange(ctx: ModuleContext, kind: ModelKind, model: Row, changes: Row) {
  const fields = await inheritedFields(ctx, kind);
  const labels = await fieldLabels(ctx, kind);
  const next: Row = { ...model, inherited_custom: { ...(model.inherited_custom ?? {}) } };
  const changed: string[] = [];
  for (const f of fields) {
    if (!(f in changes)) continue;
    const v = changes[f] === '' ? null : changes[f];
    if (same(modelValue(model, f), v)) continue;
    changed.push(f);
    if (isCustom(f)) next.inherited_custom[customKey(f)] = v; else next[f] = v;
  }
  const members = await membersOf(ctx, kind, model.id);
  const def = ctx.resources.get(kind.memberType)!;
  let changing = 0;
  const perField = changed.map((f) => ({ field: f, label: labels[f] ?? f, changes: 0, keeps: 0 }));
  const keeping: { id: string; label: string; fields: string[] }[] = [];
  for (const m of members) {
    const overrides: string[] = Array.isArray(m.model_overrides) ? m.model_overrides : [];
    const patch = memberPatch(m, next, changed);
    if (Object.keys(patch).length) changing++;
    const kept = changed.filter((f) => overrides.includes(f));
    if (kept.length) keeping.push({ id: m.id, label: memberLabel(def, m), fields: kept.map((f) => labels[f] ?? f) });
    for (const p of perField) {
      if (p.field in patch) p.changes++;
      if (overrides.includes(p.field)) p.keeps++;
    }
  }
  const threshold = await backgroundAfter(ctx);
  return {
    members: members.length, changing, fields: perField, keeping: keeping.slice(0, 100), keepingTotal: keeping.length,
    background: changing > threshold,
  };
}

export async function backgroundAfter(ctx: ModuleContext): Promise<number> {
  const n = Number(await ctx.settings.get<number>(BACKGROUND_SETTING, BACKGROUND_DEFAULT));
  return Number.isFinite(n) && n >= 0 ? n : BACKGROUND_DEFAULT;
}

/** A model change's log row as the API gives it. */
export async function changeRow(ctx: ModuleContext, id: string): Promise<Row | undefined> {
  return ctx.db.one<Row>(
    `select c.id, c.model_type, c.model_id, c.kind, c.fields, c.status, c.total, c.applied, c.kept, c.refused, c.job_id,
            c.created_at, c.finished_at, u.display_name as created_by_name
     from model_changes c left join users u on u.id = c.created_by where c.id = $1`, [id]);
}

/**
 * A model was saved with new values for `fields`: each member that does not override a field takes
 * the new value through the normal update path (its type's rules, lifecycles, hooks, audit, history
 * and webhooks; the audit line says it came from the model). A member whose own rules refuse the value
 * is listed and left unchanged. More than `models.background_after` members: a background job does it
 * with progress. Answers the change's log row.
 */
export async function startChange(ctx: ModuleContext, kind: ModelKind, model: Row, fields: string[], req: FastifyRequest | null, opts: { changeKind?: string } = {}): Promise<Row | undefined> {
  if (!fields.length) return undefined;
  const members = await membersOf(ctx, kind, model.id);
  const targets = members.filter((m) => Object.keys(memberPatch(m, model, fields)).length);
  const kept = members.filter((m) => fields.some((f) => (Array.isArray(m.model_overrides) ? m.model_overrides : []).includes(f))).length;
  const background = targets.length > (await backgroundAfter(ctx));
  const log = (await ctx.db.one<{ id: string }>(
    `insert into model_changes (model_type, model_id, kind, fields, status, total, kept, created_by)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8) returning id`,
    [kind.modelType, model.id, opts.changeKind ?? 'change', JSON.stringify(fields), background ? 'queued' : 'running', targets.length, kept, req?.user?.id ?? null]))!;
  if (background && ctx.app.jobs) {
    const job = await ctx.app.jobs.enqueue(kind.jobType, { changeId: log.id, userId: req?.user?.id ?? null });
    await ctx.db.query('update model_changes set job_id = $2 where id = $1', [log.id, job.id ?? null]);
    return changeRow(ctx, log.id);
  }
  await runChange(ctx, kind, log.id, req, null);
  return changeRow(ctx, log.id);
}

/**
 * Applies a logged change to the model's members, now. With a request the person's rules apply as for
 * any save; in a job (no request) the person who saved the model is checked against the lifecycle
 * rules before each member is saved as system work on their behalf.
 */
export async function runChange(ctx: ModuleContext, kind: ModelKind, changeId: string, req: FastifyRequest | null, onProgress: ((done: number, of: number) => Promise<void>) | null): Promise<Row | undefined> {
  const change = await ctx.db.one<Row>('select * from model_changes where id = $1', [changeId]);
  const def = ctx.resources.get(kind.memberType);
  if (!change || !def) return undefined;
  const model = await modelRow(ctx, kind, change.model_id);
  if (!model) {
    await ctx.db.query(`update model_changes set status = 'failed', finished_at = now() where id = $1`, [changeId]);
    return changeRow(ctx, changeId);
  }
  await ctx.db.query(`update model_changes set status = 'running' where id = $1`, [changeId]);
  const user: SessionUser | null = req?.user ?? (change.created_by ? await loadUser(ctx.db, change.created_by) : null);
  const fields: string[] = Array.isArray(change.fields) ? change.fields : [];
  const members = await membersOf(ctx, kind, model.id);
  const targets = members.map((m) => ({ m, patch: memberPatch(m, model, fields) })).filter((t) => Object.keys(t.patch).length);
  const via = `${kind.label.toLowerCase()} ${model.name}`;
  const refused: Refusal[] = [];
  let applied = 0;
  for (const [i, { m, patch }] of targets.entries()) {
    try {
      if (!req && user) {
        const problems = await ctx.app.lifecycles.check(def, m, patch, { user, apiToken: null } as unknown as FastifyRequest);
        if (Object.keys(problems).length) throw Object.assign(new Error('refused'), { fields: problems });
      }
      await ctx.resources.update(kind.memberType, m.id, patch, req, { via });
      applied++;
    } catch (err) {
      refused.push({ id: m.id, label: memberLabel(def, m), message: refusalText(err) });
    }
    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      await ctx.db.query('update model_changes set applied = $2, refused = $3::jsonb where id = $1', [changeId, applied, JSON.stringify(refused.slice(0, 500))]);
      await onProgress?.(i + 1, targets.length);
    }
  }
  await ctx.db.query(
    `update model_changes set status = 'done', total = $2, applied = $3, refused = $4::jsonb, finished_at = now() where id = $1`,
    [changeId, targets.length, applied, JSON.stringify(refused.slice(0, 500))]);
  return changeRow(ctx, changeId);
}

/** The reason a member refused a change, in words a person can act on. */
export function refusalText(err: unknown): string {
  const e = err as { message?: string; fields?: Record<string, string>; body?: { error?: { fields?: Record<string, string>; message?: string } } };
  const fields = e.fields ?? e.body?.error?.fields;
  if (fields && Object.keys(fields).length) return Object.values(fields).join(' ');
  return e.body?.error?.message ?? e.message ?? 'Refused.';
}
