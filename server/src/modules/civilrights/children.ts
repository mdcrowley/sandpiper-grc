// Rows that belong to one record and are not records of their own: a program's elements, notices and
// language items, a complaint's investigation steps and letters, an award's participating firms. One
// set of routes per kind of row (list, add, change, remove), each checked against the parent record:
// the caller must be able to see it (its row rule included) and hold the edit permission to change it.
// Who did something (`checked_by`, `done_by`) is `actorOf(req)`, so a data load records the person it
// names; dates given in the body are kept as given.
import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../core/dataload.ts';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, Row, SessionUser } from '../../core/module.ts';

export type ChildField =
  | { kind: 'text' | 'longtext'; required?: boolean; max?: number }
  | { kind: 'date' }
  | { kind: 'bool' }
  | { kind: 'number'; min?: number }
  | { kind: 'lookup'; list: string }
  | { kind: 'ref'; to: string };

export interface ChildDef {
  table: string;
  parentType: string;
  parentColumn: string;
  /** API base of the parent ('/api/civil-rights/programs'); the rows are at `${base}/:id/${segment}`. */
  base: string;
  segment: string;
  tag: string;
  /** What one row is called, for messages and the audit ("Element"). */
  label: (row: Row) => string;
  /** Allowed values of the `kind` column, when the table has one. */
  kinds?: string[];
  fields: Record<string, ChildField>;
  /** Columns stamped with the person (id and name) when the date column is first filled. */
  stamp?: { date: string; id: string; name: string };
  /** Defaults by kind for new rows. */
  defaults?: (kind: string | null) => Row;
  /** Called after any change (the parent's figures or dates may follow). */
  after?: (req: FastifyRequest, parentId: string) => Promise<void>;
  /** Refuses a change with a reason (409), for example a closed complaint. */
  locked?: (parent: Row) => string | null;
  view: string;
  edit: string;
  summary: string;
  /** The body the add route takes, for the API description. */
  body: string;
}

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function defineChildRows(ctx: ModuleContext, def: ChildDef) {
  const { app, db } = ctx;
  const invalid = (fields: Record<string, string>): never => ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const path = `${def.base}/:id/${def.segment}`;
  const itemPath = `${path}/:itemId`;
  const parentLabel = () => ctx.resources.get(def.parentType)?.label ?? 'Record';

  const parentFor = async (req: FastifyRequest): Promise<Row> => {
    const id = String((req.params as { id: string }).id ?? '');
    const row = UUID_RE.test(id) ? await ctx.resources.find(def.parentType, id, req.user) : undefined;
    return row ?? ctx.fail(404, 'not_found', `${parentLabel()} not found.`);
  };

  /** Label of a linked record the caller may see; undefined when it is gone, hidden or its area is off. */
  const refLabel = async (type: string, id: unknown, user: SessionUser | null | undefined): Promise<string | undefined> => {
    if (typeof id !== 'string' || !ctx.resources.get(type)) return undefined;
    const def2 = ctx.resources.get(type)!;
    const row = await ctx.resources.find(type, id, user);
    if (!row) return undefined;
    return [def2.ref ? row[def2.ref.field] : null, row[def2.titleField]].filter(Boolean).join(' ');
  };

  async function list(parentId: string, user: SessionUser | null | undefined, kind?: string): Promise<Row[]> {
    const rows = await db.query<Row>(
      `select * from ${def.table} where ${def.parentColumn} = $1 ${kind ? 'and kind = $2' : ''} order by ${def.kinds ? 'kind, ' : ''}sort, created_at, id`,
      kind ? [parentId, kind] : [parentId]);
    const out: Row[] = [];
    for (const r of rows) {
      const shown: Row = { ...r };
      for (const [name, f] of Object.entries(def.fields)) {
        if (f.kind !== 'ref') continue;
        const label = await refLabel(f.to, r[name], user);
        // A link the reader may not open (or whose area is off) is not named.
        if (label === undefined) shown[name] = null;
        shown[`${name}_label`] = label ?? null;
      }
      for (const k of ['due_on', 'done_on', 'checked_on']) if (shown[k] instanceof Date) shown[k] = (shown[k] as Date).toISOString().slice(0, 10);
      out.push(shown);
    }
    return out;
  }

  /** The columns a body sets, checked. */
  async function readBody(req: FastifyRequest, b: Row, creating: boolean): Promise<Row> {
    const errors: Record<string, string> = {};
    const out: Row = {};
    for (const [name, f] of Object.entries(def.fields)) {
      if (!(name in b)) {
        if (creating && 'required' in f && f.required) errors[name] = 'Required.';
        continue;
      }
      const v = b[name];
      if (v === null || v === '' || v === undefined) {
        if ('required' in f && f.required) errors[name] = 'Required.';
        else out[name] = f.kind === 'bool' ? false : null;
        continue;
      }
      switch (f.kind) {
        case 'text': case 'longtext': {
          const s = String(v).trim();
          const max = f.max ?? (f.kind === 'text' ? 300 : 4000);
          if (s.length > max) errors[name] = `At most ${max} characters.`;
          else if (!s && f.required) errors[name] = 'Required.';
          else out[name] = s || null;
          break;
        }
        case 'date': if (!isDate(v)) errors[name] = 'Give a date (YYYY-MM-DD).'; else out[name] = v; break;
        case 'bool': out[name] = v === true || v === 'true'; break;
        case 'number': {
          const n = Number(v);
          if (!Number.isFinite(n) || (f.min !== undefined && n < f.min)) errors[name] = `Give a number${f.min !== undefined ? ` of at least ${f.min}` : ''}.`;
          else out[name] = n;
          break;
        }
        case 'lookup':
          if (!(await ctx.lookups.values(f.list)).some((x) => x.value === String(v))) errors[name] = 'Choose from the list.';
          else out[name] = String(v);
          break;
        case 'ref':
          if (!ctx.resources.get(f.to)) break; // its area is off: the field is not offered
          if (typeof v !== 'string' || !UUID_RE.test(v) || !(await ctx.resources.find(f.to, v, req.user))) errors[name] = 'Choose a record you can see.';
          else out[name] = v;
          break;
      }
    }
    if (def.kinds) {
      if (creating) {
        if (!def.kinds.includes(String(b.kind))) errors.kind = `Kind is one of: ${def.kinds.join(', ')}.`;
        else out.kind = String(b.kind);
      }
    }
    if (Object.keys(errors).length) invalid(errors);
    return out;
  }

  const findItem = async (req: FastifyRequest, parentId: string): Promise<Row> => {
    const itemId = String((req.params as { itemId: string }).itemId ?? '');
    const row = UUID_RE.test(itemId) ? await db.one<Row>(`select * from ${def.table} where id = $1 and ${def.parentColumn} = $2`, [itemId, parentId]) : undefined;
    return row ?? ctx.fail(404, 'not_found', 'Not found.');
  };

  const checkLocked = (parent: Row) => {
    const why = def.locked?.(parent);
    if (why) ctx.fail(409, 'locked', why);
  };

  app.get(path, { preHandler: ctx.requirePerm(def.view) }, async (req) => {
    const parent = await parentFor(req);
    const kind = (req.query as Row).kind;
    if (kind !== undefined && def.kinds && !def.kinds.includes(String(kind))) invalid({ kind: `Kind is one of: ${def.kinds.join(', ')}.` });
    return { rows: await list(parent.id, req.user, kind === undefined ? undefined : String(kind)) };
  });
  ctx.describeRoute({ method: 'GET', path, tag: def.tag, permission: def.view, summary: `List: ${def.summary}`, query: def.kinds ? { kind: `Optional: ${def.kinds.join(', ')}` } : undefined, response: '{ rows: [...] }' });

  app.post(path, { preHandler: ctx.requirePerm(def.edit) }, async (req, reply) => {
    const parent = await parentFor(req);
    checkLocked(parent);
    const b = (req.body ?? {}) as Row;
    const data = await readBody(req, b, true);
    const values: Row = { ...(def.defaults?.(data.kind ?? null) ?? {}), ...data };
    if (def.stamp && values[def.stamp.date]) {
      const who = actorOf(req);
      values[def.stamp.id] = who.id;
      values[def.stamp.name] = who.name;
    }
    const max = await db.one<{ n: number }>(`select coalesce(max(sort), 0)::int n from ${def.table} where ${def.parentColumn} = $1`, [parent.id]);
    values.sort = (max?.n ?? 0) + 10;
    values.created_by = actorOf(req).id;
    values[def.parentColumn] = parent.id;
    const cols = Object.keys(values);
    const row = (await db.one<Row>(
      `insert into ${def.table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, cols.map((c) => values[c])))!;
    await ctx.audit(req, {
      action: `${def.parentType}.${def.segment}_add`, recordType: def.parentType, recordId: parent.id,
      summary: `${def.label(row)} added: ${row.title ?? row.firm_name ?? ''}`.trim(), after: data,
    });
    await def.after?.(req, parent.id);
    reply.code(201);
    return (await list(parent.id, req.user)).find((r) => r.id === row.id);
  });
  ctx.describeRoute({ method: 'POST', path, tag: def.tag, permission: def.edit, summary: `Add: ${def.summary}`, body: def.body });

  app.patch(itemPath, { preHandler: ctx.requirePerm(def.edit) }, async (req) => {
    const parent = await parentFor(req);
    checkLocked(parent);
    const item = await findItem(req, parent.id);
    const patch = await readBody(req, (req.body ?? {}) as Row, false);
    if (def.stamp && def.stamp.date in patch) {
      if (patch[def.stamp.date] && !item[def.stamp.date]) {
        const who = actorOf(req);
        patch[def.stamp.id] = who.id;
        patch[def.stamp.name] = who.name;
      } else if (!patch[def.stamp.date]) {
        patch[def.stamp.id] = null;
        patch[def.stamp.name] = null;
      }
    }
    const keys = Object.keys(patch);
    if (keys.length) {
      await db.query(`update ${def.table} set ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [item.id, ...keys.map((k) => patch[k])]);
      await ctx.audit(req, {
        action: `${def.parentType}.${def.segment}_change`, recordType: def.parentType, recordId: parent.id,
        summary: `${def.label(item)} changed: ${item.title ?? item.firm_name ?? ''}`.trim(),
        before: Object.fromEntries(keys.filter((k) => !k.endsWith('_by') && !k.endsWith('_name')).map((k) => [k, item[k]])),
        after: Object.fromEntries(keys.filter((k) => !k.endsWith('_by') && !k.endsWith('_name')).map((k) => [k, patch[k]])),
      });
      await def.after?.(req, parent.id);
    }
    return (await list(parent.id, req.user)).find((r) => r.id === item.id);
  });
  ctx.describeRoute({ method: 'PATCH', path: itemPath, tag: def.tag, permission: def.edit, summary: `Change: ${def.summary}`, body: def.body });

  app.delete(itemPath, { preHandler: ctx.requirePerm(def.edit) }, async (req) => {
    const parent = await parentFor(req);
    checkLocked(parent);
    const item = await findItem(req, parent.id);
    await db.query(`delete from ${def.table} where id = $1`, [item.id]);
    await ctx.audit(req, {
      action: `${def.parentType}.${def.segment}_remove`, recordType: def.parentType, recordId: parent.id,
      summary: `${def.label(item)} removed: ${item.title ?? item.firm_name ?? ''}`.trim(), before: item,
    });
    await def.after?.(req, parent.id);
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: itemPath, tag: def.tag, permission: def.edit, summary: `Remove: ${def.summary}` });

  return { list };
}
