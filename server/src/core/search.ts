import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import type { ResourceDef } from './module.ts';

/**
 * Full-text search (E14-07).
 *
 * Every record type has one row per record in `search_index` (record_type, record_id, vector),
 * kept up to date by a trigger that the resource engine generates from the type's definition
 * (title, `searchable` fields, text custom fields) at start-up. A side table is used rather than a
 * column on each record table so that module tables, and `select *` over them, are unchanged.
 * Because it is a trigger, rows written by raw SQL (seeders, imports) are indexed too.
 *
 * Each field is indexed twice: with the language configuration (so "printers" finds "printer") and
 * with `simple` (so the last, half-typed word can be matched as a prefix whatever its stem).
 */

const IDENT = /^[a-z_][a-z0-9_]*$/;

/** PostgreSQL text-search configuration. GRC_SEARCH_LANGUAGE, default `english`. */
export const SEARCH_CONFIG = IDENT.test(String(process.env.GRC_SEARCH_LANGUAGE ?? '').toLowerCase())
  ? String(process.env.GRC_SEARCH_LANGUAGE).toLowerCase() : 'english';

/** Queries shorter than this fall back to substring matching. */
export const MIN_FTS_LENGTH = 3;

const esc = (s: string) => s.replace(/[%_\\]/g, '\\$&');

export interface ParsedSearch {
  /** The trimmed query. */
  text: string;
  /** `%text%` with wildcards escaped, for ILIKE. */
  like: string;
  /** False: too short or no words; use substring matching only. */
  fts: boolean;
  /** One word with no spaces: substring matching is kept as well, so codes and part-words still match. */
  single: boolean;
  /** SQL for the tsquery, given a function that registers a parameter and returns its placeholder. */
  tsquery(add: (v: unknown) => string): string;
}

export function parseSearch(raw: unknown): ParsedSearch {
  const text = String(raw ?? '').trim().slice(0, 200);
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const fts = text.length >= MIN_FTS_LENGTH && words.length > 0;
  // Quotes, a leading minus and "or" are websearch operators: leave such a query exactly as typed.
  const operators = /"|(^|\s)-\S|\sor\s/i.test(text);
  return {
    text, like: `%${esc(text)}%`, fts, single: !/\s/.test(text),
    tsquery(add) {
      const all = `websearch_to_tsquery('${SEARCH_CONFIG}', ${add(text)}::text)`;
      if (operators || !words.length) return all;
      // The last word may be half typed: match it as a prefix too.
      const prefix = `to_tsquery('simple', ${add(`${words[words.length - 1].toLowerCase()}:*`)}::text)`;
      if (words.length === 1) return `(${all} || ${prefix})`;
      const head = `websearch_to_tsquery('${SEARCH_CONFIG}', ${add(words.slice(0, -1).join(' '))}::text)`;
      return `(${all} || (${head} && ${prefix}))`;
    },
  };
}

/** The tsvector expression for one text value, in both configurations, with a weight. */
const vec = (expr: string, weight: 'A' | 'B' | 'C') =>
  `setweight(to_tsvector('${SEARCH_CONFIG}', coalesce(${expr}, '')), '${weight}') || setweight(to_tsvector('simple', coalesce(${expr}, '')), '${weight}')`;

/** The search vector of one row; `row` is `new` inside the trigger or a table alias in the backfill. */
export function vectorSql(def: ResourceDef, customKeys: string[], row: string): string {
  const parts: string[] = [vec(`${row}.${def.titleField}::text`, 'A')];
  if (def.ref) parts.push(`setweight(to_tsvector('simple', coalesce(${row}.${def.ref.field}::text, '')), 'A')`);
  for (const c of def.searchable ?? []) if (c !== def.titleField) parts.push(vec(`${row}.${c}::text`, 'B'));
  for (const k of customKeys) if (IDENT.test(k)) parts.push(vec(`${row}.custom->>'${k}'`, 'C'));
  return parts.join(' || ');
}

/**
 * The substring match on the index row `si`: `body ILIKE like`, written as LIKE on the lowercased
 * copy of the text kept beside it (`body_lc`, migration 029), which matches the same rows without
 * lowercasing every row on every query, and through the trigram index (E16-41).
 */
export const bodyLike = (like: string, si = 'si') => `${si}.body_lc like lower(${like}::text)`;

/** Separates fields in `search_index.body`, so a substring match never spans two of them. */
export const BODY_SEPARATOR = '';

/** The fields a record is matched on by substring: its searchable fields (else its title) and its reference. */
export const substringColumns = (def: ResourceDef) => [...(def.searchable ?? [def.titleField]), ...(def.ref ? [def.ref.field] : [])];

/**
 * The substring text of one row (`search_index.body`, E16-36): the substring fields joined by
 * BODY_SEPARATOR. `body ILIKE '%x%'` matches exactly when one of the fields does (for a pattern
 * without the separator), and a trigram index (migration 009) answers it without reading the table.
 */
export function bodySql(def: ResourceDef, row: string): string {
  return `concat_ws(chr(31), ${substringColumns(def).map((c) => `${row}.${c}::text`).join(', ')})`;
}

/**
 * The table a type's search trigger sits on: its own table, or, when its records are a view that
 * reads exactly one table holding every searched column under the same name (a view that adds
 * computed columns, such as `vulnerability_records`), that table. Null when there is none. Read
 * from the system catalog, which every role may read.
 */
export async function indexedTable(db: Db, def: ResourceDef, needsCustom: boolean): Promise<string | null> {
  const rel = await db.one<{ kind: string }>(`select c.relkind::text as kind from pg_class c where c.oid = to_regclass($1)`, [def.table]);
  if (!rel) return null;
  if (rel.kind === 'r' || rel.kind === 'p') return def.table;
  if (rel.kind !== 'v') return null;
  const bases = await db.query<{ base: string }>(
    `select distinct d.refobjid::regclass::text as base
     from pg_rewrite rw join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
     join pg_class c on c.oid = d.refobjid and c.relkind in ('r', 'p')
     where rw.ev_class = to_regclass($1) and d.refclassid = 'pg_class'::regclass and d.refobjid <> rw.ev_class`, [def.table]);
  if (bases.length !== 1 || !IDENT.test(bases[0].base)) return null;
  const base = bases[0].base;
  const cols = new Set((await db.query<{ name: string }>(
    `select attname::text as name from pg_attribute where attrelid = to_regclass($1) and attnum > 0 and not attisdropped`, [base])).map((r) => r.name));
  const needed = ['id', def.titleField, ...(def.ref ? [def.ref.field] : []), ...(def.searchable ?? []), ...(needsCustom ? ['custom'] : [])];
  return needed.every((c) => cols.has(c)) ? base : null;
}

// ---------- schema changes and the run-time role (E16-37) ----------

/**
 * Whether this connection may change `table`'s schema (its triggers, its columns): it owns the
 * table, or is a member of the role that does, and may create in the schema. False for a
 * least-privilege run-time role (E16-31), which must never attempt a schema change.
 */
export async function maySchemaChange(db: Pick<Db, 'one'>, table: string): Promise<boolean> {
  const row = await db.one<{ ok: boolean }>(
    `select pg_has_role(current_user, c.relowner, 'USAGE') and has_schema_privilege(current_user, c.relnamespace, 'CREATE') as ok
     from pg_class c where c.oid = to_regclass($1)`, [table]);
  return row?.ok === true;
}

/** Records a schema change the owner's migrate step must make (table `schema_requests`, migration 014). */
export async function requestSchemaChange(db: Pick<Db, 'query'>, kind: 'search' | 'custom_column' | 'register', target: string, detail: string): Promise<void> {
  const fresh = await db.query(
    `insert into schema_requests (kind, target, detail) values ($1, $2, $3)
     on conflict (kind, target) do update set detail = excluded.detail where schema_requests.detail is distinct from excluded.detail
     returning kind`, [kind, target, detail]);
  if (fresh.length && !process.env.VITEST) {
    console.warn(`[schema] waiting for the owner account: ${detail} Run migrate with GRC_DATABASE_MIGRATE_URL set (or restart the server with it set).`);
  }
}

/** Marks a recorded schema change as made. */
export async function schemaChangeDone(db: Pick<Db, 'query'>, kind: 'search' | 'custom_column' | 'register', target: string): Promise<void> {
  await db.query('delete from schema_requests where kind = $1 and target = $2', [kind, target]);
}

/**
 * Creates or refreshes the trigger that indexes one record type, and indexes rows that are missing.
 * Without the right to change the table (a least-privilege run-time role, E16-37) no trigger is
 * touched: the change is recorded for the owner's migrate step, and the type keeps its current
 * trigger (and so full-text search, on its earlier definition) until then.
 * Does nothing when the definition has not changed since the last start. Returns false when the
 * type cannot be indexed (the caller then searches it by substring).
 */
export async function ensureSearchIndex(db: Db, def: ResourceDef, customKeys: string[], known?: Map<string, string>): Promise<boolean> {
  if (![def.type, def.table, def.titleField, def.ref?.field ?? 'x', ...(def.searchable ?? [])].every((n) => IDENT.test(n))) return false;
  const fn = `${def.type}_search_tg`;
  // A type whose records are a view over one table (vulnerabilities, E16-38) is indexed through that
  // table: a trigger cannot sit on a view, and every write through the view reaches the table.
  let table: string | null;
  try {
    table = await indexedTable(db, def, customKeys.length > 0);
  } catch {
    table = null;
  }
  if (!table) {
    if (!process.env.VITEST) console.warn(`[search] ${def.type} is searched by substring only: ${def.table} is not a table or a view over one table`);
    return false;
  }
  const via = table === def.table ? '' : `|via ${table}`;
  // A view of a shared table (registers, E41-06: ResourceDef.partition): the trigger on that table
  // indexes only this type's rows, so no row is indexed as a type it does not belong to.
  const part = table !== def.table && def.partition && IDENT.test(def.partition.column) && /^[a-z0-9_]+$/.test(def.partition.value)
    ? def.partition : null;
  const signature = createHash('sha256').update(`v2|${def.table}${via}${part ? `|${part.column}=${part.value}` : ''}|${vectorSql(def, customKeys, 'new')}|${bodySql(def, 'new')}`).digest('hex');
  const backfill = (onlyMissing: boolean) => {
    const conds = [
      ...(part ? [`t.${part.column} = '${part.value}'`] : []),
      ...(onlyMissing ? [`not exists (select 1 from search_index si where si.record_type = '${def.type}' and si.record_id = t.id)`] : []),
    ];
    return `
    insert into search_index (record_type, record_id, vector, body)
    select '${def.type}', t.id, ${vectorSql(def, customKeys, 't')}, ${bodySql(def, 't')} from ${table} t
    ${conds.length ? `where ${conds.join(' and ')}` : ''}
    on conflict (record_type, record_id) do update set vector = excluded.vector, body = excluded.body;`;
  };
  try {
    const current = known ? known.get(def.type)
      : (await db.one<{ signature: string }>('select signature from search_index_state where table_name = $1', [def.type]))?.signature;
    if (current === signature) {
      // Rows loaded with triggers switched off (a restore from an export) are picked up here.
      await db.exec(backfill(true));
      return true;
    }
    if (!(await maySchemaChange(db, table))) {
      await requestSchemaChange(db, 'search', def.type, `The search index of ${def.plural.toLowerCase()} must be rebuilt (its searched fields changed).`);
      if (current === undefined) return false; // never built: substring matching until the owner builds it
      await db.exec(backfill(true));
      return true;
    }
    await db.exec(`
      create or replace function ${fn}() returns trigger language plpgsql as $search$
      begin
        begin
          insert into search_index (record_type, record_id, vector, body)
          values ('${def.type}', new.id, ${vectorSql(def, customKeys, 'new')}, ${bodySql(def, 'new')})
          on conflict (record_type, record_id) do update set vector = excluded.vector, body = excluded.body;
        exception when others then
          -- Indexing must never stop a record being saved. A text too long for a search vector
          -- keeps its substring text, so it can still be found by part of a word.
          begin
            insert into search_index (record_type, record_id, vector, body)
            values ('${def.type}', new.id, null, ${bodySql(def, 'new')})
            on conflict (record_type, record_id) do update set vector = null, body = excluded.body;
          exception when others then null;
          end;
        end;
        return null;
      end $search$;
      drop trigger if exists ${def.type}_search on ${table};
      create trigger ${def.type}_search after insert or update on ${table}
        for each row${part ? ` when (new.${part.column} = '${part.value}')` : ''} execute function ${fn}();
      ${backfill(false)}
      insert into search_index_state (table_name, signature) values ('${def.type}', '${signature}')
      on conflict (table_name) do update set signature = excluded.signature, built_at = now();`);
    await schemaChangeDone(db, 'search', def.type);
    return true;
  } catch (err) {
    if (!process.env.VITEST) console.warn(`[search] ${def.type} is searched by substring only: ${(err as Error).message}`);
    return false;
  }
}

export const HIT_START = '\u0001';
export const HIT_STOP = '\u0002';
/** Options for ts_headline that mark matches with control characters (turned into parts by `snippetParts`). */
export const HEADLINE_OPTIONS = `StartSel=${HIT_START}, StopSel=${HIT_STOP}, MaxWords=18, MinWords=6, MaxFragments=1`;

export interface SnippetPart { text: string; match: boolean }

/** Splits a ts_headline result into plain and matched parts, so a client never has to parse markup. */
export function snippetParts(headline: string | null | undefined): SnippetPart[] {
  const out: SnippetPart[] = [];
  const s = String(headline ?? '').replace(/\s+/g, ' ').trim();
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf(HIT_START, i);
    if (a < 0) { out.push({ text: s.slice(i), match: false }); break; }
    if (a > i) out.push({ text: s.slice(i, a), match: false });
    const b = s.indexOf(HIT_STOP, a);
    const end = b < 0 ? s.length : b;
    out.push({ text: s.slice(a + 1, end), match: true });
    i = end + 1;
  }
  return out.filter((p) => p.text !== '');
}

/** The comments search vector of one row, in a given configuration (`row` is `new` or a table alias). */
export const commentVectorSql = (config: string, row: string) =>
  `to_tsvector('${config}', coalesce(${row}.body, '')) || to_tsvector('simple', coalesce(${row}.body, ''))`;

/**
 * Builds the comments search trigger from the configured language (E14-21), as the record triggers
 * are. Migration 003 created it with `english`; when GRC_SEARCH_LANGUAGE names another configuration
 * the function is replaced and every comment's vector is recomputed, once, at start-up. Does nothing
 * when the language has not changed since the last build. Returns false when it cannot (an unknown
 * configuration), leaving the trigger as it was.
 */
export async function ensureCommentSearch(db: Db, config: string = SEARCH_CONFIG): Promise<boolean> {
  if (!IDENT.test(config)) return false;
  const signature = createHash('sha256').update(`comments-v1|${commentVectorSql(config, 'new')}`).digest('hex');
  try {
    const current = (await db.one<{ signature: string }>(`select signature from search_index_state where table_name = '__comments'`))?.signature;
    // A database built by migration 003 alone is already in `english`: record that without rewriting rows.
    if (current === undefined && config === 'english') {
      await db.query(`insert into search_index_state (table_name, signature) values ('__comments', $1) on conflict (table_name) do nothing`, [signature]);
      return true;
    }
    if (current === signature) return true;
    if (!(await maySchemaChange(db, 'comments'))) {
      await requestSchemaChange(db, 'search', '__comments', `Comments must be indexed in the search language "${config}".`);
      return false;
    }
    await db.exec(`
      create or replace function comments_search_tg() returns trigger language plpgsql as $cs$
      begin
        new.search_vector := ${commentVectorSql(config, 'new')};
        return new;
      end $cs$;
      update comments c set search_vector = ${commentVectorSql(config, 'c')};
      insert into search_index_state (table_name, signature) values ('__comments', '${signature}')
      on conflict (table_name) do update set signature = excluded.signature, built_at = now();`);
    await schemaChangeDone(db, 'search', '__comments');
    return true;
  } catch (err) {
    if (!process.env.VITEST) console.warn(`[search] comments keep their earlier search language: ${(err as Error).message}`);
    return false;
  }
}
