// Chunked uploads (E43-07, migration 007). A file is sent in numbered parts of at most 1 MB, in any
// order, each as raw bytes (`application/octet-stream`) or as JSON `{ "data": "<base64>" }` (what an
// AI assistant over MCP can send). Finishing joins the parts and puts the whole file through the same
// intake as a single upload (intake.ts: allowed types, size limit, content against the name, malware
// scanner), then checks the SHA-256 the sender gave. The finished upload belongs to the person who
// sent it and is attached to a record the first time it is used, under that record's own rules (the
// attach route here, or a module such as documents through `claimUpload`). Unfinished and unused
// uploads expire after 24 hours and are removed with their bytes (hourly housekeeping).
//
// Nothing here decides who may see a record: an upload is not a record, and it is reachable only by
// the person who started it (anyone else gets "not found").
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { UUID_RE } from '../../core/errors.ts';
import { scheduleWork } from '../../core/jobs/index.ts';
import type { ModuleContext, ResourceDef, Row } from '../../core/module.ts';
import { discardReceived, insertAttachment, prepareFile, receiveFile, type Received } from './intake.ts';
import { formatBytes, present, readSettings, validateDescriptive } from './service.ts';
import { newStorageKey, type FileStorage } from './storage.ts';
import { queueFileTexts } from './text.ts';

/** The largest part, in bytes (decoded). Every part but the last is exactly this size. */
export const UPLOAD_PART_BYTES = 1024 * 1024;
/** How long an upload may wait to be finished and used. */
export const UPLOAD_HOURS = 24;
/** Uploads one person may have open (receiving or ready) at once. */
export const UPLOAD_OPEN_LIMIT = 50;
const HOUR = 3_600_000;
const SHA_RE = /^[0-9a-f]{64}$/;

interface Parent { def: ResourceDef; row: Row; restricted: boolean; label: string }
interface Helpers {
  needParent(req: FastifyRequest, type: unknown, id: unknown, action: 'view' | 'edit'): Promise<Parent>;
}

/** An upload as the API returns it (never the storage keys). */
export function presentUpload(u: Row): Row {
  const parts = Object.keys(u.parts ?? {}).map(Number).sort((a, b) => a - b);
  const file = u.file as Row | null;
  return {
    id: u.id, file_name: u.file_name, extension: u.extension, size: Number(u.size), sha256: file?.sha256 ?? u.sha256 ?? null,
    status: u.status, part_size: Number(u.part_size), part_count: Number(u.part_count), parts_received: parts,
    missing_parts: Array.from({ length: Number(u.part_count) }, (_, i) => i + 1).filter((n) => !parts.includes(n)),
    scan_status: file?.scanStatus ?? null, scan_warning: file?.scanUnavailable?.warning ?? null,
    attachment_id: u.attachment_id ?? null, detail: u.detail ?? null,
    created_at: u.created_at, expires_at: u.expires_at, finished_at: u.finished_at ?? null,
  };
}

const store = (ctx: ModuleContext, driver: string): FileStorage => ctx.app.attachmentStores.forDriver(driver);

async function dropParts(ctx: ModuleContext, u: Row): Promise<void> {
  for (const p of Object.values((u.parts ?? {}) as Record<string, Row>)) {
    try { await store(ctx, u.parts_driver).delete(p.key); } catch { /* gone already, or the store is away: housekeeping tries again */ }
  }
}

/** The caller's own upload; anyone else's, or a missing one, is "not found". */
async function ownUpload(ctx: ModuleContext, req: FastifyRequest, id: unknown, lock = false): Promise<Row> {
  const row = typeof id === 'string' && UUID_RE.test(id)
    ? await ctx.db.one<Row>(`select * from uploads_pending where id = $1 and user_id = $2 and expires_at > now()${lock ? ' for update' : ''}`, [id, req.user!.id])
    : undefined;
  return row ?? ctx.fail(404, 'not_found', 'Upload not found. It may have expired (uploads are kept for 24 hours).');
}

/** Starts an upload: the name and size are checked against the file settings before any byte arrives. */
export async function startUpload(ctx: ModuleContext, req: FastifyRequest, body: Row): Promise<Row> {
  const size = Number(body.size);
  const sha = typeof body.sha256 === 'string' && body.sha256.trim() ? body.sha256.trim().toLowerCase() : null;
  const fields: Record<string, string> = {};
  if (!Number.isInteger(size) || size < 1) fields.size = 'Give the file size in bytes (a whole number above 0).';
  if (sha !== null && !SHA_RE.test(sha)) fields.sha256 = 'The SHA-256 is 64 hexadecimal characters.';
  if (typeof body.file_name !== 'string' || !body.file_name.trim()) fields.file_name = 'Give the file name, with its extension.';
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  const prepared = await prepareFile(ctx, body.file_name);
  if (!prepared.ok) ctx.fail(prepared.refusal.status, prepared.refusal.code, prepared.refusal.message);
  const file = (prepared as { ok: true; file: { fileName: string; extension: string; maxBytes: number } }).file;
  if (size > file.maxBytes) ctx.fail(413, 'too_large', `The file is larger than the limit of ${formatBytes(file.maxBytes)}.`);
  const open = (await ctx.db.one<{ n: number }>(
    `select count(*)::int as n from uploads_pending where user_id = $1 and status in ('receiving', 'ready') and expires_at > now()`, [req.user!.id]))!.n;
  if (open >= UPLOAD_OPEN_LIMIT) ctx.fail(429, 'too_many_uploads', `You have ${open} uploads open. Finish or cancel some first (unused uploads expire after ${UPLOAD_HOURS} hours).`);
  let driver: string;
  try {
    driver = ctx.app.attachmentStores.current().driver;
  } catch {
    return ctx.fail(503, 'storage_unavailable', 'Files cannot be stored at the moment. Tell an administrator.');
  }
  const row = (await ctx.db.one<Row>(
    `insert into uploads_pending (user_id, token_id, file_name, extension, size, sha256, part_size, part_count, parts_driver, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + make_interval(hours => $10)) returning *`,
    [req.user!.id, req.apiToken?.id ?? null, file.fileName, file.extension, size, sha, UPLOAD_PART_BYTES, Math.ceil(size / UPLOAD_PART_BYTES), driver, UPLOAD_HOURS],
  ))!;
  return presentUpload(row);
}

/** Takes one part. Sending a part again replaces it. */
export async function putPart(ctx: ModuleContext, req: FastifyRequest, id: unknown, n: unknown, bytes: Buffer, sha256?: unknown): Promise<Row> {
  const u = await ownUpload(ctx, req, id);
  if (u.status !== 'receiving') ctx.fail(409, 'not_receiving', u.status === 'ready' || u.status === 'used' ? 'This upload is finished already.' : 'This upload was refused. Start a new one.');
  const index = Number(n);
  const count = Number(u.part_count);
  if (!Number.isInteger(index) || index < 1 || index > count) ctx.fail(400, 'validation', `Parts are numbered from 1 to ${count}.`, { part: `Parts are numbered from 1 to ${count}.` });
  const expected = index < count ? Number(u.part_size) : Number(u.size) - Number(u.part_size) * (count - 1);
  if (bytes.length !== expected) {
    ctx.fail(400, 'part_size', `Part ${index} must be ${expected.toLocaleString('en-US')} bytes; ${bytes.length.toLocaleString('en-US')} arrived.`, { part: `Expected ${expected} bytes.` });
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (typeof sha256 === 'string' && sha256.trim() && sha256.trim().toLowerCase() !== digest) {
    ctx.fail(422, 'checksum_mismatch', `Part ${index} arrived damaged (its SHA-256 does not match). Send it again.`);
  }
  const key = newStorageKey();
  const target = store(ctx, u.parts_driver);
  await target.put(key, Readable.from([bytes]));
  const saved = await ctx.db.tx(async (tx) => {
    const cur = await tx.one<Row>(`select parts -> $2::text as old from uploads_pending where id = $1 and status = 'receiving' for update`, [u.id, String(index)]);
    if (!cur) return undefined;
    const row = await tx.one<Row>(
      `update uploads_pending set parts = parts || jsonb_build_object($2::text, jsonb_build_object('key', $3::text, 'size', $4::int, 'sha256', $5::text))
       where id = $1 returning *`, [u.id, String(index), key, bytes.length, digest]);
    return { old: cur.old as Row | null, row: row! };
  });
  if (!saved) {
    await target.delete(key).catch(() => undefined);
    ctx.fail(409, 'not_receiving', 'This upload is finished already.');
  }
  if (saved!.old?.key) await target.delete(saved!.old.key).catch(() => undefined);
  return presentUpload(saved!.row);
}

/** A stream of the parts in order. */
function joined(ctx: ModuleContext, u: Row): Readable {
  const parts = u.parts as Record<string, Row>;
  const count = Number(u.part_count);
  const s = store(ctx, u.parts_driver);
  return Readable.from((async function* () {
    for (let i = 1; i <= count; i++) {
      for await (const chunk of await s.get(parts[String(i)].key)) yield chunk as Buffer;
    }
  })());
}

/**
 * Finishes an upload: every part must be there; the whole file goes through the usual intake and its
 * SHA-256 is compared with the one given (at the start or now). A refused file leaves nothing behind.
 */
export async function finishUpload(ctx: ModuleContext, req: FastifyRequest, id: unknown, body: Row = {}): Promise<Row> {
  const u = await ownUpload(ctx, req, id);
  if (u.status === 'ready') return presentUpload(u);
  if (u.status !== 'receiving') ctx.fail(409, 'not_receiving', u.status === 'used' ? 'This upload has been used already.' : 'This upload was refused. Start a new one.');
  const sha = typeof body.sha256 === 'string' && body.sha256.trim() ? body.sha256.trim().toLowerCase() : u.sha256;
  if (sha && !SHA_RE.test(sha)) ctx.fail(400, 'validation', 'The SHA-256 is 64 hexadecimal characters.', { sha256: 'The SHA-256 is 64 hexadecimal characters.' });
  const missing = presentUpload(u).missing_parts as number[];
  if (missing.length) ctx.fail(409, 'parts_missing', `Parts still missing: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}.`);
  const prepared = await prepareFile(ctx, u.file_name);
  const refuse = async (status: number, code: string, message: string, reason: string): Promise<never> => {
    await ctx.db.query(`update uploads_pending set status = 'failed', detail = $2, finished_at = now() where id = $1`, [u.id, message]);
    await dropParts(ctx, u);
    await ctx.audit(req, { action: 'attachment.upload_refused', recordType: 'upload', recordId: u.id, summary: `Chunked upload refused: ${u.file_name} (${reason})` });
    return ctx.fail(status, code, message);
  };
  if (!prepared.ok) return refuse(prepared.refusal.status, prepared.refusal.code, prepared.refusal.message, prepared.refusal.reason);
  const received = await receiveFile(ctx, prepared.file, joined(ctx, u), Number(u.size));
  if (!received.ok) return refuse(received.refusal.status, received.refusal.code, received.refusal.message, received.refusal.reason);
  const file = received.file;
  if (file.size !== Number(u.size)) {
    await discardReceived(ctx, file);
    return refuse(422, 'size_mismatch', `The parts add up to ${file.size} bytes, not the ${u.size} announced.`, 'size mismatch');
  }
  if (sha && file.sha256 !== sha) {
    await discardReceived(ctx, file);
    return refuse(422, 'checksum_mismatch', 'The file that arrived does not match the SHA-256 given, so it was not kept. Send it again.', 'checksum mismatch');
  }
  const row = (await ctx.db.one<Row>(
    `update uploads_pending set status = 'ready', file = $2::jsonb, storage_key = $3, sha256 = $4, finished_at = now(), parts = '{}'::jsonb
     where id = $1 and status = 'receiving' returning *`, [u.id, JSON.stringify(file), file.key, file.sha256]))!;
  await dropParts(ctx, u);
  if (file.scanUnavailable) {
    await ctx.audit(req, {
      action: 'attachment.scan_unavailable', recordType: 'upload', recordId: u.id,
      summary: `Chunked upload accepted without a malware scan: ${u.file_name} (malware scanner ${file.scanUnavailable.engine} failed: ${file.scanUnavailable.detail})`,
    });
  }
  await ctx.audit(req, {
    action: 'attachment.upload_received', recordType: 'upload', recordId: u.id,
    summary: `Chunked upload received: ${u.file_name} (${formatBytes(file.size)})`, after: { file_name: u.file_name, size_bytes: file.size, sha256: file.sha256, scan_status: file.scanStatus },
  });
  return presentUpload(row);
}

/** A finished upload of the caller's, not used yet (for reading its bytes or attaching it). */
export async function readyUpload(ctx: ModuleContext, req: FastifyRequest, id: unknown): Promise<Row> {
  const u = await ownUpload(ctx, req, id);
  if (u.status === 'used') ctx.fail(409, 'upload_used', 'This upload has been attached already. Start a new upload for another copy.');
  if (u.status !== 'ready') ctx.fail(409, 'upload_not_ready', u.status === 'receiving' ? 'Finish the upload first.' : 'This upload was refused.');
  return u;
}

/** The bytes of a finished upload (at most `max`), for a module that reads it before or instead of attaching it. */
export async function readUploadBytes(ctx: ModuleContext, req: FastifyRequest, id: unknown, max = 200 * 1024 * 1024): Promise<{ upload: Row; bytes: Buffer }> {
  const u = await readyUpload(ctx, req, id);
  const file = u.file as Received;
  if (file.size > max) ctx.fail(413, 'too_large', `The file is larger than ${formatBytes(max)}.`);
  const chunks: Buffer[] = [];
  for await (const c of await store(ctx, file.driver).get(file.key)) chunks.push(c as Buffer);
  return { upload: u, bytes: Buffer.concat(chunks) };
}

/**
 * Attaches a finished upload to a record, once. The caller has checked that the person may change
 * the record's files (the attach route uses the attachments module's own rule). `db` may be a transaction.
 */
export async function claimUpload(
  ctx: ModuleContext, req: FastifyRequest, id: unknown,
  owner: { recordType: string; recordId: string; kind?: 'file' | 'evidence'; description?: string | null; collectedOn?: string | null; expiresOn?: string | null; audit?: boolean },
): Promise<Row> {
  const u = await readyUpload(ctx, req, id);
  const taken = await ctx.db.one<Row>(`update uploads_pending set status = 'used', used_at = now() where id = $1 and status = 'ready' returning id`, [u.id]);
  if (!taken) ctx.fail(409, 'upload_used', 'This upload has been attached already.');
  const row = await insertAttachment(ctx.db, u.file as Received, {
    recordType: owner.recordType, recordId: owner.recordId, kind: owner.kind ?? 'file', description: owner.description ?? null,
    collectedOn: owner.collectedOn ?? null, expiresOn: owner.expiresOn ?? null, uploadedByName: req.user!.displayName, userId: req.user!.id,
  });
  await ctx.db.query('update uploads_pending set attachment_id = $2 where id = $1', [u.id, row.id]);
  if (owner.audit !== false) {
    await ctx.audit(req, {
      action: 'attachment.upload', recordType: owner.recordType, recordId: owner.recordId,
      summary: `File attached: ${row.file_name} (${formatBytes(Number(row.size_bytes))}, chunked upload)`,
      after: { attachment_id: row.id, file_name: row.file_name, size_bytes: Number(row.size_bytes), sha256: row.sha256, kind: row.kind, scan_status: row.scan_status },
    });
  }
  await queueFileTexts(ctx);
  return row;
}

/**
 * A finished upload made on the server from bytes it already holds (a file taken out of an import
 * archive): the same intake as any upload, owned by the person whose request it is.
 */
export async function uploadFromBytes(ctx: ModuleContext, req: FastifyRequest, fileName: string, bytes: Buffer): Promise<Row> {
  const prepared = await prepareFile(ctx, fileName);
  if (!prepared.ok) ctx.fail(prepared.refusal.status, prepared.refusal.code, prepared.refusal.message);
  const p = (prepared as { ok: true; file: Parameters<typeof receiveFile>[1] }).file;
  const received = await receiveFile(ctx, p, Readable.from([bytes]), bytes.length);
  if (!received.ok) ctx.fail(received.refusal.status, received.refusal.code, received.refusal.message);
  const file = (received as { ok: true; file: Received }).file;
  const row = (await ctx.db.one<Row>(
    `insert into uploads_pending (user_id, token_id, file_name, extension, size, sha256, part_size, part_count, parts_driver, status, file, storage_key, finished_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7, 1, $8, 'ready', $9::jsonb, $10, now(), now() + make_interval(hours => $11)) returning *`,
    [req.user!.id, req.apiToken?.id ?? null, file.fileName, file.extension, file.size, file.sha256, UPLOAD_PART_BYTES, file.driver, JSON.stringify(file), file.key, UPLOAD_HOURS],
  ))!;
  return presentUpload(row);
}

/** Removes expired uploads with their bytes (parts, and the file of a finished upload never used). */
export async function expireUploads(ctx: ModuleContext): Promise<{ removed: number }> {
  const old = await ctx.db.query<Row>(`select * from uploads_pending where expires_at <= now() order by expires_at limit 500`);
  for (const u of old) {
    await dropParts(ctx, u);
    if (u.status === 'ready' && u.file) await discardReceived(ctx, u.file as Received);
    await ctx.db.query('delete from uploads_pending where id = $1', [u.id]);
  }
  return { removed: old.length };
}

/** The parts' bytes from the request body: raw (octet-stream) or JSON `{ data: base64 }`. */
async function partBytes(ctx: ModuleContext, req: FastifyRequest): Promise<{ bytes: Buffer; sha256?: unknown }> {
  const body = req.body as unknown;
  if (body && typeof (body as Readable).pipe === 'function') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of body as Readable) {
      size += (c as Buffer).length;
      if (size > UPLOAD_PART_BYTES) ctx.fail(413, 'too_large', `A part is at most ${formatBytes(UPLOAD_PART_BYTES)}.`);
      chunks.push(c as Buffer);
    }
    return { bytes: Buffer.concat(chunks), sha256: (req.query as Row)?.sha256 };
  }
  const b = (body ?? {}) as Row;
  if (typeof b.data !== 'string') ctx.fail(400, 'validation', 'Send the part as the body (application/octet-stream) or as JSON { "data": "<base64>" }.', { data: 'Base64 text of the part.' });
  const text = (b.data as string).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) ctx.fail(400, 'validation', 'The part is not valid base64.', { data: 'Not valid base64.' });
  if (text.length > Math.ceil(UPLOAD_PART_BYTES / 3) * 4) ctx.fail(413, 'too_large', `A part is at most ${formatBytes(UPLOAD_PART_BYTES)}.`);
  return { bytes: Buffer.from(text, 'base64'), sha256: b.sha256 };
}

export async function registerUploads(ctx: ModuleContext, h: Helpers) {
  const { app } = ctx;
  const T = 'Attachments';

  if (!app.hasDecorator('claimUpload')) {
    app.decorate('claimUpload', async (req: FastifyRequest, uploadId: string, owner: { recordType: string; recordId: string; description?: string | null }) => {
      const row = await claimUpload(ctx, req, uploadId, owner);
      return { attachment_id: row.id as string, file_name: row.file_name as string, extension: row.extension as string };
    });
  }
  await scheduleWork(ctx, 'attachments.uploads_housekeeping', () => expireUploads(ctx), { every: HOUR, firstRunInMs: 150_000 });

  await app.register(async (scoped) => {
    scoped.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

    const start = async (req: FastifyRequest, reply: { code(n: number): unknown }) => {
      const out = await startUpload(ctx, req, (req.body ?? {}) as Row);
      reply.code(201);
      return { ...out, max_bytes: (await readSettings(ctx)).maxBytes };
    };
    scoped.put('/api/attachments/uploads', start);
    scoped.post('/api/attachments/uploads', start);
    const part = async (req: FastifyRequest) => {
      const p = req.params as Row;
      const { bytes, sha256 } = await partBytes(ctx, req);
      return putPart(ctx, req, p.id, p.n, bytes, sha256);
    };
    scoped.put('/api/attachments/uploads/:id/parts/:n', part);
    scoped.post('/api/attachments/uploads/:id/parts/:n', part);
  });
  for (const method of ['PUT', 'POST'] as const) {
    ctx.describeRoute({
      method, path: '/api/attachments/uploads', tag: T, summary: 'Start a chunked upload',
      description: `Signed in. Body \`{ file_name, size, sha256? }\`. The name and size are checked against the file settings first (415 \`type_not_allowed\`, 413 \`too_large\`). Answers the upload with \`id\`, \`part_size\` (${UPLOAD_PART_BYTES} bytes) and \`part_count\`. At most ${UPLOAD_OPEN_LIMIT} open uploads per person (429). Expires after ${UPLOAD_HOURS} hours.`,
      body: { type: 'object', properties: { file_name: { type: 'string' }, size: { type: 'integer' }, sha256: { type: 'string' } }, required: ['file_name', 'size'] },
      response: '{ id, file_name, size, status, part_size, part_count, parts_received, missing_parts, expires_at, max_bytes }',
    });
    ctx.describeRoute({
      method, path: '/api/attachments/uploads/:id/parts/:n', tag: T, summary: 'Send one part of a chunked upload',
      description: 'The person who started the upload only. Parts are numbered from 1; every part but the last is exactly `part_size` bytes. Send the bytes as the body (`application/octet-stream`, optional `?sha256=`) or JSON `{ data: base64, sha256? }`. A part sent again replaces the earlier one.',
    });
  }

  app.get('/api/attachments/uploads/:id', async (req) => presentUpload(await ownUpload(ctx, req, (req.params as Row).id)));
  ctx.describeRoute({ method: 'GET', path: '/api/attachments/uploads/:id', tag: T, summary: 'A chunked upload: parts received and missing, status', description: 'The person who started the upload only.' });

  app.post('/api/attachments/uploads/:id/finish', async (req) => finishUpload(ctx, req, (req.params as Row).id, (req.body ?? {}) as Row));
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/uploads/:id/finish', tag: T, summary: 'Finish a chunked upload',
    description: 'Joins the parts, checks the content against the name, runs the malware scanner and compares the SHA-256 given at the start or here (`{ sha256? }`). 409 `parts_missing`; 422 `checksum_mismatch`, `size_mismatch` or `malware`. A refused upload keeps nothing. The finished upload is attached on first use.',
  });

  app.delete('/api/attachments/uploads/:id', async (req) => {
    const u = await ownUpload(ctx, req, (req.params as Row).id);
    if (u.status === 'used') ctx.fail(409, 'upload_used', 'This upload has been attached already; remove the file from its record instead.');
    await dropParts(ctx, u);
    if (u.status === 'ready' && u.file) await discardReceived(ctx, u.file as Received);
    await ctx.db.query('delete from uploads_pending where id = $1', [u.id]);
    return { ok: true };
  });
  ctx.describeRoute({ method: 'DELETE', path: '/api/attachments/uploads/:id', tag: T, summary: 'Cancel a chunked upload that has not been attached' });

  app.post('/api/attachments/uploads/:id/attach', async (req, reply) => {
    const b = (req.body ?? {}) as Row;
    await readyUpload(ctx, req, (req.params as Row).id);
    const parent = await h.needParent(req, b.record_type, b.record_id, 'edit');
    const meta = validateDescriptive(ctx, b);
    const row = await claimUpload(ctx, req, (req.params as Row).id, {
      recordType: parent.def.type, recordId: parent.row.id, kind: meta.kind, description: meta.description,
      collectedOn: meta.collected_on, expiresOn: meta.expires_on,
    });
    reply.code(201);
    return present(row);
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/attachments/uploads/:id/attach', tag: T, summary: 'Attach a finished chunked upload to a record',
    description: 'Body `{ record_type, record_id, kind?, description?, collected_on?, expires_on? }`. Needs edit permission on the record, as a single upload does; a record you cannot see answers 404. An upload is attached once (409 `upload_used`).',
    response: 'The attachment, as GET /api/attachments lists it.',
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Attaches the caller's finished chunked upload to a record, once (E43-07). The caller must have
     * checked that the person may change that record's files. Set by the attachments module.
     */
    claimUpload(req: FastifyRequest, uploadId: string, owner: { recordType: string; recordId: string; description?: string | null }): Promise<{ attachment_id: string; file_name: string; extension: string }>;
  }
}
