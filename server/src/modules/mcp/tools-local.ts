import { z } from 'zod';
import { qs } from './caller.ts';
import { normalizeDate } from './resolve.ts';
import { fail, plural, type ToolContext, type ToolSpec } from './toolkit.ts';
import { AS_INPUT, named } from './tools-records.ts';

// Local file import (E18-96): in a data load, the server reads source files from folders an
// administrator allowed (Administration > AI assistant access), instead of the assistant sending
// them as base64 parts. Offered only while the caller's saves are loads, the token can write, and
// folders are set; the routes (attachments/local.ts) check all of it again, refuse paths outside
// those folders and the server's own files, and audit every file read.

type Json = Record<string, any>;
const typeArg = z.string().min(1).describe('Record type: its key (e.g. "asset", "system"), label or plural.');
const idArg = z.string().min(1).describe('The record id or its reference, e.g. "TKT-00012".');
export const PATH_ARG = z.string().min(1).max(4096)
  .describe('The file on the server: its full path as list_local_files gives it (e.g. "D:\\Imports\\Contracts\\2021 renewal.pdf"), or a path relative to the allowed folder when there is only one.');

const mb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const listLocalFiles: ToolSpec = {
  name: 'list_local_files', title: 'List files in a server folder', group: 'Records', idempotent: true, dataLoadOnly: true, localFiles: true,
  description: 'Only in a data load with local file import on: lists the files in a folder on the server that an administrator allowed, with each file\'s full path, path relative to the folder, size and modified time, '
    + 'and whether its type may be uploaded. Office lock files (~$...), Thumbs.db, desktop.ini, .DS_Store and recycle bins are left out. Without a folder it lists the allowed folder (or the allowed folders when there are several). '
    + 'Then attach a file with attach_local_file, or give its path to convert_upload and add_document_version.',
  input: {
    folder: z.string().max(4096).optional().describe('A folder inside an allowed folder: its full path, or a path relative to the allowed folder. Default: the allowed folder.'),
    pattern: z.string().max(200).optional().describe('Only file names like this, with * and ? (any case), e.g. "*.docx" or "SOP-*".'),
    recursive: z.boolean().optional().describe('Include the files in subfolders too (default false: the subfolders are listed by name).'),
    page: z.number().int().min(1).optional().describe('Page, from 1 (default 1).'),
    page_size: z.number().int().min(1).max(1000).optional().describe('Files per page (default 200, at most 1000).'),
  },
  async run(args, t) {
    const r = await t.api.get<Json>(`/api/data-load/local-files${qs({ folder: args.folder, pattern: args.pattern, recursive: args.recursive ? 'true' : undefined, page: args.page, page_size: args.page_size })}`);
    if (!r.folder) {
      return {
        text: `Local file import may read ${plural(r.roots.length, 'folder')}:\n${r.roots.map((x: Json) => `- ${x.path}${x.exists ? '' : ' (missing)'}`).join('\n')}\nGive one as "folder".`,
        data: { roots: r.roots, files: [], folders: r.folders, total: 0 },
      };
    }
    const files = r.files as Json[];
    const pages = Math.max(1, Math.ceil(r.total / r.page_size));
    const lines = files.map((f) => `- ${f.relative_path} (${mb(f.size_bytes)}, modified ${String(f.modified_at).slice(0, 10)}${f.allowed_type ? '' : ', type not allowed'}${f.size_bytes > r.max_bytes ? ', larger than the file limit' : ''})`);
    const skipped = r.skipped ?? {};
    return {
      text: [
        `${r.folder}: ${plural(r.total, 'file')}${args.recursive ? ' (subfolders included)' : ''}, ${mb(r.total_bytes)} in all${r.total > files.length ? `; page ${r.page} of ${pages}` : ''}.`,
        r.folders?.length ? `Subfolders: ${r.folders.map((f: Json) => f.name).join(', ')}` : '',
        lines.join('\n'),
        skipped.junk || skipped.links || skipped.protected ? `Left out: ${[skipped.junk ? plural(skipped.junk, 'lock or system file') : '', skipped.links ? plural(skipped.links, 'link') : '', skipped.protected ? plural(skipped.protected, 'server file') : ''].filter(Boolean).join(', ')}.` : '',
        r.truncated ? 'The listing stopped at 50,000 files: list a smaller folder or use a pattern.' : '',
      ].filter(Boolean).join('\n'),
      data: {
        folder: r.folder, root: r.root, total: r.total, total_bytes: r.total_bytes, page: r.page, page_size: r.page_size, pages,
        files, folders: r.folders ?? [], skipped, truncated: r.truncated, max_bytes: r.max_bytes,
      },
    };
  },
};

const recordName = (type: { label: string; refField?: string; titleField: string }, row: Json) => `${type.label.toLowerCase()} ${row[type.refField ?? ''] ?? `"${row[type.titleField] ?? ''}"`}`;

const attachLocalFile: ToolSpec = {
  name: 'attach_local_file', title: 'Attach a file from a server folder', group: 'Changes', write: true, idempotent: true, dataLoadOnly: true, localFiles: true,
  description: 'Only in a data load with local file import on: the server reads a file from a folder an administrator allowed and attaches it to any record you may edit, '
    + 'exactly as an upload would be (allowed types, size limit, content check, malware scanner; listed with the load so undoing the load removes it). '
    + 'A file whose content is already on that record is not attached again (duplicate: true), so calling again is safe. Optionally keep it as evidence with its dates.',
  input: {
    path: PATH_ARG,
    type: typeArg, id: idArg,
    evidence: z.boolean().optional().describe('Keep it as evidence (an audit or control proof) rather than an ordinary file. Default: the record type\'s own default.'),
    description: z.string().max(2000).optional().describe('What the file is, e.g. "Signed maintenance agreement, 2023 renewal".'),
    collected_on: z.string().optional().describe('Evidence only: the date the evidence was collected (YYYY-MM-DD). Default: today.'),
    expires_on: z.string().optional().describe('Evidence only: the date it stops being valid.'),
    created_at: z.string().optional().describe('The date (or date and time) the file was first added in the source, e.g. "2021-03-04" (often its modified time from list_local_files). Default: now.'),
    ...AS_INPUT,
  },
  async run(args, t: ToolContext) {
    const type = await t.typeOf(args.type);
    const row = await t.record(type, args.id);
    const meta = (await t.meta()).resources[type.type] as Json;
    const who = await named(t, args.as);
    const evidence = args.evidence ?? meta?.evidence === true;
    const fields: Record<string, string> = {};
    const body: Json = { path: args.path, record_type: type.type, record_id: row.id, kind: evidence ? 'evidence' : 'file' };
    if (args.description) body.description = args.description;
    for (const k of ['collected_on', 'expires_on'] as const) {
      if (!args[k]) continue;
      if (!evidence) { fields[k] = 'Only for evidence: give evidence true.'; continue; }
      const d = normalizeDate(args[k]);
      if (!d) fields[k] = `"${args[k]}" is not a date I can read; give YYYY-MM-DD.`;
      else body[k] = d;
    }
    if (args.created_at) {
      const c = /T\d/.test(String(args.created_at)) ? String(args.created_at) : normalizeDate(args.created_at);
      if (!c) fields.created_at = `"${args.created_at}" is not a date I can read; give YYYY-MM-DD.`;
      else body.created_at = c;
    }
    if (Object.keys(fields).length) fail('Some values are not right. Nothing was attached.', 'validation', fields);
    if (who) body.on_behalf_of = who.send;
    const att = await t.api.post<Json>('/api/data-load/local-files/attach', body);
    const name = recordName(type, row);
    const what = att.kind === 'evidence' ? 'Evidence file' : 'File';
    return {
      text: att.duplicate
        ? `${att.file_name} is already on ${name} (same content), so it was not attached again. Open: ${t.link(type.route, row.id)}`
        : `${what} ${att.file_name} read from ${att.path} and attached to ${name}${who ? ` on behalf of ${who.name}` : ''}. Open: ${t.link(type.route, row.id)}`,
      data: {
        type: type.type, id: row.id, attachment_id: att.id, file_name: att.file_name, size_bytes: Number(att.size_bytes), kind: att.kind,
        path: att.path, duplicate: att.duplicate === true, scan_status: att.scan_status ?? null, url: t.link(type.route, row.id), data_load: true,
      },
      audit: att.duplicate ? undefined : { recordType: type.type, recordId: row.id, summary: `${what} ${att.file_name} attached to ${name} from the server's folder`, onBehalf: who?.name },
    };
  },
};

/**
 * A finished upload made by the server from a file in an allowed folder (for convert_upload and
 * add_document_version given a path): the same as finish_upload answers.
 */
export async function uploadFromPath(t: ToolContext, path: string): Promise<Json> {
  return t.api.post<Json>('/api/data-load/local-files/upload', { path });
}

export const LOCAL_FILE_TOOLS: ToolSpec[] = [listLocalFiles, attachLocalFile];
