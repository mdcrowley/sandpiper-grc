import type { FastifyRequest } from 'fastify';
import { allTaggables, taggable, taggables, type TaggableDef } from '../../core/asset-tags.ts';
import { etagOf } from '../../core/api/conventions.ts';
import { holdsOn } from '../../core/holds.ts';
import type { LookupValue, ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import {
  MAX_LOOKUP_CANDIDATES,
  type CardActivityItem, type CardRef, type LookupCandidate, type LookupOutcome, type LookupResponse, type LookupResult, type TagAction, type TagCard,
} from '../../../../shared/asset-tags-api.ts';
import {
  cleanValue, extractFromCode, firstMatchingFormat, formatsFor, matchFormat, MAX_CODE_CONTENT, MAX_TAG_VALUE, valueKey,
  type TagFormat, type TagSource,
} from '../../../../shared/tag-format.ts';
import { cardActions, registerActionRoutes } from './actions.ts';
import { lastSeen, logLookup, logSourceOf } from './history.ts';
import { activeByKey, assignmentsOf, historyByKey, loadFormats, stockStatus, type AssignmentRow } from './store.ts';

// Lookup and the tag card (E37-04, E37-05). Owned by TAGS-LOOKUP.
//
// GET /api/asset-tags/lookup?value=&source=typed|handheld (the web: typed, or a handheld scanner) and
// POST /api/asset-tags/lookup { candidates } (the app's camera: up to 10 readings at once) answer, per
// candidate, in the rule order of spec §4.2: current, replaced, in stock, unknown but matching a format,
// another identifier, nothing. A check character that does not match is a misread, refused first.
//
// The one rule that matters most: a value whose record the person may not see (restricted, no view
// permission, a switched-off area) or whose tag was ended answers exactly as if the value had never
// been attached to anything. With no stock and no formats that is "Nothing found for <value>."; with a
// format it matches, "not in your tag stock". Only administrators learn that a record of a
// switched-off area holds it (`switchedOff: true`). A hidden record is never tied to the lookup log.

const SOURCES: TagSource[] = ['code', 'text', 'typed', 'handheld'];
const WEB_SOURCES: TagSource[] = ['typed', 'handheld'];
/** Records the identifier rule returns at most, across types. */
const MAX_IDENTIFIER_CARDS = 10;
/** Characters the comparison form leaves out, as a PostgreSQL bracket expression (valueKey in SQL, near enough; checked again in code). */
const SQL_IGNORED = `'[[:space:]_‐-―−－-]'`;

/** Per-request memo: lookup lists, people's names, the formats. */
export interface LookupEnv {
  formats: TagFormat[];
  lists: Map<string, LookupValue[]>;
  names: Map<string, string | null>;
  isAdmin: boolean;
}

async function newEnv(ctx: ModuleContext, req: FastifyRequest): Promise<LookupEnv> {
  return { formats: await loadFormats(ctx.db, { activeOnly: true }), lists: new Map(), names: new Map(), isAdmin: ctx.can(req.user, 'admin.administer') };
}

async function listOf(ctx: ModuleContext, env: LookupEnv, list: string): Promise<LookupValue[]> {
  let values = env.lists.get(list);
  if (!values) env.lists.set(list, (values = await ctx.lookups.values(list)));
  return values;
}

async function nameOf(ctx: ModuleContext, env: LookupEnv, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  if (!env.names.has(id)) {
    const u = await ctx.db.one<{ name: string }>(`select coalesce(nullif(display_name, ''), username) as name from users where id::text = $1`, [id]);
    env.names.set(id, u?.name ?? null);
  }
  return env.names.get(id) ?? null;
}

/** The record type's definition, if the person may see records of it (loaded, switched on, view permission, not wholly restricted). */
export function viewableType(ctx: ModuleContext, req: FastifyRequest, type: string): ResourceDef | undefined {
  const def = ctx.resources.get(type);
  if (!def || !ctx.can(req.user, `${def.module}.view`)) return undefined;
  if (def.restricted === true && !ctx.can(req.user, 'security.view')) return undefined;
  return def;
}

/** One record, if the person may see it (the same rules as its own page). */
export async function seeRecord(ctx: ModuleContext, req: FastifyRequest, type: string, id: string): Promise<{ def: ResourceDef; row: Row } | undefined> {
  const def = viewableType(ctx, req, type);
  if (!def) return undefined;
  const row = await ctx.resources.find(type, id, req.user);
  return row ? { def, row } : undefined;
}

const refOf = (def: ResourceDef, row: Row): string | null => (def.ref ? (row[def.ref.field] as string | null) ?? null : null);
const titleOf = (def: ResourceDef, row: Row): string => String(row[def.titleField] ?? '') || refOf(def, row) || def.label;
const dateText = (v: unknown): string | null => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));

/** A field's value as display text (lookup labels, people's names, record labels the person may see). */
async function display(ctx: ModuleContext, req: FastifyRequest, env: LookupEnv, def: ResourceDef, field: string, value: unknown): Promise<string | null> {
  if (value === null || value === undefined || value === '') return null;
  const f = def.fields[field];
  if (!f) return null;
  if (f.type === 'lookup' && f.list) return (await listOf(ctx, env, f.list)).find((v) => v.value === value)?.label ?? String(value);
  if (f.type === 'user') return nameOf(ctx, env, value);
  if (f.type === 'ref' && f.to) {
    const found = typeof value === 'string' ? await seeRecord(ctx, req, f.to, value) : undefined;
    return found ? [refOf(found.def, found.row), titleOf(found.def, found.row)].filter(Boolean).join(' ') : null;
  }
  if (f.type === 'boolean') return value ? 'Yes' : 'No';
  if (f.type === 'number' || f.type === 'currency') return Number(value).toLocaleString('en-US');
  if (f.type === 'date') return String(value instanceof Date ? value.toISOString() : value).slice(0, 10);
  if (f.type === 'json') return null;
  return String(value);
}

async function cardRef(ctx: ModuleContext, req: FastifyRequest, type: string, id: unknown): Promise<CardRef | null> {
  if (typeof id !== 'string' || !id) return null;
  const found = await seeRecord(ctx, req, type, id);
  if (!found) return null;
  return { type, id, label: titleOf(found.def, found.row), ref: refOf(found.def, found.row), route: `${found.def.route}/${id}` };
}

async function tableExists(ctx: ModuleContext, table: string): Promise<boolean> {
  return Boolean((await ctx.db.one<{ t: string | null }>('select to_regclass($1)::text as t', [`public.${table}`]))?.t);
}

/** The image attachment marked as the record's photo (E37-06), while it is still there. */
async function photoOf(ctx: ModuleContext, type: string, id: string): Promise<TagCard['photo']> {
  if (!(await tableExists(ctx, 'attachments'))) return null;
  const row = await ctx.db.one<Row>(
    `select a.id, a.description from tag_record_photos p join attachments a on a.id = p.attachment_id
      where p.record_type = $1 and p.record_id = $2 and a.deleted_at is null and a.record_type = $1 and a.record_id = $2
        and a.content_type like 'image/%'`, [type, id]);
  return row ? { attachmentId: row.id, url: `/api/attachments/${row.id}/download`, description: row.description ?? null } : null;
}

async function activity(ctx: ModuleContext, req: FastifyRequest, env: LookupEnv, type: string, id: string): Promise<TagCard['activity']> {
  const out: TagCard['activity'] = { openTickets: [], lastInspection: null, lastCondition: null, recentChanges: [] };
  const item = async (t: string, def: ResourceDef, r: Row, statusList: string | null, date: unknown): Promise<CardActivityItem> => ({
    type: t, id: r.id, label: titleOf(def, r), ref: refOf(def, r), route: `${def.route}/${r.id}`,
    status: statusList && r.status ? (await listOf(ctx, env, statusList)).find((v) => v.value === r.status)?.label ?? String(r.status) : null,
    date: dateText(date),
  });

  // Open tickets about it: the affected asset or system, or linked to the record.
  const tickets = viewableType(ctx, req, 'ticket');
  if (tickets) {
    const closed = (await listOf(ctx, env, 'ticket_status'))
      .filter((s) => ['resolved', 'closed'].includes(String(s.meta?.category ?? '')) || s.value === 'cancelled').map((s) => s.value);
    const direct = type === 'asset' ? 't.asset_id = $2' : type === 'system' ? 't.system_id = $2' : 'false';
    const rows = await ctx.db.query<Row>(
      `select t.* from tickets t
        where t.deleted_at is null and ${ctx.resources.visibleWhere('ticket', req.user, 't')} and not (t.status = any($3::text[]))
          and (${direct} or exists (select 1 from record_links l where (l.from_type = 'ticket' and l.from_id = t.id and l.to_type = $1 and l.to_id = $2)
                                                                   or (l.to_type = 'ticket' and l.to_id = t.id and l.from_type = $1 and l.from_id = $2)))
        order by t.opened_at desc nulls last, t.created_at desc limit 5`, [type, id, closed]);
    for (const r of rows) out.openTickets.push(await item('ticket', tickets, r, 'ticket_status', r.opened_at ?? r.created_at));
  }

  const inspections = viewableType(ctx, req, 'inspection');
  if (inspections) {
    const r = await ctx.db.one<Row>(
      `select i.* from inspections i where i.deleted_at is null and i.target_type = $1 and i.target_id = $2 and ${ctx.resources.visibleWhere('inspection', req.user, 'i')}
        order by (i.performed_on is null), i.performed_on desc, i.due_on desc nulls last limit 1`, [type, id]);
    if (r) out.lastInspection = await item('inspection', inspections, r, 'inspection_status', r.performed_on ?? r.due_on);
  }

  const condition = viewableType(ctx, req, 'condition_assessment');
  if (condition) {
    const r = await ctx.db.one<Row>(
      `select c.* from condition_assessments c where c.deleted_at is null and c.target_type = $1 and c.target_id = $2 and ${ctx.resources.visibleWhere('condition_assessment', req.user, 'c')}
        order by c.assessed_on desc, c.created_at desc limit 1`, [type, id]);
    if (r) {
      const it = await item('condition_assessment', condition, r, null, r.assessed_on);
      it.status = (await listOf(ctx, env, 'condition_rating')).find((v) => v.value === r.rating)?.label ?? (r.rating ? String(r.rating) : null);
      out.lastCondition = it;
    }
  }

  const changes = await ctx.db.query<Row>(
    `select at, summary, actor_name from audit_events where record_type = $1 and record_id = $2 order by at desc, id desc limit 5`, [type, id]);
  out.recentChanges = changes.map((c) => ({ at: dateText(c.at)!, summary: String(c.summary ?? ''), byName: c.actor_name ?? null }));
  return out;
}

/** The tag card of a record the person may see (spec §4.3). */
export async function buildCard(ctx: ModuleContext, req: FastifyRequest, env: LookupEnv, tdef: TaggableDef, def: ResourceDef, row: Row): Promise<TagCard> {
  const id = String(row.id);
  const active = (await assignmentsOf(ctx.db, tdef.type, id)).filter((a) => a.status === 'active');
  const tagValues = active.length ? active.map((a) => a.value) : row[tdef.field] ? [String(row[tdef.field])] : [];
  const statusField = tdef.statusField && def.fields[tdef.statusField] ? tdef.statusField : null;
  const statusList = statusField ? def.fields[statusField].list : undefined;
  const statusValue = statusField ? row[statusField] : null;
  const statusLookup = statusList && statusValue ? (await listOf(ctx, env, statusList)).find((v) => v.value === statusValue) : undefined;

  const people: TagCard['people'] = [];
  for (const f of tdef.peopleFields ?? []) {
    if (!def.fields[f] || !row[f]) continue;
    const name = await nameOf(ctx, env, row[f]);
    if (name) people.push({ field: f, label: def.fields[f].label, userId: String(row[f]), name });
  }
  const facts: TagCard['facts'] = [];
  for (const f of tdef.facts ?? []) {
    if (!def.fields[f]) continue; // a field of a switched-off area (condition) is not there
    facts.push({ field: f, label: def.fields[f].label, value: await display(ctx, req, env, def, f, row[f]) });
  }

  const holds = await holdsOn(ctx.db, tdef.type, id);
  const restricted = def.restricted === true || (def.restricted === 'flag' && row.restricted === true);
  const card: TagCard = {
    recordType: tdef.type, typeLabel: def.label, recordId: id, route: `${def.route}/${id}`,
    title: titleOf(def, row), ref: refOf(def, row),
    tagValue: (active.find((a) => a.is_primary) ?? active[0])?.value ?? tagValues[0] ?? null,
    tagValues,
    status: statusValue ? { value: String(statusValue), label: statusLookup?.label ?? String(statusValue), color: statusLookup?.color ?? null } : null,
    photo: await photoOf(ctx, tdef.type, id),
    site: tdef.siteField && tdef.siteField !== 'id' && def.fields[tdef.siteField] ? await cardRef(ctx, req, 'site', row[tdef.siteField]) : null,
    location: tdef.locationField && def.fields[tdef.locationField] && row[tdef.locationField] ? String(row[tdef.locationField]) : null,
    people,
    facts,
    activity: await activity(ctx, req, env, tdef.type, id),
    // The hold's reference only for people who may see holds; the actions leave out changes either way.
    holds: ctx.can(req.user, 'legal.view') ? holds.map((h) => ({ ref: h.ref })) : [],
    restricted,
    lastSeen: ctx.can(req.user, `${def.module}.edit`) ? await lastSeen(ctx, tdef.type, id) : null,
    version: etagOf(id, row.updated_at),
    actions: [],
  };
  card.actions = await cardActions(ctx, req, tdef.type, row, { def, tdef, held: holds.length > 0, hasTag: active.length > 0 || Boolean(row[tdef.field]) });
  return card;
}

/** What one value's assignment shows this person: its record, or why it is hidden. */
async function recordOf(ctx: ModuleContext, req: FastifyRequest, a: AssignmentRow): Promise<{ tdef: TaggableDef; def: ResourceDef; row: Row } | 'hidden' | 'off'> {
  const tdef = taggable(ctx.app, ctx.resources, a.record_type);
  if (!tdef) return allTaggables(ctx.app).some((t) => t.type === a.record_type) ? 'off' : 'hidden';
  const found = await seeRecord(ctx, req, a.record_type, a.record_id);
  return found ? { tdef, ...found } : 'hidden';
}

interface Found { tdef: TaggableDef; def: ResourceDef; row: Row; matchedBy: string }

/** Rule 5: an exact match (by the comparison form) on another identifier field, among records the person may see. */
async function byIdentifiers(ctx: ModuleContext, req: FastifyRequest, key: string, withTagField: boolean): Promise<Found[]> {
  const out: Found[] = [];
  for (const tdef of taggables(ctx.app, ctx.resources)) {
    const def = viewableType(ctx, req, tdef.type);
    if (!def) continue;
    const fields = [...(withTagField ? [{ field: tdef.field, label: 'tag' }] : []), ...tdef.identifiers]
      .filter((i) => i.field === 'id' ? false : Boolean(def.fields[i.field]) || i.field === 'ref');
    for (const ident of fields) {
      if (out.length >= MAX_IDENTIFIER_CARDS) return out;
      const rows = await ctx.db.query<Row>(
        `select * from ${def.table} t where t.deleted_at is null and ${ctx.resources.visibleWhere(tdef.type, req.user, 't')}
           and t.${ident.field} is not null and upper(regexp_replace(t.${ident.field}::text, ${SQL_IGNORED}, '', 'g')) = $1
         order by t.created_at limit ${MAX_IDENTIFIER_CARDS}`, [key]);
      for (const row of rows) {
        if (valueKey(row[ident.field]) !== key || out.some((f) => f.row.id === row.id && f.tdef.type === tdef.type)) continue;
        out.push({ tdef, def, row, matchedBy: ident.label });
      }
    }
  }
  return out.slice(0, MAX_IDENTIFIER_CARDS);
}

function attachAction(ctx: ModuleContext, req: FastifyRequest, value: string): TagAction[] {
  if (!ctx.can(req.user, 'tags.manage')) return [];
  return [{ key: 'attach', label: 'Attach this tag', webPath: null, prefill: null, value }];
}

function result(c: LookupCandidate, key: string, outcome: LookupOutcome, message: string, extra: Partial<LookupResult> = {}): LookupResult {
  return { candidate: c, key, outcome, message, cards: [], replacedBy: null, matchedBy: null, formatId: null, actions: [], ...extra };
}

/** Resolves one candidate (spec §4.2). Returns the result and the record to tie the log entry to, if any. */
async function resolveOne(ctx: ModuleContext, req: FastifyRequest, env: LookupEnv, c: LookupCandidate): Promise<LookupResult> {
  let value = cleanValue(c.value).slice(0, MAX_CODE_CONTENT);
  // A code may hold more than the value: an active format's extraction pattern takes the value out of it.
  if (c.source === 'code') {
    for (const f of env.formats) {
      if (!f.extractPattern) continue;
      const ex = extractFromCode(c.value, f);
      if (ex.extracted && ex.value) { value = ex.value; break; }
    }
  }
  const key = valueKey(value);
  if (!key) return result(c, key, 'nothing', 'Type or scan a tag number first.');
  if (key.length > MAX_TAG_VALUE) return result(c, key, 'nothing', `Nothing found for ${value.slice(0, 60)}…`);

  // A check character that does not match: refused before any lookup (the app treats it as a misread).
  const formats = formatsFor(env.formats);
  const matched = firstMatchingFormat(value, formats, c.source);
  if (!matched && formats.some((f) => { const m = matchFormat(value, f, c.source); return !m.ok && m.reason === 'check'; })) {
    return result(c, key, 'misread', `The check character of ${value} does not match, so it was probably misread. Check the tag and try again.`);
  }

  let switchedOff = false;
  const active = await activeByKey(ctx.db, key);
  const history = active ? [] : await historyByKey(ctx.db, key);
  if (active) {
    const seen = await recordOf(ctx, req, active);
    if (typeof seen === 'object') {
      return result(c, key, 'current', `Tag ${value} is on ${seen.def.label.toLowerCase()} ${titleOf(seen.def, seen.row)}.`, {
        cards: [await buildCard(ctx, req, env, seen.tdef, seen.def, seen.row)], formatId: active.format_id ?? matched?.format.id ?? null,
      });
    }
    if (seen === 'off') switchedOff = true;
  }
  const newest = history[0];
  if (newest?.status === 'replaced') {
    const seen = await recordOf(ctx, req, newest);
    if (typeof seen === 'object') {
      const next = newest.replaced_by ? await ctx.db.one<{ value: string }>('select value from tag_assignments where id = $1', [newest.replaced_by]) : undefined;
      const card = await buildCard(ctx, req, env, seen.tdef, seen.def, seen.row);
      const now = next?.value ?? card.tagValue;
      return result(c, key, 'replaced', now
        ? `This tag was replaced by ${now}. Remove the old tag ${value} from ${seen.def.label.toLowerCase()} ${card.title}.`
        : `Tag ${value} was replaced on ${seen.def.label.toLowerCase()} ${card.title}. Remove the old tag.`, {
        cards: [card], replacedBy: now ?? null,
      });
    }
    if (seen === 'off') switchedOff = true;
  }

  // From here on, the value is treated as if it had never been attached to anything this person may
  // see: a hidden, switched-off or ended assignment answers exactly like an unknown value.
  const extra = switchedOff && env.isAdmin ? { switchedOff: true } : {};
  const stock = await stockStatus(ctx.db, key);
  const spent = Boolean(stock.mark) || (newest !== undefined && (newest.status === 'void' || newest.status === 'lost'));
  if (stock.inStock && !spent) {
    return result(c, key, 'in_stock', `Tag ${value} is not attached yet.`, {
      formatId: stock.formatId ?? matched?.format.id ?? null, actions: attachAction(ctx, req, value), ...extra,
    });
  }
  if (matched) {
    return result(c, key, 'unknown_format', `Tag ${value} is not in your tag stock.`, {
      formatId: matched.format.id, actions: attachAction(ctx, req, value), ...extra,
    });
  }
  // Rule 5: other identifiers. Before the tag history exists for a value (records tagged before the
  // tags module, not yet backfilled) the record's own tag field is looked at too.
  const found = await byIdentifiers(ctx, req, key, !active && history.length === 0);
  if (found.length) {
    const onTagField = found.filter((f) => f.matchedBy === 'tag');
    if (onTagField.length === 1) {
      const f = onTagField[0];
      return result(c, key, 'current', `Tag ${value} is on ${f.def.label.toLowerCase()} ${titleOf(f.def, f.row)}.`, {
        cards: [await buildCard(ctx, req, env, f.tdef, f.def, f.row)],
      });
    }
    const cards: TagCard[] = [];
    for (const f of found) cards.push(await buildCard(ctx, req, env, f.tdef, f.def, f.row));
    const labels = [...new Set(found.map((f) => f.matchedBy))];
    const matchedBy = labels.join(', ');
    return result(c, key, 'identifier', found.length === 1
      ? `No tag has the number ${value}, but it is the ${labels[0].toLowerCase()} of ${found[0].def.label.toLowerCase()} ${titleOf(found[0].def, found[0].row)}.`
      : `No tag has the number ${value}, but ${found.length} records have it as ${labels.length === 1 ? `their ${labels[0].toLowerCase()}` : 'another identifier'}.`, {
      cards, matchedBy,
    });
  }
  return result(c, key, 'nothing', `Nothing found for ${value}.`, extra);
}

export interface LookupOptions {
  /** Write each result to the lookup log (default true). Inventory counts pass false when they log themselves. */
  log?: boolean;
  /** The log's `action` column, for example `count`. */
  action?: string | null;
}

/**
 * Resolves candidates to results and tag cards for the person making the request (spec §4.2, §4.3).
 * Also used by inventory counts (TAGS-COUNTS) to resolve a value typed or read during a count, and by
 * the mobile app's endpoints. Logs each lookup through history.ts `logLookup` when logging is on; a
 * record is tied to the entry only when the person may see it.
 */
export async function lookupValues(ctx: ModuleContext, req: FastifyRequest, candidates: LookupCandidate[], opts: LookupOptions = {}): Promise<LookupResponse> {
  const env = await newEnv(ctx, req);
  const results: LookupResult[] = [];
  for (const c of candidates) {
    const r = await resolveOne(ctx, req, env, c);
    results.push(r);
    if (opts.log !== false && r.key) {
      const card = r.cards.length === 1 ? r.cards[0] : null;
      await logLookup(ctx, {
        key: r.key, personId: req.user?.id ?? null, source: logSourceOf(c.source, req), outcome: r.outcome,
        recordType: card?.recordType ?? null, recordId: card?.recordId ?? null, action: opts.action ?? null,
      });
    }
  }
  const records = new Set(results.flatMap((r) => r.cards.map((cd) => `${cd.recordType}:${cd.recordId}`))).size;
  return { results, records };
}

function candidateOf(ctx: ModuleContext, raw: unknown, allowed: TagSource[], field: string): LookupCandidate {
  const b = (raw ?? {}) as Row;
  const value = typeof b.value === 'string' ? b.value : typeof b.value === 'number' ? String(b.value) : '';
  if (!cleanValue(value)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: 'Give a tag number.' });
  if (value.length > MAX_CODE_CONTENT) ctx.fail(400, 'validation', 'Check the highlighted fields.', { [field]: `At most ${MAX_CODE_CONTENT} characters.` });
  const source = (b.source ?? 'typed') as TagSource;
  if (!allowed.includes(source)) ctx.fail(400, 'validation', 'Check the highlighted fields.', { source: `How it was read: one of ${allowed.join(', ')}.` });
  return { value, source };
}

/** Registers the lookup routes, and the routes of the card's actions (actions.ts). */
export async function registerLookup(ctx: ModuleContext): Promise<void> {
  const { app } = ctx;

  app.get('/api/asset-tags/lookup', async (req) => {
    const q = req.query as Row;
    const c = candidateOf(ctx, { value: q.value, source: q.source || 'typed' }, WEB_SOURCES, 'value');
    return lookupValues(ctx, req, [c]);
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/asset-tags/lookup', tag: 'Asset tags',
    summary: 'What a tag number is stuck to, and what you may do with it (the tag card)',
    description: 'Signed in; no permission beyond seeing the record. Answers per spec §4.2: current, replaced, in_stock, unknown_format, identifier, misread or nothing. A value whose record you may not see, in a switched-off area, or whose tag was ended answers exactly like a value never attached.',
    query: { value: 'The tag number as typed or as a handheld scanner gave it', source: 'typed (default) or handheld' },
    response: 'LookupResponse { results: [LookupResult], records } (shared/asset-tags-api.ts)',
  });

  app.post('/api/asset-tags/lookup', async (req) => {
    const b = (req.body ?? {}) as Row;
    const list = Array.isArray(b.candidates) ? b.candidates : [];
    if (!list.length || list.length > MAX_LOOKUP_CANDIDATES) {
      ctx.fail(400, 'validation', 'Check the highlighted fields.', { candidates: `Send 1 to ${MAX_LOOKUP_CANDIDATES} candidates.` });
    }
    return lookupValues(ctx, req, list.map((c: unknown, i: number) => candidateOf(ctx, c, SOURCES, `candidates.${i}.value`)));
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/asset-tags/lookup', tag: 'Asset tags',
    summary: 'Look up several readings of one tag at once (the app\'s camera): one result per candidate, in order',
    body: `{ candidates: [{ value, source: code | text | typed | handheld }] } (1 to ${MAX_LOOKUP_CANDIDATES})`,
    response: 'LookupResponse { results: [LookupResult], records } (shared/asset-tags-api.ts)',
  });

  await registerActionRoutes(ctx);
}
