import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { allTaggables, taggable, type TaggableDef } from '../../core/asset-tags.ts';
import type { Queryable } from '../../core/db.ts';
import { UUID_RE } from '../../core/errors.ts';
import { holdsOn } from '../../core/holds.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { onAnonymize } from '../../core/retention.ts';
import { TAG_SETTINGS } from '../../../../shared/asset-tags-api.ts';
import type { AttachRequest, EndRequest, RecordTags, ReplaceRequest, TagAssignmentView } from '../../../../shared/asset-tags-api.ts';
import { cleanValue, firstMatchingFormat, formatsFor, MAX_TAG_VALUE, valueKey, type TagSource } from '../../../../shared/tag-format.ts';
import { activeByKey, assignmentViews, invalid, isUniqueViolation, loadFormats, tagsOn, type AssignmentRow } from './common.ts';
import { lastVerified } from './counts.ts';
import { lastSeen } from './history.ts';
import { stockStatus } from './stock.ts';

// Tag values on records (E37-01) and attach, replace and end (E37-07). Owned by TAGS-CORE.
//
// `tag_assignments` is the source of truth: its partial unique index on `value_key` where the status is
// active makes a value active on one record at most, across every taggable type, under concurrent
// writes. The record's tag field (assets `tag`, others `tag_number`) holds a copy of its primary active
// value. Every change of the primary value goes through the record's own update (the hooks below), so
// a form edit, an import, a bulk edit, the app and the attach/replace/end routes behave alike:
// a new value is claimed (or refused), the earlier one is marked replaced, a cleared one is ended.
// While the Asset tags area is off nothing is claimed; the reconcile step catches up when it is on.

const TAG_SOURCES: TagSource[] = ['code', 'text', 'typed', 'handheld'];
const END_STATUSES = ['void', 'lost', 'ended'] as const;
const MAX_REASON = 500;
/** A claim whose record was never written (a create that failed) is free after this long. */
const ORPHAN_MINUTES = 10;

/** What a route asks of the record update it makes (read by the hooks). */
interface TagOp {
  kind: 'attach' | 'replace' | 'end';
  source: TagSource | 'import' | 'system';
  reason?: string | null;
  endStatus?: 'void' | 'lost' | 'ended';
}
const opStore = new AsyncLocalStorage<TagOp>();

/** Record type -> table, for every registered taggable type (filled once the application is ready). */
const tablesByApp = new WeakMap<object, Map<string, string>>();

/** Other parts of the tags module that keep per-record rows (the lookup log) add their anonymization here. */
type TaggableAnonymizer = (tx: { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }, recordType: string, recordId: string) => Promise<unknown>;
const anonymizers: TaggableAnonymizer[] = [];
/**
 * Runs `fn` when a taggable record is anonymized, in the same transaction (core keeps one
 * `onAnonymize` hook per type; the tags module owns that hook for the taggable types). Call it in
 * `register`.
 */
export function onTaggableAnonymize(fn: TaggableAnonymizer): void {
  if (!anonymizers.includes(fn)) anonymizers.push(fn);
}

const conflictMessage = (value: string) => `Tag ${value} is already in use.`;

/** The person's request, or null for system work. */
type Req = FastifyRequest | null;

async function auditTag(ctx: ModuleContext, req: Req, action: string, def: TaggableDef, recordId: string, summary: string, before: unknown, after: unknown) {
  await ctx.audit(req, { action, recordType: def.type, recordId, summary, before, after });
}

/** Refuses any change to the tags of a record under an active legal hold (references only). */
async function assertTagsNotHeld(ctx: ModuleContext, type: string, id: string): Promise<void> {
  const holds = await holdsOn(ctx.db, type, id);
  if (holds.length) ctx.fail(409, 'on_hold', `This record is under a legal hold (${holds.map((h) => h.ref).join(', ')}), so its tags cannot be attached, replaced or ended.`);
}

/**
 * Checks a value a person gives for a record: its length, the tag formats for the type (typed values
 * only: a decoded code is exact, text read by the app was confirmed by the person) and void or lost
 * stock marks. Returns the cleaned value and the format it matched, if any.
 */
async function checkValue(ctx: ModuleContext, type: string, raw: unknown, source: TagOp['source'], field: string): Promise<{ value: string; key: string; formatId: string | null }> {
  const value = cleanValue(raw);
  if (!value) invalid(ctx, { [field]: 'Enter a tag number.' });
  if (value.length > MAX_TAG_VALUE) invalid(ctx, { [field]: `A tag number has at most ${MAX_TAG_VALUE} characters.` });
  const key = valueKey(value);
  if (!key) invalid(ctx, { [field]: 'Enter a tag number with letters or digits.' });
  const formats = formatsFor(await loadFormats(ctx.db, { activeOnly: true }), type);
  const match = formats.length ? firstMatchingFormat(value, formats, source === 'import' || source === 'system' ? 'typed' : source) : null;
  if (formats.length && !match && (source === 'typed' || source === 'handheld')) {
    invalid(ctx, { [field]: `Tag ${value} does not match any tag format for this kind of record (${formats.map((f) => f.name).join(', ')}).` });
  }
  const st = await stockStatus(ctx.db, key);
  if (st.mark) invalid(ctx, { [field]: `Tag ${value} is marked ${st.mark} in your tag stock. Mark it available again first.` });
  return { value, key, formatId: match?.format.id ?? null };
}

export async function registerAssignments(ctx: ModuleContext): Promise<void> {
  const { app, db } = ctx;
  const tables = new Map<string, string>();
  tablesByApp.set(app, tables);

  /** Whether a claimed record no longer stands: removed, or never written (after a while). */
  async function stale(a: AssignmentRow): Promise<boolean> {
    const table = tables.get(a.record_type);
    if (!table) return false;
    const row = await db.one<{ deleted: boolean; old: boolean }>(
      `select (select deleted_at is not null from ${table} where id = $1) as deleted,
              (select assigned_at < now() - interval '${ORPHAN_MINUTES} minutes' from tag_assignments where id = $2) as old`, [a.record_id, a.id]);
    if (row?.deleted === true) return true;
    return row?.deleted === null && row.old === true;
  }

  /**
   * Makes `value` active on the record, or refuses: 409 `in_use` from the tag routes, 400 `validation`
   * on the record's field otherwise; the same answer whether or not the caller may see the other record.
   */
  async function claim(def: TaggableDef, recordId: string, v: { value: string; key: string; formatId: string | null }, primary: boolean, req: Req, source: string): Promise<AssignmentRow> {
    // In its own (sub)transaction, so a refused insert never spoils an import's dry run.
    const insert = () => db.tx((tx) => tx.one<AssignmentRow>(
      `insert into tag_assignments (value, value_key, record_type, record_id, status, is_primary, source, format_id, assigned_by)
       values ($1, $2, $3, $4, 'active', $5, $6, $7, $8) returning *`,
      [v.value, v.key, def.type, recordId, primary, source, v.formatId, req?.user?.id ?? null]));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return (await insert())!;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const holder = await activeByKey(db, v.key);
        if (holder && holder.record_type === def.type && holder.record_id === recordId) {
          if (primary && !holder.is_primary) await db.query('update tag_assignments set is_primary = true where id = $1', [holder.id]);
          return { ...holder, is_primary: primary || holder.is_primary };
        }
        if (attempt === 0 && holder && await stale(holder)) {
          await db.query(`update tag_assignments set status = 'ended', is_primary = false, ended_at = now(), reason = 'The record was removed or never saved' where id = $1 and status = 'active'`, [holder.id]);
          continue;
        }
        if (opStore.getStore()) ctx.fail(409, 'in_use', conflictMessage(v.value));
        invalid(ctx, { [def.field]: conflictMessage(v.value) });
      }
    }
    return ctx.fail(409, 'in_use', conflictMessage(v.value));
  }

  /** The record's active assignments, primary first. */
  const activeOf = (type: string, id: string) => db.query<AssignmentRow>(
    `select * from tag_assignments where record_type = $1 and record_id = $2 and status = 'active' order by is_primary desc, assigned_at`, [type, id]);

  /** Ends an assignment; promotes the record's next active value to primary when the primary ended. Returns the new primary value. */
  async function endAssignment(a: AssignmentRow, status: 'void' | 'lost' | 'ended' | 'replaced', reason: string | null, req: Req, replacedBy: string | null = null): Promise<string | null> {
    await db.query(
      `update tag_assignments set status = $2, is_primary = false, ended_at = now(), ended_by = $3, reason = $4, replaced_by = $5 where id = $1 and status = 'active'`,
      [a.id, status, req?.user?.id ?? null, reason, replacedBy]);
    if (!a.is_primary) return null;
    const next = (await activeOf(a.record_type, a.record_id))[0];
    if (!next) return null;
    await db.query('update tag_assignments set is_primary = true where id = $1', [next.id]);
    return next.value;
  }

  // ---------- the record hooks ----------

  /** A new record: claim its value (or, for assets numbered automatically, a free number). */
  async function onCreate(def: ResourceDef, t: TaggableDef, req: Req, data: Row): Promise<Row> {
    if (!(await tagsOn(db))) return data;
    const op = opStore.getStore();
    const source = op?.source ?? (req ? 'typed' : 'system');
    let given = cleanValue(data[t.field]);
    if (!given && def.ref?.field === t.field) {
      // The record's reference is its tag (assets, AST-00001): number it here, skipping values in use elsewhere.
      for (let i = 0; i < 1000 && !given; i += 1) {
        const n = await db.one<{ value: number }>(
          `insert into counters (key, value) values ($1, 1) on conflict (key) do update set value = counters.value + 1 returning value`, [def.ref.prefix]);
        const candidate = `${def.ref.prefix}${String(n!.value).padStart(5, '0')}`;
        if (!(await activeByKey(db, valueKey(candidate)))) given = candidate;
      }
      data[t.field] = given;
      if (!given) return data;
      data.id ??= randomUUID();
      await claim(t, String(data.id), { value: given, key: valueKey(given), formatId: null }, true, req, 'system');
      return data;
    }
    if (!given) { if (t.field in data) data[t.field] = null; return data; }
    const v = await checkValue(ctx, t.type, given, req || op ? source : 'system', t.field);
    data[t.field] = v.value;
    data.id ??= randomUUID();
    if (!UUID_RE.test(String(data.id))) return data;
    await claim(t, String(data.id), v, true, req, source);
    await auditTag(ctx, req, 'tag.attach', t, String(data.id), `Tag ${v.value} attached`, null, { value: v.value, source });
    return data;
  }

  /** A change of the record's tag field: claim the new value, mark the earlier one replaced, or end it. */
  async function onUpdate(t: TaggableDef, req: Req, existing: Row, patch: Row): Promise<Row> {
    if (!(t.field in patch) || !(await tagsOn(db))) return patch;
    const op = opStore.getStore();
    const source = op?.source ?? (req ? 'typed' : 'system');
    const id = String(existing.id);
    const newValue = cleanValue(patch[t.field]);
    const newKey = valueKey(newValue);
    const active = await activeOf(t.type, id);
    const primary = active.find((a) => a.is_primary) ?? null;
    const currentKey = primary?.value_key ?? valueKey(existing[t.field]);
    if (newKey === currentKey && (primary || !newKey)) {
      patch[t.field] = newValue || null;
      return patch;
    }
    if (!primary && !op && newKey === valueKey(existing[t.field])) {
      // An unchanged value that is not claimed yet (written while the area was off, or on two records
      // before asset tags existed): claim it when free, and never let it stop an edit of other fields.
      try { await claim(t, id, { value: newValue, key: newKey, formatId: null }, true, null, 'import'); } catch { /* left to the reconcile report */ }
      patch[t.field] = newValue;
      return patch;
    }
    await assertTagsNotHeld(ctx, t.type, id);
    if (!newKey) {
      // Cleared: the primary value ends (void, lost or ended); another active value takes its place.
      patch[t.field] = null;
      if (primary) {
        const status = op?.endStatus ?? 'ended';
        const reason = op?.reason ?? (op ? null : 'Cleared from the record');
        const next = await endAssignment(primary, status, reason, req);
        patch[t.field] = next;
        await auditTag(ctx, req, 'tag.end', t, id, `Tag ${primary.value} ended (${status})${reason ? `: ${reason}` : ''}`,
          { value: primary.value, status: 'active' }, { value: primary.value, status, reason });
      }
      return patch;
    }
    const own = active.find((a) => a.value_key === newKey);
    if (own) {
      // One of the record's other active values becomes the one shown.
      await db.query('update tag_assignments set is_primary = (id = $2) where record_type = $3 and record_id = $1 and status = \'active\'', [id, own.id, t.type]);
      patch[t.field] = own.value;
      return patch;
    }
    const v = await checkValue(ctx, t.type, newValue, req || op ? source : 'system', t.field);
    const claimed = await claim(t, id, v, true, req, source);
    patch[t.field] = v.value;
    if (primary) {
      const reason = op?.reason ?? null;
      await endAssignment({ ...primary, is_primary: false }, 'replaced', reason, req, claimed.id);
      await auditTag(ctx, req, 'tag.replace', t, id, `Tag ${primary.value} replaced by ${v.value}${reason ? `: ${reason}` : ''}`,
        { value: primary.value }, { value: v.value, source, reason });
    } else {
      await auditTag(ctx, req, 'tag.attach', t, id, `Tag ${v.value} attached`, null, { value: v.value, source });
    }
    return patch;
  }

  const wrapped = new WeakSet<ResourceDef>();
  app.addHook('onReady', async () => {
    for (const t of allTaggables(app)) {
      const def = ctx.resources.get(t.type);
      if (!def) continue;
      tables.set(t.type, def.table);
      if (wrapped.has(def)) continue;
      wrapped.add(def);
      const own = def.hooks ?? {};
      def.hooks = {
        ...own,
        beforeCreate: async (req: Req, data: Row) => onCreate(def, t, req, own.beforeCreate ? await own.beforeCreate(req, data) : data),
        beforeUpdate: async (req: Req, existing: Row, patch: Row) => onUpdate(t, req, existing, own.beforeUpdate ? await own.beforeUpdate(req, existing, patch) : patch),
      };
      // Anonymizing a record ends its tags (the asset's tag stays as its reference; other fields are cleared).
      const field = def.ref?.field === t.field ? null : t.field;
      const table = def.table;
      onAnonymize(t.type, async (tx, id) => {
        await tx.query(`update tag_assignments set status = 'ended', is_primary = false, ended_at = now(), reason = 'Record anonymized' where record_type = $1 and record_id = $2 and status = 'active'`, [t.type, id]);
        if (field) await tx.query(`update ${table} set ${field} = null where id = $1`, [id]);
        for (const fn of anonymizers) await fn(tx, t.type, id);
      }, 'tags.assignments');
    }
    try {
      const r = await reconcile();
      if (r.clashes.length) console.warn(`[tags] ${r.clashes.length} tag value(s) are on more than one record and were not claimed: ${r.clashes.slice(0, 10).join(', ')}`);
    } catch (err) {
      console.error('[tags] reconciling tag values failed:', err);
    }
  });

  // Deleting or removing a record for good ends its tags (core refuses both for a held record).
  ctx.resources.onChange?.(async (change) => {
    if ((change.action !== 'delete' && change.action !== 'purge') || !tables.has(change.def.type)) return;
    await db.query(
      `update tag_assignments set status = 'ended', is_primary = false, ended_at = now(), ended_by = $3, reason = $4
       where record_type = $1 and record_id = $2 and status = 'active'`,
      [change.def.type, change.row.id, change.req?.user?.id ?? null, change.action === 'delete' ? 'Record deleted' : 'Record removed for good']);
  });

  /**
   * Brings `tag_assignments` in step with the records' tag fields: values written while the area was off
   * or before asset tags existed (existing asset tags are claimed, so they are unique across types from
   * the start), deleted records and claims whose record was never saved. A value already active on
   * another record is reported, never moved.
   */
  async function reconcile(): Promise<{ claimed: number; ended: number; clashes: string[] }> {
    const out = { claimed: 0, ended: 0, clashes: [] as string[] };
    if (!(await tagsOn(db))) return out;
    for (const t of allTaggables(app)) {
      const table = tables.get(t.type);
      if (!table) continue;
      const exists = await db.one<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`]);
      if (!exists?.t) continue;
      const rows = await db.query<{ id: string; v: string | null; deleted: boolean }>(
        `select r.id, r.${t.field}::text as v, r.deleted_at is not null as deleted from ${table} r
         where (r.deleted_at is null and r.${t.field} is not null and r.${t.field} <> '')
            or exists (select 1 from tag_assignments a where a.record_type = $1 and a.record_id = r.id and a.status = 'active')`, [t.type]);
      const active = await db.query<AssignmentRow>(`select * from tag_assignments where record_type = $1 and status = 'active' order by assigned_at`, [t.type]);
      const byRecord = new Map<string, AssignmentRow[]>();
      for (const a of active) byRecord.set(a.record_id, [...(byRecord.get(a.record_id) ?? []), a]);
      const ever = new Set((await db.query<{ k: string }>(
        `select record_id::text || ' ' || value_key as k from tag_assignments where record_type = $1`, [t.type])).map((x) => x.k));
      const seen = new Set<string>();
      for (const r of rows) {
        seen.add(r.id);
        const mine = byRecord.get(r.id) ?? [];
        if (r.deleted) {
          for (const a of mine) { await endAssignment({ ...a, is_primary: false }, 'ended', 'Record deleted', null); out.ended += 1; }
          continue;
        }
        const key = valueKey(r.v);
        const primary = mine.find((a) => a.is_primary) ?? null;
        if (!key) {
          if (primary) {
            const next = await endAssignment(primary, 'ended', 'Cleared from the record', null);
            if (next) await db.query(`update ${table} set ${t.field} = $2 where id = $1`, [r.id, next]);
            out.ended += 1;
          }
          continue;
        }
        if (primary?.value_key === key) continue;
        if (ever.has(`${r.id} ${key}`) && !mine.some((a) => a.value_key === key)) continue; // ended on purpose (anonymized, ended)
        const own = mine.find((a) => a.value_key === key);
        if (own) { await db.query('update tag_assignments set is_primary = (id = $2) where record_type = $3 and record_id = $1 and status = \'active\'', [r.id, own.id, t.type]); continue; }
        const value = cleanValue(r.v).slice(0, MAX_TAG_VALUE);
        let claimed: AssignmentRow | undefined;
        try {
          claimed = await db.tx((tx) => tx.one<AssignmentRow>(
            `insert into tag_assignments (value, value_key, record_type, record_id, status, is_primary, source) values ($1, $2, $3, $4, 'active', true, 'import') returning *`,
            [value, key, t.type, r.id]));
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
          out.clashes.push(value);
          continue;
        }
        out.claimed += 1;
        if (primary) await endAssignment({ ...primary, is_primary: false }, 'replaced', 'Changed while asset tags were off', null, claimed!.id);
      }
      // Claims whose record row never existed (a create that failed), after a while.
      for (const [recordId, mine] of byRecord) {
        if (seen.has(recordId)) continue;
        const there = await db.one(`select 1 from ${table} where id = $1`, [recordId]);
        if (there) continue;
        for (const a of mine) {
          const old = await db.one(`select 1 from tag_assignments where id = $1 and assigned_at < now() - interval '${ORPHAN_MINUTES} minutes'`, [a.id]);
          if (old) { await endAssignment({ ...a, is_primary: false }, 'ended', 'The record was never saved', null); out.ended += 1; }
        }
      }
    }
    return out;
  }
  await scheduleWork(ctx, 'tags.reconcile', () => reconcile(), { every: 24 * 3_600_000, firstRunInMs: 3_600_000 });

  // ---------- routes ----------

  /** The taggable type and the record, when the caller may see it; else 404 (the same for hidden and missing). */
  async function recordFor(req: FastifyRequest, type: unknown, id: unknown): Promise<{ t: TaggableDef; def: ResourceDef; row: Row }> {
    const t = typeof type === 'string' ? taggable(app, ctx.resources, type) : undefined;
    const def = t ? ctx.resources.get(t.type) : undefined;
    if (!t || !def || !ctx.can(req.user!, `${def.module}.view`) || !UUID_RE.test(String(id ?? ''))) return ctx.fail(404, 'not_found', 'Record not found.');
    const row = await ctx.resources.find(t.type, String(id), req.user);
    if (!row) ctx.fail(404, 'not_found', 'Record not found.');
    return { t, def, row: row! };
  }

  async function mayChange(req: FastifyRequest, def: ResourceDef, id: string) {
    if (!ctx.can(req.user!, `${def.module}.edit`)) ctx.fail(403, 'forbidden', `You may not edit this ${def.label.toLowerCase()}.`);
    await assertTagsNotHeld(ctx, def.type, id);
  }

  const view = async (a: AssignmentRow | undefined) => (a ? (await assignmentViews(db, [a]))[0] : null);
  const byId = async (id: unknown) => {
    const a = UUID_RE.test(String(id ?? '')) ? await db.one<AssignmentRow>('select * from tag_assignments where id = $1', [id]) : undefined;
    return a ?? ctx.fail(404, 'not_found', 'Tag not found.');
  };
  const sourceOf = (s: unknown): TagSource => {
    if (s === undefined || s === null || s === '') return 'typed';
    if (!TAG_SOURCES.includes(s as TagSource)) invalid(ctx, { source: 'Choose code, text, typed or handheld.' });
    return s as TagSource;
  };
  const reasonOf = (r: unknown, required: boolean): string | null => {
    const reason = typeof r === 'string' ? r.trim() : '';
    if (required && !reason) invalid(ctx, { reason: 'Say why.' });
    if (reason.length > MAX_REASON) invalid(ctx, { reason: `Use at most ${MAX_REASON} characters.` });
    return reason || null;
  };

  app.get('/api/asset-tags/record', async (req): Promise<RecordTags> => {
    const q = (req.query ?? {}) as Row;
    const { def, row } = await recordFor(req, q.type, q.id);
    const all = await db.query<AssignmentRow>(
      `select * from tag_assignments where record_type = $1 and record_id = $2 order by (status = 'active') desc, is_primary desc, assigned_at desc`, [def.type, row.id]);
    const mayHistory = ctx.can(req.user!, 'tags.view');
    const views = await assignmentViews(db, mayHistory ? all : all.filter((a) => a.status === 'active'));
    const held = (await holdsOn(db, def.type, row.id)).length > 0;
    const mayEdit = ctx.can(req.user!, `${def.module}.edit`);
    return {
      current: views.filter((v) => v.status === 'active'),
      earlier: views.filter((v) => v.status !== 'active').sort((a, b) => String(b.endedAt ?? b.assignedAt).localeCompare(String(a.endedAt ?? a.assignedAt))),
      // "Last seen" (the lookup log) only for people who may edit the record (spec §4.6).
      lastSeen: mayEdit ? await lastSeen(ctx, def.type, row.id) : null,
      lastVerified: await lastVerified(ctx, def.type, row.id),
      canManage: ctx.can(req.user!, 'tags.manage') && mayEdit && !held,
      held,
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/record', summary: 'The tags of one record', permission: 'tags.view',
    description: 'Current values, and earlier ones for people with tags.view; "last seen" for people who may edit the record; last verified in an inventory count; whether the caller may attach, replace and end. Needs view on the record (404 otherwise, the same as a missing record); tags.view only for the history.',
    query: { type: 'Record type (asset, site, system, vehicle)', id: 'Record id' },
    response: { type: 'object', properties: { current: { type: 'array' }, earlier: { type: 'array' }, lastSeen: { type: ['object', 'null'] }, lastVerified: { type: ['object', 'null'] }, canManage: { type: 'boolean' }, held: { type: 'boolean' } } },
  });

  const ATTACH_BODY = { type: 'object', required: ['recordType', 'recordId', 'value'], properties: { recordType: { type: 'string' }, recordId: { type: 'string' }, value: { type: 'string' }, source: { type: 'string', enum: TAG_SOURCES } } };

  app.post('/api/asset-tags/attach', { preHandler: ctx.requirePerm('tags.manage') }, async (req, reply): Promise<TagAssignmentView> => {
    const b = (req.body ?? {}) as Partial<AttachRequest>;
    const { t, def, row } = await recordFor(req, b.recordType, b.recordId);
    await mayChange(req, def, row.id);
    const source = sourceOf(b.source);
    const v = await checkValue(ctx, t.type, b.value, source, 'value');
    const active = await activeOf(t.type, row.id);
    if (active.some((a) => a.value_key === v.key)) ctx.fail(409, 'in_use', `Tag ${v.value} is already on this record.`);
    if (active.length && !(await ctx.settings.get<boolean>(TAG_SETTINGS.severalPerRecord.key, TAG_SETTINGS.severalPerRecord.fallback))) {
      ctx.fail(409, 'one_per_record', 'This record already has a tag. Replace it instead, or allow several tags per record under Administration > Asset tags > Settings.');
    }
    let made: AssignmentRow | undefined;
    if (!active.length) {
      await opStore.run({ kind: 'attach', source }, () => ctx.resources.update(t.type, row.id, { [t.field]: v.value }, req));
      made = await activeByKey(db, v.key);
    } else {
      made = await opStore.run({ kind: 'attach', source }, () => claim(t, row.id, v, false, req, source));
      await auditTag(ctx, req, 'tag.attach', t, row.id, `Tag ${v.value} attached (an extra tag)`, null, { value: v.value, source });
    }
    reply.code(201);
    return (await view(made))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/attach', summary: 'Attach a tag value to a record', permission: 'tags.manage',
    description: 'Needs tags.manage and edit on the record. 409 `in_use` when the value is active on any record (the same answer whether or not the caller may see it), `on_hold` for a record under a legal hold, `one_per_record` when the record has a tag and several are not allowed; 400 `validation` for a typed value no tag format for the type accepts, or a value marked void or lost in stock.',
    body: ATTACH_BODY, response: { type: 'object' },
  });

  app.post('/api/asset-tags/replace', { preHandler: ctx.requirePerm('tags.manage') }, async (req): Promise<TagAssignmentView> => {
    const b = (req.body ?? {}) as Partial<ReplaceRequest>;
    const old = await byId(b.assignmentId);
    const { t, def, row } = await recordFor(req, old.record_type, old.record_id);
    if (old.status !== 'active') ctx.fail(409, 'not_active', 'This tag is no longer on the record.');
    await mayChange(req, def, row.id);
    const source = sourceOf(b.source);
    const reason = reasonOf(b.reason, false);
    const v = await checkValue(ctx, t.type, b.value, source, 'value');
    if (v.key === old.value_key) invalid(ctx, { value: 'Enter the new tag number.' });
    let made: AssignmentRow | undefined;
    if (old.is_primary) {
      await opStore.run({ kind: 'replace', source, reason }, () => ctx.resources.update(t.type, row.id, { [t.field]: v.value }, req));
      made = await activeByKey(db, v.key);
    } else {
      made = await opStore.run({ kind: 'replace', source, reason }, () => claim(t, row.id, v, false, req, source));
      await endAssignment(old, 'replaced', reason, req, made.id);
      await auditTag(ctx, req, 'tag.replace', t, row.id, `Tag ${old.value} replaced by ${v.value}${reason ? `: ${reason}` : ''}`, { value: old.value }, { value: v.value, source, reason });
    }
    return (await view(made))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/replace', summary: 'Replace a tag on a record', permission: 'tags.manage',
    description: 'Records the new value and marks the old one replaced, pointing at the new one. Same refusals as attach.',
    body: { type: 'object', required: ['assignmentId', 'value'], properties: { assignmentId: { type: 'string' }, value: { type: 'string' }, source: { type: 'string', enum: TAG_SOURCES }, reason: { type: 'string' } } },
    response: { type: 'object' },
  });

  app.post('/api/asset-tags/end', { preHandler: ctx.requirePerm('tags.manage') }, async (req): Promise<TagAssignmentView> => {
    const b = (req.body ?? {}) as Partial<EndRequest>;
    const a = await byId(b.assignmentId);
    const { t, def, row } = await recordFor(req, a.record_type, a.record_id);
    if (a.status !== 'active') ctx.fail(409, 'not_active', 'This tag is no longer on the record.');
    if (!END_STATUSES.includes(b.status as never)) invalid(ctx, { status: 'Choose void, lost or removed.' });
    const reason = reasonOf(b.reason, true);
    await mayChange(req, def, row.id);
    const status = b.status as EndRequest['status'];
    if (a.is_primary) {
      const others = (await activeOf(t.type, row.id)).filter((x) => x.id !== a.id);
      await opStore.run({ kind: 'end', source: 'system', endStatus: status, reason }, () =>
        ctx.resources.update(t.type, row.id, { [t.field]: others[0]?.value ?? null }, req));
      // With another value taking its place the hook saw a change of value, not a clearing: end it as asked.
      const still = await db.one<AssignmentRow>('select * from tag_assignments where id = $1', [a.id]);
      if (still && still.status !== status) {
        await db.query('update tag_assignments set status = $2, reason = $3, replaced_by = null, ended_by = $4, ended_at = coalesce(ended_at, now()) where id = $1', [a.id, status, reason, req.user!.id]);
      }
      if (others.length) await auditTag(ctx, req, 'tag.end', t, row.id, `Tag ${a.value} ended (${status}): ${reason}`, { value: a.value, status: 'active' }, { value: a.value, status, reason });
    } else {
      await endAssignment(a, status, reason, req);
      await auditTag(ctx, req, 'tag.end', t, row.id, `Tag ${a.value} ended (${status}): ${reason}`, { value: a.value, status: 'active' }, { value: a.value, status, reason });
    }
    return (await view(await db.one<AssignmentRow>('select * from tag_assignments where id = $1', [a.id])))!;
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/end', summary: 'End a tag on a record: void (damaged), lost, or removed', permission: 'tags.manage',
    description: 'A reason is required. Refused (409 `on_hold`) for a record under a legal hold.',
    body: { type: 'object', required: ['assignmentId', 'status', 'reason'], properties: { assignmentId: { type: 'string' }, status: { type: 'string', enum: [...END_STATUSES] }, reason: { type: 'string' } } },
    response: { type: 'object' },
  });

  // For tests and the coordinator: run the reconcile step now.
  if (!app.hasDecorator('tagsReconcile')) app.decorate('tagsReconcile', reconcile);
}

/** Record type -> table of the taggable types (for other parts of the tags module). */
export function taggableTables(app: object): Map<string, string> {
  return tablesByApp.get(app) ?? new Map();
}

declare module 'fastify' {
  interface FastifyInstance {
    tagsReconcile?: () => Promise<{ claimed: number; ended: number; clashes: string[] }>;
  }
}
