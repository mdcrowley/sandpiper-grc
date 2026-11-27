import { z } from 'zod';
import { qs } from './caller.ts';
import { normalizeDate, resolveValues, valueHint, type Resolution } from './resolve.ts';
import {
  defaultColumns, display, fail, plural, presentRow, rowLine,
  type FieldMeta, type Meta, type ToolContext, type ToolSpec, type TypeMeta,
} from './toolkit.ts';

// The generic tools: every record type the person may see, through the generated REST routes.

const typeArg = z.string().min(1).describe('Record type: its key (e.g. "ticket", "risk", "security_incident"), label or plural. See list_record_types.');
const idArg = z.string().min(1).describe('The record id (a UUID) or its reference, e.g. "TKT-00012".');
const valueArg = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]);

/** The standard fields a data load may set besides the type's own (E18-70). */
const LOAD_STANDARD: Record<string, FieldMeta> = {
  created_at: { label: 'Created', type: 'datetime' },
  created_by: { label: 'Created by', type: 'user' },
  updated_at: { label: 'Updated', type: 'datetime' },
  updated_by: { label: 'Updated by', type: 'user' },
};
/** Whether this caller's saves are data loads (E18-70): read-only fields may be set then. */
const loading = (t: ToolContext) => t.session.dataLoad?.allowed === true;

/**
 * The `as` argument of the write tools, offered only while this caller's saves are loads (E18-71):
 * the person the load writes in the name of.
 */
export const asArg = z.union([
  z.string().min(1).max(250),
  z.object({ user: z.string().optional(), person: z.string().optional(), name: z.string().optional() }),
]).describe('Data load mode only: the person who really wrote or did this, for the history. A user id, username or email (disabled accounts too); '
  + '"person:<roster id, reference or email>" for someone on the people roster; "name:<their name>" for someone with neither. '
  + 'Unknown people are refused. The audit log still names you and your token, "on behalf of" this person. Nothing is sent to them.');
export const AS_INPUT = { as: asArg.optional() };

/**
 * Works out the person named by `as` (E18-71) through POST /api/data-load/person: what to send as
 * `on_behalf_of` (unambiguous), and their name for the answer and the audit event. Null without `as`.
 */
export async function named(t: ToolContext, as: unknown): Promise<{ send: unknown; name: string } | null> {
  if (as === undefined || as === null || as === '') return null;
  if (!loading(t)) fail('"as" is only for data load mode.', 'validation', { as: 'Only while data load mode is on.' });
  let p: { kind: string; user_id: string | null; person_id: string | null; name: string };
  try {
    p = await t.api.post('/api/data-load/person', { person: as });
  } catch (err) {
    const e = err as { fields?: Record<string, string> };
    if (e.fields?.person) fail(e.fields.person, 'validation', { as: e.fields.person });
    throw err;
  }
  const send = p.kind === 'name' ? { name: p.name } : p.person_id ? `person:${p.person_id}` : p.user_id;
  return { send, name: p.name };
}
const behalf = (who: { name: string } | null) => (who ? ` on behalf of ${who.name}` : '');
/** A comment's time as given, or a date in a common format as YYYY-MM-DD; the route checks it. */
const commentTime = (v: string) => (Number.isNaN(Date.parse(v)) ? normalizeDate(v) ?? v : v);

/**
 * Checks field names against the type and resolves the values (resolve.ts): a linked record by its
 * reference or exact title, a person by username, email or name ("me" for the caller), a list value
 * by its label, a date in a common format. Returns what to send and what was worked out.
 */
async function cleanValues(t: ToolContext, type: TypeMeta, values: Record<string, unknown>, what: 'create' | 'update') {
  const fields: Record<string, string> = {};
  const given: Record<string, unknown> = {};
  const load = loading(t);
  for (const [name, v] of Object.entries(values ?? {})) {
    const f = type.fields[name] ?? (load ? LOAD_STANDARD[name] : undefined);
    if (!f) { fields[name] = `${type.plural} have no field "${name}".`; continue; }
    if (f.readOnly && !load) { fields[name] = `"${f.label}" is worked out by the application and cannot be set.`; continue; }
    given[name] = v;
  }
  if (Object.keys(fields).length) fail(`Some fields cannot be ${what === 'create' ? 'set' : 'changed'}. Use list_record_types with type "${type.type}" for the fields.`, 'validation', fields);
  if (!Object.keys(given).length) fail(what === 'create' ? 'Give at least the required fields.' : 'Give at least one field to change.');
  const r = await resolveValues(t, given, (name) => type.fields[name] ?? LOAD_STANDARD[name]);
  if (Object.keys(r.errors).length) fail('Some values could not be matched. Nothing was saved.', 'validation', r.errors);
  return { data: r.out, resolved: r.resolved };
}

/** "Assignee "sam@x" → Sam Rivera" lines for the answer. */
const resolvedText = (type: TypeMeta, resolved: Resolution[]) => (resolved.length
  ? ` Matched: ${resolved.map((r) => `${type.fields[r.field]?.label ?? r.field} "${Array.isArray(r.given) ? r.given.join(', ') : String(r.given)}" → ${r.label ?? (Array.isArray(r.value) ? r.value.join(', ') : String(r.value))}`).join('; ')}.`
  : '');

/** Every type with a field pointing at `type` (its child and dependent records), among those the caller may see. */
export function relatedTypes(meta: Meta, type: string) {
  const out: { type: string; plural: string; field: string; field_label: string; required: boolean }[] = [];
  for (const r of Object.values(meta.resources)) {
    for (const [name, f] of Object.entries(r.fields)) {
      if (f.type === 'ref' && f.to === type && !f.readOnly) out.push({ type: r.type, plural: r.plural, field: name, field_label: f.label, required: !!f.required });
    }
  }
  return out.sort((a, b) => a.plural.localeCompare(b.plural));
}

const RELATED_COUNTED = 12;
const isEmpty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length);

/**
 * What a save left out (E45-49): the optional fields still empty, and the related types with no records
 * pointing at this one yet, so the assistant sees what else its sources might fill.
 */
async function completeness(t: ToolContext, type: TypeMeta, row: Record<string, any>) {
  const meta = await t.meta();
  const unfilled = Object.entries(type.fields)
    .filter(([name, f]) => !f.readOnly && !f.required && name !== type.titleField && name !== type.refField && isEmpty(row[name]))
    .map(([name, f]) => ({ field: name, label: f.label }));
  const related = relatedTypes(meta, type.type).filter((r) => r.type !== type.type).slice(0, RELATED_COUNTED);
  const counts = await Promise.all(related.map(async (r) => {
    const res = await t.api.tryGet<{ total: number }>(`${meta.resources[r.type].path}${qs({ [`f.${r.field}`]: row.id, pageSize: 1 })}`).catch(() => undefined);
    return res ? res.total : -1;
  }));
  const relatedEmpty = related.filter((_, i) => counts[i] === 0).map((r) => ({ type: r.type, plural: r.plural, field: r.field }));
  const text = [
    unfilled.length ? ` Still empty: ${unfilled.slice(0, 20).map((u) => u.label).join(', ')}${unfilled.length > 20 ? ', …' : ''}.` : '',
    relatedEmpty.length ? ` No related records yet: ${relatedEmpty.map((r) => `${r.plural} (${r.type}.${r.field})`).join(', ')}.` : '',
    unfilled.length || relatedEmpty.length ? ' Fill what your sources give, create related records, attach the source files (attach_file, attach_link) and add history as comments.' : '',
  ].join('');
  return { unfilled, relatedEmpty, text };
}

const LINKS_TEXT = 'Besides these, link_records links a record to any other record you can see (relation in words, e.g. "related", "affects", "depends on", "caused by", "mitigates"), '
  + 'attach_file and attach_link put the source files and links on it, and add_comment keeps its history.';

const listRecordTypes: ToolSpec = {
  name: 'list_record_types', title: 'List record types', group: 'Records', idempotent: true,
  description: 'Lists the kinds of record you can see in Sandpiper GRC (systems, assets, actions, ...) with each type\'s required fields. '
    + 'With "type", describes that type\'s fields (label, kind of value, required or read-only, help text, how to give the value, the allowed choices of list fields, custom fields included) '
    + 'and its related types: the types whose records point at it (child records that belong to it) and how to link, attach files and add history. '
    + 'Use it before create_record or update_record, for the type and for its related types, to plan a complete record.',
  input: { type: typeArg.optional() },
  async run(args, t) {
    const meta = await t.meta();
    if (!args.type) {
      const types = Object.values(meta.resources).sort((a, b) => a.plural.localeCompare(b.plural)).map((r) => ({
        type: r.type, label: r.label, plural: r.plural, restricted: r.restricted, has_reference: !!r.refField, fields: Object.keys(r.fields),
        required: Object.entries(r.fields).filter(([, f]) => f.required && !f.readOnly).map(([n]) => n),
      }));
      const dl = t.session.dataLoad;
      return {
        text: `${plural(types.length, 'record type')} you can see (required fields in brackets):\n${types.map((r) => `- ${r.type}: ${r.plural}${r.restricted ? ' (restricted)' : ''}${r.required.length ? ` [${r.required.join(', ')}]` : ''}`).join('\n')}`
          + '\nAsk with a type for its fields and its related types.'
          + (loading(t) ? `\n\nData load mode is on until ${dl!.until}: create_record and update_record may also set read-only fields, any status, created_at, created_by, updated_at and the reference. Ask with a type for its extra fields.` : ''),
        data: { types, data_load: dl ? { on: dl.on, until: dl.until, your_saves_are_loads: dl.allowed } : { on: false } },
      };
    }
    const type = await t.typeOf(args.type);
    const load = loading(t);
    const fields = Object.entries(type.fields).map(([name, f]) => ({
      name, label: f.label, kind: f.type, required: !!f.required, read_only: !!f.readOnly,
      ...(load && f.readOnly ? { settable_in_data_load: true } : {}),
      ...(f.custom ? { custom: true } : {}),
      ...(f.multiple ? { multiple: true } : {}),
      ...(f.to ? { refers_to: f.to } : {}),
      ...(f.help ? { help: f.help } : {}),
      ...(valueHint(f, meta) ? { how: valueHint(f, meta) } : {}),
      ...(f.list ? { choices: (meta.lookups[f.list] ?? []).map((v) => ({ value: v.value, label: v.label })) } : {}),
    }));
    const choiceText = (c: { value: string; label: string }) => (c.label && c.label.toLowerCase() !== c.value.toLowerCase() ? `${c.value} (${c.label})` : c.value);
    const lines = fields.map((f) => `- ${f.name} (${f.kind}${f.multiple ? ', several' : ''}${f.required ? ', required' : ''}${f.read_only ? (load ? ', read-only, settable in data load mode' : ', read-only') : ''}${f.custom ? ', custom' : ''}${f.refers_to ? `, a ${f.refers_to}` : ''}): ${f.label}`
      + (f.help ? ` — ${f.help}` : '')
      + ('choices' in f && f.choices?.length ? ` [${f.choices.map(choiceText).join(', ')}]` : ''));
    const related = relatedTypes(meta, type.type);
    const relatedLines = related.map((r) => `- ${r.type} (${r.plural}): its ${r.field} ("${r.field_label}"${r.required ? ', required' : ''}) points at the ${type.label.toLowerCase()}`);
    const extra = load ? [...fields.filter((f) => f.read_only).map((f) => f.name), ...Object.keys(LOAD_STANDARD)] : [];
    return {
      text: `${type.plural} (${type.type})${type.restricted ? ', restricted records' : ''}. Title field: ${type.titleField}.${type.refField ? ` Reference field: ${type.refField}.` : ''}\nFields:\n${lines.join('\n')}`
        + '\nValues: a linked record by its id, reference or exact title; a person by username, email, exact name or "me"; a list field by value or label; dates as YYYY-MM-DD (other common formats are converted). Fill every field your source supports rather than writing facts into a description or notes.'
        + (relatedLines.length ? `\nRelated types (create them with create_record, setting the field to this ${type.label.toLowerCase()}'s reference or id):\n${relatedLines.join('\n')}` : '\nNo other type points at this one.')
        + `\n${LINKS_TEXT}`
        + (load ? `\nData load mode is on until ${t.session.dataLoad!.until}: you may also set ${extra.join(', ')} (dates and times as ISO 8601; created_by, updated_by and person fields take a user id, username or email). Give "as" on create_record and update_record to name the person who did it. Any status is allowed. A reference you give must be unique; values you give win over what the application would work out, and what you leave out is worked out from the dates you give. Nothing is sent to anyone.` : ''),
      data: {
        type: type.type, label: type.label, plural: type.plural, title_field: type.titleField, reference_field: type.refField ?? null, restricted: type.restricted, fields,
        related_types: related, links: LINKS_TEXT, url: t.link(type.route),
        ...(load ? { data_load: { on: true, until: t.session.dataLoad!.until, extra_fields: extra } } : {}),
      },
    };
  },
};

const search: ToolSpec = {
  name: 'search', title: 'Search everything', group: 'Records', idempotent: true,
  description: 'Full-text search across every record you may see (titles, descriptions, references, comments and attachment names), best matches first. '
    + 'Restricted records are only found by people who may see them.',
  input: {
    query: z.string().min(2).max(200).describe('Words or a reference to look for.'),
    types: z.array(z.string()).optional().describe('Only these record types (keys).'),
    limit: z.number().int().min(1).max(30).optional().describe('Most results to return (default 15).'),
  },
  async run(args, t) {
    let hits = await t.api.get<any[]>(`/api/search${qs({ q: args.query })}`);
    if (args.types?.length) hits = hits.filter((h) => args.types.includes(h.type));
    const results = hits.slice(0, args.limit ?? 15).map((h) => ({
      type: h.type, type_label: h.typeLabel, id: h.id, ref: h.ref ?? null, title: h.label, matched: h.matched, snippet: h.snippet || null, url: t.link(h.route, h.id),
    }));
    return {
      text: results.length
        ? `${plural(results.length, 'match', 'matches')} for "${args.query}":\n${results.map((r) => `- [${r.type_label}] ${r.ref ? `${r.ref} ` : ''}${r.title}${r.snippet ? ` — ${r.snippet}` : ''}`).join('\n')}`
        : `Nothing you can see matches "${args.query}".`,
      data: { query: args.query, results },
    };
  },
};

const listRecords: ToolSpec = {
  name: 'list_records', title: 'List records', group: 'Records', idempotent: true,
  description: 'Lists records of one type with optional search, filters, sort and paging (at most 50 a page). '
    + 'Filters use field names from list_record_types: {"status": ["new","open"]} matches any of the values; "me" stands for you in person fields '
    + '({"assignee_id": "me"}); add ".lt", ".gt", ".lte" or ".gte" to a date or number field ({"due_on.lt": "2026-12-01"}) and ".null" with true or false ({"owner_id.null": true}). '
    + 'Values are shown with their labels (people\'s names, list labels) rather than codes.',
  input: {
    type: typeArg,
    query: z.string().max(200).optional().describe('Full-text search within this type.'),
    filters: z.record(z.string(), valueArg).optional().describe('Field filters, as described above.'),
    sort: z.string().optional().describe('Field to sort by.'),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.number().int().min(1).optional(),
    page_size: z.number().int().min(1).max(50).optional().describe('Rows a page (default 20, at most 50).'),
    fields: z.array(z.string()).max(20).optional().describe('Fields to include for each row (default: a few useful ones).'),
  },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const params: Record<string, unknown> = { q: args.query, sort: args.sort, dir: args.direction, page: args.page ?? 1, pageSize: args.page_size ?? 20 };
    const bad: Record<string, string> = {};
    for (const [key, raw] of Object.entries((args.filters ?? {}) as Record<string, unknown>)) {
      const [name, op] = key.split('.');
      if (!type.fields[name] && name !== 'tags' && name !== 'created_at' && name !== 'updated_at') { bad[key] = `${type.plural} have no field "${name}".`; continue; }
      if (op && !['lt', 'gt', 'lte', 'gte', 'null', 'all'].includes(op)) { bad[key] = `Unknown operator ".${op}".`; continue; }
      params[`f.${key}`] = raw === null ? undefined : Array.isArray(raw) ? raw.join(',') : String(raw);
    }
    const fields = args.fields?.length ? args.fields : defaultColumns(type);
    for (const f of fields) if (!type.fields[f] && !['created_at', 'updated_at'].includes(f)) bad[f] = `${type.plural} have no field "${f}".`;
    if (args.sort && !type.fields[args.sort] && !['created_at', 'updated_at'].includes(args.sort)) bad.sort = `Cannot sort by "${args.sort}".`;
    if (Object.keys(bad).length) fail('Some field names are not right. Use list_record_types for this type.', 'validation', bad);
    const res = await t.api.get<{ rows: any[]; total: number; page: number; pageSize: number }>(`${type.path}${qs(params)}`);
    const rows = res.rows.map((r) => presentRow(t, type, r, fields));
    const pages = Math.max(1, Math.ceil(res.total / res.pageSize));
    return {
      text: res.total === 0
        ? `No ${type.plural.toLowerCase()} match.`
        : `${plural(res.total, type.label.toLowerCase(), type.plural.toLowerCase())} match; page ${res.page} of ${pages}:\n${rows.map((r) => rowLine(type, r)).join('\n')}`,
      data: { type: type.type, total: res.total, page: res.page, page_size: res.pageSize, pages, rows, url: t.link(type.route) },
    };
  },
};

const getRecord: ToolSpec = {
  name: 'get_record', title: 'Get a record', group: 'Records', idempotent: true,
  description: 'One record with every field you may see (labels rather than codes), its tags, its latest comments and its latest changes. '
    + 'Give the id or the reference (e.g. "RSK-00004").',
  input: { type: typeArg, id: idArg },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const fields: Record<string, unknown> = {};
    for (const [name, f] of Object.entries(type.fields)) fields[name] = display(row, name, f, 4000);
    const [comments, history] = await Promise.all([
      t.api.tryGet<any[]>(`/api/comments${qs({ record_type: type.type, record_id: row.id })}`),
      t.api.tryGet<any[]>(`/api/history${qs({ record_type: type.type, record_id: row.id })}`),
    ]);
    const recentComments = (comments ?? []).slice(-5).reverse().map((c) => ({ at: c.created_at, by: c.author_name, internal: c.internal, body: String(c.body).slice(0, 1000) }));
    const recentChanges = (history ?? []).slice(0, 5).map((h) => ({ at: h.at, by: h.actor_name, summary: h.summary, via_token: h.token_name ?? null }));
    const lines = Object.entries(type.fields)
      .filter(([name]) => fields[name] !== null && name !== type.titleField)
      .map(([name, f]) => `${f.label}: ${String(fields[name]).slice(0, 400)}`);
    return {
      text: [
        `${type.label} ${row[type.refField ?? ''] ?? ''} ${row[type.titleField] ?? ''}`.replace(/\s+/g, ' ').trim(),
        ...lines,
        recentComments.length ? `Latest comments:\n${recentComments.map((c) => `- ${c.by} (${c.at}): ${c.body.slice(0, 200)}`).join('\n')}` : 'No comments.',
        recentChanges.length ? `Latest changes:\n${recentChanges.map((c) => `- ${c.at} ${c.by ?? 'System'}: ${c.summary}`).join('\n')}` : '',
        `Open: ${t.link(type.route, row.id)}`,
      ].filter(Boolean).join('\n'),
      data: {
        type: type.type, id: row.id, ref: type.refField ? row[type.refField] ?? null : null, title: row[type.titleField] ?? null,
        fields, tags: row._tags ?? [], created_at: row.created_at, updated_at: row.updated_at,
        recent_comments: recentComments, recent_changes: recentChanges, url: t.link(type.route, row.id),
      },
    };
  },
};

const getRelated: ToolSpec = {
  name: 'get_related', title: 'Get related records', group: 'Records', idempotent: true,
  description: 'The records linked to one record (both directions), with the relation, e.g. a system\'s assets or the record an action arose from. Links you may not see are left out.',
  input: { type: typeArg, id: idArg },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const links = await t.api.get<any[]>(`/api/links${qs({ record_type: type.type, record_id: row.id })}`);
    const related = links.map((l) => ({ relation: l.relation, direction: l.direction, type: l.type, type_label: l.typeLabel, id: l.recordId, ref: l.ref ?? null, title: l.label, url: t.link(l.route, l.recordId) }));
    return {
      text: related.length
        ? `${plural(related.length, 'related record')}:\n${related.map((r) => `- ${r.relation} [${r.type_label}] ${r.ref ? `${r.ref} ` : ''}${r.title}`).join('\n')}`
        : 'No related records that you can see.',
      data: { type: type.type, id: row.id, related },
    };
  },
};

const getHistory: ToolSpec = {
  name: 'get_history', title: 'Get record history', group: 'Records', idempotent: true,
  description: 'Who changed one record, when, and what changed (newest first), including changes made with API tokens.',
  input: { type: typeArg, id: idArg, limit: z.number().int().min(1).max(100).optional().describe('Most events (default 20).') },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const events = (await t.api.get<any[]>(`/api/history${qs({ record_type: type.type, record_id: row.id })}`)).slice(0, args.limit ?? 20);
    const history = events.map((e) => {
      const after = e.after && typeof e.after === 'object' && !Array.isArray(e.after) ? e.after : {};
      return { at: e.at, by: e.actor_name ?? 'System', action: e.action, summary: e.summary, via_token: e.token_name ?? null, fields_changed: Object.keys(after).map((k) => type.fields[k]?.label ?? k) };
    });
    return {
      text: history.length
        ? history.map((h) => `- ${h.at} ${h.by}${h.via_token ? ` (token "${h.via_token}")` : ''}: ${h.summary ?? h.action}${h.fields_changed.length ? ` [${h.fields_changed.join(', ')}]` : ''}`).join('\n')
        : 'No history recorded.',
      data: { type: type.type, id: row.id, history },
    };
  },
};

// ---------- changes ----------

const addComment: ToolSpec = {
  name: 'add_comment', title: 'Add a comment', group: 'Changes', write: true,
  description: 'Adds a comment to a record you may see. Comments are internal notes unless "internal" is false (a public comment, which the person who raised the record can see where the application shows it to them). '
    + 'Use one comment per entry of a record\'s history (work notes, emails, meeting notes from the source), oldest first, rather than one long description.',
  input: {
    type: typeArg, id: idArg,
    body: z.string().min(1).max(20000).describe('The comment text.'),
    internal: z.boolean().optional().describe('Internal note (default true).'),
  },
  dataLoadInput: {
    ...AS_INPUT,
    created_at: z.string().optional().describe('Data load mode only: when the comment was written (ISO 8601, or a date).'),
  },
  dataLoadNote: 'Data load mode is on: give "as" for the person who wrote the comment and created_at for when; nobody is told about it.',
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const who = await named(t, args.as);
    const made = await t.api.post<any>('/api/comments', {
      record_type: type.type, record_id: row.id, body: args.body, internal: args.internal !== false,
      ...(who ? { on_behalf_of: who.send } : {}), ...(loading(t) && args.created_at ? { created_at: commentTime(args.created_at) } : {}),
    });
    const name = `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? row[type.titleField]}`;
    return {
      text: `${args.internal === false ? 'Public comment' : 'Internal note'} added to ${name}${behalf(who)}.`,
      data: {
        type: type.type, id: row.id, comment_id: made.id, internal: made.internal, url: t.link(type.route, row.id),
        ...(loading(t) ? { author: made.author_name, created_at: made.created_at } : {}),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `${args.internal === false ? 'Public comment' : 'Internal note'} added to ${name}`, onBehalf: who?.name },
    };
  },
};

const VALUES_HELP = 'Linked records (ref fields) take an id, a reference (e.g. "SYS-00012") or the exact title of a record you can see; person fields a user id, username, email, exact display name or "me"; '
  + 'list fields a value or its label; dates YYYY-MM-DD or another common format (MM/DD/YYYY is read month first). The answer says what each value was matched to, '
  + 'which optional fields are still empty (unfilled) and which related types have no records for it yet (related_empty).';

const createRecord: ToolSpec = {
  name: 'create_record', title: 'Create a record', group: 'Changes', write: true,
  description: 'Creates a record of one type, with the same validation, numbering and notifications as the application. '
    + 'Use list_record_types first for the field names, required fields, choices and related types, and fill every field your source supports '
    + '(people, linked records, dates, categories) instead of writing those facts into the description or notes. ' + VALUES_HELP
    + ' If something is not valid or cannot be matched, the answer names each field and what is wrong, and nothing is saved.',
  input: {
    type: typeArg,
    fields: z.record(z.string(), z.unknown()).describe('Field values by field name, e.g. {"title": "...", "priority": "High", "system_id": "SYS-00012", "assignee_id": "sam@example.org"}.'),
  },
  dataLoadNote: 'Data load mode is on: you may also set read-only fields (such as opened_at, resolved_at, closed_at, due times and breach flags), any status, created_at, created_by, updated_at, updated_by and the reference; give "as" for the person who created it (its author in the history). Person fields may name disabled accounts. The record is marked as loaded and can be deleted with delete_record. Nothing is sent to anyone.',
  dataLoadInput: AS_INPUT,
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const { data, resolved } = await cleanValues(t, type, args.fields, 'create');
    const who = await named(t, args.as);
    const row = await t.api.post<any>(type.path, who ? { ...data, on_behalf_of: who.send } : data);
    const ref = type.refField ? row[type.refField] : null;
    const load = loading(t);
    const gaps = await completeness(t, type, row);
    return {
      text: `${load ? 'Loaded' : 'Created'} ${type.label.toLowerCase()} ${ref ?? ''} "${row[type.titleField] ?? ''}"${load ? ' (data load mode)' : ''}${behalf(who)}. Open: ${t.link(type.route, row.id)}`.replace(/\s+/g, ' ')
        + resolvedText(type, resolved) + gaps.text,
      data: {
        type: type.type, id: row.id, ref, title: row[type.titleField] ?? null, url: t.link(type.route, row.id),
        resolved, unfilled: gaps.unfilled, related_empty: gaps.relatedEmpty,
        ...(load ? { data_load: true, created_at: row.created_at, ...(who ? { on_behalf_of: who.name } : {}) } : {}),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `${type.label} ${ref ?? `"${row[type.titleField] ?? ''}"`} ${load ? 'loaded (data load mode)' : 'created'}`, onBehalf: who?.name },
    };
  },
};

const updateRecord: ToolSpec = {
  name: 'update_record', title: 'Update a record', group: 'Changes', write: true, idempotent: true,
  description: 'Changes some fields of one record you may edit; fields you leave out are kept. Read-only fields are refused. '
    + 'The application\'s own rules apply (for example status changes that need other fields); problems come back per field. ' + VALUES_HELP,
  input: {
    type: typeArg, id: idArg,
    changes: z.record(z.string(), z.unknown()).describe('New values by field name; null clears a field.'),
  },
  dataLoadNote: 'Data load mode is on: read-only fields, any status, created_at, created_by, updated_at, updated_by and the reference may be changed too; give "as" for the person who made the change (a status change, an assignment and so on). Nothing is sent to anyone.',
  dataLoadInput: AS_INPUT,
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const { data: patch, resolved } = await cleanValues(t, type, args.changes, 'update');
    const who = await named(t, args.as);
    const saved = await t.api.patch<any>(`${type.path}/${row.id}`, who ? { ...patch, on_behalf_of: who.send } : patch);
    const changed = Object.keys(patch).map((k) => type.fields[k]?.label ?? k);
    const name = `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? `"${row[type.titleField]}"`}`;
    // A status move that waits for an approval workflow (E14-37): the record keeps its status for now.
    const held = saved?._pending_move as { field: string; to: string } | undefined;
    const heldText = held ? ` The ${(type.fields[held.field]?.label ?? held.field).toLowerCase()} stays as it is until an approval workflow approves the move to "${held.to}".` : '';
    const gaps = await completeness(t, type, saved ?? row);
    return {
      text: `Updated ${name}${behalf(who)}: ${changed.join(', ')}.${heldText}${resolvedText(type, resolved)}${gaps.text}`,
      data: {
        type: type.type, id: row.id, changed: Object.keys(patch), now: Object.fromEntries(Object.keys(patch).map((k) => [k, display(saved, k, type.fields[k])])), url: t.link(type.route, row.id),
        resolved, unfilled: gaps.unfilled, related_empty: gaps.relatedEmpty,
        ...(held ? { waiting_for_approval: { field: held.field, to: held.to } } : {}),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `Updated ${name} (${changed.join(', ')})`, onBehalf: who?.name },
    };
  },
};

const linkRecords: ToolSpec = {
  name: 'link_records', title: 'Link two records', group: 'Changes', write: true, idempotent: true,
  description: 'Links two records you may see (you need edit permission on the first), for example an asset to the system it belongs to. Linking the same pair again changes nothing.',
  input: {
    from_type: typeArg, from_id: idArg, to_type: typeArg, to_id: idArg,
    relation: z.string().max(60).optional().describe('How they relate, e.g. "related", "caused by", "affects" (default "related").'),
  },
  dataLoadInput: AS_INPUT,
  dataLoadNote: 'Data load mode is on: give "as" for the person who made the link.',
  async run(args, t) {
    const from = await t.typeOf(args.from_type);
    const to = await t.typeOf(args.to_type);
    const a = await t.record(from, args.from_id);
    const b = await t.record(to, args.to_id);
    const who = await named(t, args.as);
    const link = await t.api.post<any>('/api/links', { from_type: from.type, from_id: a.id, to_type: to.type, to_id: b.id, relation: args.relation, ...(who ? { on_behalf_of: who.send } : {}) });
    const an = a[from.refField ?? ''] ?? a[from.titleField];
    const bn = b[to.refField ?? ''] ?? b[to.titleField];
    return {
      text: `Linked ${from.label.toLowerCase()} ${an} to ${to.label.toLowerCase()} ${bn} (${link.relation}).`,
      data: { link_id: link.id, relation: link.relation, from: { type: from.type, id: a.id }, to: { type: to.type, id: b.id } },
      audit: { recordType: from.type, recordId: a.id, summary: `Linked ${from.label.toLowerCase()} ${an} to ${to.label.toLowerCase()} ${bn} (${link.relation})`, onBehalf: who?.name },
    };
  },
};

const deleteRecord: ToolSpec = {
  name: 'delete_record', title: 'Delete a loaded record', group: 'Changes', write: true, dataLoadOnly: true,
  description: 'Only while data load mode is on: deletes one record that was created in data load mode (for example to undo a wrong load). '
    + 'Other records cannot be deleted. The record is soft-deleted, as in the application, and the deletion is audited; a record under a legal hold is refused.',
  input: { type: typeArg, id: idArg },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    await t.api.del(`/api/data-load/records/${encodeURIComponent(type.type)}/${row.id}`);
    const name = `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? `"${row[type.titleField]}"`}`;
    return {
      text: `Deleted ${name} (created in data load mode).`,
      data: { type: type.type, id: row.id, ref: type.refField ? row[type.refField] ?? null : null, deleted: true },
      audit: { recordType: type.type, recordId: row.id, summary: `Deleted ${name} (created in data load mode)` },
    };
  },
};

export const RECORD_TOOLS: ToolSpec[] = [
  listRecordTypes, search, listRecords, getRecord, getRelated, getHistory, addComment, createRecord, updateRecord, linkRecords, deleteRecord,
];
