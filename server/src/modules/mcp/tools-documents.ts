import { z } from 'zod';
import { todayInZone } from '../../core/timezone.ts';
import { addDays } from '../../../../shared/dates.ts';
import { fileOnlyReport } from '../policies/convert/docx.ts';
import { qs, ToolError } from './caller.ts';
import { fail, isUuid, plural, type ToolContext, type ToolResult, type ToolSpec } from './toolkit.ts';
import { AS_INPUT, named } from './tools-records.ts';
import { PATH_ARG, uploadFromPath } from './tools-local.ts';

// Document control tools (E43-10): find, read and check controlled documents, the register figures,
// and, with write access, load a whole document package: chunked upload of the originals, Word
// conversion, documents created or updated by their number, versions with their original dates and
// statuses (in data load mode), access lists, links and reviews.
//
// Every tool calls the application's own routes with the caller's token (`t.api`), so the document's
// distribution (who may read it), permissions, scope, numbering and data load mode are exactly those
// of the web application: a document the person may not read does not exist here either. Write tools
// are offered only when AI assistant write access is on; nothing here deletes anything (in data load
// mode delete_record removes a record a load created).

type Json = Record<string, any>;
const DOC = 'policy';
const sees = (a: { sees(t: string): boolean }) => a.sees(DOC);
const edits = (a: { sees(t: string): boolean; can(p: string): boolean }) => a.sees(DOC) && (a.can('policies.edit') || a.can('policies.create'));
const loading = (t: ToolContext) => t.session.dataLoad?.allowed === true;
const docArg = z.string().min(1).describe('The document: its number (e.g. "SOP-IT-014"), its reference (e.g. "POL-00012") or its id.');
const listArg = z.array(z.string()).optional();
const dateArg = (what: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe(`${what} (YYYY-MM-DD).`);

const DATA_LOAD_NOTE = 'Data load mode is on: the dates, statuses and numbers you give are kept as they are, nothing is sent to anyone (no acknowledgment requests, notifications or approvals), and every document, version and file is listed for undoing.';

/** One document by number, reference or id, as GET /api/policies/:id answers it. */
async function findDocument(t: ToolContext, key: string): Promise<Json> {
  const k = String(key ?? '').trim();
  if (!k) fail('Give the document number, reference or id.');
  if (isUuid(k)) return t.api.get(`/api/policies/${k}`);
  for (const field of ['doc_number', 'ref']) {
    const found = await t.api.get<{ rows: Json[] }>(`/api/policies${qs({ [`f.${field}`]: [...new Set([k, k.toUpperCase()])], pageSize: 5 })}`);
    const row = found.rows.find((r) => String(r[field] ?? '').toLowerCase() === k.toLowerCase());
    if (row) return row;
  }
  throw new ToolError(`No document ${k} that you can open.`, 'not_found', 404);
}

const docName = (d: Json) => `${d.doc_number ?? d.ref ?? ''} "${d.title ?? ''}"`.trim();
const docLink = (t: ToolContext, d: Json) => t.link('/policies', d.id);

// ---------- name lookups (departments, people, roles, groups) through routes the caller may use ----------

async function departmentId(t: ToolContext, name: string): Promise<string> {
  if (isUuid(name)) return name;
  const all = await t.api.get<{ rows: Json[] }>(`/api/departments${qs({ q: name, pageSize: 50 })}`);
  const hit = all.rows.filter((d) => String(d.name).toLowerCase() === name.trim().toLowerCase());
  if (hit.length !== 1) fail(`No department called "${name}".`, 'validation', { department: `No department called "${name}".` });
  return hit[0].id;
}
async function userId(t: ToolContext, name: string): Promise<string> {
  if (name === 'me') return t.session.user.id;
  if (isUuid(name)) return name;
  const opts = await t.api.get<{ id: string; label: string }[]>(`/api/users/options${qs({ q: name })}`);
  const wanted = name.trim().toLowerCase();
  const hit = opts.filter((o) => o.label.toLowerCase() === wanted || o.label.toLowerCase().startsWith(`${wanted} (`) || o.label.toLowerCase().includes(`(${wanted})`));
  const pick = hit.length === 1 ? hit : opts.length === 1 ? opts : [];
  if (pick.length !== 1) fail(`No single person matches "${name}"${opts.length ? `: ${opts.slice(0, 5).map((o) => o.label).join('; ')}` : ''}. Give a user name or id.`, 'validation', { owner: 'Not found.' });
  return pick[0].id;
}
async function roleKeys(t: ToolContext, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const opts = await t.api.get<{ roles: { key: string; name: string }[] }>('/api/policies/audience-options');
  return names.map((n) => {
    const r = opts.roles.find((x) => x.key === n || x.name.toLowerCase() === n.trim().toLowerCase());
    if (!r) fail(`No role "${n}".`, 'validation', { roles: `No role "${n}".` });
    return r!.key;
  });
}
async function groupIds(t: ToolContext, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const groups = await t.api.get<Json[]>('/api/documents/groups');
  return names.map((n) => {
    const g = groups.find((x) => x.id === n || String(x.name).toLowerCase() === n.trim().toLowerCase());
    if (!g) fail(`No distribution group "${n}".`, 'validation', { groups: `No distribution group "${n}".` });
    return g!.id;
  });
}
async function accessFields(t: ToolContext, a: Json): Promise<Json> {
  const out: Json = {};
  if (a.access !== undefined) out.access = a.access;
  if (a.access_departments) out.access_departments = await Promise.all((a.access_departments as string[]).map((d) => departmentId(t, d)));
  if (a.access_roles) out.access_roles = await roleKeys(t, a.access_roles);
  if (a.access_groups) out.access_groups = await groupIds(t, a.access_groups);
  if (a.access_users) out.access_users = await Promise.all((a.access_users as string[]).map((u) => userId(t, u)));
  return out;
}

// ---------- read ----------

const findDocuments: ToolSpec = {
  name: 'find_documents', title: 'Find controlled documents', group: 'Records', idempotent: true, available: sees,
  description: 'Finds controlled documents (policies, plans, standards, procedures, SOPs, work instructions, forms, external and reference documents) you may read, '
    + 'by words (number, title, summary and full text), type, owning department, status and review state. Returns number, title, type, status, current version and dates.',
  input: {
    q: z.string().optional().describe('Words to find in the number, title or text.'),
    type: z.string().optional().describe('Document type value, e.g. "policy", "sop", "procedure", "external".'),
    department: z.string().optional().describe('Owning department name or id.'),
    status: z.enum(['draft', 'in_review', 'approved', 'published', 'retired']).optional().describe('"published" is Effective, "retired" is Obsolete.'),
    review: z.enum(['overdue', 'due_90']).optional().describe('Only documents whose review is overdue, or due within 90 days.'),
    limit: z.number().int().min(1).max(200).optional().describe('Most rows (default 50).'),
  },
  async run(args, t) {
    const today = todayInZone();
    const params: Json = { q: args.q, 'f.document_type': args.type, 'f.status': args.status, pageSize: args.limit ?? 50, sort: 'doc_number', dir: 'asc' };
    if (args.department) params['f.owning_department_id'] = await departmentId(t, args.department);
    if (args.review === 'overdue') params['f.review_date.lt'] = today;
    if (args.review === 'due_90') { params['f.review_date.lt'] = addDays(today, 91); params['f.review_date.gt'] = addDays(today, -1); }
    if (args.q) { delete params.sort; delete params.dir; }
    const r = await t.api.get<{ rows: Json[]; total: number }>(`/api/policies${qs(params)}`);
    const rows = r.rows.map((d) => ({
      id: d.id, doc_number: d.doc_number ?? null, ref: d.ref, title: d.title, type: d._display?.document_type ?? d.document_type,
      status: d._display?.status ?? d.status, current_version: d.current_version ?? null, next_review_on: d.review_date ?? null,
      department: d._display?.owning_department_id ?? null, access: d.access ?? null, url: docLink(t, d),
    }));
    return {
      text: `${plural(r.total, 'document')} found${r.total > rows.length ? ` (showing ${rows.length})` : ''}.\n`
        + rows.map((d) => `- ${d.doc_number ?? d.ref} ${d.title} (${d.type}; ${d.status}${d.current_version ? `; version ${d.current_version}` : ''}${d.next_review_on ? `; next review ${d.next_review_on}` : ''})`).join('\n'),
      data: { total: r.total, rows },
    };
  },
};

const readDocument: ToolSpec = {
  name: 'read_document', title: 'Read a controlled document', group: 'Records', idempotent: true, available: sees,
  description: 'Reads one document you may read: its details, its versions with their labels and dates, the text of one version (the Markdown, or the text read from a PDF original), '
    + 'its place in the hierarchy and its links. Access lists are included only when you may change them. Drafts are shown only to people who write or approve documents.',
  input: {
    document: docArg,
    version: z.number().int().min(1).optional().describe('Version number to read (default: the effective one, else the newest you may see).'),
    max_chars: z.number().int().min(500).max(100_000).optional().describe('Most characters of text (default 20,000).'),
  },
  async run(args, t) {
    const d = await findDocument(t, args.document);
    const versions = await t.api.get<Json[]>(`/api/policies/${d.id}/versions`);
    const chosen = args.version
      ? versions.find((v) => Number(v.version) === args.version) ?? fail(`Version ${args.version} of ${docName(d)} does not exist or is not visible to you.`, 'not_found')
      : versions.find((v) => v.status === 'published') ?? versions[0];
    const max = args.max_chars ?? 20_000;
    let text = '';
    let textNote: string | null = null;
    if (chosen) {
      if (chosen.content_kind === 'file') {
        const ft = await t.api.tryGet<Json>(`/api/documents/${d.id}/versions/${chosen.id}/text?max_chars=${max}`);
        text = ft?.text ?? '';
        textNote = !ft ? 'The text of the file could not be read.' : ft.ocr ? 'Scanned PDF read by OCR: the text may contain reading mistakes.'
          : ft.scanned ? 'Scanned PDF: no text layer, and no text could be read from it by OCR here.'
          : ft.status === 'waiting' ? 'The text of the file has not been read yet; try again in a few minutes.' : ft.status === 'no_file' ? 'This version has no original file.' : null;
      } else text = String(chosen.body ?? '');
    }
    const truncated = text.length > max;
    const [hierarchy, relationships, access] = await Promise.all([
      t.api.tryGet<Json>(`/api/policies/${d.id}/hierarchy`),
      t.api.tryGet<Json>(`/api/policies/${d.id}/relationships`),
      t.api.tryGet<Json>(`/api/policies/${d.id}/access`),
    ]);
    const vlist = versions.map((v) => ({
      id: v.id, version: v.version, label: v.version_label ?? null, status: v.status, approved_on: v.approved_on ?? null, effective_on: v.effective_on ?? null,
      superseded_on: v.superseded_on ?? null, withdrawn_on: v.withdrawn_on ?? null, approved_by_name: v.approved_by_name ?? null,
      approval_body: v.approval_body ?? null, approval_reference: v.approval_reference ?? null, change_summary: v.change_summary ?? null,
      content_kind: v.content_kind ?? 'markdown', has_original: !!v.source_attachment_id, conversion_warnings: v.conversion?.warnings ?? [],
    }));
    const links = (relationships?.groups ?? []).map((g: Json) => ({
      relation: g.label ?? g.relation, items: (g.items ?? []).map((i: Json) => ({ type: i.typeLabel ?? i.type, ref: i.ref ?? null, label: i.label, id: i.id })), hidden: g.hidden ?? 0,
    }));
    const data: Json = {
      document: {
        id: d.id, doc_number: d.doc_number ?? null, ref: d.ref, title: d.title, summary: d.summary ?? null, type: d._display?.document_type ?? d.document_type,
        status: d._display?.status ?? d.status, owner: d._display?.owner_id ?? null, department: d._display?.owning_department_id ?? null,
        access: d.access ?? null, next_review_on: d.review_date ?? null, last_reviewed_on: d.last_reviewed_on ?? null, retired_on: d.retired_on ?? null,
        approver_name: d.approver_name ?? null, ack_required: d.ack_required ?? null, url: docLink(t, d),
      },
      versions: vlist,
      version: chosen ? { version: chosen.version, label: chosen.version_label ?? null, status: chosen.status, content_kind: chosen.content_kind ?? 'markdown', text: text.slice(0, max), truncated, note: textNote } : null,
      parent: hierarchy?.ancestors?.length ? hierarchy.ancestors[hierarchy.ancestors.length - 1] : null,
      children: hierarchy?.children ?? [], hidden_children: hierarchy?.hidden_children ?? 0,
      links,
    };
    if (access?.can_change) data.access_lists = { access: access.access, departments: access.departments, roles: access.roles, groups: access.groups, users: access.users, reader_count: access.reader_count };
    const lines = [
      `${docName(d)} (${data.document.type}; ${data.document.status}). ${d.summary ?? ''}`.trim(),
      `Versions: ${vlist.map((v) => `${v.version}${v.label ? ` (${v.label})` : ''} ${v.status}${v.effective_on ? ` effective ${v.effective_on}` : ''}${v.superseded_on ? ` to ${v.superseded_on}` : ''}`).join('; ') || 'none'}.`,
      chosen ? `Text of version ${chosen.version}${truncated ? ` (first ${max} characters)` : ''}:${textNote ? ` ${textNote}` : ''}\n${text.slice(0, max)}` : 'No version you may read.',
      `Open: ${docLink(t, d)}`,
    ];
    return { text: lines.join('\n'), data };
  },
};

const registerSummary: ToolSpec = {
  name: 'document_register_summary', title: 'Document register figures', group: 'Work and insight', idempotent: true, available: sees,
  description: 'Figures of the document register, the same for everyone: documents by type and status, effective, in review, reviews overdue and due within 90 days, obsolete, without an owner, and acknowledgment completion. Counts include documents you may not open; no titles are given.',
  input: {},
  async run(_args, t) {
    const s = await t.api.tryGet<Json>('/api/documents/summary');
    const byStatus = await t.api.tryGet<Json>('/api/policies/stats?group=status');
    if (!s && !byStatus) return { text: 'The document register figures are not available to you.', data: { available: false } };
    const types = (s?.by_type ?? []).map((x: Json) => ({ value: x.value, label: x.label, count: Number(x.count) }));
    const statuses = (byStatus?.groups ?? []).map((x: Json) => ({ value: x.value, label: x.label, count: Number(x.count) }));
    const data = {
      total: s?.total ?? byStatus?.total ?? null, effective: s?.effective ?? null, in_review: s?.in_review ?? null, review_overdue: s?.review_overdue ?? null,
      review_due_90: s?.review_due_90 ?? null, obsolete: s?.obsolete ?? null, without_owner: s?.without_owner ?? null, ack_completion_pct: s?.ack_completion_pct ?? null,
      by_type: types, by_status: statuses,
    };
    return {
      text: [
        `Documents: ${data.total ?? 'n/a'}; effective ${data.effective ?? 'n/a'}; in review ${data.in_review ?? 'n/a'}; obsolete ${data.obsolete ?? 'n/a'}.`,
        `Reviews overdue ${data.review_overdue ?? 'n/a'}; due within 90 days ${data.review_due_90 ?? 'n/a'}; without an owner ${data.without_owner ?? 'n/a'}.`,
        `Acknowledgment completion: ${data.ack_completion_pct === null ? 'n/a' : `${data.ack_completion_pct}%`}.`,
        `By type: ${types.filter((x: Json) => x.count).map((x: Json) => `${x.label} ${x.count}`).join(', ') || 'none'}.`,
      ].join('\n'),
      data,
    };
  },
};

// ---------- uploads ----------

const startUpload: ToolSpec = {
  name: 'start_upload', title: 'Start a file upload', group: 'Changes', write: true,
  description: 'Starts sending a file (a document\'s original: .docx, .pdf, .doc and so on) in parts. Give its name, size in bytes and SHA-256. '
    + 'Then send each part of at most part_size bytes (1 MB) with upload_part as base64, and call finish_upload. The upload is kept for 24 hours and can be used once (attach_file for any record, or add_document_version).',
  input: {
    file_name: z.string().min(1).describe('File name with its extension, e.g. "SOP-IT-014 Rev C.docx".'),
    size: z.number().int().min(1).describe('Size in bytes.'),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().describe('SHA-256 of the whole file (hex), checked at the end.'),
  },
  async run(args, t) {
    const u = await t.api.post<Json>('/api/attachments/uploads', { file_name: args.file_name, size: args.size, sha256: args.sha256 });
    return {
      text: `Upload ${u.id} started for ${u.file_name}: send ${plural(u.part_count, 'part')} of ${u.part_size} bytes (the last may be shorter) with upload_part, then finish_upload.`,
      data: { upload_id: u.id, file_name: u.file_name, part_size: u.part_size, part_count: u.part_count, expires_at: u.expires_at },
    };
  },
};

const uploadPart: ToolSpec = {
  name: 'upload_part', title: 'Send one part of an upload', group: 'Changes', write: true, idempotent: true,
  description: 'Sends one part of a file started with start_upload, as base64. Parts are numbered from 1; every part but the last is exactly part_size bytes before encoding. Sending a part again replaces it.',
  input: {
    upload_id: z.string().min(1),
    part: z.number().int().min(1).describe('Part number, from 1.'),
    data: z.string().min(1).describe('The part\'s bytes as base64.'),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().describe('SHA-256 of this part (hex), checked on arrival.'),
  },
  async run(args, t) {
    const u = await t.api.post<Json>(`/api/attachments/uploads/${encodeURIComponent(args.upload_id)}/parts/${args.part}`, { data: args.data, sha256: args.sha256 });
    await t.progress(u.parts_received.length, u.part_count, `${u.parts_received.length} of ${u.part_count} parts`);
    return {
      text: u.missing_parts.length ? `Part ${args.part} received; still missing: ${u.missing_parts.slice(0, 30).join(', ')}${u.missing_parts.length > 30 ? '…' : ''}.` : `Part ${args.part} received; every part is there. Call finish_upload.`,
      data: { upload_id: u.id, received: u.parts_received.length, part_count: u.part_count, missing_parts: u.missing_parts },
    };
  },
};

const finishUpload: ToolSpec = {
  name: 'finish_upload', title: 'Finish an upload', group: 'Changes', write: true, idempotent: true,
  description: 'Joins the parts, checks the SHA-256, the file type and its content, and runs the malware scanner. Returns the upload_id to use with attach_file (any record), convert_upload or add_document_version.',
  input: { upload_id: z.string().min(1), sha256: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().describe('SHA-256 of the whole file, if not given at the start.') },
  async run(args, t) {
    const u = await t.api.post<Json>(`/api/attachments/uploads/${encodeURIComponent(args.upload_id)}/finish`, { sha256: args.sha256 });
    return {
      text: `Upload ${u.id} (${u.file_name}, ${u.size} bytes) is ready${u.scan_warning ? `; ${u.scan_warning}` : ''}. Use it once: attach_file to put it on a record, or add_document_version (convert_upload first to check a Word file).`,
      data: { upload_id: u.id, file_name: u.file_name, size: u.size, sha256: u.sha256, scan_status: u.scan_status, expires_at: u.expires_at },
      audit: { recordType: 'upload', recordId: u.id, summary: `File ${u.file_name} uploaded` },
    };
  },
};

const convertUpload: ToolSpec = {
  name: 'convert_upload', title: 'Preview a Word conversion', group: 'Records', idempotent: true, available: edits,
  description: 'Converts a finished upload of a Word file (.docx) to Markdown and returns it with the conversion report (tracked changes, comments, left-out content, images, '
    + 'hints from headers and footers such as a revision label or effective date) without saving anything, so you can check it before add_document_version. '
    + 'A PDF or a legacy .doc is not converted: the report says it will be kept as the original file.',
  localFileInput: { path: PATH_ARG.optional().describe('Instead of upload_id (local file import, E18-96): a file in a folder the server may read. The server reads it into an upload, converts it, and answers its upload_id for add_document_version.') },
  input: {
    upload_id: z.string().min(1).optional().describe('A finished upload (finish_upload).'),
    max_chars: z.number().int().min(500).max(100_000).optional().describe('Most characters of Markdown returned (default 20,000).'),
  },
  async run(args, t) {
    if (!args.upload_id && !args.path) fail('Give an upload_id.', 'validation', { upload_id: 'Required.' });
    if (args.upload_id && args.path) fail('Give either upload_id or path, not both.');
    // A file on disk (E18-96) becomes a finished upload first; it is not used until add_document_version.
    const local = args.path ? await uploadFromPath(t, args.path) : null;
    const uploadId = local ? local.id : args.upload_id;
    const r = await t.api.post<Json>('/api/documents/convert', { upload_id: uploadId });
    const max = args.max_chars ?? 20_000;
    const md = String(r.markdown ?? '');
    const rep = r.report ?? {};
    return {
      text: [
        local ? `Read ${local.path} into upload ${local.id}: give upload_id ${local.id} to add_document_version (kept for 24 hours).` : '',
        rep.status === 'file_only' ? `Not converted: ${rep.note}` : `Converted ${rep.file_name}: ${md.length} characters, ${plural(r.images?.length ?? 0, 'image')}.`,
        rep.warnings?.length ? `Warnings:\n${rep.warnings.map((w: string) => `- ${w}`).join('\n')}` : '',
        rep.suggested && Object.keys(rep.suggested).length ? `Found in headers or footers: ${Object.entries(rep.suggested).map(([k, v]) => `${k} ${v}`).join(', ')}.` : '',
        rep.tracked_changes ? 'It has tracked changes: add_document_version refuses it unless accept_as_is is true (insertions kept, deletions left out).' : '',
        md ? `\n${md.slice(0, max)}${md.length > max ? '\n…' : ''}` : '',
      ].filter(Boolean).join('\n'),
      data: { markdown: md.slice(0, max), truncated: md.length > max, report: rep, images: r.images ?? [], ...(local ? { upload_id: local.id, path: local.path } : {}) },
    };
  },
};

// ---------- write ----------

const saveDocument: ToolSpec = {
  name: 'save_document', title: 'Create or update a document', group: 'Changes', write: true, idempotent: true, available: edits,
  description: 'Creates a controlled document, or updates the one with the same doc_number (fields you leave out are kept). '
    + 'Give the title, type, owner, owning department, parent number, approver, review cycle, access (who may read it), acknowledgment settings and, for external documents, publisher and edition. '
    + 'Without a doc_number a new document is numbered by the organization\'s pattern. Names are matched: departments and groups by name, people by user name, roles by key or name.',
  dataLoadNote: `${DATA_LOAD_NOTE} Give "as" for the person who wrote or owned the document then (user name or email; name:<their name> for someone without an account).`,
  dataLoadInput: AS_INPUT,
  input: {
    doc_number: z.string().max(60).optional().describe('Controlled number, e.g. "SOP-IT-014" (kept as given in data load mode; otherwise setting it needs document controller rights).'),
    title: z.string().max(300).optional(),
    summary: z.string().max(4000).optional(),
    type: z.string().optional().describe('Document type value: policy, plan, charter, standard, program, procedure, sop, work_instruction, guideline, form_template, rulebook_section, bulletin, external, reference.'),
    owner: z.string().optional().describe('Owner: user name, user id, or "me".'),
    owning_department: z.string().optional().describe('Owning department: name or id.'),
    parent_number: z.string().optional().describe('Number (or reference) of the document this one sits under.'),
    approver_name: z.string().optional(), approver_role: z.string().optional(),
    review_months: z.number().int().min(1).max(120).optional().describe('Review cycle in months (empty: the type\'s).'),
    access: z.enum(['organization', 'restricted']).optional().describe('"organization": everyone may read it; "restricted": only the readers listed.'),
    access_departments: listArg.describe('Departments (names or ids) whose people (and sub-departments) may read it.'),
    access_roles: listArg.describe('Roles (keys or names) whose holders may read it.'),
    access_groups: listArg.describe('Distribution groups (names or ids).'),
    access_users: listArg.describe('People (user names or ids).'),
    ack_required: z.boolean().optional().describe('Whether readers must acknowledge it (read and understood).'),
    audience_everyone: z.boolean().optional(), audience_roles: listArg, audience_departments: listArg,
    ack_days: z.number().int().min(1).max(365).optional(),
    publisher: z.string().optional(), edition: z.string().optional(), published_on: dateArg('Publication date of the edition'),
    source_url: z.string().optional(), license_note: z.string().optional(), expires_on: dateArg('Expiry (bulletins)'),
  },
  async run(args, t) {
    const who = await named(t, args.as);
    const fields: Json = {};
    for (const k of ['title', 'summary', 'approver_name', 'approver_role', 'review_months', 'ack_required', 'audience_everyone', 'ack_days', 'publisher', 'edition', 'published_on', 'source_url', 'license_note', 'expires_on']) {
      if (args[k] !== undefined) fields[k] = args[k];
    }
    if (args.type) fields.document_type = args.type;
    if (args.owner) fields.owner_id = await userId(t, args.owner);
    if (args.owning_department) fields.owning_department_id = await departmentId(t, args.owning_department);
    if (args.parent_number) fields.parent_id = (await findDocument(t, args.parent_number)).id;
    if (args.audience_roles) fields.audience_roles = await roleKeys(t, args.audience_roles);
    if (args.audience_departments) fields.audience_departments = await Promise.all((args.audience_departments as string[]).map((d) => departmentId(t, d)));
    Object.assign(fields, await accessFields(t, args));
    let existing: Json | null = null;
    if (args.doc_number) {
      existing = await findDocument(t, args.doc_number).catch((err) => {
        if (err instanceof ToolError && err.status === 404) return null;
        throw err;
      });
    }
    if (existing) {
      if (!Object.keys(fields).length) fail('Give at least one field to change.');
      const saved = await t.api.patch<Json>(`/api/policies/${existing.id}`, { ...fields, ...(who ? { on_behalf_of: who.send } : {}) });
      return {
        text: `Updated ${docName(saved)}: ${Object.keys(fields).join(', ')}. Open: ${docLink(t, saved)}`,
        data: { id: saved.id, doc_number: saved.doc_number ?? null, ref: saved.ref, created: false, changed: Object.keys(fields), url: docLink(t, saved) },
        audit: { recordType: DOC, recordId: saved.id, summary: `Document ${docName(saved)} updated`, onBehalf: who?.name },
      };
    }
    if (!fields.title) fail('A new document needs a title.', 'validation', { title: 'Required for a new document.' });
    if (args.doc_number) fields.doc_number = args.doc_number;
    const made = await t.api.post<Json>('/api/policies', { ...fields, ...(who ? { on_behalf_of: who.send } : {}) });
    const load = loading(t);
    return {
      text: `${load ? 'Loaded' : 'Created'} document ${docName(made)}${load ? ' (data load mode)' : ''}. Add its versions with add_document_version, oldest first. Open: ${docLink(t, made)}`,
      data: { id: made.id, doc_number: made.doc_number ?? null, ref: made.ref, created: true, url: docLink(t, made), ...(load ? { data_load: true } : {}) },
      audit: { recordType: DOC, recordId: made.id, summary: `Document ${docName(made)} ${load ? 'loaded (data load mode)' : 'created'}`, onBehalf: who?.name },
    };
  },
};

/** Conversion refusals after which a Word file is kept as its original instead (tracked changes are not one: the person decides). */
const CONVERSION_FAILURES = ['not_word', 'too_large', 'conversion_stopped', 'conversion_failed', 'convert_unavailable'];
const VERSION_STATUSES = ['draft', 'in_review', 'approved', 'published', 'superseded', 'withdrawn'] as const;

const addDocumentVersion: ToolSpec = {
  name: 'add_document_version', title: 'Add a version to a document', group: 'Changes', write: true, available: edits,
  description: 'Adds a version to a document: its text as Markdown (body_markdown), or a finished upload (upload_id) that becomes the version\'s original. '
    + 'A Word file (.docx) is converted to Markdown with its images kept (convert, default true; tracked changes need accept_as_is); a PDF or a legacy .doc is kept as a file-only version (a PDF\'s text is read for search). '
    + 'Outside data load mode the version is a draft, to be sent for review and approved in the application. Load history oldest version first.',
  dataLoadNote: `${DATA_LOAD_NOTE} You may give the version number (versions may arrive out of order), its status (draft to superseded or withdrawn) and its approved, effective, superseded and withdrawn dates; superseding is worked out from the dates when not given, and the document's status follows its newest version. Give "as" for the person who wrote the version.`,
  dataLoadInput: AS_INPUT,
  localFileInput: { path: PATH_ARG.optional().describe('Instead of upload_id or body_markdown (local file import, E18-96): a file in a folder the server may read, which becomes the version\'s original in this one call (a Word file is converted as with an upload).') },
  input: {
    document: docArg,
    body_markdown: z.string().max(200_000).optional().describe('The version\'s text in Markdown (instead of upload_id).'),
    upload_id: z.string().optional().describe('A finished upload (finish_upload) to use as the version\'s original.'),
    convert: z.boolean().optional().describe('Convert a Word upload to Markdown (default true for .docx).'),
    accept_as_is: z.boolean().optional().describe('Convert a Word file even though it has tracked changes (insertions kept, deletions left out).'),
    version: z.number().int().min(1).optional().describe('Version number (data load mode).'),
    version_label: z.string().max(60).optional().describe('The organization\'s label, e.g. "Rev. C" or "2021-1".'),
    status: z.enum(VERSION_STATUSES).optional().describe('Data load mode: the version\'s status as it was ("published" is Effective).'),
    approved_on: dateArg('Approval date'), effective_on: dateArg('Effective date'), superseded_on: dateArg('Date the next version took effect'), withdrawn_on: dateArg('Date it was withdrawn'),
    approved_by_name: z.string().optional(), approval_body: z.string().optional().describe('E.g. "Board of directors".'),
    approval_reference: z.string().optional().describe('E.g. a resolution number.'),
    change_summary: z.string().max(4000).optional(),
    minor: z.boolean().optional().describe('A minor change (typo, formatting): no new acknowledgment requests when published.'),
  },
  async run(args, t) {
    if (!args.body_markdown && !args.upload_id && !args.path) fail('Give body_markdown or an upload_id.', 'validation', { body_markdown: 'Text or a file is needed.' });
    if ([args.body_markdown, args.upload_id, args.path].filter(Boolean).length > 1) fail('Give only one of body_markdown, upload_id and path.');
    const d = await findDocument(t, args.document);
    const load = loading(t);
    const who = await named(t, args.as);
    // A file on disk (E18-96): read by the server into an upload, then used as any upload is.
    if (args.path) args = { ...args, upload_id: (await uploadFromPath(t, args.path)).id };
    const body: Json = who ? { on_behalf_of: who.send } : {};
    for (const k of ['version_label', 'approved_by_name', 'approval_body', 'approval_reference', 'change_summary', 'minor']) if (args[k] !== undefined) body[k] = args[k];
    if (load) for (const k of ['version', 'status', 'approved_on', 'effective_on', 'superseded_on', 'withdrawn_on']) if (args[k] !== undefined) body[k] = args[k];
    let kind = 'markdown';
    const notes: string[] = [];
    let v: Json;
    if (args.body_markdown) {
      body.body = args.body_markdown;
      v = await t.api.post<Json>(`/api/policies/${d.id}/versions`, body);
    } else {
      const u = await t.api.get<Json>(`/api/attachments/uploads/${encodeURIComponent(args.upload_id)}`);
      const docx = u.extension === 'docx';
      let convert = docx && args.convert !== false;
      // Checked before the upload is used, so a refusal leaves it free for another try.
      if (convert && args.accept_as_is !== true) {
        try {
          const preview = await t.api.post<Json>('/api/documents/convert', { upload_id: u.id });
          if (preview.report?.tracked_changes) {
            fail('The Word file has tracked changes. Accept or reject them in Word and upload it again, or call add_document_version again with accept_as_is true (insertions kept, deletions left out).', 'tracked_changes');
          }
        } catch (err) {
          if (!(err instanceof ToolError && CONVERSION_FAILURES.includes(err.code))) throw err;
          notes.push(`${err.message} It was kept as the original file only.`);
          convert = false;
        }
      }
      kind = convert ? 'markdown' : 'file';
      const asFile = { content_kind: 'file', conversion: { ...fileOnlyReport(u.file_name, u.extension), ...(notes.length ? { warnings: [...notes] } : {}) } };
      try {
        v = await t.api.post<Json>(`/api/policies/${d.id}/versions`, {
          ...body, source_upload_id: u.id, ...(convert ? { content_kind: 'markdown', convert: true, accept_as_is: args.accept_as_is === true } : asFile),
        });
      } catch (err) {
        // A Word file that cannot be converted (damaged, too large, or not really Word) is kept as the
        // original file: the upload is already on the document, so the version takes that file.
        if (!(convert && err instanceof ToolError && CONVERSION_FAILURES.includes(err.code))) throw err;
        const used = await t.api.get<Json>(`/api/attachments/uploads/${encodeURIComponent(u.id)}`);
        if (!used.attachment_id) throw err;
        kind = 'file';
        notes.push(`${err.message} It was kept as the original file only.`);
        v = await t.api.post<Json>(`/api/policies/${d.id}/versions`, { ...body, attachment_id: used.attachment_id, ...asFile, conversion: { ...asFile.conversion, warnings: [`Could not convert: ${err.message}`] } });
      }
    }
    if (!load && (args.status && args.status !== 'draft' || args.approved_on || args.effective_on || args.superseded_on || args.withdrawn_on || args.version)) {
      notes.push('Saved as a draft: the version number, status and dates you gave are kept only in data load mode. Send it for review and approve it in the application.');
    }
    if (v.content_kind === 'file' && v.conversion?.note) notes.push(v.conversion.note);
    if (Array.isArray(v.conversion?.warnings)) notes.push(...v.conversion.warnings.filter((w: string) => !notes.includes(w)));
    return {
      text: `${load ? 'Loaded' : 'Added'} version ${v.version}${v.version_label ? ` (${v.version_label})` : ''} of ${docName(d)}: ${v.status}${v.effective_on ? `, effective ${v.effective_on}` : ''}${v.superseded_on ? `, superseded ${v.superseded_on}` : ''}; `
        + `${v.content_kind === 'file' ? 'kept as the original file' : 'text in Markdown'}.${notes.length ? `\n${notes.map((n) => `- ${n}`).join('\n')}` : ''}`,
      data: {
        document_id: d.id, version_id: v.id, version: v.version, version_label: v.version_label ?? null, status: v.status, content_kind: v.content_kind ?? kind,
        effective_on: v.effective_on ?? null, superseded_on: v.superseded_on ?? null, source_attachment_id: v.source_attachment_id ?? null, notes, ...(load ? { data_load: true } : {}),
      },
      audit: { recordType: DOC, recordId: d.id, summary: `Version ${v.version} of document ${docName(d)} ${load ? 'loaded (data load mode)' : 'added'}`, onBehalf: who?.name },
    };
  },
};

const setDocumentAccess: ToolSpec = {
  name: 'set_document_access', title: 'Set who may read a document', group: 'Changes', write: true, idempotent: true, available: edits,
  description: 'Replaces a document\'s distribution: "organization" (everyone) or "restricted" to the departments, roles, distribution groups and people listed. '
    + 'Needs to be the owner or a document controller. The acknowledgment audience must stay inside the readers.',
  input: {
    document: docArg,
    access: z.enum(['organization', 'restricted']),
    access_departments: listArg.describe('Department names or ids.'), access_roles: listArg.describe('Role keys or names.'),
    access_groups: listArg.describe('Distribution group names or ids.'), access_users: listArg.describe('User names or ids.'),
  },
  async run(args, t) {
    const d = await findDocument(t, args.document);
    const fields = await accessFields(t, { access_departments: [], access_roles: [], access_groups: [], access_users: [], ...args });
    await t.api.patch<Json>(`/api/policies/${d.id}`, fields);
    const after = await t.api.tryGet<Json>(`/api/policies/${d.id}/access`);
    return {
      text: `${docName(d)} may now be read by ${args.access === 'organization' ? 'everyone in the organization' : 'the listed readers only'}${after?.reader_count !== undefined ? ` (${plural(after.reader_count, 'person', 'people')})` : ''}.`,
      data: { document_id: d.id, access: fields.access, reader_count: after?.reader_count ?? null },
      audit: { recordType: DOC, recordId: d.id, summary: `Access of document ${docName(d)} set to ${fields.access}` },
    };
  },
};

const linkDocument: ToolSpec = {
  name: 'link_document', title: 'Link a document to a record', group: 'Changes', write: true, idempotent: true, available: edits,
  // Worded without naming areas: the tool list is shown while some areas are switched off (list_record_types names the types that are on).
  description: 'Links a document to another record you may see (any record type list_record_types offers) or to another document, '
    + 'with a relation from the list "Document link relations", for example implements, references, replaces or based_on.',
  input: {
    document: docArg,
    to_type: z.string().min(1).describe('Record type of the other record (e.g. "control", "obligation", "system", "framework_outcome", "policy").'),
    to: z.string().min(1).describe('The other record: id, reference, or for a document its number.'),
    relation: z.enum(['implements', 'references', 'replaces', 'meets', 'applies_to', 'taught_by', 'treats', 'produces', 'retention', 'based_on']).optional(),
  },
  dataLoadInput: AS_INPUT,
  async run(args, t) {
    const d = await findDocument(t, args.document);
    const type = await t.typeOf(args.to_type);
    const target = type.type === DOC ? await findDocument(t, args.to) : await t.record(type, args.to);
    const tname = `${type.label.toLowerCase()} ${target[type.refField ?? ''] ?? target[type.titleField] ?? target.id}`;
    const who = await named(t, args.as);
    const as: Json = who ? { on_behalf_of: who.send } : {};
    if (type.type === 'framework_outcome') {
      await t.api.post(`/api/policies/${d.id}/outcomes`, { outcome_id: target.id, ...as });
      return {
        text: `Mapped ${docName(d)} to ${tname}.`, data: { document_id: d.id, to_type: type.type, to_id: target.id, relation: 'supports' },
        audit: { recordType: DOC, recordId: d.id, summary: `Document ${docName(d)} mapped to ${tname}`, onBehalf: who?.name },
      };
    }
    const link = await t.api.post<Json>('/api/links', { from_type: DOC, from_id: d.id, to_type: type.type, to_id: target.id, relation: args.relation ?? 'references', ...as });
    return {
      text: `Linked ${docName(d)} to ${tname} (${link.relation}).`,
      data: { link_id: link.id, document_id: d.id, to_type: type.type, to_id: target.id, relation: link.relation },
      audit: { recordType: DOC, recordId: d.id, summary: `Document ${docName(d)} linked to ${tname} (${link.relation})`, onBehalf: who?.name },
    };
  },
};

const recordDocumentReview: ToolSpec = {
  name: 'record_document_review', title: 'Record a document review', group: 'Changes', write: true, available: edits,
  description: 'Records a periodic review of a document: "no_change" (moves the next review date), "revise" (opens a draft) or "retire" (makes it obsolete; needs approval rights and a reason). '
    + 'Past reviews can be loaded with their date and reviewer in data load mode.',
  dataLoadNote: `${DATA_LOAD_NOTE} Give "as" for the person who reviewed it (they are the reviewer unless reviewed_by_name is given).`,
  dataLoadInput: AS_INPUT,
  input: {
    document: docArg,
    result: z.enum(['no_change', 'revise', 'retire']),
    reviewed_on: dateArg('Date of the review (default today)'),
    reviewed_by_name: z.string().optional(), note: z.string().max(4000).optional(),
    reason: z.string().max(2000).optional().describe('Why it is made obsolete (result "retire").'),
    replaced_by: z.string().optional().describe('Number of the document replacing it (result "retire").'),
  },
  async run(args, t) {
    const d = await findDocument(t, args.document);
    const who = await named(t, args.as);
    const body: Json = { result: args.result, reviewed_on: args.reviewed_on, reviewed_by_name: args.reviewed_by_name, note: args.note, reason: args.reason, ...(who ? { on_behalf_of: who.send } : {}) };
    if (args.replaced_by) body.replaced_by_id = (await findDocument(t, args.replaced_by)).id;
    const r = await t.api.post<Json>(`/api/policies/${d.id}/reviews`, body);
    const what = args.result === 'no_change' ? 'reviewed with no change' : args.result === 'revise' ? 'reviewed; a draft was opened' : 'made obsolete';
    return {
      text: `${docName(d)} ${what}${r.next_review_on ? `; next review ${r.next_review_on}` : ''}.`,
      data: { document_id: d.id, result: args.result, review: r.review ?? null, next_review_on: r.next_review_on ?? null, version: r.version?.version ?? null },
      audit: { recordType: DOC, recordId: d.id, summary: `Review of document ${docName(d)} recorded (${args.result})`, onBehalf: who?.name },
    };
  },
};

const recordAcknowledgment: ToolSpec = {
  name: 'record_acknowledgment', title: 'Record a past acknowledgment', group: 'Changes', write: true, idempotent: true, dataLoadOnly: true, available: edits,
  description: 'Only while data load mode is on: records that a person acknowledged (read and understood) a version of a document on a past date, '
    + 'for loading acknowledgment history from another system. The person must be one of the document\'s readers (its distribution). '
    + 'An account is recorded as their own acknowledgment; a roster person without an account is recorded on the roster list as "recorded by hand". '
    + 'One already acknowledged is left as it was. Nothing is sent to anyone.',
  input: {
    document: docArg,
    version: z.number().int().min(1).optional().describe('The version number they acknowledged (default: the effective version). It must have been published.'),
    person: z.string().min(1).max(250).describe('Who acknowledged it: a user id, username or email (disabled accounts too), or "person:<roster id, reference, email or employee number>" for someone on the people roster.'),
    acknowledged_on: z.string().regex(/^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/).describe('When: YYYY-MM-DD, or an ISO 8601 date and time.'),
    language: z.string().max(10).optional().describe('The language they read it in, when the version has a translation in it (default: the original).'),
  },
  dataLoadInput: { as: AS_INPUT.as.describe('For a roster person: who recorded the acknowledgment (for example the supervisor with the sign-in sheet). Same forms as "person".') },
  async run(args, t) {
    if (!loading(t)) fail('record_acknowledgment is only for data load mode.');
    const d = await findDocument(t, args.document);
    const version = args.version ?? d.current_version;
    if (!version) fail(`${docName(d)} has no effective version: give the version number.`, 'validation', { version: 'Give the version number.' });
    const who = await named(t, args.as);
    const r = await t.api.post<Json>(`/api/policies/${d.id}/versions/${version}/acknowledgments`, {
      user: args.person, acknowledged_at: args.acknowledged_on, language: args.language, ...(who ? { on_behalf_of: who.send } : {}),
    });
    const what = `${r.name}'s acknowledgment of version ${r.version} of ${docName(d)} on ${String(r.acknowledged_at).slice(0, 10)}`;
    return {
      text: r.recorded ? `Recorded ${what} (data load mode).` : `${r.name} had already acknowledged version ${r.version} of ${docName(d)}: left as it was.`,
      data: { document_id: d.id, ...r },
      audit: { recordType: DOC, recordId: d.id, summary: r.recorded ? `Recorded ${what} (data load mode)` : `${r.name} had already acknowledged version ${r.version} of ${docName(d)}`, onBehalf: who?.name },
    };
  },
};

/** The checks of check_document for one document. */
async function checksFor(t: ToolContext, d: Json): Promise<{ document: string; id: string; problems: string[] }> {
  const problems: string[] = [];
  const versions = (await t.api.get<Json[]>(`/api/policies/${d.id}/versions`)).slice().sort((a, b) => Number(a.version) - Number(b.version));
  const effective = versions.filter((v) => v.status === 'published');
  if (effective.length > 1) problems.push(`${effective.length} versions are effective at once (${effective.map((v) => v.version).join(', ')}).`);
  if (!versions.length) problems.push('It has no versions.');
  if (d.status !== 'retired' && versions.length && !effective.length && !versions.some((v) => ['draft', 'in_review', 'approved'].includes(v.status))) problems.push('No version is effective.');
  versions.forEach((v, i) => {
    if (v.approved_on && v.effective_on && v.effective_on < v.approved_on) problems.push(`Version ${v.version} takes effect (${v.effective_on}) before it was approved (${v.approved_on}).`);
    if (['published', 'superseded', 'withdrawn'].includes(v.status) && !v.effective_on) problems.push(`Version ${v.version} has no effective date.`);
    if (v.content_kind === 'file' && !v.source_attachment_id) problems.push(`Version ${v.version} is a file version with no original file.`);
    if (v.status === 'superseded' && !v.superseded_on) problems.push(`Version ${v.version} is superseded but has no superseded date.`);
    const next = versions[i + 1];
    if (next && Number(next.version) !== Number(v.version) + 1) problems.push(`Versions jump from ${v.version} to ${next.version}.`);
    if (next && v.superseded_on && next.effective_on && v.superseded_on !== next.effective_on) {
      problems.push(`Version ${v.version} was superseded on ${v.superseded_on} but version ${next.version} took effect on ${next.effective_on} (${v.superseded_on < next.effective_on ? 'a gap' : 'an overlap'}).`);
    }
    if (next && v.effective_on && next.effective_on && next.effective_on < v.effective_on) problems.push(`Version ${next.version} takes effect before version ${v.version}.`);
  });
  if (versions.some((v) => ['published', 'superseded', 'withdrawn'].includes(v.status) && v.content_kind !== 'file' && !v.source_attachment_id && !String(v.body ?? '').trim())) {
    problems.push('A released version has neither text nor an original file.');
  }
  const h = await t.api.tryGet<Json>(`/api/policies/${d.id}/hierarchy`);
  const parent = h?.ancestors?.length ? h.ancestors[h.ancestors.length - 1] : null;
  if (parent?.status === 'retired' && d.status !== 'retired') problems.push(`It sits under ${parent.doc_number ?? parent.ref}, which is obsolete: give it a new parent or make it obsolete too.`);
  if (d.status === 'retired') {
    const open = (h?.children ?? []).filter((c: Json) => c.status !== 'retired');
    if (open.length) problems.push(`It is obsolete but ${plural(open.length, 'document')} under it ${open.length === 1 ? 'is' : 'are'} not: ${open.slice(0, 10).map((c: Json) => c.doc_number ?? c.ref).join(', ')}.`);
  }
  if (h?.tier_warning) problems.push(h.tier_warning);
  const access = await t.api.tryGet<Json>(`/api/policies/${d.id}/access`);
  if (access?.audience_outside?.length) problems.push(`The acknowledgment audience reaches outside the readers: ${access.audience_outside.join('; ')}.`);
  if (!d.owner_id) problems.push('It has no owner.');
  return { document: docName(d), id: d.id, problems };
}

const checkDocument: ToolSpec = {
  name: 'check_document', title: 'Check documents for problems', group: 'Records', idempotent: true, available: sees,
  description: 'Checks one document (or, without one, up to 100 documents you may open, numbers starting with a prefix if given) after a load: more than one effective version, '
    + 'gaps or overlaps between versions\' dates, missing original files, versions out of order, children of obsolete documents, an acknowledgment audience outside the readers, no owner.',
  input: {
    document: docArg.optional(),
    number_prefix: z.string().optional().describe('Only documents whose number starts with this, e.g. "SOP-IT".'),
  },
  async run(args, t) {
    let docs: Json[];
    if (args.document) docs = [await findDocument(t, args.document)];
    else {
      const r = await t.api.get<{ rows: Json[] }>(`/api/policies${qs({ pageSize: 100, sort: 'doc_number', dir: 'asc', q: args.number_prefix })}`);
      docs = args.number_prefix ? r.rows.filter((d) => String(d.doc_number ?? '').toLowerCase().startsWith(args.number_prefix.toLowerCase())) : r.rows;
    }
    const results: Awaited<ReturnType<typeof checksFor>>[] = [];
    let n = 0;
    for (const d of docs) {
      results.push(await checksFor(t, d));
      n += 1;
      await t.progress(n, docs.length);
    }
    const bad = results.filter((r) => r.problems.length);
    return {
      text: bad.length
        ? `${plural(bad.length, 'document')} of ${docs.length} need attention:\n${bad.map((r) => `- ${r.document}:\n${r.problems.map((p) => `  - ${p}`).join('\n')}`).join('\n')}`
        : `No problems found in ${plural(docs.length, 'document')}.`,
      data: { checked: docs.length, with_problems: bad.length, results },
    };
  },
};

export const DOCUMENT_TOOLS: ToolSpec[] = [
  findDocuments, readDocument, registerSummary, checkDocument, convertUpload,
  startUpload, uploadPart, finishUpload, saveDocument, addDocumentVersion, setDocumentAccess, linkDocument, recordDocumentReview, recordAcknowledgment,
];

export type { ToolResult };
