// Documents > Import (E43-11): a .zip of files with manifest.csv (one row per version), loaded
// through the documents' own routes as the person who started it, so permissions, the distribution
// rule, numbering and data load mode (original dates and statuses kept, nothing sent) apply exactly as
// they do to any other save. A dry run reads and checks everything (the manifest, the files, owners,
// departments, roles, parents, and converts each Word file to report its warnings) and saves nothing.
//
// The archive arrives as a finished chunked upload (attachments/uploads.ts). The work runs after the
// answer (202) in the process that took the request, and records each row's result in
// `document_imports`; a run cut short by a restart is marked failed at the next start.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { UUID_RE } from '../../../core/errors.ts';
import type { ModuleContext, Row } from '../../../core/module.ts';
import { readUploadBytes, uploadFromBytes } from '../../attachments/uploads.ts';
import { convertDocx, fileOnlyReport } from '../convert/docx.ts';
import { documentKey, entryBytes, loadOrder, readArchive, type ManifestRow } from './manifest.ts';

export { COLUMNS as MANIFEST_COLUMNS, isClutter, readArchive } from './manifest.ts';

/** The largest archive taken (it is read into memory). */
export const IMPORT_MAX_ZIP = 512 * 1024 * 1024;
/** Word files converted during a dry run to report their warnings (the rest are checked on the real run). */
export const DRY_RUN_CONVERSIONS = 200;
/** Conversion refusals after which a Word file is kept as its original instead. */
const CONVERSION_FAILURES = ['not_word', 'too_large', 'conversion_stopped', 'conversion_failed', 'convert_unavailable'];

export interface ImportItem {
  row: number;
  doc_number: string | null;
  title: string | null;
  version: string | null;
  file: string | null;
  ok: boolean;
  /** What was (or would be) done: "create document and add version", "add version", ... */
  action: string;
  message: string | null;
  warnings: string[];
  document_id?: string | null;
  version_id?: string | null;
}

interface ImportCaller { call<T = any>(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown): Promise<{ status: number; body: T }> }

/** Calls the application's own routes with the credentials of the request that started the import. */
function callerFor(app: FastifyInstance, req: FastifyRequest): ImportCaller {
  const headers: Record<string, string> = { 'x-grc-csrf': '1' };
  if (typeof req.headers.cookie === 'string') headers.cookie = req.headers.cookie;
  if (typeof req.headers.authorization === 'string') headers.authorization = req.headers.authorization;
  if (typeof req.id === 'string') headers['x-request-id'] = req.id;
  const remoteAddress = req.ip;
  return {
    async call(method, url, body) {
      const res = await app.inject({
        method, url, remoteAddress,
        headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
      });
      let parsed: any = null;
      try { parsed = res.json(); } catch { /* not JSON */ }
      return { status: res.statusCode, body: parsed };
    },
  };
}

const errorOf = (r: { status: number; body: any }) => {
  const e = r.body?.error;
  if (!e) return `The request failed (${r.status}).`;
  const fields = e.fields && typeof e.fields === 'object' ? Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join('; ') : '';
  return `${e.message ?? 'The request failed.'}${fields ? ` (${fields})` : ''}`;
};

interface Directory {
  departments: Map<string, string>;
  users: Map<string, string>;
  roles: Map<string, string>;
  types: Map<string, string>;
}

async function directory(ctx: ModuleContext): Promise<Directory> {
  const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const departments = new Map<string, string>();
  for (const d of await ctx.db.query<Row>('select id, name from departments where deleted_at is null')) { departments.set(lower(d.name), d.id); departments.set(lower(d.id), d.id); }
  const users = new Map<string, string>();
  for (const u of await ctx.db.query<Row>(`select id, username, email, display_name from users where status = 'active'`)) {
    for (const k of [u.username, u.email, u.display_name, u.id]) if (k) users.set(lower(k), u.id);
  }
  const roles = new Map<string, string>();
  for (const r of await ctx.db.query<Row>('select key, name from roles')) { roles.set(lower(r.key), r.key); roles.set(lower(r.name), r.key); }
  const types = new Map<string, string>();
  for (const v of await ctx.lookups.values('policy_document_type')) { types.set(lower(v.value), v.value); types.set(lower(v.label), v.value); }
  return { departments, users, roles, types };
}

/** The document fields a group of rows gives: for each field, the last value given (newest version last). */
function documentFields(rows: ManifestRow[], dir: Directory, problems: string[]): Row {
  const last = (c: keyof ManifestRow['values']) => [...rows].reverse().find((r) => r.values[c] !== undefined)?.values[c];
  const out: Row = {};
  const lower = (s: string) => s.trim().toLowerCase();
  const list = (raw: string | undefined, map: Map<string, string>, what: string) => {
    if (raw === undefined) return undefined;
    const names = raw.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
    const ids = names.map((n) => map.get(lower(n)));
    names.forEach((n, i) => { if (!ids[i]) problems.push(`No ${what} called "${n}".`); });
    return ids.filter(Boolean);
  };
  if (last('doc_number')) out.doc_number = last('doc_number');
  if (last('title')) out.title = last('title');
  const type = last('document_type');
  if (type !== undefined) {
    if (dir.types.get(lower(type))) out.document_type = dir.types.get(lower(type));
    else problems.push(`Unknown document type "${type}".`);
  }
  const dept = last('department');
  if (dept !== undefined) {
    if (dir.departments.get(lower(dept))) out.owning_department_id = dir.departments.get(lower(dept));
    else problems.push(`No department called "${dept}".`);
  }
  const owner = last('owner');
  if (owner !== undefined) {
    if (dir.users.get(lower(owner))) out.owner_id = dir.users.get(lower(owner));
    else problems.push(`No active person "${owner}" (give a user name, email or full name).`);
  }
  if (last('access')) out.access = last('access');
  const depts = list(last('access_departments'), dir.departments, 'department');
  if (depts) out.access_departments = depts;
  const roles = list(last('access_roles'), dir.roles, 'role');
  if (roles) out.access_roles = roles;
  return out;
}

const VERSION_KEYS = ['version_label', 'status', 'approved_on', 'effective_on', 'superseded_on', 'withdrawn_on', 'approved_by_name', 'approval_body', 'approval_reference', 'change_summary'] as const;

/** Runs (or checks, when `dryRun`) one import. Never throws: problems end up in the import's results. */
export async function runImport(ctx: ModuleContext, req: FastifyRequest, importId: string, zip: Uint8Array, fileName: string, dryRun: boolean): Promise<void> {
  const api = callerFor(ctx.app, req);
  const items: ImportItem[] = [];
  const summary = { rows: 0, ok: 0, errors: 0, documents_created: 0, documents_updated: 0, versions_created: 0, skipped_files: 0, converted: 0, file_only: 0 };
  const save = async (status: string, extra: Row = {}) => {
    await ctx.db.query(
      `update document_imports set status = $2, results = $3::jsonb, finished_at = case when $2 in ('done', 'failed') then now() else finished_at end where id = $1`,
      [importId, status, JSON.stringify({ file_name: fileName, dry_run: dryRun, summary, items, ...extra })]);
  };
  try {
    const archive = readArchive(zip);
    summary.skipped_files = archive.skipped.length;
    summary.rows = archive.rows.length;
    await ctx.db.query(`update document_imports set file_count = $2, rows = $3::jsonb where id = $1`, [importId, archive.entries.length,
      JSON.stringify(archive.rows.map((r) => ({ row: r.row, doc_number: r.values.doc_number ?? null, title: r.values.title ?? null, version: r.values.version ?? null, file: r.values.file ?? null })))]);
    if (archive.problems.length) {
      await save('failed', { problems: archive.problems, skipped: archive.skipped.slice(0, 50) });
      return;
    }
    const dir = await directory(ctx);
    const ordered = loadOrder(archive.rows);
    const groups = new Map<string, ManifestRow[]>();
    for (const r of ordered) groups.set(documentKey(r), [...(groups.get(documentKey(r)) ?? []), r]);
    /** Document id by group key (or 'failed'); for a dry run, 'new' or the existing id. */
    const docs = new Map<string, string>();
    const numbers = new Map<string, string>(); // lower doc number -> id or 'new'
    let conversions = 0;

    const findExisting = async (r: ManifestRow): Promise<Row | null> => {
      const field = r.values.doc_number ? 'doc_number' : 'title';
      const value = r.values.doc_number ?? r.values.title!;
      const got = await api.call<{ rows: Row[] }>('GET', `/api/policies?f.${field}=${encodeURIComponent(value)}&pageSize=5`);
      if (got.status !== 200) return null;
      return got.body.rows.find((x) => String(x[field] ?? '').toLowerCase() === value.toLowerCase()) ?? null;
    };
    const parentId = async (number: string): Promise<string | null> => {
      const known = numbers.get(number.toLowerCase());
      if (known) return known;
      const got = await api.call<{ rows: Row[] }>('GET', `/api/policies?f.doc_number=${encodeURIComponent(number)}&pageSize=5`);
      const row = got.status === 200 ? got.body.rows.find((x) => String(x.doc_number ?? '').toLowerCase() === number.toLowerCase()) : null;
      return row?.id ?? null;
    };

    let done = 0;
    for (const r of ordered) {
      const key = documentKey(r);
      const item: ImportItem = {
        row: r.row, doc_number: r.values.doc_number ?? null, title: r.values.title ?? null, version: r.values.version ?? r.values.version_label ?? null,
        file: r.values.file ?? null, ok: false, action: '', message: null, warnings: [],
      };
      items.push(item);
      const fail = (message: string) => { item.ok = false; item.message = message; summary.errors += 1; };
      if (r.problems.length) { fail(r.problems.join(' ')); continue; }

      // ---- the document (first row of its group)
      if (!docs.has(key)) {
        const problems: string[] = [];
        const fields = documentFields(groups.get(key)!, dir, problems);
        const parentNumber = [...groups.get(key)!].reverse().find((x) => x.values.parent_number)?.values.parent_number;
        if (parentNumber) {
          const pid = await parentId(parentNumber);
          if (!pid) problems.push(`The parent ${parentNumber} is neither in the package nor a document you can open.`);
          else if (pid !== 'new') fields.parent_id = pid;
        }
        if (problems.length) { docs.set(key, 'failed'); fail(problems.join(' ')); continue; }
        const existing = await findExisting(r);
        if (dryRun) {
          docs.set(key, existing?.id ?? 'new');
          item.action = existing ? 'update document, add version' : 'create document, add version';
        } else if (existing) {
          const { doc_number: _n, ...patch } = fields;
          const res = Object.keys(patch).length ? await api.call('PATCH', `/api/policies/${existing.id}`, patch) : { status: 200, body: existing };
          if (res.status >= 400) { docs.set(key, 'failed'); fail(`The document could not be updated: ${errorOf(res)}`); continue; }
          docs.set(key, existing.id);
          summary.documents_updated += 1;
          item.action = 'update document, add version';
        } else {
          if (!fields.title) { docs.set(key, 'failed'); fail('A new document needs a title.'); continue; }
          // The parent loaded earlier in this run.
          if (parentNumber && !fields.parent_id) fields.parent_id = numbers.get(parentNumber.toLowerCase());
          const res = await api.call<Row>('POST', '/api/policies', fields);
          if (res.status >= 400) { docs.set(key, 'failed'); fail(`The document could not be created: ${errorOf(res)}`); continue; }
          docs.set(key, res.body.id);
          summary.documents_created += 1;
          item.action = 'create document, add version';
          if (!r.values.doc_number && res.body.doc_number) item.warnings.push(`Numbered ${res.body.doc_number}.`);
        }
        const id = docs.get(key)!;
        if (r.values.doc_number) numbers.set(r.values.doc_number.toLowerCase(), id);
      } else {
        item.action = 'add version';
      }
      const docId = docs.get(key)!;
      if (docId === 'failed') { fail('Its document could not be loaded (see the first row of this document).'); continue; }
      item.document_id = docId === 'new' ? null : docId;

      // ---- the version
      const ext = (r.entry!.split('.').pop() ?? '').toLowerCase();
      let bytes: Buffer;
      try { bytes = entryBytes(zip, r.entry!); } catch (err) { fail((err as Error).message); continue; }
      const versionBody: Row = {};
      for (const k of VERSION_KEYS) if (r.values[k] !== undefined) versionBody[k] = r.values[k];
      if (r.values.version) versionBody.version = Number(r.values.version);

      if (dryRun) {
        if (ext === 'docx') {
          if (conversions < DRY_RUN_CONVERSIONS) {
            conversions += 1;
            const c = await convertDocx(bytes, r.entry!);
            if (!c.ok) item.warnings.push(`${c.message} It would be kept as the original file only.`);
            else item.warnings.push(...c.report.warnings);
          } else item.warnings.push('Not converted in the dry run (too many Word files); checked when loaded.');
        } else {
          const note = fileOnlyReport(r.entry!, ext).note;
          if (note && ext !== 'pdf') item.warnings.push(note);
        }
        item.ok = true;
        summary.ok += 1;
      } else {
        const name = r.entry!.split('/').pop()!;
        const asFile = { content_kind: 'file', conversion: fileOnlyReport(name, ext) };
        let res: { status: number; body: Row };
        try {
          const upload = await uploadFromBytes(ctx, req, name, bytes);
          res = await api.call<Row>('POST', `/api/policies/${docId}/versions`, {
            ...versionBody, source_upload_id: upload.id,
            ...(ext === 'docx' ? { content_kind: 'markdown', convert: true, accept_as_is: true } : asFile),
          });
          if (res.status >= 400 && ext === 'docx' && CONVERSION_FAILURES.includes(res.body?.error?.code)) {
            // The file is on the document already: the version takes it as its original.
            const used = await ctx.db.one<Row>('select attachment_id from uploads_pending where id = $1', [upload.id]);
            if (used?.attachment_id) {
              item.warnings.push(`${errorOf(res)} Kept as the original file only.`);
              res = await api.call<Row>('POST', `/api/policies/${docId}/versions`, {
                ...versionBody, attachment_id: used.attachment_id, ...asFile, conversion: { ...asFile.conversion, warnings: [`Could not convert: ${errorOf(res)}`] },
              });
            }
          }
        } catch (err) {
          const e = err as { statusCode?: number; message?: string };
          fail(`The file was not accepted: ${e.message ?? 'unknown problem'}`);
          continue;
        }
        if (res.status >= 400) { fail(`The version could not be added: ${errorOf(res)}`); continue; }
        const v = res.body;
        item.version_id = v.id ?? null;
        if (v.content_kind === 'file') {
          summary.file_only += 1;
          const note = v.conversion?.note ?? fileOnlyReport(r.entry!, ext).note;
          if (ext !== 'pdf' && note) item.warnings.push(note);
        } else summary.converted += 1;
        if (Array.isArray(v.conversion?.warnings)) item.warnings.push(...v.conversion.warnings.filter((w: string) => !item.warnings.includes(w)));
        if (r.values.status && v.status && r.values.status !== v.status) {
          item.warnings.push(`Saved as ${v.status}, not ${r.values.status}: statuses and original dates are kept only in data load mode (Administration > Settings).`);
        }
        item.ok = true;
        summary.ok += 1;
        summary.versions_created += 1;
      }
      done += 1;
      if (done % 10 === 0) await save('running');
    }
    await save('done', { skipped: archive.skipped.slice(0, 50) });
  } catch (err) {
    console.error('[documents] import failed:', err);
    await save('failed', { problems: [`The import stopped: ${(err as Error).message ?? 'unknown problem'}`.slice(0, 300)] }).catch(() => undefined);
  }
}

const view = (r: Row) => {
  const res = (r.results && !Array.isArray(r.results) ? r.results : {}) as Row;
  return {
    id: r.id, status: r.status, dry_run: r.dry_run ?? res.dry_run ?? false, file_name: res.file_name ?? null, file_count: Number(r.file_count ?? 0),
    summary: res.summary ?? null, problems: res.problems ?? [], skipped: res.skipped ?? [], results: res.items ?? [],
    created_at: r.created_at, created_by: r.created_by, finished_at: r.finished_at,
  };
};

export async function registerDocumentImports(ctx: ModuleContext) {
  const { app, db } = ctx;
  // A run cut short by a restart is not running any more.
  await db.query(`update document_imports set status = 'failed', finished_at = now(),
    results = coalesce(results, '{}'::jsonb) || '{"problems": ["The import was interrupted by a restart of the server. Run it again: documents already loaded are updated, not duplicated, but their versions are added again."]}'::jsonb
    where status in ('pending', 'running')`).catch(() => undefined);

  app.post('/api/documents/imports', { preHandler: ctx.requirePerm('policies.administer') }, async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    if (!app.hasDecorator('claimUpload')) ctx.fail(503, 'files_unavailable', 'Files are not available in this installation.');
    if (!b.upload_id) ctx.fail(400, 'validation', 'Upload the .zip first and give its upload_id.', { upload_id: 'The finished upload of the .zip.' });
    const { upload, bytes } = await readUploadBytes(ctx, req, b.upload_id, IMPORT_MAX_ZIP);
    if (upload.extension !== 'zip') ctx.fail(415, 'not_zip', 'Send a .zip archive holding the files and manifest.csv.');
    const dryRun = b.dry_run === true || b.dry_run === 'true';
    const row = (await db.one<Row>(
      `insert into document_imports (status, dry_run, file_count, created_by, results) values ('running', $1, 0, $2, $3::jsonb) returning *`,
      [dryRun, req.user!.id, JSON.stringify({ file_name: upload.file_name, dry_run: dryRun })]))!;
    await ctx.audit(req, {
      action: dryRun ? 'policy.import_check' : 'policy.import', recordType: 'document_import', recordId: row.id,
      summary: `${dryRun ? 'Dry run of a document import' : 'Document import'} started: ${upload.file_name}`,
    });
    // The work goes on after the answer; the page asks for its progress.
    void runImport(ctx, req, row.id, bytes, upload.file_name, dryRun).then(async () => {
      const done = await db.one<Row>('select * from document_imports where id = $1', [row.id]);
      const s = done ? view(done) : null;
      await ctx.audit(req, {
        action: dryRun ? 'policy.import_check_done' : 'policy.import_done', recordType: 'document_import', recordId: row.id,
        summary: `${dryRun ? 'Dry run of document import' : 'Document import'} ${s?.status === 'done' ? 'finished' : 'failed'}: ${upload.file_name}`
          + (s?.summary ? ` (${s.summary.ok} of ${s.summary.rows} rows ${dryRun ? 'would load' : 'loaded'}, ${s.summary.errors} with errors)` : ''),
        after: s?.summary ?? null,
      });
    }).catch((err) => console.error('[documents] import:', err));
    reply.code(202);
    return view(row);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/documents/imports', tag: 'Documents', permission: 'policies.administer',
    summary: 'Import a document package (.zip with manifest.csv), or check it with a dry run',
    description: 'Body `{ upload_id, dry_run? }`: a finished chunked upload of a .zip (PUT /api/attachments/uploads). `manifest.csv` has one row per version with the columns doc_number, title, document_type, department, owner, parent_number, access, access_departments, access_roles, version, version_label, status, approved_on, effective_on, superseded_on, withdrawn_on, approved_by_name, approval_body, approval_reference, change_summary and file. Office lock files (~$...) and thumbnail caches are skipped. Each row is saved through the documents\' own routes as you, so data load mode keeps original dates and statuses. Answers 202 at once; ask GET /api/documents/imports/:id for progress and per-row results.',
    body: { type: 'object', properties: { upload_id: { type: 'string' }, dry_run: { type: 'boolean' } }, required: ['upload_id'] },
    response: '{ id, status, dry_run, file_name, file_count, summary, problems, skipped, results, created_at, finished_at }',
  });

  app.get('/api/documents/imports', { preHandler: ctx.requirePerm('policies.administer') }, async () =>
    (await db.query<Row>('select * from document_imports order by created_at desc limit 50')).map((r) => {
      const v = view(r);
      return { ...v, results: undefined, result_count: v.results.length };
    }));
  ctx.describeRoute({ method: 'GET', path: '/api/documents/imports', tag: 'Documents', permission: 'policies.administer', summary: 'The latest document imports and dry runs (without their per-row results)' });

  app.get('/api/documents/imports/:id', { preHandler: ctx.requirePerm('policies.administer') }, async (req) => {
    const id = (req.params as Row).id;
    const row = UUID_RE.test(String(id)) ? await db.one<Row>('select * from document_imports where id = $1', [id]) : undefined;
    return row ? view(row) : ctx.fail(404, 'not_found', 'Import not found.');
  });
  ctx.describeRoute({ method: 'GET', path: '/api/documents/imports/:id', tag: 'Documents', permission: 'policies.administer', summary: 'One document import: status, summary and the result of every row' });
}
