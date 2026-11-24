// Evidence requests answered by the auditee (E24-09). The person asked needs no audit permission:
// they see their own requests, and only the request itself (reference, what is asked for, due date,
// status, their answer), never the audit it belongs to. Restricted requests (on a restricted audit)
// are shown only to people who may see restricted records.
//
// They also attach the evidence itself (E41-09), still without `audits.edit`: files they send land on
// the request as evidence files (the auditor sees them on the request's Evidence files tab), through
// the attachments module's own intake (allowed types, size limit, content check, malware scanner).
// They see and download only the files on their own requests, and may remove a file they sent until
// the auditor accepts the evidence.
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { assertNotHeld } from '../../core/holds.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { typeGroup } from '../attachments/filetypes.ts';
import { canReceiveFiles, insertAttachment, prepareFile, receiveFile, sandboxDownload, sendStoredFile, type Refusal } from '../attachments/intake.ts';
import { formatBytes } from '../attachments/service.ts';

/** What the person asked sees of a file on their request. */
const ownFile = (f: Row, userId: string) => ({
  id: f.id, file_name: f.file_name, type_group: typeGroup(f.extension), size_bytes: Number(f.size_bytes), description: f.description ?? null,
  uploaded_at: f.created_at, uploaded_by_name: f.uploaded_by_name ?? null, mine: f.created_by === userId, scan_status: f.scan_status,
});

export async function registerRequests(ctx: ModuleContext) {
  const { app, db } = ctx;

  /** The files on these requests (uploaded ones; links are the auditor's), keyed by request. */
  async function filesOn(ids: string[]): Promise<Map<string, Row[]>> {
    const out = new Map<string, Row[]>();
    if (!ids.length || !canReceiveFiles(ctx)) return out;
    const rows = await db.query<Row>(
      `select * from attachments where record_type = 'audit_request' and record_id = any($1::uuid[]) and deleted_at is null
         and storage_driver <> 'link' order by created_at, id`, [ids]);
    for (const f of rows) out.set(f.record_id, [...(out.get(f.record_id) ?? []), f]);
    return out;
  }

  const OWN = (req: FastifyRequest) => `
    select r.id, r.ref, r.request, r.due_on, r.status, r.response_note, r.provided_at, r.updated_at
    from audit_requests r
    where r.deleted_at is null and r.owner_id = $1 and ${ctx.resources.visibleWhere('audit_request', req.user, 'r')}`;

  const present = (r: Row, today: string, labels: { value: string; label: string }[]) => ({
    id: r.id, ref: r.ref, request: r.request, due_on: r.due_on, status: r.status,
    status_label: labels.find((l) => l.value === r.status)?.label ?? r.status,
    response_note: r.response_note, provided_at: r.provided_at,
    overdue: Boolean(r.due_on && String(r.due_on) < today && ['requested', 'returned'].includes(String(r.status))),
    answerable: ['requested', 'returned', 'provided'].includes(String(r.status)),
  });

  app.get('/api/audit-requests/mine', async (req) => {
    const today = dayInZone();
    const labels = await ctx.lookups.values('audit_request_status');
    const rows = await db.query<Row>(`${OWN(req)} order by (r.status in ('requested', 'returned')) desc, r.due_on nulls last, r.ref`, [req.user!.id]);
    const files = await filesOn(rows.map((r) => r.id));
    const list = rows.map((r) => ({ ...present(r, today, labels), files: (files.get(r.id) ?? []).map((f) => ownFile(f, req.user!.id)) }));
    return { today, files_available: canReceiveFiles(ctx), open: list.filter((r) => r.status === 'requested' || r.status === 'returned'), answered: list.filter((r) => r.status !== 'requested' && r.status !== 'returned') };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audit-requests/mine', tag: 'Audits',
    summary: 'The evidence requests addressed to me: the request text, due date, status and my answer only, never the audit',
    description: 'Needs only a session. Requests on a restricted audit are listed only for people who may see restricted records.',
    response: '{ today, files_available, open: [{ id, ref, request, due_on, status, status_label, response_note, provided_at, overdue, answerable, files: [{ id, file_name, type_group, size_bytes, description, uploaded_at, uploaded_by_name, mine, scan_status }] }], answered: [...] }',
  });

  app.post('/api/audit-requests/:id/respond', async (req) => {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`${OWN(req)} and r.id = $2`, [req.user!.id, id]) : undefined;
    if (!row) ctx.fail(404, 'not_found', 'Evidence request not found.');
    if (row!.status === 'accepted') ctx.fail(409, 'accepted', 'The auditor has already accepted this evidence.');
    const note = String(((req.body ?? {}) as Row).response_note ?? '').trim().slice(0, 8000);
    if (!note) ctx.fail(400, 'validation', 'Check the highlighted fields.', { response_note: 'Say what you are providing and where the auditor can find it.' });
    // System work on the person's behalf: they may not hold audit permissions, and they may change only these fields.
    await ctx.resources.update('audit_request', row!.id, { response_note: note, status: 'provided', provided_at: new Date().toISOString() }, null);
    await ctx.audit(req, {
      action: 'audit_request.respond', recordType: 'audit_request', recordId: row!.id,
      summary: `Evidence request ${row!.ref} answered by the person asked`, before: { status: row!.status, response_note: row!.response_note }, after: { status: 'provided', response_note: note },
    });
    // Tell the audit's lead auditor, who decides whether the evidence is enough.
    const lead = await db.one<Row>(`select a.lead_auditor_id from audit_requests r join audits a on a.id = r.audit_id where r.id = $1`, [row!.id]);
    if (lead?.lead_auditor_id && ctx.app.hasDecorator('notify')) {
      await ctx.app.notify({
        userIds: [lead.lead_auditor_id], kind: 'audits', recordType: 'audit_request', recordId: row!.id,
        title: `Evidence provided: ${row!.ref}`, body: 'Check it and accept it, or return it with what is still needed.',
      });
    }
    const labels = await ctx.lookups.values('audit_request_status');
    return present((await db.one<Row>(`${OWN(req)} and r.id = $2`, [req.user!.id, row!.id]))!, dayInZone(), labels);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/audit-requests/:id/respond', tag: 'Audits',
    summary: 'Answer an evidence request addressed to me: say what is provided and where; the request becomes Provided',
    description: 'Needs only a session, and only the person the request is addressed to. 409 `accepted` once the auditor has accepted the evidence. Audited; the lead auditor is notified.',
    body: '{ response_note: string }', response: '{ id, ref, request, due_on, status, status_label, response_note, provided_at, overdue, answerable }',
  });

  // ---------- evidence files from the person asked (E41-09) ----------

  /** One of the caller's own requests (never says whether another exists). */
  async function ownRequest(req: FastifyRequest): Promise<Row> {
    const id = String((req.params as Row).id ?? '');
    const row = UUID_RE.test(id) ? await db.one<Row>(`${OWN(req)} and r.id = $2`, [req.user!.id, id]) : undefined;
    if (!row || !canReceiveFiles(ctx)) ctx.fail(404, 'not_found', 'Evidence request not found.');
    return row!;
  }
  async function ownFileOf(req: FastifyRequest, request: Row): Promise<Row> {
    const fid = String((req.params as Row).fid ?? '');
    const f = UUID_RE.test(fid)
      ? await db.one<Row>(`select * from attachments where id = $1 and record_type = 'audit_request' and record_id = $2 and deleted_at is null and storage_driver <> 'link'`, [fid, request.id])
      : undefined;
    if (!f) ctx.fail(404, 'not_found', 'File not found.');
    return f!;
  }

  await app.register(async (scoped) => {
    // The file is the request body, as for any upload: never buffered, the limit enforced as the bytes arrive.
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));
    scoped.put('/api/audit-requests/:id/files', async (req, reply) => {
      const request = await ownRequest(req);
      if (request.status === 'accepted') ctx.fail(409, 'accepted', 'The auditor has already accepted this evidence, so no more files can be added.');
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') {
        ctx.fail(415, 'unsupported_media_type', 'Send the file as the request body with the content type application/octet-stream.');
      }
      const q = (req.query ?? {}) as Row;
      const prepared = await prepareFile(ctx, q.name);
      const fileName = prepared.ok ? prepared.file.fileName : prepared.fileName;
      const refuse = async (refusal: Refusal): Promise<never> => {
        if (refusal.audit) {
          await ctx.audit(req, { action: 'attachment.refused', recordType: 'audit_request', recordId: request.id, summary: `File refused: ${fileName} (${refusal.reason})` });
        }
        return ctx.fail(refusal.status, refusal.code, refusal.message);
      };
      if (!prepared.ok) return refuse(prepared.refusal);
      const received = await receiveFile(ctx, prepared.file, body!, Number(req.headers['content-length']));
      if (!received.ok) return refuse(received.refusal);
      const file = received.file;
      if (file.scanUnavailable) {
        await ctx.audit(req, {
          action: 'attachment.scan_unavailable', recordType: 'audit_request', recordId: request.id,
          summary: `File accepted without a malware scan: ${fileName} (malware scanner ${file.scanUnavailable.engine} failed: ${file.scanUnavailable.detail})`,
        });
      }
      const description = typeof q.description === 'string' ? q.description.trim().slice(0, 500) || null : null;
      const row = await insertAttachment(db, file, {
        recordType: 'audit_request', recordId: request.id, kind: 'evidence', description,
        uploadedByName: req.user!.displayName, userId: req.user!.id,
      });
      await ctx.audit(req, {
        action: 'attachment.upload', recordType: 'audit_request', recordId: request.id,
        summary: `Evidence file attached by the person asked: ${fileName} (${formatBytes(file.size)})`,
        after: { attachment_id: row.id, file_name: fileName, size_bytes: file.size, sha256: file.sha256, kind: 'evidence', scan_status: row.scan_status },
      });
      reply.code(201);
      return { ...ownFile(row, req.user!.id), ...(file.scanUnavailable ? { scan_warning: file.scanUnavailable.warning } : {}) };
    });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/audit-requests/:id/files', tag: 'Audits',
    summary: 'Attach an evidence file to an evidence request addressed to me (the request body, application/octet-stream; `name`, optional `description`)',
    description: 'Needs only a session, and only the person the request is addressed to; no audit permission. The same checks as any upload (allowed types, size limit, '
      + 'content, malware scanner). The file becomes an evidence file on the request. 409 `accepted` once the auditor has accepted the evidence. Audited.',
    query: { name: { type: 'string', description: 'The file name, with its extension' }, description: { type: 'string' } },
    response: '{ id, file_name, type_group, size_bytes, description, uploaded_at, uploaded_by_name, mine, scan_status, scan_warning? }',
  });

  app.get('/api/audit-requests/:id/files/:fid', { onSend: sandboxDownload }, async (req, reply) => {
    const request = await ownRequest(req);
    const f = await ownFileOf(req, request);
    return sendStoredFile(ctx, reply, f, async (code, message, reason) => {
      await ctx.audit(req, {
        action: 'attachment.integrity_failure', recordType: 'audit_request', recordId: request.id,
        summary: `File could not be served: ${f.file_name} (${reason})`, after: { attachment_id: f.id },
      });
      return ctx.fail(500, code, message);
    });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/audit-requests/:id/files/:fid', tag: 'Audits',
    summary: 'Download a file on an evidence request addressed to me',
    description: 'Needs only a session, and only the person the request is addressed to.',
  });

  app.delete('/api/audit-requests/:id/files/:fid', async (req) => {
    const request = await ownRequest(req);
    const f = await ownFileOf(req, request);
    if (f.created_by !== req.user!.id) ctx.fail(403, 'forbidden', 'Only files you sent yourself can be removed here.');
    if (request.status === 'accepted') ctx.fail(409, 'accepted', 'The auditor has already accepted this evidence, so its files stay.');
    await assertNotHeld(db, 'audit_request', request.id, 'remove_file');
    await db.query(`update attachments set deleted_at = now(), removed_reason = 'removed', updated_at = now(), updated_by = $2 where id = $1`, [f.id, req.user!.id]);
    await ctx.audit(req, {
      action: 'attachment.delete', recordType: 'audit_request', recordId: request.id, summary: `File removed by the person asked: ${f.file_name}`,
      before: { attachment_id: f.id, file_name: f.file_name, size_bytes: f.size_bytes, sha256: f.sha256, kind: f.kind },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/audit-requests/:id/files/:fid', tag: 'Audits',
    summary: 'Remove a file I attached to an evidence request addressed to me, until the auditor accepts the evidence',
    description: 'Needs only a session; only the person asked, and only files they sent. 409 `accepted` once accepted; 409 `on_hold` under a legal hold. Audited.',
  });
}
