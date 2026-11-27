import { z } from 'zod';
import { qs } from './caller.ts';
import {
  defaultColumns, display, fail, plural, presentRow, rowLine,
  type FieldMeta, type ToolContext, type ToolSpec, type TypeMeta,
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
};
/** Whether this caller's saves are data loads (E18-70): read-only fields may be set then. */
const loading = (t: ToolContext) => t.session.dataLoad?.allowed === true;

/** Checks field names against the type and turns "me" into the caller's id for person fields. */
function cleanValues(t: ToolContext, type: TypeMeta, values: Record<string, unknown>, what: 'create' | 'update') {
  const fields: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  const load = loading(t);
  for (const [name, v] of Object.entries(values ?? {})) {
    const f = type.fields[name] ?? (load ? LOAD_STANDARD[name] : undefined);
    if (!f) { fields[name] = `${type.plural} have no field "${name}".`; continue; }
    if (f.readOnly && !load) { fields[name] = `"${f.label}" is worked out by the application and cannot be set.`; continue; }
    out[name] = f.type === 'user' && v === 'me' ? t.session.user.id : v;
  }
  if (Object.keys(fields).length) fail(`Some fields cannot be ${what === 'create' ? 'set' : 'changed'}. Use list_record_types with type "${type.type}" for the fields.`, 'validation', fields);
  if (!Object.keys(out).length) fail(what === 'create' ? 'Give at least the required fields.' : 'Give at least one field to change.');
  return out;
}

const listRecordTypes: ToolSpec = {
  name: 'list_record_types', title: 'List record types', group: 'Records', idempotent: true,
  description: 'Lists the kinds of record you can see in Sandpiper GRC (systems, assets, actions, ...). '
    + 'With "type", describes that type\'s fields: label, kind of value, whether it is required or read-only, and the allowed choices for list fields. '
    + 'Use it before list_records, create_record or update_record to learn the field names.',
  input: { type: typeArg.optional() },
  async run(args, t) {
    const meta = await t.meta();
    if (!args.type) {
      const types = Object.values(meta.resources).sort((a, b) => a.plural.localeCompare(b.plural)).map((r) => ({
        type: r.type, label: r.label, plural: r.plural, restricted: r.restricted, has_reference: !!r.refField, fields: Object.keys(r.fields),
      }));
      const dl = t.session.dataLoad;
      return {
        text: `${plural(types.length, 'record type')} you can see:\n${types.map((r) => `- ${r.type}: ${r.plural}${r.restricted ? ' (restricted)' : ''}`).join('\n')}`
          + (loading(t) ? `\n\nData load mode is on until ${dl!.until}: create_record and update_record may also set read-only fields, any status, created_at, created_by, updated_at and the reference. Ask with a type for its extra fields.` : ''),
        data: { types, data_load: dl ? { on: dl.on, until: dl.until, your_saves_are_loads: dl.allowed } : { on: false } },
      };
    }
    const type = await t.typeOf(args.type);
    const load = loading(t);
    const fields = Object.entries(type.fields).map(([name, f]) => ({
      name, label: f.label, kind: f.type, required: !!f.required, read_only: !!f.readOnly,
      ...(load && f.readOnly ? { settable_in_data_load: true } : {}),
      ...(f.to ? { refers_to: f.to } : {}),
      ...(f.list ? { choices: (meta.lookups[f.list] ?? []).map((v) => ({ value: v.value, label: v.label })) } : {}),
    }));
    const lines = fields.map((f) => `- ${f.name} (${f.kind}${f.required ? ', required' : ''}${f.read_only ? (load ? ', read-only, settable in data load mode' : ', read-only') : ''}): ${f.label}`
      + ('choices' in f && f.choices?.length ? ` [${f.choices.map((c) => c.value).join(', ')}]` : ''));
    const extra = load ? [...fields.filter((f) => f.read_only).map((f) => f.name), ...Object.keys(LOAD_STANDARD)] : [];
    return {
      text: `${type.plural} (${type.type})${type.restricted ? ', restricted records' : ''}. Title field: ${type.titleField}.${type.refField ? ` Reference field: ${type.refField}.` : ''}\nFields:\n${lines.join('\n')}`
        + (load ? `\nData load mode is on until ${t.session.dataLoad!.until}: you may also set ${extra.join(', ')} (dates and times as ISO 8601; created_by is a user id). Any status is allowed. A reference you give must be unique; values you give win over what the application would work out, and what you leave out is worked out from the dates you give. Nothing is sent to anyone.` : ''),
      data: {
        type: type.type, label: type.label, plural: type.plural, title_field: type.titleField, reference_field: type.refField ?? null, restricted: type.restricted, fields, url: t.link(type.route),
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
  description: 'Adds a comment to a record you may see. Comments are internal notes unless "internal" is false (a public comment, which the person who raised the record can see where the application shows it to them).',
  input: {
    type: typeArg, id: idArg,
    body: z.string().min(1).max(20000).describe('The comment text.'),
    internal: z.boolean().optional().describe('Internal note (default true).'),
  },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const made = await t.api.post<any>('/api/comments', { record_type: type.type, record_id: row.id, body: args.body, internal: args.internal !== false });
    const name = `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? row[type.titleField]}`;
    return {
      text: `${args.internal === false ? 'Public comment' : 'Internal note'} added to ${name}.`,
      data: { type: type.type, id: row.id, comment_id: made.id, internal: made.internal, url: t.link(type.route, row.id) },
      audit: { recordType: type.type, recordId: row.id, summary: `${args.internal === false ? 'Public comment' : 'Internal note'} added to ${name}` },
    };
  },
};

const createRecord: ToolSpec = {
  name: 'create_record', title: 'Create a record', group: 'Changes', write: true,
  description: 'Creates a record of one type, with the same validation, numbering and notifications as the application. '
    + 'Use list_record_types first for the field names, required fields and choices. Person fields take a user id or "me". '
    + 'If something is not valid, the answer names each field and what is wrong.',
  input: {
    type: typeArg,
    fields: z.record(z.string(), z.unknown()).describe('Field values by field name, e.g. {"title": "...", "priority": "high"}.'),
  },
  dataLoadNote: 'Data load mode is on: you may also set read-only fields (such as opened_at, resolved_at, closed_at, due times and breach flags), any status, created_at, created_by, updated_at and the reference; the record is marked as loaded and can be deleted with delete_record. Nothing is sent to anyone.',
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const data = cleanValues(t, type, args.fields, 'create');
    const row = await t.api.post<any>(type.path, data);
    const ref = type.refField ? row[type.refField] : null;
    const load = loading(t);
    return {
      text: `${load ? 'Loaded' : 'Created'} ${type.label.toLowerCase()} ${ref ?? ''} "${row[type.titleField] ?? ''}"${load ? ' (data load mode)' : ''}. Open: ${t.link(type.route, row.id)}`.replace(/\s+/g, ' '),
      data: { type: type.type, id: row.id, ref, title: row[type.titleField] ?? null, url: t.link(type.route, row.id), ...(load ? { data_load: true, created_at: row.created_at } : {}) },
      audit: { recordType: type.type, recordId: row.id, summary: `${type.label} ${ref ?? `"${row[type.titleField] ?? ''}"`} ${load ? 'loaded (data load mode)' : 'created'}` },
    };
  },
};

const updateRecord: ToolSpec = {
  name: 'update_record', title: 'Update a record', group: 'Changes', write: true, idempotent: true,
  description: 'Changes some fields of one record you may edit; fields you leave out are kept. Read-only fields are refused. '
    + 'The application\'s own rules apply (for example status changes that need other fields); problems come back per field.',
  input: {
    type: typeArg, id: idArg,
    changes: z.record(z.string(), z.unknown()).describe('New values by field name; null clears a field.'),
  },
  dataLoadNote: 'Data load mode is on: read-only fields, any status, created_at, created_by, updated_at and the reference may be changed too. Nothing is sent to anyone.',
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const patch = cleanValues(t, type, args.changes, 'update');
    const saved = await t.api.patch<any>(`${type.path}/${row.id}`, patch);
    const changed = Object.keys(patch).map((k) => type.fields[k]?.label ?? k);
    const name = `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? `"${row[type.titleField]}"`}`;
    // A status move that waits for an approval workflow (E14-37): the record keeps its status for now.
    const held = saved?._pending_move as { field: string; to: string } | undefined;
    const heldText = held ? ` The ${(type.fields[held.field]?.label ?? held.field).toLowerCase()} stays as it is until an approval workflow approves the move to "${held.to}".` : '';
    return {
      text: `Updated ${name}: ${changed.join(', ')}.${heldText}`,
      data: {
        type: type.type, id: row.id, changed: Object.keys(patch), now: Object.fromEntries(Object.keys(patch).map((k) => [k, display(saved, k, type.fields[k])])), url: t.link(type.route, row.id),
        ...(held ? { waiting_for_approval: { field: held.field, to: held.to } } : {}),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `Updated ${name} (${changed.join(', ')})` },
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
  async run(args, t) {
    const from = await t.typeOf(args.from_type);
    const to = await t.typeOf(args.to_type);
    const a = await t.record(from, args.from_id);
    const b = await t.record(to, args.to_id);
    const link = await t.api.post<any>('/api/links', { from_type: from.type, from_id: a.id, to_type: to.type, to_id: b.id, relation: args.relation });
    const an = a[from.refField ?? ''] ?? a[from.titleField];
    const bn = b[to.refField ?? ''] ?? b[to.titleField];
    return {
      text: `Linked ${from.label.toLowerCase()} ${an} to ${to.label.toLowerCase()} ${bn} (${link.relation}).`,
      data: { link_id: link.id, relation: link.relation, from: { type: from.type, id: a.id }, to: { type: to.type, id: b.id } },
      audit: { recordType: from.type, recordId: a.id, summary: `Linked ${from.label.toLowerCase()} ${an} to ${to.label.toLowerCase()} ${bn} (${link.relation})` },
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
