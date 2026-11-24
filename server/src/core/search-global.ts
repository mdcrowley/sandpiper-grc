import type { FastifyInstance } from 'fastify';
import type { Db } from './db.ts';
import type { ResourceDef, Row } from './module.ts';
import type { makeResources } from './resource.ts';
import { BODY_SEPARATOR, bodyLike, HEADLINE_OPTIONS, parseSearch, SEARCH_CONFIG, snippetParts, substringColumns } from './search.ts';

/** Results per record type, and in all. */
export const PER_TYPE = 6;
export const MAX_RESULTS = 60;

/**
 * Whether every record of this type that matches several words by its title or reference also has
 * them in its substring text (`search_index.body`, search.ts `bodySql`): its title is one of the
 * substring fields. The reference always is. Then the search index alone finds every candidate.
 */
export const bodyHoldsTitle = (def: ResourceDef) => substringColumns(def).includes(def.titleField);

interface Deps {
  app: FastifyInstance;
  db: Db;
  res: ReturnType<typeof makeResources>;
}

/**
 * Global search (GET /api/search): full text over every record type the caller may view, with
 * their comments, attached file names and the text inside attached files (E41-16); ranked, best first. Queries under three characters match
 * by substring. Each type shows its best PER_TYPE, under the same permission, restriction and row
 * rules as its list.
 */
export function registerGlobalSearch({ app, db, res }: Deps) {
  const { registry, mayAccess, visibilitySql } = res;

  // Whether the attachments module's tables exist (file names, and the text read from files, are searched when they do).
  let hasAttachments = false;
  let hasFileTexts = false;
  app.addHook('onReady', async () => {
    hasAttachments = Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t);
    hasFileTexts = hasAttachments && Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachment_texts')::text as t`))?.t);
  });

  app.get('/api/search', async (req) => {
    const s = parseSearch((req.query as any).q);
    if (s.text.length < 2) return [];
    const found = new Map<string, Row>();
    const put = (def: ResourceDef, r: Row, matched: 'record' | 'comment' | 'attachment', headline: string | null) => {
      const key = `${def.type}:${r.id}`;
      const rank = Number(r.rank) || 0;
      const had = found.get(key);
      if (had) { had.rank += rank; return; } // already found by its own text: the extra match only lifts it
      const parts = snippetParts(headline);
      found.set(key, {
        type: def.type, typeLabel: def.label, id: r.id, label: r.label, ref: r.ref, route: def.route,
        rank, matched, snippet: parts.map((p) => p.text).join(''), snippetParts: parts,
      });
    };

    // Which record types have a matching comment or file name at all (two queries, not two per type).
    let commentTypes = new Set<string>();
    let fileTypes = new Set<string>();
    let fileTextTypes = new Set<string>();
    if (s.fts) {
      const p: unknown[] = [];
      const tsq = s.tsquery((v) => { p.push(v); return `$${p.length}`; });
      commentTypes = new Set((await db.query<Row>(`select distinct record_type from comments where search_vector @@ ${tsq}`, p)).map((r) => r.record_type));
      if (hasAttachments) {
        fileTypes = new Set((await db.query<Row>(
          'select distinct record_type from attachments where deleted_at is null and file_name ilike $1', [s.like])).map((r) => r.record_type));
      }
      if (hasFileTexts) {
        fileTextTypes = new Set((await db.query<Row>(
          `select distinct a.record_type from attachment_texts x join attachments a on a.id = x.attachment_id
           where a.deleted_at is null and x.vector @@ ${tsq}`, p)).map((r) => r.record_type));
      }
    }

    // Each type reads its own matching rows of the search index first (E16-36), through the
    // vector and trigram indexes, and ranks only those; its record table is then read by id. The
    // substring text (search_index.body) holds exactly the fields matched by substring, so no
    // record table is scanned for one word, nor (E16-41) for several.
    const useIndex = s.fts && !s.text.includes(BODY_SEPARATOR);
    const types = registry.all().filter((def) => mayAccess(req.user, def, 'view'));

    /**
     * Every indexed type's own matches (E16-38, E16-41), in two statements.
     *
     * First, how many rows of the search index match, per type: one pass through its indexes for all
     * types together. Types with none are left out of the second statement altogether.
     *
     * Second, the matching rows are found again, once, for all types together and ranked, and grouped
     * into one row per type (`g`: arrays of ids, ranks and whether the words matched), so that each
     * type unpacks only its own rows (reading one shared list of matches once per type, as before,
     * cost as much as the rest together for a common word: some sixty times every match). The count
     * from the first statement tells the database how many rows each type unpacks, so it joins a
     * type with thousands of matches to its table in one pass rather than looking each one up (it
     * cannot know how long an array is; a few more rows written meanwhile are still unpacked, by the
     * second half of `mine`). Each type then adds its exact-reference and title boosts, applies its
     * visibility rule, keeps its best few and reads only those in full for the snippet.
     *
     * Several words: a record matches by its words, or by its title or reference containing the
     * whole text. Both are in its substring text, so the candidates are the index rows that match the
     * words or whose substring text contains the text, rechecked on the record; `hit` says the words
     * matched, and only then does the record's text rank count, as before. A type whose title is not
     * one of its substring fields is read in full as before.
     */
    async function indexedMatches(): Promise<Map<string, Row[]>> {
      const out = new Map<string, Row[]>();
      const indexedDefs = types.filter((def) => res.ftsTypes.has(def.type));
      if (!useIndex || !indexedDefs.length) return out;
      const matching = (tsq: string, like: string, typesParam: string) =>
        `si.record_type = any(${typesParam}::text[]) and (si.vector @@ ${tsq} or ${bodyLike(like)})`;

      const counts = new Map<string, number>();
      {
        const p: unknown[] = [];
        const addP = (v: unknown) => { p.push(v); return `$${p.length}`; };
        const tsq = s.tsquery(addP);
        for (const r of await db.query<{ record_type: string; n: number }>(
          `select si.record_type, count(*)::int as n from search_index si where ${matching(tsq, addP(s.like), addP(indexedDefs.map((d) => d.type)))} group by si.record_type`, p)) {
          counts.set(r.record_type, Number(r.n));
        }
      }
      // A type with no matching index row can still match several words by a title that is not a substring field.
      const defs = indexedDefs.filter((def) => counts.has(def.type) || (!s.single && !bodyHoldsTitle(def)));
      if (!defs.length) return out;

      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const tsq = s.tsquery(add);
      const like = add(s.like);
      // Added only when a type has a reference: a parameter no statement uses has no type, which PostgreSQL refuses.
      let textParam: string | null = null;
      const text = () => (textParam ??= add(s.text));
      // One word: every candidate matched (by its words or by part of a word). Several: only `hit`
      // rows matched by their words; the others are candidates by title or reference. Ranks and hits
      // are never null in the arrays (an array with nulls is read from its start for every element).
      const matchedRow = s.single ? 'true' : `coalesce(si.vector @@ ${tsq}, false)`;
      const rankOf = s.single ? `coalesce(ts_rank(si.vector, ${tsq}), 0)` : `case when si.vector @@ ${tsq} then coalesce(ts_rank(si.vector, ${tsq}), 0) else 0 end`;
      const parts = defs.map((def) => {
        const type = add(def.type);
        const n = counts.get(def.type) ?? 0;
        const visible = `t.deleted_at is null and ${visibilitySql(def, req.user, 't')}`;
        const exact = def.ref ? `lower(t.${def.ref.field}::text) = lower(${text()}::text)` : 'false';
        const unpack = (from: string, to: string) =>
          `select g.ids[i] as id, g.rs[i] as r, g.hits[i] as hit from g cross join lateral generate_series(${from}, ${to}) as i where g.record_type = ${type}`;
        const mine = `(${unpack('1', String(n))} and i <= cardinality(g.ids)
                      union all ${unpack(`${n + 1}`, 'cardinality(g.ids)')}) m`;
        const textMatch = `t.${def.titleField}::text ilike ${like}${def.ref ? ` or t.${def.ref.field}::text ilike ${like}` : ''}`;
        const from = s.single
          ? `${mine} join ${def.table} t on t.id = m.id where ${visible}`
          : bodyHoldsTitle(def)
            ? `${mine} join ${def.table} t on t.id = m.id where ${visible} and (m.hit or ${exact} or ${textMatch})`
            : `${def.table} t left join ${mine} on m.id = t.id where ${visible} and (m.hit is true or ${exact} or ${textMatch})`;
        const body = [...new Set([def.titleField, ...(def.searchable ?? [])])].map((c) => `t.${c}::text`).join(', ');
        return `select ${type}::text as type, x.id, t.${def.titleField}::text as label, ${def.ref ? `t.${def.ref.field}::text` : 'null::text'} as ref,
                  x.rank::float8 as rank, ts_headline('${SEARCH_CONFIG}', concat_ws(' - ', ${body}), ${tsq}, '${HEADLINE_OPTIONS}') as headline,
                  row_number() over (order by x.rank desc, x.updated_at desc) as n
           from (select t.id, t.updated_at,
                   (coalesce(m.r, 0) + case when ${exact} then 10 else 0 end
                    + case when t.${def.titleField}::text ilike ${like} then 0.5 else 0 end) as rank
                 from ${from}
                 order by rank desc, t.updated_at desc limit ${PER_TYPE}) x
           join ${def.table} t on t.id = x.id`;
      });
      const rows = await db.query<Row>(
        `with g as materialized (
           select si.record_type, array_agg(si.record_id) as ids, array_agg(${rankOf}) as rs, array_agg(${matchedRow}) as hits
           from search_index si where ${matching(tsq, like, add(defs.map((d) => d.type)))}
           group by si.record_type)
         ${parts.map((p) => `(${p})`).join('\nunion all\n')}`, params);
      for (const r of rows.sort((a, b) => Number(a.n) - Number(b.n))) {
        if (!out.has(r.type)) out.set(r.type, []);
        out.get(r.type)!.push(r);
      }
      return out;
    }
    const indexed = await indexedMatches();

    /** One type's matches, in the order they are added to the results. */
    async function searchType(def: ResourceDef): Promise<[Row, 'record' | 'comment' | 'attachment', string | null][]> {
      const out: [Row, 'record' | 'comment' | 'attachment', string | null][] = [];
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const visible = `t.deleted_at is null and ${visibilitySql(def, req.user, 't')}`;
      const label = `t.${def.titleField}::text as label, ${def.ref ? `t.${def.ref.field}` : 'null'} as ref`;
      const cols = substringColumns(def);
      const like = add(s.like);
      const substring = cols.map((c) => `t.${c}::text ilike ${like}`).join(' or ');
      const fts = s.fts && res.ftsTypes.has(def.type);

      if (fts && useIndex) {
        for (const r of indexed.get(def.type) ?? []) out.push([r, 'record', r.headline]);
      } else if (fts) {
        // A query holding the substring separator (never typed in practice): read the type's table.
        const tsq = s.tsquery(add);
        const exact = def.ref ? `lower(t.${def.ref.field}::text) = lower(${add(s.text)}::text)` : 'false';
        const body = [...new Set([def.titleField, ...(def.searchable ?? [])])].map((c) => `t.${c}::text`).join(', ');
        const rows = await db.query<Row>(
          `select x.id, x.label, x.ref, x.rank, ts_headline('${SEARCH_CONFIG}', x.body, ${tsq}, '${HEADLINE_OPTIONS}') as headline
           from (select t.id, ${label}, concat_ws(' - ', ${body}) as body,
                   (coalesce(ts_rank(si.vector, ${tsq}), 0) + case when ${exact} then 10 else 0 end
                    + case when t.${def.titleField}::text ilike ${like} then 0.5 else 0 end) as rank
                 from ${def.table} t left join search_index si on si.record_type = ${add(def.type)} and si.record_id = t.id
                 where ${visible} and (si.vector @@ ${tsq} or ${exact} or ${s.single ? substring : `t.${def.titleField}::text ilike ${like}${def.ref ? ` or t.${def.ref.field}::text ilike ${like}` : ''}`})
                 order by rank desc, t.updated_at desc limit ${PER_TYPE}) x
           order by x.rank desc`, params);
        for (const r of rows) out.push([r, 'record', r.headline]);
      } else {
        const rows = await db.query<Row>(
          `select t.id, ${label}, 0.1 as rank from ${def.table} t where ${visible} and (${substring}) order by t.updated_at desc limit ${PER_TYPE}`, params);
        for (const r of rows) out.push([r, 'record', null]);
      }

      // A record is also found by what was said about it and by the names of its files. Both follow
      // the record: the same permission and restriction rules, so nothing new is revealed.
      if (commentTypes.has(def.type)) {
        const p: unknown[] = [];
        const addP = (v: unknown) => { p.push(v); return `$${p.length}`; };
        const tsq = s.tsquery(addP);
        const rows = await db.query<Row>(
          `select x.id, x.label, x.ref, x.rank, ts_headline('${SEARCH_CONFIG}', x.body, ${tsq}, '${HEADLINE_OPTIONS}') as headline
           from (select distinct on (t.id) t.id, ${label}, c.body, ts_rank(c.search_vector, ${tsq}) * 0.5 as rank
                 from comments c join ${def.table} t on t.id = c.record_id
                 where c.record_type = ${addP(def.type)} and c.search_vector @@ ${tsq} and ${visible}
                 order by t.id, rank desc limit ${PER_TYPE}) x`, p);
        for (const r of rows) out.push([r, 'comment', r.headline]);
      }
      if (fileTypes.has(def.type)) {
        const rows = await db.query<Row>(
          `select distinct on (t.id) t.id, ${label}, a.file_name, 0.3 as rank
           from attachments a join ${def.table} t on t.id = a.record_id
           where a.record_type = $2 and a.deleted_at is null and a.file_name ilike $1 and ${visible} order by t.id limit ${PER_TYPE}`, [s.like, def.type]);
        for (const r of rows) out.push([r, 'attachment', r.file_name]);
      }
      // The text inside its files (E41-16), under the record's rules like the rest: the passage found is
      // shown after the file's name.
      if (fileTextTypes.has(def.type)) {
        const p: unknown[] = [];
        const addP = (v: unknown) => { p.push(v); return `$${p.length}`; };
        const tsq = s.tsquery(addP);
        const rows = await db.query<Row>(
          `select x.id, x.label, x.ref, x.rank, x.file_name || ': ' || ts_headline('${SEARCH_CONFIG}', left(x.content, 100000), ${tsq}, '${HEADLINE_OPTIONS}') as headline
           from (select distinct on (t.id) t.id, ${label}, a.file_name, ft.content, ts_rank(ft.vector, ${tsq}) * 0.4 as rank
                 from attachment_texts ft join attachments a on a.id = ft.attachment_id join ${def.table} t on t.id = a.record_id
                 where a.record_type = ${addP(def.type)} and a.deleted_at is null and ft.vector @@ ${tsq} and ${visible}
                 order by t.id, rank desc limit ${PER_TYPE}) x`, p);
        for (const r of rows) out.push([r, 'attachment', r.headline]);
      }
      return out;
    }

    // A few types at a time: a PostgreSQL server answers them side by side; the embedded database
    // takes them in turn either way. Results are merged in the registry's order, so ties come out
    // the same whatever finished first.
    const results: Awaited<ReturnType<typeof searchType>>[] = new Array(types.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, types.length) }, async () => {
      while (next < types.length) {
        const i = next++;
        results[i] = await searchType(types[i]);
      }
    }));
    types.forEach((def, i) => { for (const [r, matched, headline] of results[i]) put(def, r, matched, headline); });
    return [...found.values()].sort((a, b) => b.rank - a.rank).slice(0, MAX_RESULTS);
  });
}
