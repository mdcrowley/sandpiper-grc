import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { FieldDef, ResourceDef, ResourceRegistry, Row, SessionUser } from './module.ts';
import { can, type makeAudit, type makeLookups } from './services.ts';

const IDENT = /^[a-z_][a-z0-9_]*$/;
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
}

export interface RecordLabel { label: string; ref: string | null; hidden: boolean }

export function makeResources({ app, db, audit, lookups }: Deps) {
  const defs = new Map<string, ResourceDef>();

  /** null user = the system (seeding, automation) and sees everything. */
  const seesRestricted = (user: SessionUser | null | undefined) => !user || can(user, 'security.view');

  const mayAccess = (user: SessionUser | null, def: ResourceDef, action: string) =>
    can(user, `${def.module}.${action}`) && (def.restricted !== true || can(user, 'security.view'));

  function authorize(req: FastifyRequest, def: ResourceDef, action: string) {
    if (!mayAccess(req.user, def, action)) fail(403, 'forbidden', 'You do not have permission to do that.');
  }

  function visibilitySql(def: ResourceDef, user: SessionUser | null | undefined): string {
    if (seesRestricted(user)) return 'true';
    if (def.restricted === true) return 'false';
    if (def.restricted === 'flag') return 'coalesce(restricted, false) = false';
    return 'true';
  }

  const need = (type: string): ResourceDef => defs.get(type) ?? fail(404, 'unknown_type', `Unknown record type "${type}".`);

  // ---------- validation ----------

  async function validate(def: ResourceDef, input: Row, mode: 'create' | 'update', system: boolean): Promise<Row> {
    const errors: Record<string, string> = {};
    const out: Row = {};
    const listCache = new Map<string, Set<string>>();
    for (const [name, f] of Object.entries(def.fields)) {
      if (f.readOnly && !system) continue;
      let v = input[name];
      if (v === undefined) {
        if (mode === 'update') continue;
        if (f.default !== undefined) v = f.default;
        else if (f.required) { errors[name] = `${f.label} is required.`; continue; } else continue;
      }
      if (typeof v === 'string') v = f.type === 'longtext' || f.type === 'json' ? v : v.trim();
      if (v === null || v === '') {
        if (f.required) errors[name] = `${f.label} is required.`;
        else out[name] = null;
        continue;
      }
      switch (f.type) {
        case 'text': case 'longtext':
          out[name] = String(v);
          break;
        case 'number': case 'currency': {
          const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
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
          let allowed = listCache.get(f.list!);
          if (!allowed) {
            allowed = new Set((await lookups.values(f.list!)).map((x) => x.value));
            listCache.set(f.list!, allowed);
          }
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

  async function create(type: string, input: Row, req: FastifyRequest | null = null): Promise<Row> {
    const def = need(type);
    let data = await validate(def, input, 'create', !req);
    if (def.hooks?.beforeCreate) data = await def.hooks.beforeCreate(req, data);
    if (def.ref && !data[def.ref.field]) data[def.ref.field] = await nextRef(def.ref.prefix);
    data.created_by = data.updated_by = req?.user?.id ?? null;
    const { cols, marks, params } = sqlValues(data);
    const row = (await db.one<Row>(
      `insert into ${def.table} (${cols.join(', ')}) values (${marks.join(', ')}) returning *`, params,
    ))!;
    await audit(req, {
      action: `${type}.create`, recordType: type, recordId: row.id,
      summary: `${def.label} created: ${labelOf(def, row)}`, after: pickFields(def, row),
    });
    await def.hooks?.afterCreate?.(req, row);
    return row;
  }

  async function update(type: string, id: string, input: Row, req: FastifyRequest | null = null): Promise<Row> {
    const def = need(type);
    const existing = (await find(type, id, req?.user)) ?? fail(404, 'not_found', `${def.label} not found.`);
    let patch = await validate(def, input, 'update', !req);
    if (def.hooks?.beforeUpdate) patch = await def.hooks.beforeUpdate(req, existing, patch);
    const before: Row = {};
    const after: Row = {};
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(normalise(existing[k])) !== JSON.stringify(normalise(v))) {
        before[k] = existing[k];
        after[k] = v;
      }
    }
    if (!Object.keys(after).length) return existing;
    const { cols, marks, params } = sqlValues(after, 3);
    const row = (await db.one<Row>(
      `update ${def.table} set ${cols.map((c, i) => `${c} = ${marks[i]}`).join(', ')},
         updated_at = now(), updated_by = $2 where id = $1 returning *`,
      [id, req?.user?.id ?? null, ...params],
    ))!;
    await audit(req, {
      action: `${type}.update`, recordType: type, recordId: id,
      summary: `${def.label} updated: ${labelOf(def, row)} (${Object.keys(after).map((k) => def.fields[k]?.label ?? k).join(', ')})`,
      before, after,
    });
    await def.hooks?.afterUpdate?.(req, existing, row);
    return row;
  }

  const normalise = (v: unknown) => (v instanceof Date ? v.toISOString() : v ?? null);
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
    const rows = await db.query<Row>(
      `select id, ${def.titleField}::text as label, ${def.ref ? def.ref.field : 'null'} as ref,
              ${def.restricted === 'flag' ? 'coalesce(restricted, false)' : 'false'} as flagged
       from ${def.table} where id = any($1::uuid[])`,
      [clean],
    );
    for (const r of rows) {
      const hidden = !sees && (def.restricted === true || r.flagged);
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
    const fields = { ...def.fields, created_by: STD_FIELDS.created_by, updated_by: STD_FIELDS.updated_by };
    const entries = Object.entries(fields);
    const allLookups = entries.some(([, f]) => f.type === 'lookup') ? await lookups.all() : {};
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
        if (f.type === 'lookup') d[k] = allLookups[f.list!]?.find((x) => x.value === v)?.label ?? String(v);
        else if (f.type === 'user') d[k] = names.get(v) ?? 'Unknown user';
        else if (f.type === 'ref') d[k] = refLabels.get(f.to!)?.get(v)?.label ?? 'Unknown';
      }
      row._display = d;
    }
    return rows;
  }

  // ---------- list queries ----------

  function buildWhere(def: ResourceDef, query: Record<string, string>, user: SessionUser | null) {
    const where = ['deleted_at is null', visibilitySql(def, user)];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const fieldOf = (name: string) => def.fields[name] ?? STD_FIELDS[name];

    const q = String(query.q ?? '').trim();
    if (q) {
      const cols = [...(def.searchable ?? [def.titleField]), ...(def.ref ? [def.ref.field] : [])];
      const p = add(`%${q.replace(/[%_\\]/g, '\\$&')}%`);
      where.push(`(${cols.map((c) => `${c}::text ilike ${p}`).join(' or ')})`);
    }
    for (const [key, raw] of Object.entries(query)) {
      if (!key.startsWith('f.')) continue;
      const [, name, op] = key.split('.');
      const f = fieldOf(name);
      if (!f || !IDENT.test(name)) fail(400, 'bad_filter', `Cannot filter on "${name}".`);
      const value = String(raw);
      const cast = f.type === 'date' ? 'date' : f.type === 'datetime' ? 'timestamptz' : 'numeric';
      if (!op) {
        const values = value.split(',').map((v) => (v === 'me' && f.type === 'user' ? user?.id ?? '' : v));
        where.push(`${name}::text = any(${add(values)}::text[])`);
      } else if (op === 'null') {
        where.push(`${name} is ${value === 'true' ? '' : 'not '}null`);
      } else if (['gt', 'lt', 'gte', 'lte'].includes(op)) {
        if (!['date', 'datetime', 'number', 'currency'].includes(f.type)) fail(400, 'bad_filter', `Cannot compare "${name}".`);
        const sym = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[op as 'gt'];
        where.push(`${name} ${sym} ${add(value)}::${cast}`);
      } else {
        fail(400, 'bad_filter', `Unknown filter operator "${op}".`);
      }
    }
    return { where: where.join(' and '), params };
  }

  function csvCell(v: unknown): string {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // ---------- registration ----------

  function defineResource(def: ResourceDef) {
    for (const name of [def.table, def.titleField, def.ref?.field, ...Object.keys(def.fields), ...(def.searchable ?? [])]) {
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
      const { where, params } = buildWhere(def, query, req.user);
      const sortField = (def.fields[query.sort] || STD_FIELDS[query.sort]) && IDENT.test(query.sort)
        ? query.sort : def.defaultSort?.field ?? 'created_at';
      const dir = (query.dir ?? (query.sort ? 'asc' : def.defaultSort?.dir ?? 'desc')) === 'desc' ? 'desc' : 'asc';
      const order = `order by ${sortField} ${dir} nulls last, id`;

      if (query.format === 'csv') {
        authorize(req, def, 'export');
        const rows = await decorate(def, await db.query(`select * from ${def.table} where ${where} ${order} limit 50000`, params), req.user);
        const names = Object.keys(def.fields);
        const lines = [names.map((n) => csvCell(def.fields[n].label)).join(',')];
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

      const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50));
      const page = Math.max(1, Number(query.page) || 1);
      const total = (await db.one<{ c: number }>(`select count(*)::int c from ${def.table} where ${where}`, params))!.c;
      const rows = await db.query(
        `select * from ${def.table} where ${where} ${order} limit ${pageSize} offset ${(page - 1) * pageSize}`, params,
      );
      return { rows: await decorate(def, rows, req.user), total, page, pageSize };
    });

    app.get(`${def.path}/stats`, async (req) => {
      authorize(req, def, 'view');
      const query = req.query as Record<string, string>;
      const group = query.group;
      const f = def.fields[group];
      if (!f || !IDENT.test(group)) fail(400, 'bad_group', `Cannot group by "${group}".`);
      const { where, params } = buildWhere(def, query, req.user);
      const rows = await db.query<{ value: string | null; count: number }>(
        `select ${group}::text as value, count(*)::int as count from ${def.table} where ${where} group by 1 order by 2 desc`,
        params,
      );
      const values = rows.map((r) => r.value).filter((v): v is string => v !== null);
      const list = f.type === 'lookup' ? await lookups.values(f.list!) : [];
      const names = f.type === 'user' ? await userNames(values) : new Map<string, string>();
      const refs = f.type === 'ref' ? await labelsFor(f.to!, values, req.user) : new Map<string, RecordLabel>();
      const groups = rows.map((r) => {
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
        summary: `${def.label} deleted: ${labelOf(def, row)}`, before: pickFields(def, row),
      });
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
  };

  return { registry, defineResource, labelsFor, mayAccess, visibilitySql, decorate };
}
