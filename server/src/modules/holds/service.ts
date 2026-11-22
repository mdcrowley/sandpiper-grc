// Legal holds: placing records under a hold, saved queries, and what a reader may see of a hold's
// records (E34-01). The hold itself is enforced in core (`core/holds.ts`), whatever is loaded or on.
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import type { ModuleContext, ResourceDef, Row, SessionUser } from '../../core/module.ts';

export const HOLD_TYPE = 'legal_hold';
const IDENT = /^[a-z_][a-z0-9_]*$/;
const STD_FIELDS = new Set(['created_at', 'updated_at', 'deleted_at']);
/** The most records one saved query may add in one run (a hold is a list people read, not a dump). */
export const QUERY_LIMIT = 5000;

export interface RecordRef { type: string; id: string }

/** Whether a person may see records of a type at all (its module's view permission, and security for restricted types). */
export function mayViewType(ctx: ModuleContext, user: SessionUser | null | undefined, def: ResourceDef): boolean {
  if (!user) return false;
  if (!ctx.can(user, `${def.module}.view`)) return false;
  return def.restricted !== true || ctx.can(user, 'security.view');
}

/**
 * Adds records to a hold. `byHand` puts back a record taken off before; a saved query (`queryId`)
 * never does, so a record someone took off by hand stays off. Answers how many were added.
 */
export async function addRecords(ctx: ModuleContext, holdId: string, records: RecordRef[], by: string | null, opts: { queryId?: string | null } = {}): Promise<number> {
  let added = 0;
  for (const r of records) {
    const row = opts.queryId
      ? await ctx.db.one(
        `insert into legal_hold_records (hold_id, record_type, record_id, query_id, added_by) values ($1,$2,$3,$4,$5)
         on conflict (hold_id, record_type, record_id) do nothing returning id`, [holdId, r.type, r.id, opts.queryId, by])
      : await ctx.db.one(
        `insert into legal_hold_records (hold_id, record_type, record_id, added_by) values ($1,$2,$3,$4)
         on conflict (hold_id, record_type, record_id) do update set released_at = null, released_by = null, added_by = excluded.added_by, added_at = now()
           where legal_hold_records.released_at is not null
         returning id`, [holdId, r.type, r.id, by]);
    if (row) added += 1;
  }
  return added;
}

/**
 * Places records under a hold (contract C1): an existing active hold (`holdId`), or a new one opened
 * for `matter`. The caller has already checked that the person may see each record. A records request
 * uses it to preserve its responsive records.
 */
export async function placeHold(ctx: ModuleContext, input: { holdId?: string; matter?: string; records: RecordRef[] }, req: FastifyRequest | null): Promise<{ holdId: string; ref: string; added: number }> {
  let hold: Row | undefined;
  if (input.holdId) {
    hold = UUID_RE.test(input.holdId) ? await ctx.db.one<Row>(`select * from legal_holds where id = $1 and deleted_at is null`, [input.holdId]) : undefined;
    if (!hold) ctx.fail(404, 'not_found', 'Legal hold not found.');
    if (hold!.status !== 'active') ctx.fail(409, 'released', `Legal hold ${hold!.ref} has been released; place a new hold instead.`);
  } else {
    const matter = String(input.matter ?? '').trim();
    if (!matter) ctx.fail(400, 'validation', 'Check the highlighted fields.', { matter: 'Say what the hold is for.' });
    hold = await ctx.resources.create(HOLD_TYPE, { matter: matter.slice(0, 300) }, req);
  }
  const records = input.records.filter((r) => r && typeof r.type === 'string' && UUID_RE.test(String(r.id)));
  const added = await addRecords(ctx, hold!.id, records, req?.user?.id ?? null);
  if (added) {
    await ctx.audit(req, {
      action: 'legal_hold.records_add', recordType: HOLD_TYPE, recordId: hold!.id,
      summary: `${added} record${added === 1 ? '' : 's'} placed under legal hold ${hold!.ref}`,
      after: { records: records.slice(0, 200) },
    });
  }
  return { holdId: hold!.id, ref: hold!.ref, added };
}

// ---------------------------------------------------------------- saved queries

/** A saved query's filters, checked against the type: the list API's `f.<field>[.op]` keys. */
export function cleanFilters(def: ResourceDef, raw: unknown): { filters: Record<string, string>; error?: string } {
  const filters: Record<string, string> = {};
  if (raw === undefined || raw === null) return { filters };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { filters, error: 'Send the filters as { "f.<field>": "value" }.' };
  for (const [key, value] of Object.entries(raw as Row)) {
    const [f, name, op, extra] = key.split('.');
    if (f !== 'f' || !name || extra !== undefined || !IDENT.test(name)) return { filters, error: `"${key}" is not a filter: use f.<field>, f.<field>.null, .gt, .lt, .gte or .lte.` };
    const field = def.fields[name];
    if (!field && !STD_FIELDS.has(name)) return { filters, error: `${def.plural} have no field "${name}".` };
    if (op !== undefined && !['null', 'gt', 'lt', 'gte', 'lte'].includes(op)) return { filters, error: `Unknown filter operator "${op}".` };
    const type = field?.type ?? 'datetime';
    if (['gt', 'lt', 'gte', 'lte'].includes(op ?? '') && !['date', 'datetime', 'number', 'currency'].includes(type)) {
      return { filters, error: `"${name}" cannot be compared; filter it by value.` };
    }
    const v = String(value ?? '').trim();
    if (!v) continue;
    filters[key] = v.slice(0, 500);
  }
  return { filters };
}

/**
 * The ids of every record of a type a saved query matches, as system work: restricted records and
 * records already deleted from lists (still kept) count too, because a hold must cover them all.
 */
export async function matchQuery(ctx: ModuleContext, def: ResourceDef, q: string | null, filters: Record<string, string>): Promise<string[]> {
  const where: string[] = ['true'];
  const params: unknown[] = [];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  const text = String(q ?? '').trim();
  if (text) {
    const like = add(`%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const cols = [...new Set([def.titleField, ...(def.ref ? [def.ref.field] : []), ...(def.searchable ?? [])])].filter((c) => IDENT.test(c));
    where.push(`(${cols.map((c) => `${c}::text ilike ${like}`).join(' or ')})`);
  }
  for (const [key, value] of Object.entries(filters)) {
    const [, name, op] = key.split('.');
    const field = def.fields[name];
    const type = field?.type ?? 'datetime';
    if (!op) where.push(`${name}::text = any(${add(value.split(','))}::text[])`);
    else if (op === 'null') where.push(`${name} is ${value === 'true' ? '' : 'not '}null`);
    else {
      const cast = type === 'date' ? 'date' : type === 'datetime' ? 'timestamptz' : 'numeric';
      const sym = { gt: '>', lt: '<', gte: '>=', lte: '<=' }[op as 'gt'];
      where.push(`${name} ${sym} ${add(value)}::${cast}`);
    }
  }
  const rows = await ctx.db.query<{ id: string }>(
    `select id::text as id from ${def.table} where ${where.join(' and ')} order by created_at, id limit ${QUERY_LIMIT}`, params);
  return rows.map((r) => r.id);
}

/** Runs one saved query: adds the records it matches now (never removes any). */
export async function runQuery(ctx: ModuleContext, query: Row, req: FastifyRequest | null): Promise<{ matched: number; added: number; skipped?: string }> {
  const hold = await ctx.db.one<Row>(`select id, ref, status from legal_holds where id = $1 and deleted_at is null`, [query.hold_id]);
  if (!hold || hold.status !== 'active') return { matched: 0, added: 0, skipped: 'released' };
  // A type that is not loaded or is switched off is left until it is back; what it already holds stays held (core).
  const def = ctx.resources.get(query.record_type);
  if (!def) return { matched: query.matched ?? 0, added: 0, skipped: 'type_unavailable' };
  const { filters } = cleanFilters(def, query.filters ?? {});
  const ids = await matchQuery(ctx, def, query.q, filters);
  const added = await addRecords(ctx, hold.id, ids.map((id) => ({ type: def.type, id })), req?.user?.id ?? null, { queryId: query.id });
  await ctx.db.query('update legal_hold_queries set last_run_at = now(), matched = $2 where id = $1', [query.id, ids.length]);
  if (added) {
    await ctx.audit(req, {
      action: 'legal_hold.query_run', recordType: HOLD_TYPE, recordId: hold.id,
      summary: `Saved query on ${def.plural.toLowerCase()} added ${added} record${added === 1 ? '' : 's'} to legal hold ${hold.ref}`,
    });
  }
  return { matched: ids.length, added };
}

/** Re-runs every saved query of every active hold (the nightly job `holds.queries`). */
export async function runAllQueries(ctx: ModuleContext): Promise<{ queries: number; added: number }> {
  const queries = await ctx.db.query<Row>(
    `select q.* from legal_hold_queries q join legal_holds h on h.id = q.hold_id
     where h.status = 'active' and h.deleted_at is null order by q.created_at`);
  let added = 0;
  for (const q of queries) added += (await runQuery(ctx, q, null)).added;
  return { queries: queries.length, added };
}

// ---------------------------------------------------------------- reading a hold's records

/**
 * The records of a hold the reader may see, and the counts. The counts are figures: they include every
 * held record, also those the reader may not see and those of a type that is switched off.
 */
export async function holdRecords(ctx: ModuleContext, holdId: string, user: SessionUser | null | undefined): Promise<{ rows: Row[]; total: number; hidden: number; released: number }> {
  const entries = await ctx.db.query<Row>(
    `select r.id, r.record_type, r.record_id::text as record_id, r.query_id, r.added_at, r.released_at,
       u.display_name as added_by_name
     from legal_hold_records r left join users u on u.id = r.added_by
     where r.hold_id = $1 order by r.released_at nulls first, r.added_at desc, r.id`, [holdId]);
  const active = entries.filter((e) => !e.released_at);
  const rows: Row[] = [];
  for (const type of new Set(entries.map((e) => e.record_type))) {
    const def = ctx.resources.get(type);
    if (!def || !mayViewType(ctx, user, def)) continue;
    const mine = entries.filter((e) => e.record_type === type);
    const cols = [`id::text as id`, `${def.titleField}::text as label`, def.ref ? `${def.ref.field}::text as ref` : 'null as ref', 'deleted_at'];
    const found = new Map((await ctx.db.query<Row>(
      `select ${cols.join(', ')} from ${def.table} where id = any($1::uuid[]) and ${ctx.resources.visibleWhere(type, user ?? null)}`,
      [mine.map((e) => e.record_id)])).map((r) => [r.id, r]));
    for (const e of mine) {
      const rec = found.get(e.record_id);
      if (!rec) continue;
      rows.push({
        id: e.id, record_type: type, typeLabel: def.label, record_id: e.record_id, label: rec.label ?? def.label, ref: rec.ref ?? null,
        route: rec.deleted_at ? null : `${def.route}/${e.record_id}`, deleted: Boolean(rec.deleted_at),
        via: e.query_id ? 'query' : 'hand', added_at: e.added_at, added_by_name: e.added_by_name ?? null, released_at: e.released_at,
      });
    }
  }
  const order = new Map(entries.map((e, i) => [e.id, i]));
  rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const visibleActive = rows.filter((r) => !r.released_at).length;
  return { rows, total: active.length, hidden: active.length - visibleActive, released: entries.length - active.length };
}
