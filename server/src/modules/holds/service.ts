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
/** A page of a hold's records: the default and the most one request may ask for. */
export const HOLD_PAGE_SIZE = 100;
export const HOLD_PAGE_MAX = 500;

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
 * The records of a hold the reader may see, a page at a time (E40-09: a hold driven by a saved query can
 * cover tens of thousands of records), and the counts. The counts are figures: they include every held
 * record, also those the reader may not see and those of a type that is switched off. `state` picks the
 * records still held (`current`), those taken off (`released`) or both (the default, current first).
 * `shown` is how many rows of that state the reader may see, for paging.
 */
export async function holdRecords(
  ctx: ModuleContext, holdId: string, user: SessionUser | null | undefined,
  opts: { page?: number; pageSize?: number; state?: 'current' | 'released' | 'all' } = {},
): Promise<{ rows: Row[]; total: number; hidden: number; released: number; shown: number; page: number; pageSize: number }> {
  const page = Math.max(1, Math.trunc(opts.page ?? 1) || 1);
  const pageSize = Math.min(HOLD_PAGE_MAX, Math.max(1, Math.trunc(opts.pageSize ?? HOLD_PAGE_SIZE) || HOLD_PAGE_SIZE));
  const state = opts.state ?? 'all';
  const counts = (await ctx.db.one<{ active: number; released: number }>(
    `select count(*) filter (where released_at is null)::int as active, count(*) filter (where released_at is not null)::int as released
     from legal_hold_records where hold_id = $1`, [holdId]))!;
  const types = (await ctx.db.query<{ record_type: string }>('select distinct record_type from legal_hold_records where hold_id = $1', [holdId]))
    .map((r) => r.record_type);
  const parts: string[] = [];
  const params: unknown[] = [holdId];
  for (const type of types) {
    const def = ctx.resources.get(type);
    if (!def || !mayViewType(ctx, user, def) || !IDENT.test(def.table)) continue;
    params.push(type);
    parts.push(`select r.id, r.record_type, r.record_id::text as record_id, r.query_id, r.added_at, r.released_at, r.added_by,
        t.${def.titleField}::text as label, ${def.ref ? `t.${def.ref.field}::text` : 'null::text'} as ref, t.deleted_at
      from legal_hold_records r join ${def.table} t on t.id = r.record_id
      where r.hold_id = $1 and r.record_type = $${params.length} and ${ctx.resources.visibleWhere(type, user ?? null, 't')}`);
  }
  // Visible held records, counted whatever page is asked (hidden = held records the reader cannot see).
  let visibleActive = 0;
  let shown = 0;
  let found: Row[] = [];
  if (parts.length) {
    const stateSql = state === 'current' ? 'where v.released_at is null' : state === 'released' ? 'where v.released_at is not null' : '';
    const union = parts.join('\nunion all\n');
    const c = (await ctx.db.one<{ active: number; shown: number }>(
      `select count(*) filter (where v.released_at is null)::int as active,
              count(*) filter (where ${state === 'current' ? 'v.released_at is null' : state === 'released' ? 'v.released_at is not null' : 'true'})::int as shown
       from (${union}) v`, params))!;
    visibleActive = c.active;
    shown = c.shown;
    found = await ctx.db.query<Row>(
      `select v.*, u.display_name as added_by_name from (${union}) v left join users u on u.id = v.added_by ${stateSql}
       order by v.released_at nulls first, v.added_at desc, v.id limit ${pageSize} offset ${(page - 1) * pageSize}`, params);
  }
  const rows = found.map((e) => {
    const def = ctx.resources.get(e.record_type)!;
    return {
      id: e.id, record_type: e.record_type, typeLabel: def.label, record_id: e.record_id, label: e.label ?? def.label, ref: e.ref ?? null,
      route: e.deleted_at ? null : `${def.route}/${e.record_id}`, deleted: Boolean(e.deleted_at),
      via: e.query_id ? 'query' : 'hand', added_at: e.added_at, added_by_name: e.added_by_name ?? null, released_at: e.released_at,
    };
  });
  return { rows, total: counts.active, hidden: counts.active - visibleActive, released: counts.released, shown, page, pageSize };
}
