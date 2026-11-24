import type { FastifyRequest } from 'fastify';
import { loadUser } from '../../core/auth.ts';
import { CUSTOM_PREFIX } from '../../core/customfields.ts';
import { UUID_RE } from '../../core/errors.ts';
import { intersectGrants, tokenScopes } from '../../core/tokens.ts';
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

/** A model that is not removed; anything that is not a well-formed id is "not found" without asking the database (W19 review). */
export async function modelRow(ctx: ModuleContext, kind: ModelKind, id: unknown): Promise<Row | undefined> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return undefined;
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
  if (!model) {
    // The member's own model is gone (removed in a race with an assignment, or removed for good): the
    // member keeps its values as its own and has no model, so it can still be saved (W19 review).
    if (existing?.model_id && modelId === existing.model_id) {
      input.model_id = null;
      input.model_overrides = [];
      return input;
    }
    invalid(ctx, { model_id: `${kind.label} not found.` });
  }
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

/** Why a background change stopped when its job was skipped or gave up (W19 review). */
function stoppedReason(kind: ModelKind, skipped: boolean): string {
  if (!skipped) return 'The background job ended before the change was finished. Save the model again to apply it.';
  return kind.key === 'vehicle'
    ? 'Fleet and services was switched off before the change ran. Save the model again to apply it.'
    : 'Its area was switched off before the change ran. Save the model again to apply it.';
}

/**
 * A model change's log row as the API gives it. A waiting or running change whose job was skipped
 * (its area switched off) or gave up is marked stopped here, so it does not wait for ever.
 */
export async function changeRow(ctx: ModuleContext, id: string): Promise<Row | undefined> {
  const stale = await ctx.db.one<{ id: string; model_type: string; skipped: boolean }>(
    `select c.id, c.model_type, coalesce(j.result->>'skipped', '') = 'switched_off' as skipped
     from model_changes c join jobs j on j.id = c.job_id
     where c.id = $1 and c.status in ('queued', 'running')
       and (j.status = 'dead' or (j.status = 'done' and j.result->>'skipped' = 'switched_off')
         -- the job finished a while ago and no later run of the model's job is left to take the change
         or (j.status = 'done' and j.finished_at < now() - interval '1 minute' and not exists (
           select 1 from jobs l where l.dedupe_key = c.model_type || ':' || c.model_id::text and l.status in ('queued', 'failed', 'running'))))`, [id]);
  if (stale) {
    const kind = kindOfModel(stale.model_type);
    if (kind) {
      await ctx.db.query(
        `update model_changes set status = 'stopped', reason = $2, finished_at = now() where id = $1 and status in ('queued', 'running')`,
        [id, stoppedReason(kind, stale.skipped)]);
    }
  }
  return ctx.db.one<Row>(
    `select c.id, c.model_type, c.model_id, c.kind, c.fields, c.status, c.reason, c.total, c.applied, c.kept, c.refused, c.job_id,
            c.created_at, c.finished_at, u.display_name as created_by_name
     from model_changes c left join users u on u.id = c.created_by where c.id = $1`, [id]);
}

/** One background change per model at a time: the job queue's key for a model (W19 review). */
export const changeKey = (kind: ModelKind, modelId: string) => `${kind.modelType}:${modelId}`;

/**
 * A model was saved with new values for `fields`: each member that does not override a field takes
 * the new value through the normal update path (its type's rules, lifecycles, hooks, audit, history
 * and webhooks; the audit line says it came from the model). A member whose own rules refuse the value
 * is listed and left unchanged. More than `models.background_after` members: a background job does it
 * with progress, saving each member as the person who saved the model. A newer background change of
 * the same model takes over the fields of one still waiting (marked superseded), and the model has
 * one background job at a time. Answers the change's log row.
 */
export async function startChange(ctx: ModuleContext, kind: ModelKind, model: Row, fields: string[], req: FastifyRequest | null, opts: { changeKind?: string } = {}): Promise<Row | undefined> {
  if (!fields.length) return undefined;
  const threshold = await backgroundAfter(ctx);
  const members = await membersOf(ctx, kind, model.id);
  const targetsOf = (fs: string[]) => members.filter((m) => Object.keys(memberPatch(m, model, fs)).length);
  const keptOf = (fs: string[]) => members.filter((m) => fs.some((f) => (Array.isArray(m.model_overrides) ? m.model_overrides : []).includes(f))).length;
  const background = targetsOf(fields).length > threshold && Boolean(ctx.app.jobs);
  let all = fields;
  if (background) {
    // Changes of this model still waiting: this one takes their fields over (the members take the
    // model's values as they are when the job runs), and they are marked superseded.
    const waiting = await ctx.db.query<{ id: string; fields: string[] }>(
      `update model_changes set status = 'superseded', reason = 'A newer change of the model replaced it.', finished_at = now()
       where model_type = $1 and model_id = $2 and status = 'queued' returning id, fields`, [kind.modelType, model.id]);
    all = [...new Set([...fields, ...waiting.flatMap((w) => (Array.isArray(w.fields) ? w.fields : []))])];
  }
  // Saved with an access token: the token and its scopes go with the change, so a background job
  // works within them, not with the person's full permissions (E40-13).
  const token = req?.apiToken ?? null;
  const log = (await ctx.db.one<{ id: string }>(
    `insert into model_changes (model_type, model_id, kind, fields, status, total, kept, created_by, via_token_id, via_token_name, via_token_scopes)
     values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11::jsonb) returning id`,
    [kind.modelType, model.id, opts.changeKind ?? 'change', JSON.stringify(all), background ? 'queued' : 'running', targetsOf(all).length, keptOf(all), req?.user?.id ?? null,
      token && UUID_RE.test(String(token.id)) ? token.id : null, token?.name ?? null, token ? JSON.stringify(req ? tokenScopes(req) ?? [] : []) : null]))!;
  if (background) {
    const key = changeKey(kind, model.id);
    // A job of this model already waiting runs the waiting change; one already running runs once more after it.
    const job = await ctx.app.jobs.enqueue(kind.jobType, { modelId: model.id, changeId: log.id }, { key, rerunIfRunning: true });
    const jobId = job.id ?? (await ctx.db.one<{ id: string }>(
      `select id from jobs where dedupe_key = $1 and status in ('queued', 'failed', 'running') order by created_at desc limit 1`, [key]))?.id ?? null;
    await ctx.db.query('update model_changes set job_id = $2 where id = $1', [log.id, jobId]);
    return changeRow(ctx, log.id);
  }
  await runChange(ctx, kind, log.id, req, null);
  return changeRow(ctx, log.id);
}

/**
 * The person a background change works as: the one who saved the model, reloaded now. A change saved
 * with an access token works within that token's scopes (E40-13), and stops when the token has since
 * been revoked or has expired. Null when the account can no longer sign in, the token is no longer
 * valid, or what remains does not hold `<module>.edit` (the change then stops).
 */
async function actingPerson(ctx: ModuleContext, kind: ModelKind, change: Row): Promise<SessionUser | null> {
  const user = await loadUser(ctx.db, change.created_by);
  if (!user) return null;
  let acting: SessionUser = user;
  if (change.via_token_id || Array.isArray(change.via_token_scopes)) {
    if (change.via_token_id) {
      // A personal access token still has to be valid; a token of another kind is held to its scopes.
      const t = await ctx.db.one<{ valid: boolean }>(
        'select (revoked_at is null and expires_at > now()) as valid from api_tokens where id = $1', [change.via_token_id]);
      if (t && !t.valid) return null;
    }
    const scopes = Array.isArray(change.via_token_scopes) ? change.via_token_scopes.map(String) : [];
    acting = { ...user, permissions: intersectGrants(scopes, user.permissions) };
  }
  return ctx.can(acting, `${kind.module}.edit`) ? acting : null;
}

/**
 * A request standing for that person, so each member is saved under their rules and named in the
 * audit (W19 review), with the token the change was saved with (E40-13).
 */
const onBehalfOf = (user: SessionUser, change: Row): FastifyRequest =>
  ({ user, apiToken: change.via_token_id ? { id: change.via_token_id, name: change.via_token_name ?? '' } : null, headers: {}, ip: null, id: `model-change-${change.id}` }) as unknown as FastifyRequest;

/**
 * Applies a logged change to the model's members, now. With a request the person's rules apply as for
 * any save. In a job (no request) the change must still be waiting; the person who saved the model is
 * reloaded, and the change stops when they can no longer sign in or edit the area (checked again
 * every 25 members); otherwise each member is saved as that person, with their rules, lifecycles and
 * name in the audit. A change with no person (system work) is saved as system work.
 */
export async function runChange(ctx: ModuleContext, kind: ModelKind, changeId: string, req: FastifyRequest | null, onProgress: ((done: number, of: number) => Promise<void>) | null, jobId: string | null = null): Promise<Row | undefined> {
  const change = await ctx.db.one<Row>('select * from model_changes where id = $1', [changeId]);
  const def = ctx.resources.get(kind.memberType);
  if (!change || !def) return undefined;
  if (!req && change.status !== 'queued') return changeRow(ctx, changeId); // superseded, stopped or already done
  const stop = async (reason: string, status = 'stopped') => {
    await ctx.db.query(`update model_changes set status = $2, reason = $3, finished_at = now() where id = $1`, [changeId, status, reason]);
    return changeRow(ctx, changeId);
  };
  const model = await modelRow(ctx, kind, change.model_id);
  if (!model) return stop('The model was removed before the change ran.', 'failed');
  let as: FastifyRequest | null = req;
  const lostReason = change.via_token_id || change.via_token_scopes
    ? 'The person who saved the model can no longer sign in or edit this area, or the access token it was saved with no longer allows it, so the rest of the change was not applied.'
    : 'The person who saved the model can no longer sign in or edit this area, so the rest of the change was not applied.';
  if (!req && change.created_by) {
    const user = await actingPerson(ctx, kind, change);
    if (!user) return stop(lostReason);
    as = onBehalfOf(user, change);
  }
  await ctx.db.query(`update model_changes set status = 'running', job_id = coalesce($2, job_id) where id = $1`, [changeId, jobId]);
  const fields: string[] = Array.isArray(change.fields) ? change.fields : [];
  const members = await membersOf(ctx, kind, model.id);
  const targets = members.map((m) => ({ m, patch: memberPatch(m, model, fields) })).filter((t) => Object.keys(t.patch).length);
  const via = `${kind.label.toLowerCase()} ${model.name}`;
  const refused: Refusal[] = [];
  let applied = 0;
  for (const [i, { m, patch }] of targets.entries()) {
    try {
      await ctx.resources.update(kind.memberType, m.id, patch, as, { via });
      applied++;
    } catch (err) {
      refused.push({ id: m.id, label: memberLabel(def, m), message: refusalText(err) });
    }
    if ((i + 1) % 25 === 0 || i + 1 === targets.length) {
      await ctx.db.query('update model_changes set applied = $2, refused = $3::jsonb where id = $1', [changeId, applied, JSON.stringify(refused.slice(0, 500))]);
      await onProgress?.(i + 1, targets.length);
      if (!req && change.created_by && i + 1 < targets.length && !(await actingPerson(ctx, kind, change))) return stop(lostReason);
    }
  }
  await ctx.db.query(
    `update model_changes set status = 'done', total = $2, applied = $3, refused = $4::jsonb, finished_at = now() where id = $1`,
    [changeId, targets.length, applied, JSON.stringify(refused.slice(0, 500))]);
  return changeRow(ctx, changeId);
}

/** The background job: every change of the model still waiting, oldest first (normally one). */
export async function runWaitingChanges(ctx: ModuleContext, kind: ModelKind, payload: Row, jobId: string, onProgress: (done: number, of: number) => Promise<void>): Promise<Row | null> {
  let modelId = typeof payload.modelId === 'string' ? payload.modelId : null;
  if (!modelId && typeof payload.changeId === 'string' && UUID_RE.test(payload.changeId)) {
    modelId = (await ctx.db.one<{ model_id: string }>('select model_id from model_changes where id = $1', [payload.changeId]))?.model_id ?? null;
  }
  if (!modelId || !UUID_RE.test(modelId)) return null;
  const waiting = await ctx.db.query<{ id: string }>(
    `select id from model_changes where model_type = $1 and model_id = $2 and status = 'queued' order by created_at`, [kind.modelType, modelId]);
  let last: Row | undefined;
  for (const w of waiting) last = await runChange(ctx, kind, w.id, null, onProgress, jobId);
  return last ? { applied: last.applied, refused: Array.isArray(last.refused) ? last.refused.length : 0, total: last.total, status: last.status } : null;
}

/** The reason a member refused a change, in words a person can act on. */
export function refusalText(err: unknown): string {
  const e = err as { message?: string; fields?: Record<string, string>; body?: { error?: { fields?: Record<string, string>; message?: string } } };
  const fields = e.fields ?? e.body?.error?.fields;
  if (fields && Object.keys(fields).length) return Object.values(fields).join(' ');
  return e.body?.error?.message ?? e.message ?? 'Refused.';
}
