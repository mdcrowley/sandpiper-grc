import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pageOf, registerApiStore } from './api/conventions.ts';
import { capExportRows, EXPORT_ROW_LIMIT, TRUNCATED_HEADER } from './export/list.ts';
import type { Db } from './db.ts';
import { fail, UUID_RE } from './errors.ts';
import type { ResourceDef, Row, SessionUser } from './module.ts';
import type { CustomFields } from './customfields.ts';
import { featureState, visibleValues, type FeatureGate } from './features.ts';
import type { makeResources } from './resource.ts';
import { BODY_SEPARATOR, HEADLINE_OPTIONS, parseSearch, SEARCH_CONFIG, snippetParts, substringColumns } from './search.ts';
import { can, requirePerm, type makeAudit, type makeLookups } from './services.ts';
import { registerSharedViews } from './views.ts';
import { redactWebhookAudit } from './webhooks.ts';

interface Deps {
  app: FastifyInstance;
  db: Db;
  audit: ReturnType<typeof makeAudit>;
  lookups: ReturnType<typeof makeLookups>;
  res: ReturnType<typeof makeResources>;
  custom: CustomFields;
  /** Feature switches (core/features.ts): lists and list values of switched-off areas are hidden. */
  gate?: Pick<FeatureGate, 'listOff'>;
  /** Tells the watchers of a record about a comment (core/tags.ts). */
  notifyWatchers?: (type: string, id: string, title: string, actorId?: string | null, body?: string) => Promise<void>;
}

/** Cross-cutting routes: metadata, search, pickers, comments, links, history, audit, lookups. */
export function registerCoreRoutes({ app, db, audit, lookups, res, custom, gate, notifyWatchers }: Deps) {
  const { registry, labelsFor, mayAccess, visibilitySql } = res;

  /**
   * Lists of switched-off areas are left out and so are the values that belong to one (an action's
   * source "Risk" while risks are off): E14-34. Stored values are untouched.
   */
  async function featureLists(): Promise<{ listOn: (list: string) => boolean; values: <T extends { value: string }>(list: string, v: T[]) => T[] }> {
    const st = await featureState(db);
    if (!st.off.length || !gate) return { listOn: () => true, values: (_l, v) => v };
    const owners = new Map((await db.query<{ list_key: string; module: string | null }>('select list_key, module from lookup_lists')).map((r) => [r.list_key, r.module]));
    return { listOn: (list) => !gate.listOff(list, owners.get(list)), values: (list, v) => visibleValues(st, list, v) };
  }
  // Idempotency keys for the API conventions (core/api/conventions.ts): their table and database.
  registerApiStore(app, db);
  // List views shared with everyone who can see the list (core/views.ts).
  registerSharedViews({ app, db, audit, res });
  // The Overview's figures, kept for a few seconds while nothing is written (E16-38).
  registerFiguresCache(app, db, res);

  /** The record, if the caller may see it; otherwise a 404 that does not reveal whether it exists. */
  async function visibleRecord(req: FastifyRequest, type: string, id: string, action = 'view'): Promise<{ def: ResourceDef; row: Row }> {
    const def = registry.get(type);
    if (!def || !mayAccess(req.user, def, action)) fail(404, 'not_found', 'Record not found.');
    const row = await registry.find(type, id, req.user);
    if (!row) fail(404, 'not_found', 'Record not found.');
    return { def: def!, row: row! };
  }

  /**
   * Which configurable lists a person may read. A list is readable when:
   *  - a record type they may view has a field that uses it; or
   *  - its owning module (ctx.lookups.ensure(list, values, { module })) is one they hold view on,
   *    and, where that module has record types, they may view at least one of them (so the lists
   *    of a restricted module stay hidden without security.view); or
   *  - it is marked public; or
   *  - they are an administrator (who maintains every list).
   * A list with no owner that no record type uses is readable by administrators only.
   */
  async function listReader(user: SessionUser | null): Promise<(list: string) => boolean> {
    if (can(user, 'admin.administer')) return () => true;
    const defs = registry.all();
    const used = new Set<string>();
    for (const d of defs) {
      if (!mayAccess(user, d, 'view')) continue;
      for (const f of Object.values(d.fields)) if (f.type === 'lookup' && f.list) used.add(f.list);
      for (const f of Object.values(await custom.defs(d.type))) if (f.type === 'lookup' && f.list) used.add(f.list);
    }
    const owners = await db.query<{ list_key: string; module: string | null; public: boolean }>('select list_key, module, public from lookup_lists');
    for (const o of owners) {
      if (o.public) { used.add(o.list_key); continue; }
      if (!o.module || !can(user, `${o.module}.view`)) continue;
      const types = defs.filter((d) => d.module === o.module);
      if (!types.length || types.some((d) => mayAccess(user, d, 'view'))) used.add(o.list_key);
    }
    return (list) => used.has(list);
  }

  // Say once, at start-up, which lists nobody but an administrator can read: usually a module forgot { module }.
  app.addHook('onReady', async () => {
    const used = new Set(registry.all().flatMap((d) => Object.values(d.fields).map((f) => f.list)).filter(Boolean));
    const rows = await db.query<{ list_key: string }>(
      `select distinct l.list_key from lookups l left join lookup_lists o on o.list_key = l.list_key
       where o.list_key is null or (o.module is null and not o.public) order by 1`);
    const orphans = rows.map((r) => r.list_key).filter((k) => !used.has(k));
    if (orphans.length && !process.env.VITEST) {
      console.warn(`[lookups] administrator-only lists (no owning module, not used by a record type): ${orphans.join(', ')}. `
        + `Pass { module } or { public: true } to ctx.lookups.ensure to let other people read them.`);
    }
  });

  app.get('/api/meta', async (req) => {
    const resources: Record<string, unknown> = {};
    for (const d of registry.all()) {
      if (!mayAccess(req.user, d, 'view')) continue;
      resources[d.type] = {
        type: d.type, label: d.label, plural: d.plural, module: d.module, path: d.path, route: d.route,
        titleField: d.titleField, refField: d.ref?.field, restricted: d.restricted ?? false,
        // Files on this type are evidence (E14-18): the Attachments tab records new files as evidence.
        evidence: res.evidenceFor(d),
        // Custom fields follow the built-in ones, in the same shape, marked `custom: true` (core/customfields.ts).
        fields: { ...d.fields, ...(await custom.defs(d.type)) },
        search: res.ftsTypes.has(d.type) ? 'fulltext' : 'substring',
        // Allowed status changes and fields required per status, for this person (E14-31, core/lifecycle.ts).
        lifecycle: await res.lifecycles.metaFor(d, req.user),
      };
    }
    // Only the lists this person may read: list names and labels can themselves be sensitive.
    const readable = await listReader(req.user);
    const all = await lookups.all();
    const fl = await featureLists();
    return {
      resources,
      lookups: Object.fromEntries(Object.entries(all).filter(([list]) => readable(list) && fl.listOn(list)).map(([list, v]) => [list, fl.values(list, v)])),
    };
  });

  app.get('/api/records/lookup', async (req) => {
    const { type, q = '' } = req.query as Record<string, string>;
    const def = registry.get(type);
    if (!def || !mayAccess(req.user, def, 'view')) return [];
    const cols = [def.titleField, ...(def.ref ? [def.ref.field] : [])];
    return db.query(
      `select id, ${def.titleField}::text as label, ${def.ref ? def.ref.field : 'null'} as ref from ${def.table}
       where deleted_at is null and ${visibilitySql(def, req.user)} and (${cols.map((c) => `${c}::text ilike $1`).join(' or ')})
       order by ${def.titleField} limit 25`,
      [`%${q.trim()}%`],
    );
  });

  // Labels for known ids, for showing names where only ids are stored (History, saved filters).
  // Body: { records: { <type>: [id, ...] } }. Answer: { <type>: { <id>: { label, ref, route } } }.
  // Ids the caller may not see are left out, exactly like ids that do not exist.
  app.post('/api/records/labels', async (req) => {
    const wanted = ((req.body ?? {}) as Row).records;
    if (!wanted || typeof wanted !== 'object' || Array.isArray(wanted)) fail(400, 'validation', 'Send { records: { <type>: [ids] } }.');
    const out: Record<string, Record<string, unknown>> = {};
    let budget = 1000;
    for (const [type, ids] of Object.entries(wanted as Record<string, unknown>)) {
      out[type] = {};
      const def = registry.get(type);
      if (!def || !mayAccess(req.user, def, 'view') || !Array.isArray(ids)) continue;
      const list = ids.filter((i): i is string => typeof i === 'string').slice(0, Math.max(0, budget));
      budget -= list.length;
      for (const [id, l] of await labelsFor(type, list, req.user)) {
        if (!l.hidden) out[type][id] = { label: l.label, ref: l.ref, route: def.route };
      }
    }
    return out;
  });

  // Whether the attachments module's table exists (file names are searched when it does).
  let hasAttachments = false;
  app.addHook('onReady', async () => {
    hasAttachments = Boolean((await db.one<{ t: string | null }>(`select to_regclass('public.attachments')::text as t`))?.t);
  });

  // Global search: full text over every record type the caller may view, with their comments and
  // attached file names; ranked, best first. Queries under three characters match by substring.
  app.get('/api/search', async (req) => {
    const s = parseSearch((req.query as any).q);
    if (s.text.length < 2) return [];
    const PER_TYPE = 6;
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
    if (s.fts) {
      const p: unknown[] = [];
      const tsq = s.tsquery((v) => { p.push(v); return `$${p.length}`; });
      commentTypes = new Set((await db.query<Row>(`select distinct record_type from comments where search_vector @@ ${tsq}`, p)).map((r) => r.record_type));
      if (hasAttachments) {
        fileTypes = new Set((await db.query<Row>(
          'select distinct record_type from attachments where deleted_at is null and file_name ilike $1', [s.like])).map((r) => r.record_type));
      }
    }

    // Each type reads its own matching rows of the search index first (E16-36), through the
    // vector and trigram indexes, and ranks only those; its record table is then read by id. A
    // single word is matched on its substring text too (search_index.body holds exactly the
    // fields matched by substring), so no record table is scanned for it; more words match the
    // title and reference by substring as before.
    const useIndex = s.fts && !s.text.includes(BODY_SEPARATOR);
    const types = registry.all().filter((def) => mayAccess(req.user, def, 'view'));

    /**
     * Every indexed type's own matches in one statement (E16-38). The matching rows of the search
     * index are found once, through its indexes, for all types together (`m`), rather than once per
     * type, which for a common word read the same index entries some forty times; each type then
     * ranks only its own, reads its table by id, and only its best few in full for the snippet.
     */
    async function indexedMatches(): Promise<Map<string, Row[]>> {
      const out = new Map<string, Row[]>();
      const defs = types.filter((def) => res.ftsTypes.has(def.type));
      if (!useIndex || !defs.length) return out;
      const params: unknown[] = [];
      const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
      const tsq = s.tsquery(add);
      const like = add(s.like);
      // Added only when a type has a reference: a parameter no statement uses has no type, which PostgreSQL refuses.
      let textParam: string | null = null;
      const text = () => (textParam ??= add(s.text));
      const parts = defs.map((def) => {
        const type = add(def.type);
        const visible = `t.deleted_at is null and ${visibilitySql(def, req.user, 't')}`;
        const exact = def.ref ? `lower(t.${def.ref.field}::text) = lower(${text()}::text)` : 'false';
        const mine = `(select m.id, m.r from m where m.record_type = ${type}) m`;
        const from = s.single
          ? `${mine} join ${def.table} t on t.id = m.id where ${visible}`
          : `${def.table} t left join ${mine} on m.id = t.id
             where ${visible} and (m.id is not null or ${exact} or t.${def.titleField}::text ilike ${like}${def.ref ? ` or t.${def.ref.field}::text ilike ${like}` : ''})`;
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
        `with m as materialized (
           select si.record_type, si.record_id as id, ts_rank(si.vector, ${tsq}) as r from search_index si
           where si.record_type = any(${add(defs.map((d) => d.type))}::text[]) and (si.vector @@ ${tsq}${s.single ? ` or si.body ilike ${like}` : ''}))
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
    return [...found.values()].sort((a, b) => b.rank - a.rank).slice(0, 60);
  });

  // ---------- comments ----------

  app.get('/api/comments', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return db.query(
      'select id, body, internal, author_id, author_name, created_at from comments where record_type = $1 and record_id = $2 order by created_at',
      [record_type, record_id],
    );
  });

  app.post('/api/comments', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const body = String(b.body ?? '').trim();
    if (!body) fail(400, 'validation', 'Check the highlighted fields.', { body: 'Write a comment first.' });
    const { def, row: found } = await visibleRecord(req, b.record_type, b.record_id);
    const row = await db.one<Row>(
      `insert into comments (record_type, record_id, body, internal, author_id, author_name)
       values ($1,$2,$3,$4,$5,$6) returning id, body, internal, author_id, author_name, created_at`,
      [b.record_type, b.record_id, body, b.internal !== false, req.user!.id, req.user!.displayName],
    );
    await audit(req, {
      action: 'comment.add', recordType: b.record_type, recordId: b.record_id,
      summary: `${b.internal !== false ? 'Internal' : 'Public'} comment added to ${def.label.toLowerCase()}`,
    });
    await notifyWatchers?.(b.record_type, b.record_id, `New comment on ${def.label.toLowerCase()} ${res.labelOf(def, found)}`, req.user!.id)
      .catch((err) => console.error('[watchers] could not notify:', err));
    reply.code(201);
    return row;
  });

  // ---------- links ----------

  app.get('/api/links', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    const rows = await db.query<Row>(
      `select id, relation, 'out' as direction, to_type as type, to_id as record_id from record_links where from_type = $1 and from_id = $2
       union all
       select id, relation, 'in' as direction, from_type as type, from_id as record_id from record_links where to_type = $1 and to_id = $2`,
      [record_type, record_id],
    );
    const out: unknown[] = [];
    for (const type of new Set(rows.map((r) => r.type))) {
      const def = registry.get(type);
      if (!def || !mayAccess(req.user, def, 'view')) continue;
      const labels = await labelsFor(type, rows.filter((r) => r.type === type).map((r) => r.record_id), req.user);
      for (const r of rows.filter((x) => x.type === type)) {
        const l = labels.get(r.record_id);
        if (!l || l.hidden) continue;
        out.push({
          id: r.id, relation: r.relation, direction: r.direction, type, typeLabel: def.label,
          recordId: r.record_id, label: l.label, ref: l.ref, route: def.route,
        });
      }
    }
    return out;
  });

  app.post('/api/links', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    await visibleRecord(req, b.from_type, b.from_id, 'edit');
    await visibleRecord(req, b.to_type, b.to_id);
    if (b.from_type === b.to_type && b.from_id === b.to_id) fail(400, 'validation', 'A record cannot be linked to itself.');
    const relation = String(b.relation ?? 'related').trim().slice(0, 60) || 'related';
    const row = await db.one<Row>(
      `insert into record_links (from_type, from_id, to_type, to_id, relation, created_by) values ($1,$2,$3,$4,$5,$6)
       on conflict (from_type, from_id, to_type, to_id, relation) do update set relation = excluded.relation returning *`,
      [b.from_type, b.from_id, b.to_type, b.to_id, relation, req.user!.id],
    );
    await audit(req, {
      action: 'link.add', recordType: b.from_type, recordId: b.from_id,
      summary: `Linked to ${b.to_type} (${relation})`, after: { to_type: b.to_type, to_id: b.to_id, relation },
    });
    reply.code(201);
    return row;
  });

  app.delete('/api/links/:id', async (req) => {
    const id = (req.params as any).id;
    const link = UUID_RE.test(id) ? await db.one<Row>('select * from record_links where id = $1', [id]) : undefined;
    if (!link) fail(404, 'not_found', 'Link not found.');
    await visibleRecord(req, link!.from_type, link!.from_id, 'edit');
    await db.query('delete from record_links where id = $1', [id]);
    await audit(req, {
      action: 'link.remove', recordType: link!.from_type, recordId: link!.from_id,
      summary: `Link to ${link!.to_type} removed`, before: { to_type: link!.to_type, to_id: link!.to_id, relation: link!.relation },
    });
    return { ok: true };
  });

  // ---------- history and audit ----------

  app.get('/api/history', async (req) => {
    const { record_type, record_id } = req.query as Record<string, string>;
    await visibleRecord(req, record_type, record_id);
    return db.query(
      `select id, at, actor_id, actor_name, action, summary, before, after, token_name from audit_events
       where record_type = $1 and record_id = $2 order by at desc, id desc limit 500`,
      [record_type, record_id],
    );
  });

  app.get('/api/audit', { preHandler: requirePerm('audit.view') }, async (req, reply) => {
    const query = req.query as Record<string, string>;
    const where: string[] = ['true'];
    const params: unknown[] = [];
    const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
    if (query.q) where.push(`(summary ilike ${add(`%${query.q}%`)} or actor_name ilike $${params.length} or action ilike $${params.length})`);
    if (query.action) where.push(`action = ${add(query.action)}`);
    if (query.record_type) where.push(`record_type = ${add(query.record_type)}`);
    if (query.record_id) where.push(`record_id = ${add(query.record_id)}`);
    if (query.actor_id) where.push(`actor_id::text = ${add(query.actor_id)}`);
    // Every event of one request (E13-20): the id is the answer's X-Request-Id header.
    if (query.request_id) {
      const rid = String(query.request_id).trim();
      if (rid.length > 200) fail(400, 'bad_filter', '"request_id" is too long.');
      if (rid) where.push(`request_id = ${add(rid)}`);
    }
    for (const k of ['from', 'to'] as const) {
      if (query[k] && Number.isNaN(Date.parse(query[k]))) fail(400, 'bad_filter', `"${k}" must be a date or a date and time.`);
    }
    if (query.from) where.push(`at >= ${add(query.from)}::timestamptz`);
    if (query.to) where.push(`at <= ${add(query.to)}::timestamptz`);
    // Events about restricted record types stay hidden without security.view.
    const hiddenTypes = registry.all().filter((d) => d.restricted === true && !mayAccess(req.user, d, 'view')).map((d) => d.type);
    if (hiddenTypes.length) where.push(`(record_type is null or record_type <> all(${add(hiddenTypes)}::text[]))`);
    // So do events about individual records flagged restricted (for example an action raised on a risk).
    if (!can(req.user, 'security.view')) {
      for (const d of registry.all().filter((x) => x.restricted === 'flag')) {
        where.push(`not (record_type = ${add(d.type)} and record_id in (select id::text from ${d.table} where coalesce(restricted, false)))`);
      }
    }
    const w = where.join(' and ');
    // Webhook addresses often carry the receiver's secret: shown as host and fingerprint only, also
    // in entries written before they were redacted (core/webhooks.ts, SP-06).
    const redact = <T extends Row>(rows: T[]): T[] => rows.map((r) => (String(r.action ?? '').startsWith('webhook.')
      ? { ...r, before: redactWebhookAudit(r.before), after: redactWebhookAudit(r.after) } : r));

    if (query.format === 'csv') {
      // Newest first, one more than the limit to know (and say, OP-10) when older events were left out.
      const { rows: found, truncated } = capExportRows(await db.query<Row>(`select * from audit_events where ${w} order by id desc limit ${EXPORT_ROW_LIMIT + 1}`, params));
      const rows = redact(found);
      const esc = (v: unknown) => {
        let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheet formula injection
        return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      await audit(req, { action: 'audit.export', summary: `Exported ${rows.length} audit events to CSV${truncated ? ` (the newest ${EXPORT_ROW_LIMIT.toLocaleString('en-US')}: the export limit)` : ''}` });
      if (truncated) reply.header(TRUNCATED_HEADER, String(EXPORT_ROW_LIMIT));
      reply.header('content-type', 'text/csv; charset=utf-8');
      reply.header('content-disposition', 'attachment; filename="audit-export.csv"');
      const cols = ['id', 'at', 'actor_name', 'token_name', 'request_id', 'ip', 'action', 'record_type', 'record_id', 'summary', 'before', 'after'];
      const cut = truncated ? [esc(`Only the newest ${EXPORT_ROW_LIMIT.toLocaleString('en-US')} events were exported (the export limit). Choose a shorter period to export older events.`)] : [];
      return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(',')), ...cut].join('\r\n');
    }
    const { page, pageSize } = pageOf(query); // whole numbers in range (SP-09)
    const total = (await db.one<{ c: number }>(`select count(*)::int c from audit_events where ${w}`, params))!.c;
    const rows = redact(await db.query<Row>(
      `select * from audit_events where ${w} order by id desc limit ${pageSize} offset ${(page - 1) * pageSize}`, params,
    ));
    return { rows, total, page, pageSize };
  });

  // ---------- lookups (configurable lists) ----------

  app.get('/api/lookups', { preHandler: requirePerm('admin.administer') }, async () => {
    const fl = await featureLists();
    const rows = await db.query<{ list_key: string; count: number }>('select list_key, count(*)::int as count from lookups group by 1 order by 1');
    return rows.filter((r) => fl.listOn(r.list_key));
  });

  app.get('/api/lookups/:list', async (req) => {
    const list = String((req.params as any).list);
    if (!(await listReader(req.user))(list)) {
      // The same answer whether or not the list exists.
      fail(403, 'forbidden', 'You do not have permission to read that list.');
    }
    const fl = await featureLists();
    if (!fl.listOn(list)) return [];
    return fl.values(list, await db.query<Row & { value: string }>('select id, list_key, value, label, color, sort, active, meta from lookups where list_key = $1 order by sort, label', [list]));
  });

  app.post('/api/lookups', { preHandler: requirePerm('admin.administer') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    const fields: Record<string, string> = {};
    if (!/^[a-z][a-z0-9_]*$/.test(String(b.list_key ?? ''))) fields.list_key = 'Choose a list.';
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(String(b.value ?? ''))) fields.value = 'Use lower-case letters, numbers, dashes or underscores.';
    if (!String(b.label ?? '').trim()) fields.label = 'Label is required.';
    if (Object.keys(fields).length) fail(400, 'validation', 'Check the highlighted fields.', fields);
    if (await db.one('select 1 from lookups where list_key = $1 and value = $2', [b.list_key, b.value])) {
      fail(400, 'validation', 'Check the highlighted fields.', { value: 'That value already exists in this list.' });
    }
    const row = await db.one<Row>(
      `insert into lookups (list_key, value, label, color, sort, meta) values ($1,$2,$3,$4,$5,$6::jsonb) returning *`,
      [b.list_key, b.value, String(b.label).trim(), b.color ?? 'gray', Number(b.sort) || 0, JSON.stringify(b.meta ?? {})],
    );
    await audit(req, { action: 'lookup.create', recordType: 'lookup', recordId: row!.id, summary: `Added "${row!.label}" to ${b.list_key}`, after: row });
    reply.code(201);
    return row;
  });

  app.patch('/api/lookups/:id', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const id = (req.params as any).id;
    const before = UUID_RE.test(id) ? await db.one<Row>('select * from lookups where id = $1', [id]) : undefined;
    if (!before) fail(404, 'not_found', 'Value not found.');
    const b = (req.body ?? {}) as Row;
    const row = await db.one<Row>(
      `update lookups set label = $2, color = $3, sort = $4, active = $5, meta = $6::jsonb where id = $1 returning *`,
      [id, String(b.label ?? before!.label).trim() || before!.label, b.color ?? before!.color,
        b.sort === undefined ? before!.sort : Number(b.sort) || 0, b.active ?? before!.active, JSON.stringify(b.meta ?? before!.meta)],
    );
    await audit(req, { action: 'lookup.update', recordType: 'lookup', recordId: id, summary: `Changed "${row!.label}" in ${row!.list_key}`, before, after: row });
    return row;
  });

  // Values are retired (active = false), never removed, so existing records keep their meaning.
  app.delete('/api/lookups/:id', { preHandler: requirePerm('admin.administer') }, async (req) => {
    const id = (req.params as any).id;
    const row = UUID_RE.test(id) ? await db.one<Row>('update lookups set active = false where id = $1 returning *', [id]) : undefined;
    if (!row) fail(404, 'not_found', 'Value not found.');
    await audit(req, { action: 'lookup.retire', recordType: 'lookup', recordId: id, summary: `Retired "${row!.label}" in ${row!.list_key}` });
    return { ok: true };
  });
}

// ---------- figures cache (E16-38) ----------

/**
 * The Overview's figure routes, and whether a figure depends on who asks beyond their permissions
 * (`person`: it holds the caller's own counts, such as "mine"). A record type's `/stats` route is a
 * figure too; it depends on the person only when a filter names "me".
 */
export const FIGURE_ROUTES: Record<string, 'viewer' | 'person'> = {
  '/api/tickets/metrics': 'viewer',
  '/api/risks/summary': 'viewer',
  '/api/actions/summary': 'person',
  '/api/vulnerabilities/summary': 'viewer',
  '/api/projects/portfolio': 'viewer',
  '/api/contracts/renewals': 'viewer',
  '/api/training/summary': 'viewer',
};

/** `GRC_FIGURES_CACHE_SECONDS` (default 10; 0 switches the cache off). Off by default in tests. */
export function figuresCacheMs(): number {
  const raw = process.env.GRC_FIGURES_CACHE_SECONDS;
  if (raw === undefined || raw.trim() === '') return process.env.VITEST ? 0 : 10_000;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 300) * 1000 : 0;
}

interface Kept { generation: number; at: number; body: string; type: string }
interface Pending { key: string; generation: number; done: Promise<Kept | null>; resolve: (k: Kept | null) => void }

/**
 * Keeps the answer of a figure route for a few seconds, and only while nothing has been written
 * (`db.generation()` grows on every change; a write anywhere empties it at once). Answers are kept
 * per set of permissions and switched-off areas (they decide every figure, which is the same for
 * everyone who sees it; restricted records are counted for all), and per person for the routes
 * that hold the caller's own counts. Callers asking at the same moment wait for one computation
 * instead of each running it, which is what makes the Overview fast with several people at once
 * on the embedded database (it answers one statement at a time). Only a 200 answer is kept. The
 * feature switches and the route's own permission check run before the cache is looked at.
 */
export function registerFiguresCache(app: FastifyInstance, db: Db, res: ReturnType<typeof makeResources>) {
  const ttl = figuresCacheMs();
  if (!ttl || !db.generation) return { clear() { /* off */ }, size: () => 0 };
  const generation = db.generation.bind(db);
  const kept = new Map<string, Kept>();
  const pending = new Map<string, Pending>();
  const mine = new WeakMap<FastifyRequest, Pending>();
  let statsRoutes = new Set<string>();
  app.addHook('onReady', async () => { statsRoutes = new Set(res.registry.all().map((d) => `${d.path}/stats`)); });

  const keyOf = (req: FastifyRequest): string | null => {
    if (req.method !== 'GET' || !req.user) return null;
    const route = req.routeOptions?.url ?? '';
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    let scope = FIGURE_ROUTES[route];
    if (!scope && statsRoutes.has(route)) {
      let plain: string;
      try {
        plain = decodeURIComponent(query.slice(1).replace(/\+/g, ' '));
      } catch {
        return null; // a malformed query is not kept: the route answers it
      }
      scope = /(^|[=,])\s*me\s*(,|&|$)/.test(plain) ? 'person' : 'viewer';
    }
    if (!scope) return null;
    const u = req.user;
    // The permissions are part of every key, also for a person's own figures: an API token holds
    // fewer than its owner, and a kept answer is given before the route checks them.
    const who = `p:${[...u.permissions].sort().join(',')}${scope === 'person' ? `|u:${u.id}` : ''}`;
    return `${who}|off:${[...(u.off ?? [])].sort().join(',')}|${route}${query}`;
  };

  // Registered after the feature gate (core/features.ts), so a switched-off area answers 404 first;
  // the route's own permission check (its preHandler) runs after this, and a stored answer exists
  // only for a set of permissions that passed it.
  app.addHook('preHandler', async (req, reply) => {
    const key = keyOf(req);
    if (!key) return;
    const now = generation();
    const hit = kept.get(key);
    if (hit && hit.generation === now && Date.now() - hit.at < ttl) return reply.type(hit.type).send(hit.body);
    const busy = pending.get(key);
    if (busy && busy.generation === now) {
      // Someone with the same permissions is computing it right now: wait for that answer (at most 30 s).
      const done = await Promise.race([busy.done, new Promise<null>((r) => setTimeout(() => r(null), 30_000).unref())]);
      if (done && done.generation === generation()) return reply.type(done.type).send(done.body);
    }
    let resolve!: (k: Kept | null) => void;
    const entry: Pending = { key, generation: now, done: new Promise<Kept | null>((r) => { resolve = r; }), resolve: (k) => resolve(k) };
    pending.set(key, entry);
    mine.set(req, entry);
  });

  const finish = (req: FastifyRequest, value: Kept | null) => {
    const entry = mine.get(req);
    if (!entry) return;
    mine.delete(req);
    if (pending.get(entry.key) === entry) pending.delete(entry.key);
    entry.resolve(value);
  };

  app.addHook('onSend', async (req, reply, payload) => {
    const m = mine.get(req);
    if (!m) return payload;
    let value: Kept | null = null;
    if (reply.statusCode === 200 && typeof payload === 'string') {
      value = { generation: m.generation, at: Date.now(), body: payload, type: String(reply.getHeader('content-type') ?? 'application/json; charset=utf-8') };
      if (kept.size >= 1000) kept.clear();
      kept.set(m.key, value);
    }
    finish(req, value);
    return payload;
  });
  // A request that ended without an answer (an error, a closed connection) lets the others compute.
  app.addHook('onResponse', async (req) => finish(req, null));
  app.addHook('onRequestAbort', async (req) => finish(req, null));

  return { clear: () => kept.clear(), size: () => kept.size };
}
