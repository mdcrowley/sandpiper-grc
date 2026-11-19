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
 * Creates or refreshes the trigger that indexes one record type, and indexes rows that are missing.
 * Does nothing when the definition has not changed since the last start. Returns false when the
 * type cannot be indexed (the caller then searches it by substring).
 */
export async function ensureSearchIndex(db: Db, def: ResourceDef, customKeys: string[], known?: Map<string, string>): Promise<boolean> {
  if (![def.type, def.table, def.titleField, def.ref?.field ?? 'x', ...(def.searchable ?? [])].every((n) => IDENT.test(n))) return false;
  const fn = `${def.type}_search_tg`;
  const signature = createHash('sha256').update(`v1|${def.table}|${vectorSql(def, customKeys, 'new')}`).digest('hex');
  const backfill = (onlyMissing: boolean) => `
    insert into search_index (record_type, record_id, vector)
    select '${def.type}', t.id, ${vectorSql(def, customKeys, 't')} from ${def.table} t
    ${onlyMissing ? `where not exists (select 1 from search_index si where si.record_type = '${def.type}' and si.record_id = t.id)` : ''}
    on conflict (record_type, record_id) do update set vector = excluded.vector;`;
  try {
    const current = known ? known.get(def.type)
      : (await db.one<{ signature: string }>('select signature from search_index_state where table_name = $1', [def.type]))?.signature;
    if (current === signature) {
      // Rows loaded with triggers switched off (a restore from an export) are picked up here.
      await db.exec(backfill(true));
      return true;
    }
    await db.exec(`
      create or replace function ${fn}() returns trigger language plpgsql as $search$
      begin
        begin
          insert into search_index (record_type, record_id, vector)
          values ('${def.type}', new.id, ${vectorSql(def, customKeys, 'new')})
          on conflict (record_type, record_id) do update set vector = excluded.vector;
        exception when others then null; -- indexing must never stop a record being saved
        end;
        return null;
      end $search$;
      drop trigger if exists ${def.type}_search on ${def.table};
      create trigger ${def.type}_search after insert or update on ${def.table}
        for each row execute function ${fn}();
      ${backfill(false)}
      insert into search_index_state (table_name, signature) values ('${def.type}', '${signature}')
      on conflict (table_name) do update set signature = excluded.signature, built_at = now();`);
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
