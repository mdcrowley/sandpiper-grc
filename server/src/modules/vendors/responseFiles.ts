// Files a vendor sends through an assessment response link (E06-22).
//
// Same link, same rules: only while the link works and the answers have not been sent, within
// the rate limits of the public routes, plus a count and a total size per link and a list of
// file types (`vendors.response_link_*`), which can only narrow the attachments settings. Every
// file goes through the attachments module's own intake (allowed types, content compared with
// the name, malware scanner, size limit; intake.ts), so nothing is checked twice or differently.
//
// A received file waits in a holding area tied to the link: an attachments row with the record
// type `vendor_response_link` and the link's id, which no record page, search or list shows.
// Staff download it to look at it, then take it over (it becomes a file or evidence file on the
// vendor) or discard it (its content is deleted at once). The vendor may withdraw a file until
// the answers are sent. Every step is audited on the vendor, without the link's secret.
import type { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { makeDbLimiter } from '../../core/ratelimit.ts';
import { typeGroup } from '../attachments/filetypes.ts';
import {
  canReceiveFiles, discardReceived, insertAttachment, prepareFile, receiveFile, sandboxDownload, sendStoredFile, type Refusal,
} from '../attachments/intake.ts';
import { formatBytes, readSettings, validateDescriptive } from '../attachments/service.ts';
import type { LinkKit, LinkSettings } from './responseLinks.ts';

/** The record type of the holding area. Not a resource type: nothing outside this file reads it. */
export const HOLD_TYPE = 'vendor_response_link';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Uploads through one link in an hour, whatever happens to them (each one is scanned). */
const UPLOADS_PER_HOUR = 30;
/** Days before unreviewed files are discarded that the person who created the link is told (E06-24). */
const NOTICE_DAYS = 3;

/** Files waiting on these links (not yet taken over, discarded or withdrawn). */
export async function heldFiles(ctx: ModuleContext, linkIds: string[]): Promise<Row[]> {
  if (!linkIds.length || !ctx.app.hasDecorator('attachmentStores')) return [];
  return ctx.db.query<Row>(
    `select * from attachments where record_type = $1 and record_id = any($2::uuid[]) and deleted_at is null order by created_at, id`,
    [HOLD_TYPE, linkIds]);
}

/** What the vendor sees of a file they sent. */
export const publicFile = (f: Row) => ({
  id: f.id, file_name: f.file_name, type_group: typeGroup(f.extension), size_bytes: Number(f.size_bytes), description: f.description, uploaded_at: f.created_at,
});

/** What staff see of a file waiting on a link. */
export const staffFile = (f: Row) => ({
  ...publicFile(f), extension: f.extension, sha256: f.sha256, scan_status: f.scan_status, scan_engine: f.scan_engine, uploaded_by_name: f.uploaded_by_name,
});

/** What the response page tells the vendor before they choose a file (the server checks again). */
export async function uploadLimits(ctx: ModuleContext, s: LinkSettings) {
  if (!s.files_available || s.max_files === 0) return { available: false, max_files: 0, max_bytes: 0, max_file_bytes: 0, file_types: [] as string[] };
  const files = await readSettings(ctx);
  const types = s.file_types.filter((x) => files.allowedExtensions.includes(x));
  return { available: types.length > 0, max_files: s.max_files, max_bytes: s.max_bytes, max_file_bytes: Math.min(files.maxBytes, s.max_bytes), file_types: types };
}

export async function registerResponseFiles(ctx: ModuleContext, kit: LinkKit) {
  const { app, db } = ctx;
  const viewPerm = { preHandler: ctx.requirePerm('vendors.view') };
  const editPerm = { preHandler: ctx.requirePerm('vendors.edit') };
  const uploads = makeDbLimiter(db, 'vendor_response_upload', UPLOADS_PER_HOUR, 60 * 60_000);

  async function usage(linkId: string, q = db as Pick<typeof db, 'one'>) {
    const u = await q.one<{ files: number; bytes: string | number }>(
      `select count(*)::int as files, coalesce(sum(size_bytes), 0)::bigint as bytes from attachments
       where record_type = $1 and record_id = $2 and deleted_at is null`, [HOLD_TYPE, linkId]);
    return { files: u?.files ?? 0, bytes: Number(u?.bytes ?? 0) };
  }

  /** Content deleted now and the row kept as the record of what was there. */
  async function removeHeld(f: Row, reason: 'withdrawn' | 'rejected' | 'unreviewed') {
    await discardReceived(ctx, { driver: f.storage_driver, key: f.storage_key });
    await db.query(
      `update attachments set deleted_at = now(), purged_at = now(), removed_reason = $2, updated_at = now() where id = $1`, [f.id, reason]);
  }

  // ---------- housekeeping: files nobody reviewed (E06-24) ----------

  /**
   * Daily: a file still waiting on a link `discard_days` after the link closed (answers sent, link
   * revoked or expired) is discarded like a file staff discard: its content deleted, the row kept,
   * audited on the vendor. The person who created the link is told once, NOTICE_DAYS beforehand.
   */
  async function discardUnreviewed(): Promise<{ noticed: number; discarded: number }> {
    const s = await kit.settings();
    if (s.discard_days === 0 || !canReceiveFiles(ctx)) return { noticed: 0, discarded: 0 };
    const closedAt = `least(l.submitted_at, l.revoked_at, case when l.expires_at <= now() then l.expires_at end)`;
    const waiting = (withinDays: number) => db.query<Row>(
      `select f.*, l.created_by as link_created_by, l.assessment_id, a.vendor_id, v.name as vendor_name, ${closedAt} as closed_at
       from attachments f join vendor_assessment_links l on l.id = f.record_id
       join vendor_assessments a on a.id = l.assessment_id join vendors v on v.id = a.vendor_id
       where f.record_type = $1 and f.deleted_at is null and ${closedAt} is not null
         and ${closedAt} <= now() - make_interval(days => $2::int)
       order by f.created_at limit 5000`, [HOLD_TYPE, withinDays]);

    // The notice: once per link, before its files go.
    let noticed = 0;
    const lead = Math.max(0, s.discard_days - NOTICE_DAYS);
    const byLink = new Map<string, Row[]>();
    for (const f of await waiting(lead)) (byLink.get(f.record_id) ?? byLink.set(f.record_id, []).get(f.record_id)!).push(f);
    for (const [linkId, files] of byLink) {
      const first = files[0];
      if (!first.link_created_by || !ctx.app.hasDecorator('notify')) continue;
      const send = (ctx.app as unknown as { notify: (i: Row) => Promise<{ sent: number }> }).notify;
      const r = await send({
        userIds: [first.link_created_by], kind: 'reminder', recordType: 'vendor', recordId: first.vendor_id,
        route: `/vendors/${first.vendor_id}`, once: `vendors.response_files_discard:${linkId}`,
        title: `${files.length} file${files.length === 1 ? '' : 's'} sent by ${first.vendor_name} will be discarded unless reviewed`,
        body: `Files sent through a response link that closed ${s.discard_days} days ago are discarded. Open the assessment to take them over or discard them yourself.`,
      });
      noticed += r.sent;
    }

    let discarded = 0;
    for (const f of await waiting(s.discard_days)) {
      await removeHeld(f, 'unreviewed');
      await ctx.audit(null, {
        action: 'vendor.response_file_expire', recordType: 'vendor', recordId: f.vendor_id,
        summary: `File sent through the response link discarded unreviewed, ${s.discard_days} days after the link closed: ${f.file_name}`,
        before: { attachment_id: f.id, link_id: f.record_id, sha256: f.sha256, size_bytes: Number(f.size_bytes) },
      });
      discarded += 1;
    }
    return { noticed, discarded };
  }
  await scheduleWork(ctx, 'vendors.response_files_discard', discardUnreviewed, { every: 24 * 3_600_000, firstRunInMs: 150_000 });

  // ---------- public: the vendor sends, lists (with the questions) and withdraws files ----------

  const quotaMessage = (max: number) => `You can send up to ${max} file${max === 1 ? '' : 's'} through this link. Remove one to send another.`;

  await app.register(async (scoped) => {
    // The file is the request body, as for any other upload: never buffered in memory, and the
    // limit is enforced while the bytes arrive. Nothing is read before the link is checked.
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

    scoped.put('/api/vendor-response/:token/files', { config: { public: true } }, async (req, reply) => {
      const link = await kit.openLink(req);
      const body = req.body as Readable | undefined;
      if (!body || typeof body.pipe !== 'function') {
        ctx.fail(415, 'unsupported_media_type', 'Send the file as the request body with the content type application/octet-stream.');
      }
      const s = await kit.settings();
      if (!canReceiveFiles(ctx) || s.max_files === 0) ctx.fail(409, 'files_off', 'Files cannot be sent through this link. Send them to your contact instead.');
      if (link.submitted_at) ctx.fail(409, 'submitted', 'These answers have been sent, so no more files can be added. Ask your contact if something needs to change.');
      if (await uploads.blocked(link.id)) ctx.fail(429, 'rate_limited', 'Too many files sent in a short time. Wait a while and try again.');
      await uploads.hit(link.id);

      const q = (req.query ?? {}) as Row;
      let fileName = 'file';
      const refuse = async (refusal: Refusal): Promise<never> => {
        if (refusal.audit) {
          await ctx.audit(req, {
            action: 'vendor.response_file_refused', recordType: 'vendor', recordId: link.vendor_id,
            summary: `File sent through the response link refused: ${fileName} (${refusal.reason})`, after: { link_id: link.id },
          });
        }
        return ctx.fail(refusal.status, refusal.code, refusal.message);
      };
      const held = await usage(link.id);
      if (held.files >= s.max_files) {
        return refuse({ status: 409, code: 'quota', message: quotaMessage(s.max_files), reason: 'too many files on the link', audit: true });
      }
      const room = s.max_bytes - held.bytes;
      if (room <= 0) {
        return refuse({ status: 413, code: 'quota', message: `The files sent through this link already reach the limit of ${formatBytes(s.max_bytes)}. Remove one to send another.`, reason: 'link size limit reached', audit: true });
      }
      const description = typeof q.description === 'string' ? q.description.trim().slice(0, 500) || null : null;
      const prepared = await prepareFile(ctx, q.name, { maxBytes: room, allowedExtensions: s.file_types });
      fileName = prepared.ok ? prepared.file.fileName : prepared.fileName;
      if (!prepared.ok) return refuse(prepared.refusal);

      const received = await receiveFile(ctx, prepared.file, body!, Number(req.headers['content-length']));
      if (!received.ok) return refuse(received.refusal);
      const file = received.file;

      // Checked again under a lock on the link: it may have been sent, withdrawn or filled meanwhile.
      const outcome = await db.tx(async (tx) => {
        const open = await tx.one<Row>(
          `select id from vendor_assessment_links where id = $1 and submitted_at is null and revoked_at is null and expires_at > now() for update`, [link.id]);
        if (!open) return 'closed' as const;
        const now = await usage(link.id, tx);
        if (now.files >= s.max_files || now.bytes + file.size > s.max_bytes) return 'quota' as const;
        return insertAttachment(tx, file, {
          recordType: HOLD_TYPE, recordId: link.id, kind: 'file', description,
          uploadedByName: link.responder_name ? `${link.responder_name} (vendor)` : 'Vendor (response link)', userId: null,
        });
      });
      if (outcome === 'closed' || outcome === 'quota') {
        await discardReceived(ctx, file);
        if (outcome === 'closed') ctx.fail(409, 'submitted', 'This link no longer accepts files. Ask your contact if something needs to change.');
        return refuse({ status: 409, code: 'quota', message: quotaMessage(s.max_files), reason: 'link limits reached', audit: true });
      }
      if (file.scanUnavailable) {
        await ctx.audit(req, {
          action: 'attachment.scan_unavailable', recordType: 'vendor', recordId: link.vendor_id,
          summary: `File sent through the response link accepted without a malware scan: ${file.fileName} (malware scanner ${file.scanUnavailable.engine} failed: ${file.scanUnavailable.detail})`,
        });
      }
      await ctx.audit(req, {
        action: 'vendor.response_file_upload', recordType: 'vendor', recordId: link.vendor_id,
        summary: `Vendor sent a file through the response link: ${file.fileName} (${formatBytes(file.size)}); it waits for review`,
        after: { link_id: link.id, attachment_id: outcome.id, file_name: file.fileName, size_bytes: file.size, sha256: file.sha256, scan_status: file.scanStatus },
      });
      reply.code(201);
      return { ...publicFile(outcome), ...(file.scanUnavailable ? { scan_warning: file.scanUnavailable.warning } : {}) };
    });
  });
  ctx.describeRoute({
    method: 'PUT', path: '/api/vendor-response/:token/files', tag: 'Vendors', public: true,
    summary: 'Send one file through a vendor response link (the request body, application/octet-stream; `name`, optional `description`)',
    description: 'Only while the link works and the answers have not been sent. Same checks as any upload (type, content, malware scanner, size), '
      + 'within the file count, total size and file types set for response links. The file waits for staff review; it is not attached to any record.',
    query: { name: { type: 'string', description: 'The file name, with its extension' }, description: { type: 'string' } },
  });

  app.delete('/api/vendor-response/:token/files/:fid', { config: { public: true } }, async (req) => {
    const link = await kit.openLink(req);
    if (link.submitted_at) ctx.fail(409, 'submitted', 'These answers have been sent. Ask your contact if a file needs to be removed.');
    const fid = String((req.params as Row).fid ?? '');
    const f = UUID.test(fid)
      ? await db.one<Row>('select * from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null', [fid, HOLD_TYPE, link.id])
      : undefined;
    if (!f) ctx.fail(404, 'not_found', 'File not found.');
    await removeHeld(f!, 'withdrawn');
    await ctx.audit(req, {
      action: 'vendor.response_file_withdraw', recordType: 'vendor', recordId: link.vendor_id,
      summary: `Vendor removed a file sent through the response link: ${f!.file_name}`, before: { link_id: link.id, attachment_id: f!.id, sha256: f!.sha256 },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'DELETE', path: '/api/vendor-response/:token/files/:fid', tag: 'Vendors', public: true,
    summary: 'Remove a file sent through a vendor response link, before the answers are sent',
  });

  // ---------- staff: look at, take over or discard ----------

  async function needHeld(req: FastifyRequest) {
    const a = await kit.needDraft(req);
    const { lid, fid } = req.params as Row;
    const f = UUID.test(String(lid)) && UUID.test(String(fid))
      ? await db.one<Row>(
        `select f.* from attachments f join vendor_assessment_links l on l.id = f.record_id
         where f.id = $1 and f.record_type = $2 and f.record_id = $3 and l.assessment_id = $4 and f.deleted_at is null`,
        [fid, HOLD_TYPE, lid, a.id])
      : undefined;
    if (!f) ctx.fail(404, 'not_found', 'File not found. It may have been taken over or discarded already.');
    return { a, f: f! };
  }

  app.get('/api/vendor-assessments/:aid/links/:lid/files/:fid/download', { ...viewPerm, onSend: sandboxDownload }, async (req, reply) => {
    if (!canReceiveFiles(ctx)) ctx.fail(404, 'not_found', 'File not found.');
    const { a, f } = await needHeld(req);
    return sendStoredFile(ctx, reply, f, async (code, message, reason) => {
      await ctx.audit(req, {
        action: 'attachment.integrity_failure', recordType: 'vendor', recordId: a.vendor_id,
        summary: `File sent through the response link could not be served: ${f.file_name} (${reason})`, after: { attachment_id: f.id },
      });
      return ctx.fail(500, code, message);
    });
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/vendor-assessments/:aid/links/:lid/files/:fid/download', tag: 'Vendors', permission: 'vendors.view',
    summary: 'Download a file the vendor sent through a response link, to review it before taking it over',
  });

  app.post('/api/vendor-assessments/:aid/links/:lid/files/:fid/accept', editPerm, async (req) => {
    if (!canReceiveFiles(ctx)) ctx.fail(404, 'not_found', 'File not found.');
    const { a, f } = await needHeld(req);
    const b = (req.body ?? {}) as Row;
    const meta = validateDescriptive(ctx, {
      kind: b.kind ?? 'evidence', description: b.description !== undefined ? b.description : f.description,
      collected_on: b.collected_on, expires_on: b.expires_on,
    });
    // Moved, not copied: the same stored bytes now belong to the vendor record. Checked again in the update.
    const row = await db.one<Row>(
      `update attachments set record_type = 'vendor', record_id = $2, kind = $3, description = $4, collected_on = $5, expires_on = $6,
         updated_at = now(), updated_by = $7
       where id = $1 and record_type = $8 and deleted_at is null returning *`,
      [f.id, a.vendor_id, meta.kind, meta.description, meta.collected_on, meta.expires_on, req.user!.id, HOLD_TYPE]);
    if (!row) ctx.fail(404, 'not_found', 'File not found. It may have been taken over or discarded already.');
    await ctx.audit(req, {
      action: 'vendor.response_file_accept', recordType: 'vendor', recordId: a.vendor_id,
      summary: `${meta.kind === 'evidence' ? 'Evidence file' : 'File'} taken over from the vendor's response for ${a.vendor.name}: ${f.file_name} (${formatBytes(Number(f.size_bytes))})`,
      after: {
        attachment_id: f.id, link_id: f.record_id, file_name: f.file_name, size_bytes: Number(f.size_bytes), sha256: f.sha256,
        kind: meta.kind, collected_on: meta.collected_on, expires_on: meta.expires_on, scan_status: f.scan_status,
      },
    });
    return { ok: true, attachment_id: f.id, record_type: 'vendor', record_id: a.vendor_id };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-assessments/:aid/links/:lid/files/:fid/accept', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Take over a file the vendor sent: it becomes a file on the vendor (evidence by default)',
    body: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['evidence', 'file'] }, description: { type: 'string' },
        collected_on: { type: 'string', format: 'date' }, expires_on: { type: 'string', format: 'date' },
      },
    },
  });

  app.post('/api/vendor-assessments/:aid/links/:lid/files/:fid/discard', editPerm, async (req) => {
    if (!canReceiveFiles(ctx)) ctx.fail(404, 'not_found', 'File not found.');
    const { a, f } = await needHeld(req);
    await removeHeld(f, 'rejected');
    await ctx.audit(req, {
      action: 'vendor.response_file_discard', recordType: 'vendor', recordId: a.vendor_id,
      summary: `File sent through the vendor's response discarded: ${f.file_name}`, before: { attachment_id: f.id, link_id: f.record_id, sha256: f.sha256 },
    });
    return { ok: true };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/vendor-assessments/:aid/links/:lid/files/:fid/discard', tag: 'Vendors', permission: 'vendors.edit',
    summary: 'Discard a file the vendor sent: its content is deleted at once',
  });
}
