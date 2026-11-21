import type { FastifyInstance, FastifyRequest } from 'fastify';
import { CURRENCY } from './config.ts';
import { inTrial, type Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { CreateOptions, FieldDef, ResourceDef, ResourceRegistry, Row, SessionUser } from './module.ts';
import { CUSTOM_PREFIX, customFieldDef, customName, type CustomField, type CustomFields } from './customfields.ts';
import { makeLifecycles, type HeldMove, type Lifecycles } from './lifecycle.ts';
import { BODY_SEPARATOR, ensureCommentSearch, ensureSearchIndex, maySchemaChange, parseSearch, requestSchemaChange, schemaChangeDone, substringColumns } from './search.ts';
import { can, type makeAudit, type makeLookups } from './services.ts';
// Spreadsheet and PDF exports, record fact sheets and the generic import (core/export, core/import).
import { exportColumns, sendListExport } from './export/list.ts';
import { registerExportRoutes } from './export/routes.ts';
import { registerImportRoutes } from './import/routes.ts';

const IDENT = /^[a-z_][a-z0-9_]*$/;
const CODE = CURRENCY.replace(/[^A-Z]/g, '') || 'USD';
const CURRENCY_CODE_RE = new RegExp(`^${CODE}|${CODE}$`, 'i');
const STD_FIELDS: Record<string, FieldDef> = {
  id: { label: 'ID', type: 'text' },
  created_at: { label: 'Created', type: 'datetime' },
  updated_at: { label: 'Updated', type: 'datetime' },
  created_by: { label: 'Created by', type: 'user' },
  updated_by: { label: 'Updated by', type: 'user' },
};

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  lookups: ReturnType<typeof makeLookups>;
  custom: CustomFields;
}

/** A record was created, updated, soft-deleted or purged through the resource engine. */
export interface RecordChange {
  action: 'create' | 'update' | 'delete' | 'purge';
  def: ResourceDef;
  row: Row;
  /** Update only: the changed fields, before and after. */
  before?: Row;
  after?: Row;
  req: FastifyRequest | null;
}
export type ChangeListener = (change: RecordChange) => Promise<void> | void;

/**
 * Field types that hold a record's details: its words and its people. Figures (counts, totals,
 * charts) include restricted records for everyone, but never match, group or label a restricted
 * record by the value of such a field; whether the field is blank still counts.
 */
export const DETAIL_TYPES: ReadonlySet<string> = new Set(['text', 'longtext', 'json', 'user']);
/** The group value a figure gives a restricted record in place of a detail (SQL and its value). */
export const MASKED_SQL = `(chr(1) || 'restricted')`;
export const MASKED_VALUE = '\u0001restricted';
export const MASKED_LABEL = 'Restricted records';

/**
 * Record types whose files are evidence unless their definition says otherwise (E14-18): vendor
 * evidence items, framework outcomes, obligations, policies, exercises and risks (whose treatments
 * are proved by files). A module sets `evidence` on its definition to change this.
 */
export const EVIDENCE_TYPES: ReadonlySet<string> = new Set(['evidence_item', 'framework_outcome', 'obligation', 'policy', 'exercise', 'risk']);

/** Tags as stored: trimmed, lower case, single spaces, no commas, at most 40 characters. */
export const normalizeTag = (raw: unknown) => String(raw ?? '').toLowerCase().replace(/[\s,]+/g, ' ').trim().slice(0, 40);

declare module 'fastify' {
  interface FastifyInstance {
    /** Allowed status changes and required fields per record type (E14-31, core/lifecycle.ts). */
    lifecycles: Lifecycles;
  }
}

export interface RecordLabel { label: string; ref: string | null; hidden: boolean }

export function makeResources({ app, db, audit, lookups, custom }: Deps) {
  const defs = new Map<string, ResourceDef>();
  /** Record types with a working full-text index (the rest are searched by substring). */
  const ftsTypes = new Set<string>();
  const listeners: ChangeListener[] = [];
  // Allowed status changes and required fields per record type (E14-31, core/lifecycle.ts).
  const lifecycles = makeLifecycles({ db, lookups, customDefs: (type) => custom.defs(type) });
  if (!app.hasDecorator('lifecycles')) app.decorate('lifecycles', lifecycles);

  /** Tells listeners (webhooks, watchers) about a change. A failing listener never fails the change. */
  async function emit(change: RecordChange): Promise<void> {
    if (inTrial()) return; // a rolled-back check (E13-22) tells nobody
    for (const fn of listeners) {
      try { await fn(change); } catch (err) { console.error(`[events] listener failed on ${change.def.type}.${change.action}:`, err); }
    }
  }

  // ---------- custom fields and search index ----------

  /** Adds the `custom` column to a type's table (once) so custom values have somewhere to live. */
  async function ensureCustomColumn(def: ResourceDef): Promise<void> {
    // Looked up first, so a run-time account without the right to change tables (E16-31) logs
    // nothing at start-up once the column exists; only a missing column needs `alter table`.
    const exists = await db.one(
      `select 1 from information_schema.columns
       where table_schema = current_schema() and table_name = $1 and column_name = 'custom'`, [def.table]);
    if (exists) return;
    // A least-privilege run-time role never changes the schema (E16-37). The owner's migrate step
    // gives every record table this column, so this happens only for a table added since then.
    if (!(await maySchemaChange(db, def.table))) {
      await requestSchemaChange(db, 'custom_column', def.type, `${def.plural} need a column for custom fields.`);
      throw new Error(`Custom fields on ${def.plural.toLowerCase()} need a database change that the owner account makes: run migrate with GRC_DATABASE_MIGRATE_URL set.`);
    }
    await db.exec(`alter table ${def.table} add column if not exists custom jsonb not null default '{}'`);
    await schemaChangeDone(db, 'custom_column', def.type);
  }

  const textKeys = (fields: CustomField[]) => fields.filter((f) => f.type === 'text' || f.type === 'longtext').map((f) => f.key);

  /** (Re)builds one type's search trigger from its definition and its text custom fields. */
  async function refreshSearch(def: ResourceDef, known?: Map<string, string>): Promise<void> {
    if (await ensureSearchIndex(db, def, textKeys(await custom.active(def.type)), known)) ftsTypes.add(def.type);
    else ftsTypes.delete(def.type);
  }

  app.addHook('onReady', async () => {
    for (const type of await custom.types()) {
      const def = defs.get(type);
      if (def) await ensureCustomColumn(def).catch((err) => console.error(`[custom fields] ${type}: ${(err as Error).message}`));
    }
    const known = new Map((await db.query<{ table_name: string; signature: string }>('select table_name, signature from search_index_state'))
      .map((r) => [r.table_name, r.signature]));
    for (const def of defs.values()) await refreshSearch(def, known);
    // Comments are searched in the same language as records (E14-21).
    await ensureCommentSearch(db);
  });

  /** null user = the system (seeding, automation) and sees everything. */
  const seesRestricted = (user: SessionUser | null | undefined) => !user || can(user, 'security.view');

  const mayAccess = (user: SessionUser | null, def: ResourceDef, action: string) =>
    can(user, `${def.module}.${action}`) && (def.restricted !== true || can(user, 'security.view'));

  function authorize(req: FastifyRequest, def: ResourceDef, action: string) {
    if (!mayAccess(req.user, def, action)) fail(403, 'forbidden', 'You do not have permission to do that.');
  }

  function visibilitySql(def: ResourceDef, user: SessionUser | null | undefined, alias?: string): string {
    if (alias !== undefined && !IDENT.test(alias)) throw new Error(`Bad table alias: ${alias}`);
    if (seesRestricted(user)) return 'true';
    if (def.restricted === true) return 'false';
    if (def.restricted === 'flag') return `coalesce(${alias ? `${alias}.` : ''}restricted, false) = false`;
    return 'true';
  }

  // ---------- inherited restriction ----------

  /** Whether the record a row points at (see ResourceDef.restrictedFrom) is restricted. */
  async function sourceRestricted(def: ResourceDef, row: Row): Promise<boolean> {
    const type = row[def.restrictedFrom!.typeField];
    const id = row[def.restrictedFrom!.idField];
    const src = typeof type === 'string' ? defs.get(type) : undefined;
    if (!src || !id || !UUID_RE.test(String(id))) return false;
    if (src.restricted === true) return true;
    if (src.restricted !== 'flag') return false;
    const s = await db.one<{ restricted: boolean }>(`select coalesce(restricted, false) as restricted from ${src.table} where id = $1`, [id]);
    return Boolean(s?.restricted);
  }

  /** A person may only point a row at a source record they can see; otherwise the row would vanish from their view. */
  async function checkSourceVisible(def: ResourceDef, row: Row, req: FastifyRequest | null): Promise<void> {
    if (!req) return;
    const { typeField, idField } = def.restrictedFrom!;
    const type = row[typeField];
    const id = row[idField];
    const src = typeof type === 'string' ? defs.get(type) : undefined;
    if (!src || !id) return;
    if (!mayAccess(req.user, src, 'view') || !(await find(src.type, String(id), req.user))) {
      fail(400, 'validation', 'Check the highlighted fields.', { [idField]: `${def.fields[idField]?.label ?? 'Source record'} was not found.` });
    }
  }

  /** Copies a changed restriction to every row that inherits from this record, and on to their dependants. */
  async function propagateRestriction(type: string, id: string, restricted: boolean, depth = 0): Promise<void> {
    if (depth > 5) return;
    for (const d of defs.values()) {
      if (!d.restrictedFrom) continue;
      const rows = await db.query<{ id: string }>(
        `update ${d.table} set restricted = $3 where ${d.restrictedFrom.typeField} = $1 and ${d.restrictedFrom.idField}::text = $2
           and coalesce(restricted, false) <> $3 returning id`,
        [type, id, restricted],
      );
      for (const r of rows) {
        await audit(null, {
          action: `${d.type}.restriction`, recordType: d.type, recordId: r.id,
          summary: `${d.label} ${restricted ? 'restricted' : 'no longer restricted'}: follows its source record`,
          before: { restricted: !restricted }, after: { restricted },
        });
        await propagateRestriction(d.type, r.id, restricted, depth + 1);
      }
    }
  }

  /** Start-up repair: brings every inherited flag in line with its source (covers rows written before the rule existed). */
  async function syncInheritedRestriction(): Promise<void> {
    for (const d of defs.values()) {
      if (!d.restrictedFrom) continue;
      const { typeField, idField } = d.restrictedFrom;
      let changed = 0;
      for (const s of defs.values()) {
        const sql = s.restricted === true
          ? `update ${d.table} set restricted = true where ${typeField} = $1 and coalesce(restricted, false) = false returning id`
          : s.restricted === 'flag'
            ? `update ${d.table} t set restricted = coalesce(s.restricted, false) from ${s.table} s
               where t.${typeField} = $1 and t.${idField}::text = s.id::text and coalesce(t.restricted, false) <> coalesce(s.restricted, false) returning t.id`
            : `update ${d.table} set restricted = false where ${typeField} = $1 and coalesce(restricted, false) = true returning id`;
        changed += (await db.query(sql, [s.type])).length;
      }
      if (changed) {
        await audit(null, {
          action: `${d.type}.restriction_sync`, recordType: d.type,
          summary: `${changed} ${d.plural.toLowerCase()} brought in line with the restriction of their source records`,
        });
      }
    }
  }
  app.addHook('onReady', syncInheritedRestriction);

  const need = (type: string): ResourceDef => defs.get(type) ?? fail(404, 'unknown_type', `Unknown record type "${type}".`);

  // ---------- validation ----------

  async function validate(def: ResourceDef, input: Row, mode: 'create' | 'update', system: boolean, skipCustomRequired = false): Promise<Row> {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const listCache = new Map<string, Set<string>>();
    const allowedIn = async (list: string) => {
      let allowed = listCache.get(list);
      if (!allowed) {
        allowed = new Set((await lookups.values(list)).map((x) => x.value));
        listCache.set(list, allowed);
      }
      return allowed;
    };
    // Custom fields are validated like built-in ones. "Required" applies to people, not to system work
    // (seeding, automation), which cannot know what an administrator has added.
    const customDefs = Object.entries(await custom.defs(def.type))
      .map(([name, f]): [string, FieldDef] => [name, system || skipCustomRequired ? { ...f, required: false } : f]);
    for (const [name, f] of [...Object.entries(def.fields), ...customDefs]) {
      if (f.readOnly && !system) continue;
      let v = input[name];
      if (v === undefined) {
        if (mode === 'update') continue;
        if (f.default !== undefined) v = f.default;
        else if (f.required) { errors[name] = `${f.label} is required.`; continue; } else continue;
      }
      if (typeof v === 'string') v = f.type === 'longtext' || f.type === 'json' ? v : v.trim();
      if (v === null || v === '' || (f.multiple && Array.isArray(v) && !v.length)) {
        if (f.required) errors[name] = `${f.label} is required.`;
        else out[name] = null;
        continue;
      }
      if (f.multiple) {
        // Multi select (custom fields only): a list of values from the field's list.
        const values = [...new Set((Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean))];
        const allowed = await allowedIn(f.list!);
        const bad = values.find((x) => !allowed.has(x));
        if (bad !== undefined) errors[name] = `${f.label}: "${bad}" is not an allowed value.`;
        else out[name] = values;
        continue;
      }
      switch (f.type) {
        case 'text': case 'longtext':
          out[name] = String(v);
          break;
        case 'number': case 'currency': {
          // Typed amounts may carry a currency symbol, the configured currency code and thousands separators.
          const n = typeof v === 'number' ? v
            : Number(String(v).replace(/[\p{Sc},\s]/gu, '').replace(CURRENCY_CODE_RE, '') || NaN);
          if (Number.isFinite(n)) out[name] = n; else errors[name] = `${f.label} must be a number.`;
          break;
        }
        case 'date':
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v)))) out[name] = String(v);
          else errors[name] = `${f.label} must be a date (YYYY-MM-DD).`;
          break;
        case 'datetime': {
          const d = v instanceof Date ? v : new Date(String(v));
          if (Number.isNaN(d.getTime())) errors[name] = `${f.label} must be a date and time.`;
          else out[name] = d.toISOString();
          break;
        }
        case 'boolean':
          if (typeof v === 'boolean') out[name] = v;
          else if (v === 'true' || v === 'false') out[name] = v === 'true';
          else errors[name] = `${f.label} must be yes or no.`;
          break;
        case 'lookup': {
          const allowed = await allowedIn(f.list!);
          if (allowed.has(String(v))) out[name] = String(v);
          else errors[name] = `${f.label}: "${v}" is not an allowed value.`;
          break;
        }
        case 'user': case 'ref':
          if (UUID_RE.test(String(v))) out[name] = String(v); else errors[name] = `${f.label} is not a valid reference.`;
          break;
        case 'json':
          out[name] = v;
          break;
      }
    }
    if (Object.keys(errors).length) fail(400, 'validation', 'Check the highlighted fields.', errors);
    return out;
  }

  /** Takes the validated custom values (`cf_<key>`) out of `data`; returns them keyed by `key`, or null when there are none. */
  function takeCustom(data: Row): Row | null {
    let values: Row | null = null;
    for (const name of Object.keys(data)) {
      if (!name.startsWith(CUSTOM_PREFIX)) continue;
      (values ??= {})[name.slice(CUSTOM_PREFIX.length)] = data[name];
      delete data[name];
    }
    return values;
  }

  /** Custom values of a row under their client names (`cf_<key>`), for audit events and webhooks. */
  const customOf = (row: Row): Row =>
    Object.fromEntries(Object.entries((row.custom ?? {}) as Row).filter(([, v]) => v !== null && v !== undefined).map(([k, v]) => [`${CUSTOM_PREFIX}${k}`, v]));

  /** Column list, placeholders and params for a data object. Objects and arrays are stored as jsonb. */
  function sqlValues(data: Row, startAt = 1) {
    const cols: string[] = [];
    const marks: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(data)) {
      if (!IDENT.test(k)) throw new Error(`Bad column name: ${k}`);
      cols.push(k);
      const isJson = typeof v === 'object' && v !== null && !(v instanceof Date);
      params.push(isJson ? JSON.stringify(v) : v);
      marks.push(`$${startAt + params.length - 1}${isJson ? '::jsonb' : ''}`);
    }
    return { cols, marks, params };
  }

  async function nextRef(prefix: string): Promise<string> {
    const row = await db.one<{ value: number }>(
      `insert into counters (key, value) values ($1, 1)
       on conflict (key) do update set value = counters.value + 1 returning value`,
      [prefix],
    );
    return `${prefix}${String(row!.value).padStart(5, '0')}`;
  }

  // ---------- core operations ----------

  async function find(type: string, id: string, user?: SessionUser | null): Promise<Row | undefined> {
    const def = need(type);
    if (!UUID_RE.test(id)) return undefined;
    return db.one(
      `select * from ${def.table} where id = $1 and deleted_at is null and ${visibilitySql(def, user)}`, [id],
    );
  }

  /**
   * The type's lifecycle rules (E14-31): a person's save that makes a move the rules do not allow,
   * or leaves a field the new status needs empty, is refused like any other invalid field. It runs
   * before the module's own hooks, which still apply their own rules afterwards.
   */
  async function checkLifecycle(def: ResourceDef, existing: Row | null, data: Row, req: FastifyRequest | null): Promise<void> {
    const problems = await lifecycles.check(def, existing, data, req);
    if (Object.keys(problems).length) fail(400, 'validation', 'Check the highlighted fields.', problems);
  }

  async function create(type: string, input: Row, req: FastifyRequest | null = null, opts: CreateOptions = {}): Promise<Row> {
    const def = need(type);
    let data = await validate(def, input, 'create', !req, opts.skipCustomRequired === true);
    await checkLifecycle(def, null, data, req);
    // Hooks see built-in fields only; custom values are stored beside them afterwards.
    const customValues = takeCustom(data);
    if (def.hooks?.beforeCreate) data = await def.hooks.beforeCreate(req, data);
    if (customValues) data.custom = Object.fromEntries(Object.entries(customValues).filter(([, v]) => v !== null));
    if (def.restrictedFrom) {
      await checkSourceVisible(def, data, req);
      data.restricted = await sourceRestricted(def, data);
    }
    if (def.ref && !data[def.ref.field]) data[def.ref.field] = await nextRef(def.ref.prefix);
    data.created_by = data.updated_by = req?.user?.id ?? null;
    const { cols, marks, params } = sqlValues(data);
    const row = (await db.one<Row>(
      `insert into ${def.table} (${cols.join(', ')}) values (${marks.join(', ')}) returning *`, params,
    ))!;
    await audit(req, {
      action: `${type}.create`, recordType: type, recordId: row.id,
      summary: `${def.label} created: ${labelOf(def, row)}`, after: { ...pickFields(def, row), ...customOf(row) },
    });
    await def.hooks?.afterCreate?.(req, row);
    await emit({ action: 'create', def, row, req });
    return row;
  }

  async function update(type: string, id: string, input: Row, req: FastifyRequest | null = null): Promise<Row> {
    const def = need(type);
    const existing = (await find(type, id, req?.user)) ?? fail(404, 'not_found', `${def.label} not found.`);
    let patch = await validate(def, input, 'update', !req);
    await checkLifecycle(def, existing, patch, req);
    // A move that waits for an approval workflow (E14-37): the rest is saved, the status stays, and
    // the workflow starts; its approval makes the move later.
    const held = await lifecycles.held(def, existing, patch, req);
    if (held) delete patch[held.field];
    const customValues = takeCustom(patch);
    if (def.hooks?.beforeUpdate) patch = await def.hooks.beforeUpdate(req, existing, patch);
    if (def.restrictedFrom && (def.restrictedFrom.typeField in patch || def.restrictedFrom.idField in patch)) {
      const merged = { ...existing, ...patch };
      await checkSourceVisible(def, merged, req);
      patch.restricted = await sourceRestricted(def, merged);
    }
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(normalize(existing[k])) !== JSON.stringify(normalize(v))) {
        before[k] = existing[k];
        after[k] = v;
      }
    }
    // Custom values: compared one by one, stored together in the `custom` column.
    const labels: Record<string, string> = {};
    const set: Row = { ...after };
    if (customValues) {
      const stored = { ...((existing.custom ?? {}) as Row) };
      const customLabels = await custom.defs(type);
      let changed = false;
      for (const [k, v] of Object.entries(customValues)) {
        if (JSON.stringify(stored[k] ?? null) === JSON.stringify(v ?? null)) continue;
        before[`${CUSTOM_PREFIX}${k}`] = stored[k] ?? null;
        after[`${CUSTOM_PREFIX}${k}`] = v;
        labels[`${CUSTOM_PREFIX}${k}`] = customLabels[`${CUSTOM_PREFIX}${k}`]?.label ?? k;
        if (v === null) delete stored[k]; else stored[k] = v;
        changed = true;
      }
      if (changed) set.custom = stored;
    }
    if (!Object.keys(after).length) {
      if (held) return holdMove(def, existing, held, req!);
      return existing;
    }
    const { cols, marks, params } = sqlValues(set, 3);
    const row = (await db.one<Row>(
      `update ${def.table} set ${cols.map((c, i) => `${c} = ${marks[i]}`).join(', ')},
         updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [id, req?.user?.id ?? null, ...params],
    ))!;
    await audit(req, {
      action: `${type}.update`, recordType: type, recordId: id,
      summary: `${def.label} updated: ${labelOf(def, row)} (${Object.keys(after).map((k) => def.fields[k]?.label ?? labels[k] ?? k).join(', ')})`,
      before, after,
    });
    if (def.restricted === 'flag' && 'restricted' in after) await propagateRestriction(type, id, row.restricted === true);
    await def.hooks?.afterUpdate?.(req, existing, row);
    await emit({ action: 'update', def, row, before, after, req });
    if (held) return holdMove(def, row, held, req!);
    return row;
  }


  /**
   * Starts the approval a held move waits for (E14-37) and answers the record as it now is: with
   * `_pending_move` while the move waits, or with the new status when the workflow approved at once
   * (every step skipped for this record).
   */
  async function holdMove(def: ResourceDef, row: Row, move: HeldMove, req: FastifyRequest): Promise<Row> {
    await lifecycles.hold(def, row, move, req);
    const now = (await find(def.type, row.id)) ?? row;
    if (now[move.field] === move.to) return now;
    return { ...now, _pending_move: { field: move.field, from: move.from, to: move.to } };
  }
  const normalize = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
  const labelOf = (def: ResourceDef, row: Row) =>
    [def.ref && row[def.ref.field], row[def.titleField]].filter(Boolean).join(' ') || row.id;
  const pickFields = (def: ResourceDef, row: Row) =>
    Object.fromEntries(Object.keys(def.fields).filter((k) => row[k] !== null && row[k] !== undefined).map((k) => [k, row[k]]));

  // ---------- labels and display ----------

  async function labelsFor(type: string, ids: string[], user?: SessionUser | null): Promise<Map<string, RecordLabel>> {
    const out = new Map<string, RecordLabel>();
    const def = defs.get(type);
    const clean = [...new Set(ids.filter((i) => typeof i === 'string' && UUID_RE.test(i)))];
    if (!def || !clean.length) return out;
    const sees = seesRestricted(user);
    // A label is a piece of the other record: people without view on its module do not get it either.
    const mayView = !user || can(user, `${def.module}.view`);
    const rows = await db.query<Row>(
      `select id, ${def.titleField}::text as label, ${def.ref ? def.ref.field : 'null'} as ref,
              ${def.restricted === 'flag' ? 'coalesce(restricted, false)' : 'false'} as flagged
       from ${def.table} where id = any($1::uuid[])`,
      [clean],
    );
    for (const r of rows) {
      const hidden = !mayView || (!sees && (def.restricted === true || r.flagged));
      out.set(r.id, hidden ? { label: 'Restricted', ref: null, hidden } : { label: r.label ?? '', ref: r.ref, hidden });
    }
    return out;
  }

  async function userNames(ids: string[]): Promise<Map<string, string>> {
    const clean = [...new Set(ids.filter((i) => typeof i === 'string' && UUID_RE.test(i)))];
    if (!clean.length) return new Map();
    const rows = await db.query<{ id: string; display_name: string }>(
      'select id, display_name from users where id = any($1::uuid[])', [clean],
    );
    return new Map(rows.map((r) => [r.id, r.display_name]));
  }

  /** Adds `_display` labels for user, ref and lookup fields. */
  async function decorate(def: ResourceDef, rows: Row[], user: SessionUser | null): Promise<Row[]> {
    if (!rows.length) return rows;
    // Custom values appear beside the built-in fields as cf_<key> (the raw `custom` column stays too).
    const customFields = await custom.active(def.type);
    for (const row of rows) for (const f of customFields) row[customName(f)] = row.custom?.[f.key] ?? null;
    // Tags travel with the row so a list can show them without a request per record.
    const tags = await db.query<{ record_id: string; tag: string }>(
      'select record_id, tag from record_tags where record_type = $1 and record_id = any($2::uuid[]) order by tag', [def.type, rows.map((r) => r.id)]);
    for (const row of rows) row._tags = tags.filter((t) => t.record_id === row.id).map((t) => t.tag);
    const fields: Record<string, FieldDef> = {
      ...def.fields, created_by: STD_FIELDS.created_by, updated_by: STD_FIELDS.updated_by,
      ...Object.fromEntries(customFields.map((f) => [customName(f), customFieldDef(f)])),
    };
    const entries = Object.entries(fields);
    // Only the lists this type uses, and only the labels (E16-36: every list was read for each page).
    const lists = [...new Set(entries.filter(([k, f]) => f.type === 'lookup' && rows.some((r) => r[k] !== null && r[k] !== undefined)).map(([, f]) => f.list!))];
    const lookupLabels = new Map<string, Map<string, string>>();
    if (lists.length) {
      for (const r of await db.query<{ list_key: string; value: string; label: string }>(
        'select list_key, value, label from lookups where active and list_key = any($1::text[])', [lists])) {
        (lookupLabels.get(r.list_key) ?? lookupLabels.set(r.list_key, new Map()).get(r.list_key)!).set(r.value, r.label);
      }
    }
    const lookupLabel = (list: string, v: unknown) => lookupLabels.get(list)?.get(String(v)) ?? String(v);
    const names = await userNames(
      entries.filter(([, f]) => f.type === 'user').flatMap(([k]) => rows.map((r) => r[k])),
    );
    const refLabels = new Map<string, Map<string, RecordLabel>>();
    for (const to of new Set(entries.filter(([, f]) => f.type === 'ref').map(([, f]) => f.to!))) {
      const ids = entries.filter(([, f]) => f.type === 'ref' && f.to === to).flatMap(([k]) => rows.map((r) => r[k]));
      refLabels.set(to, await labelsFor(to, ids, user));
    }
    for (const row of rows) {
      const d: Record<string, string> = {};
      for (const [k, f] of entries) {
        const v = row[k];
        if (v === null || v === undefined) continue;
        if (f.type === 'lookup' && Array.isArray(v)) d[k] = v.map((x) => lookupLabel(f.list!, x)).join(', ');
        else if (f.type === 'lookup') d[k] = lookupLabel(f.list!, v);
        else if (f.type === 'user') d[k] = names.get(v) ?? 'Unknown user';
        else if (f.type === 'ref') d[k] = refLabels.get(f.to!)?.get(v)?.label ?? 'Unknown';
      }
      row._display = d;
    }
    return rows;
  }

  // ---------- list queries ----------

  /** The SQL expression for a field: a column, or a key of the `custom` column for a custom field. */
  function columnSql(name: string, f: FieldDef, as: 'text' | 'typed' = 'text'): string {
    if (!IDENT.test(name)) throw new Error(`Bad field name: ${name}`);
    if (!f.custom) return name;
    const text = `(custom->>'${name.slice(CUSTOM_PREFIX.length)}')`;
    if (as === 'text') return text;
    return f.type === 'number' || f.type === 'currency' ? `${text}::numeric` : f.type === 'date' ? `${text}::date` : text;
  }

  /**
   * The WHERE clause for a list (`figures` false: only what the caller may see) or for a figure
   * (`figures` true, GET /stats: every record, whoever asks; see "Figures" in docs/security.md).
   * In a figure, a condition that reads a restricted record's details (its words, its people, a
   * search) never matches that record, so a figure cannot be used to find out what one says. A
   * figure about the caller's own records ("me") is theirs alone and keeps the list rule.
   */
  function buildWhere(def: ResourceDef, query: Record<string, string>, user: SessionUser | null, customDefs: Record<string, FieldDef> = {}, figures = false) {
    const fieldOf = (name: string) => def.fields[name] ?? STD_FIELDS[name] ?? customDefs[name];
    const personal = figures && Object.entries(query).some(([key, v]) => {
      const [f, name, op] = key.split('.');
      return f === 'f' && op === undefined && fieldOf(name)?.type === 'user' && String(v).split(',').includes('me');
    });
    const everyone = figures && !personal;
    const where = ['deleted_at is null', everyone ? 'true' : visibilitySql(def, user)];
    const masks = everyone && def.restricted === 'flag';
    const guard = (cond: string) => (masks ? `(not coalesce(restricted, false) and ${cond})` : cond);
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    /** Set when the query is a full-text search: an expression to order the best matches first. */
    let rank: string | null = null;

    const search = parseSearch(query.q);
    if (search.text) {
      const cols = substringColumns(def);
      const like = add(search.like);
      const substring = cols.map((c) => `${c}::text ilike ${like}`).join(' or ');
      if (search.fts && ftsTypes.has(def.type)) {
        // Full-text search (core/search.ts). Reference numbers always match as typed, and a single
        // word still matches inside words (codes, serial numbers), as it did before.
        const tsq = search.tsquery(add);
        const type = add(def.type);
        const entry = `from search_index si where si.record_type = ${type} and si.record_id = ${def.table}.id`;
        const exact = def.ref ? `lower(${def.ref.field}::text) = lower(${add(search.text)}::text)` : 'false';
        // The matching index rows are found once, through the index (the vector, and for one word the
        // substring text with its trigram index), and kept in a hash, rather than tested again on
        // every record (E16-36). `body` holds exactly the substring fields (search.ts, bodySql).
        const inBody = search.single && !search.text.includes(BODY_SEPARATOR) ? ` or si.body ilike ${like}` : '';
        const matched = `${def.table}.id in (select si.record_id from search_index si where si.record_type = ${type} and (si.vector @@ ${tsq}${inBody}))`;
        where.push(guard(`(${matched} or ${exact}`
          + ` or ${search.single ? (inBody ? 'false' : substring) : `${def.titleField}::text ilike ${like}${def.ref ? ` or ${def.ref.field}::text ilike ${like}` : ''}`})`));
        rank = `(coalesce((select ts_rank(si.vector, ${tsq}) ${entry}), 0) + case when ${exact} then 10 else 0 end`
          + ` + case when ${def.titleField}::text ilike ${like} then 0.5 else 0 end)`;
      } else {
        where.push(guard(`(${substring})`));
      }
    }
    for (const [key, raw] of Object.entries(query)) {
      if (!key.startsWith('f.')) continue;
      const [, name, op] = key.split('.');
      const value = String(raw);
      if (name === 'tags' && !def.fields.tags) {
        // Tags (core/tags.ts): f.tags=a,b is any of; f.tags.all=a,b is every one; f.tags.null=true is untagged.
        const tagged = `select 1 from record_tags rt where rt.record_type = ${add(def.type)} and rt.record_id = ${def.table}.id`;
        const tags = [...new Set(value.split(',').map(normalizeTag).filter(Boolean))];
        if (!op) where.push(guard(`exists (${tagged} and rt.tag = any(${add(tags)}::text[]))`));
        else if (op === 'all') for (const t of tags) where.push(guard(`exists (${tagged} and rt.tag = ${add(t)})`));
        else if (op === 'null') where.push(`${value === 'true' ? 'not ' : ''}exists (${tagged})`);
        else fail(400, 'bad_filter', `Unknown filter operator "${op}".`);
        continue;
      }
      const f = fieldOf(name);
      if (!f || !IDENT.test(name)) fail(400, 'bad_filter', `Cannot filter on "${name}".`);
      const cast = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'timestamptz' : 'numeric';
      const col = columnSql(name, f);
      if (!op) {
        const values = value.split(',').map((v) => (v === 'me' && f.type === 'user' ? user?.id ?? '' : v));
        if (f.multiple) where.push(`jsonb_exists_any(custom->'${name.slice(CUSTOM_PREFIX.length)}', ${add(values)}::text[])`);
        else {
          const cond = `${col}::text = any(${add(values)}::text[])`;
          where.push(DETAIL_TYPES.has(f.type) ? guard(cond) : cond);
        }
      } else if (op === 'null') {
        where.push(`${col} is ${value === 'true' ? '' : 'not '}null`);
      } else if (['gt', 'lt', 'gte', 'lte'].includes(op)) {
        if (!['date', 'datetime', 'number', 'currency'].includes(f.type)) fail(400, 'bad_filter', `Cannot compare "${name}".`);
        const sym = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[op as 'gt'];
        where.push(`${columnSql(name, f, 'typed')} ${sym} ${add(value)}::${cast}`);
      } else {
        fail(400, 'bad_filter', `Unknown filter operator "${op}".`);
      }
    }
    return { where: where.join(' and '), params, rank, everyone };
  }

  function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // ---------- registration ----------

  function defineResource(def: ResourceDef) {
    if (def.restrictedFrom && def.restricted !== 'flag') throw new Error(`Resource ${def.type}: restrictedFrom needs restricted: 'flag'`);
    for (const name of [def.table, def.titleField, def.ref?.field, def.restrictedFrom?.typeField, def.restrictedFrom?.idField,
      ...Object.keys(def.fields), ...(def.searchable ?? []), ...(def.defaultSort ? [def.defaultSort.field] : [])]) {
      if (name !== undefined && !IDENT.test(name)) throw new Error(`Resource ${def.type}: bad identifier "${name}"`);
    }
    for (const [name, f] of Object.entries(def.fields)) {
      if (f.type === 'lookup' && !f.list) throw new Error(`Resource ${def.type}.${name}: lookup needs "list"`);
      if (f.type === 'ref' && !f.to) throw new Error(`Resource ${def.type}.${name}: ref needs "to"`);
    }
    if (defs.has(def.type)) throw new Error(`Resource ${def.type} defined twice`);
    defs.set(def.type, def);

    app.get(def.path, async (req, reply) => {
      authorize(req, def, 'view');
      const query = req.query as Record<string, string>;
      const customDefs = await custom.defs(def.type);
      const { where, params, rank } = buildWhere(def, query, req.user, customDefs);
      const sortable = query.sort !== undefined && IDENT.test(query.sort)
        && (def.fields[query.sort] ?? STD_FIELDS[query.sort] ?? (customDefs[query.sort]?.multiple ? undefined : customDefs[query.sort]));
      const sortField = sortable ? columnSql(query.sort, sortable, 'typed') : def.defaultSort?.field ?? 'created_at';
      const dir = (query.dir ?? (query.sort ? 'asc' : def.defaultSort?.dir ?? 'desc')) === 'desc' ? 'desc' : 'asc';
      // A full-text search with no sort chosen puts the best matches first.
      const order = `order by ${rank && !sortable ? `${rank} desc, ` : ''}${sortField} ${dir} nulls last, id`;

      if (query.format === 'csv') {
        authorize(req, def, 'export');
        const rows = await decorate(def, await db.query(`select * from ${def.table} where ${where} ${order} limit 50000`, params), req.user);
        const exported: Record<string, FieldDef> = Object.fromEntries(exportColumns({ ...def.fields, ...customDefs }, query.columns));
        const names = Object.keys(exported);
        const lines = [names.map((n) => csvCell(exported[n].label)).join(',')];
        for (const r of rows) lines.push(names.map((n) => csvCell(r._display?.[n] ?? r[n])).join(','));
        if (def.restricted === true || rows.some((r) => r.restricted === true)) lines.push(csvCell(`Restricted export by ${req.user!.displayName} at ${new Date().toISOString()}`));
        await audit(req, {
          action: `${def.type}.export`, recordType: def.type,
          summary: `Exported ${rows.length} ${def.plural.toLowerCase()} to CSV`,
        });
        reply.header('content-type', 'text/csv; charset=utf-8');
        reply.header('content-disposition', `attachment; filename="${def.type}-export.csv"`);
        return '﻿' + lines.join('\r\n');
      }
      // Spreadsheet (XLSX) and PDF: the same rows, permissions, watermark rule and audit as CSV (core/export/list.ts).
      if (query.format === 'xlsx' || query.format === 'pdf') {
        authorize(req, def, 'export');
        const rows = await decorate(def, await db.query(`select * from ${def.table} where ${where} ${order} limit 50000`, params), req.user);
        return sendListExport({
          req, reply, db, audit, def, rows, fields: { ...def.fields, ...customDefs }, query, format: query.format,
          lookupLabels: async (list, value) => (await lookups.values(list)).find((x) => x.value === value)?.label,
        });
      }

      const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
      const page = Math.max(1, Number(query.page) || 1);
      // The page is found on ids alone and then read in full, so sorting never carries whole
      // records, and the exact total comes from the same pass (E16-36). A page past the end has no
      // row to carry it, so only then is it counted on its own.
      const offset = (page - 1) * pageSize;
      const found = await db.query<{ id: string; total: number }>(
        `select id, count(*) over ()::int as total from ${def.table} where ${where} ${order} limit ${pageSize} offset ${offset}`, params,
      );
      const ids = found.map((r) => r.id);
      const total = found.length ? found[0].total
        : offset === 0 ? 0 : (await db.one<{ c: number }>(`select count(*)::int c from ${def.table} where ${where}`, params))!.c;
      const byId = new Map((ids.length
        ? await db.query<Row>(`select * from ${def.table} where id = any($1::uuid[]) and deleted_at is null and ${visibilitySql(def, req.user)}`, [ids])
        : []).map((r) => [r.id, r]));
      const rows = ids.map((id) => byId.get(id)).filter((r): r is Row => r !== undefined);
      return { rows: await decorate(def, rows, req.user), total, page, pageSize };
    });

    // A figure: the same counts for everyone who may view the type, restricted records included
    // (buildWhere, figures). A restricted record is grouped under "Restricted records" when the
    // grouping field is one of its details; a restricted related record is labeled "Restricted".
    app.get(`${def.path}/stats`, async (req) => {
      authorize(req, def, 'view');
      const query = req.query as Record<string, string>;
      const group = query.group;
      const customDefs = await custom.defs(def.type);
      const f = def.fields[group] ?? customDefs[group];
      if (!f || !IDENT.test(group) || f.multiple) fail(400, 'bad_group', `Cannot group by "${group}".`);
      const { where, params, everyone } = buildWhere(def, query, req.user, customDefs, true);
      const col = columnSql(group, f);
      const value = everyone && def.restricted === 'flag' && DETAIL_TYPES.has(f.type)
        ? `case when coalesce(restricted, false) and ${col} is not null then ${MASKED_SQL} else ${col}::text end`
        : `${col}::text`;
      const rows = await db.query<{ value: string | null; count: number }>(
        `select ${value} as value, count(*)::int as count from ${def.table} where ${where} group by 1 order by 2 desc`,
        params,
      );
      const values = rows.map((r) => r.value).filter((v): v is string => v !== null && v !== MASKED_VALUE);
      const list = f.type === 'lookup' ? await lookups.values(f.list!) : [];
      const names = f.type === 'user' ? await userNames(values) : new Map<string, string>();
      const refs = f.type === 'ref' ? await labelsFor(f.to!, values, req.user) : new Map<string, RecordLabel>();
      const groups = rows.map((r) => {
        if (r.value === MASKED_VALUE) return { value: null, label: MASKED_LABEL, color: 'gray', count: r.count, restricted: true };
        const lv = list.find((x) => x.value === r.value);
        const label = r.value === null ? 'None'
          : f.type === 'lookup' ? lv?.label ?? r.value
          : f.type === 'user' ? names.get(r.value) ?? 'Unknown user'
          : f.type === 'ref' ? refs.get(r.value)?.label ?? 'Unknown'
          : f.type === 'boolean' ? (r.value === 'true' ? 'Yes' : 'No')
          : r.value;
        return { value: r.value, label, color: lv?.color ?? 'gray', count: r.count };
      });
      if (f.type === 'lookup') {
        const pos = (v: string | null) => { const i = list.findIndex((x) => x.value === v); return i < 0 ? 1e9 : i; };
        groups.sort((a, b) => pos(a.value) - pos(b.value));
      }
      return { groups, total: groups.reduce((n, g) => n + g.count, 0) };
    });

    app.get(`${def.path}/:id`, async (req) => {
      authorize(req, def, 'view');
      const row = (await find(def.type, (req.params as any).id, req.user)) ?? fail(404, 'not_found', `${def.label} not found.`);
      return (await decorate(def, [row], req.user))[0];
    });

    app.post(def.path, async (req, reply) => {
      authorize(req, def, 'create');
      const row = await create(def.type, (req.body ?? {}) as Row, req);
      reply.code(201);
      return (await decorate(def, [row], req.user))[0];
    });

    app.patch(`${def.path}/:id`, async (req) => {
      authorize(req, def, 'edit');
      const row = await update(def.type, (req.params as any).id, (req.body ?? {}) as Row, req);
      return (await decorate(def, [row], req.user))[0];
    });

    app.delete(`${def.path}/:id`, async (req) => {
      authorize(req, def, 'delete');
      const id = (req.params as any).id;
      const row = (await find(def.type, id, req.user)) ?? fail(404, 'not_found', `${def.label} not found.`);
      await db.query(`update ${def.table} set deleted_at = now(), updated_by = $2 where id = $1`, [id, req.user!.id]);
      await audit(req, {
        action: `${def.type}.delete`, recordType: def.type, recordId: id,
        summary: `${def.label} deleted: ${labelOf(def, row)}`, before: { ...pickFields(def, row), ...customOf(row) },
      });
      await emit({ action: 'delete', def, row, req });
      return { ok: true };
    });
  }

  const registry: ResourceRegistry = {
    get: (type) => defs.get(type),
    all: () => [...defs.values()],
    labelFor: async (type, id) => (await labelsFor(type, [id], null)).get(id)?.label ?? null,
    find,
    create,
    update,
    visibleWhere: (type, user, alias) => {
      const def = defs.get(type);
      return def ? visibilitySql(def, user, alias) : 'false';
    },
  };

  /**
   * Removes a record for good, with what hangs off it in core tables. The only caller is the
   * retention review (core/retention.ts): an explicit, audited administrator action.
   */
  async function purge(type: string, id: string, req: FastifyRequest | null): Promise<Row> {
    const def = need(type);
    const row = (await db.one<Row>(`select * from ${def.table} where id = $1`, [id])) ?? fail(404, 'not_found', `${def.label} not found.`);
    await db.tx(async (tx) => {
      await tx.query(`delete from ${def.table} where id = $1`, [id]);
      await tx.query('delete from search_index where record_type = $1 and record_id = $2', [type, id]);
      await tx.query('delete from comments where record_type = $1 and record_id = $2', [type, id]);
      await tx.query('delete from record_tags where record_type = $1 and record_id = $2', [type, id]);
      await tx.query('delete from record_watchers where record_type = $1 and record_id = $2', [type, id]);
      await tx.query('delete from record_links where (from_type = $1 and from_id = $2) or (to_type = $1 and to_id = $2)', [type, id]);
    });
    await emit({ action: 'purge', def, row, req });
    return row;
  }

  /** The record, if the caller may see it (and do `action` on its type); otherwise a 404 that does not reveal whether it exists. */
  async function visibleRecord(req: FastifyRequest, type: unknown, id: unknown, action = 'view'): Promise<{ def: ResourceDef; row: Row }> {
    const def = typeof type === 'string' ? defs.get(type) : undefined;
    if (!def || !mayAccess(req.user, def, action)) fail(404, 'not_found', 'Record not found.');
    const row = await find(def!.type, String(id ?? ''), req.user);
    if (!row) fail(404, 'not_found', 'Record not found.');
    return { def: def!, row: row! };
  }

  // Record fact sheets (PDF) and the generic import of any record type.
  registerExportRoutes({ app, db, audit, custom, decorate, visibleRecord, labelOf });
  registerImportRoutes({
    app, db, audit, registry, lookups, mayAccess, visibilitySql, customDefs: (type) => custom.defs(type),
    validate: (def, input, mode, system) => validate(def, input, mode, system),
  });

  return {
    registry, defineResource, labelsFor, mayAccess, visibilitySql,
    /** Whether files on this type are evidence (ResourceDef.evidence, else EVIDENCE_TYPES). */
    evidenceFor: (def: ResourceDef) => def.evidence ?? EVIDENCE_TYPES.has(def.type),
    decorate, userNames, labelOf, pickFields, customOf, visibleRecord,
    /** Record types with a working full-text index. */
    ftsTypes,
    /** Subscribes to record changes (webhooks, watchers). */
    onChange: (fn: ChangeListener) => { listeners.push(fn); },
    ensureCustomColumn, refreshSearch, purge,
    /** Allowed status changes and required fields per record type (core/lifecycle.ts). */
    lifecycles,
  };
}
