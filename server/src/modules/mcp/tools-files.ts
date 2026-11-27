import { z } from 'zod';
import { qs } from './caller.ts';
import { normalizeDate } from './resolve.ts';
import { fail, plural, type ToolContext, type ToolSpec } from './toolkit.ts';
import { AS_INPUT, named } from './tools-records.ts';

// Files and links on any record (E45-47, wave 25): a finished upload (start_upload, upload_part,
// finish_upload) attached to a record, a link to a document kept elsewhere, and the list of a record's
// files. Each calls the attachments routes with the caller's token, so the record's own rules apply:
// seeing the record to list its files, editing it to add one; the full intake (allowed types, size,
// content against the name, the malware scanner) ran when the upload was finished.

type Json = Record<string, any>;
const typeArg = z.string().min(1).describe('Record type: its key (e.g. "asset", "system"), label or plural.');
const idArg = z.string().min(1).describe('The record id or its reference, e.g. "TKT-00012".');
const loading = (t: ToolContext) => t.session.dataLoad?.allowed === true;


const evidenceInput = {
  evidence: z.boolean().optional().describe('Keep it as evidence (an audit or control proof) rather than an ordinary file. Default: the record type\'s own default.'),
  description: z.string().max(2000).optional().describe('What the file or link is, e.g. "Signed maintenance agreement, 2023 renewal".'),
  collected_on: z.string().optional().describe('Evidence only: the date the evidence was collected (YYYY-MM-DD or another common format; not in the future). Default: today.'),
  expires_on: z.string().optional().describe('Evidence only: the date it stops being valid, e.g. a certificate\'s end date.'),
};

/** The descriptive fields the attachments routes take, with dates converted. */
function descriptive(args: Json, evidenceType: boolean): Json {
  const out: Json = {};
  const fields: Record<string, string> = {};
  const evidence = args.evidence ?? evidenceType;
  out.kind = evidence ? 'evidence' : 'file';
  if (args.description) out.description = args.description;
  for (const k of ['collected_on', 'expires_on'] as const) {
    if (!args[k]) continue;
    if (!evidence) { fields[k] = 'Only for evidence: give evidence true.'; continue; }
    const d = normalizeDate(args[k]);
    if (!d) fields[k] = `"${args[k]}" is not a date I can read; give YYYY-MM-DD.`;
    else out[k] = d;
  }
  if (Object.keys(fields).length) fail('Some values are not right. Nothing was attached.', 'validation', fields);
  return out;
}

const recordName = (type: { label: string; refField?: string; titleField: string }, row: Json) => `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? `"${row[type.titleField] ?? ''}"`}`;

const attachFile: ToolSpec = {
  name: 'attach_file', title: 'Attach a file to a record', group: 'Changes', write: true,
  description: 'Attaches a finished upload (start_upload, upload_part, finish_upload) to any record you may edit: an asset, a system, an action and so on.'
    + 'Attach the source documents a record was built from (agreements, reports, certificates, photos, exported emails) rather than only summarizing them. '
    + 'Each upload can be attached once. Optionally keep it as evidence, with the date it was collected and when it expires.',
  input: {
    type: typeArg, id: idArg,
    upload_id: z.string().min(1).describe('The upload_id from finish_upload.'),
    ...evidenceInput,
  },
  dataLoadInput: {
    ...AS_INPUT,
    created_at: z.string().optional().describe('The date (or date and time) the file was first added in the source system, e.g. "2021-03-04". Default: now.'),
  },
  dataLoadNote: 'Data load mode is on: give "as" for the person who added the file in the source, and created_at for when. A file attached in a load is undone with it.',
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const meta = (await t.meta()).resources[type.type] as Json;
    const who = await named(t, args.as);
    let createdAt: string | undefined;
    if (args.created_at) {
      // A plain date in a common format becomes YYYY-MM-DD; an ISO time is passed as given (E45-52).
      createdAt = /T\d/.test(String(args.created_at)) ? String(args.created_at) : normalizeDate(args.created_at) ?? undefined;
      if (!createdAt) fail('Some values are not right. Nothing was attached.', 'validation', { created_at: `"${args.created_at}" is not a date I can read; give YYYY-MM-DD.` });
    }
    const att = await t.api.post<Json>(`/api/attachments/uploads/${encodeURIComponent(args.upload_id)}/attach`, {
      record_type: type.type, record_id: row.id, ...descriptive(args, meta?.evidence === true), ...(who ? { on_behalf_of: who.send } : {}),
      ...(createdAt ? { created_at: createdAt } : {}),
    });
    const name = recordName(type, row);
    const what = att.kind === 'evidence' ? 'Evidence file' : 'File';
    return {
      text: `${what} ${att.file_name} attached to ${name}${who ? ` on behalf of ${who.name}` : ''}. Open: ${t.link(type.route, row.id)}`,
      data: {
        type: type.type, id: row.id, attachment_id: att.id, file_name: att.file_name, size_bytes: Number(att.size_bytes), kind: att.kind,
        collected_on: att.collected_on ?? null, expires_on: att.expires_on ?? null, scan_status: att.scan_status ?? null, url: t.link(type.route, row.id),
        ...(loading(t) ? { data_load: true } : {}),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `${what} ${att.file_name} attached to ${name}`, onBehalf: who?.name },
    };
  },
};

const attachLink: ToolSpec = {
  name: 'attach_link', title: 'Attach a link to a record', group: 'Changes', write: true,
  description: 'Links a document kept elsewhere (a document store, a shared drive, a page on another web site) to any record you may edit, instead of uploading a copy. '
    + 'The address must be http or https with no user name or password in it; the application never opens it. Optionally keep it as evidence.',
  input: {
    type: typeArg, id: idArg,
    url: z.string().min(1).max(1000).describe('The full address, starting with https:// or http://.'),
    title: z.string().max(200).optional().describe('What to show for the link (default: the address\'s host and last part).'),
    ...evidenceInput,
  },
  dataLoadInput: AS_INPUT,
  dataLoadNote: 'Data load mode is on: give "as" for the person who added the link in the source.',
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const meta = (await t.meta()).resources[type.type] as Json;
    const who = await named(t, args.as);
    const d = descriptive(args, meta?.evidence === true);
    const att = await t.api.post<Json>('/api/attachments/link', {
      record_type: type.type, record_id: row.id, url: args.url, title: args.title, ...d, evidence: d.kind === 'evidence', ...(who ? { on_behalf_of: who.send } : {}),
    });
    const name = recordName(type, row);
    const what = att.kind === 'evidence' ? 'Evidence link' : 'Link';
    return {
      text: `${what} "${att.link_title ?? att.file_name}" added to ${name}${who ? ` on behalf of ${who.name}` : ''}.`,
      data: {
        type: type.type, id: row.id, attachment_id: att.id, title: att.link_title ?? att.file_name, link_url: att.link_url, kind: att.kind,
        added_by: att.checked_by_name ?? att.uploaded_by_name ?? null, url: t.link(type.route, row.id),
      },
      audit: { recordType: type.type, recordId: row.id, summary: `${what} "${att.link_title ?? att.file_name}" added to ${name}`, onBehalf: who?.name },
    };
  },
};

const listAttachments: ToolSpec = {
  name: 'list_attachments', title: 'List a record\'s files and links', group: 'Records', idempotent: true,
  description: 'The files and links on one record you may see: name, kind (file or evidence), size, description, evidence dates, who added it and when. '
    + 'Use it to check what is already attached before attaching a source file again.',
  input: { type: typeArg, id: idArg },
  async run(args, t) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const r = await t.api.get<{ rows: Json[] }>(`/api/attachments${qs({ record_type: type.type, record_id: row.id })}`);
    const files = r.rows.map((a) => ({
      attachment_id: a.id, name: a.is_link ? a.link_title ?? a.file_name : a.file_name, is_link: !!a.is_link, link_url: a.is_link ? a.link_url : null,
      kind: a.kind, size_bytes: a.is_link ? null : Number(a.size_bytes), description: a.description ?? null,
      collected_on: a.collected_on ?? null, expires_on: a.expires_on ?? null, added_by: a.uploaded_by_name ?? null, added_at: a.created_at, scan_status: a.is_link ? null : a.scan_status,
    }));
    return {
      text: files.length
        ? `${plural(files.length, 'file or link', 'files and links')} on ${recordName(type, row)}:\n${files.map((f) => `- ${f.is_link ? 'Link' : 'File'}${f.kind === 'evidence' ? ' (evidence)' : ''}: ${f.name}${f.description ? ` — ${f.description}` : ''}${f.added_by ? ` (added by ${f.added_by})` : ''}`).join('\n')}`
        : `No files or links on ${recordName(type, row)}.`,
      data: { type: type.type, id: row.id, files, url: t.link(type.route, row.id) },
    };
  },
};

export const FILE_TOOLS: ToolSpec[] = [attachFile, attachLink, listAttachments];
