// Taking in one uploaded file, and sending one stored file back, as a service other modules
// reuse (the upload route here, and the vendor response link in the vendors module). Every file
// goes through the same steps whoever sends it: the allowed types (narrowed further if the
// caller asks), the size limit (lowered further if the caller asks), the content compared with
// the name, and the malware scanner. Refusals come back as values, so each caller audits them
// against its own record; nothing here writes an audit event.
import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { Queryable } from '../../core/db.ts';
import type { ModuleContext, Row } from '../../core/module.ts';
import { readScanner } from './config.ts';
import {
  BLOCKED_EXTENSIONS, checkContent, contentDisposition, contentTypeFor, downloadContentType, extensionOf, previewContentType, sanitizeFileName,
} from './filetypes.ts';
import type { ScanResult } from './scanner.ts';
import { formatBytes, Meter, readSettings, TooLargeError } from './service.ts';
import { newStorageKey, type FileStorage } from './storage.ts';

/** Whether files can be taken in at all (the attachments module is loaded). */
export const canReceiveFiles = (ctx: ModuleContext) => ctx.app.hasDecorator('attachmentStores') && ctx.app.hasDecorator('fileScanner');

export interface Refusal {
  status: number;
  code: string;
  /** For the person who sent the file. */
  message: string;
  /** For the audit log. */
  reason: string;
  /** False when nothing about the file was decided (storage unavailable): not worth an audit event. */
  audit: boolean;
}

export interface Prepared {
  fileName: string;
  extension: string;
  maxBytes: number;
  allowedExtensions: string[];
}

export interface Received {
  fileName: string;
  extension: string;
  contentType: string;
  size: number;
  sha256: string;
  driver: string;
  key: string;
  scanStatus: 'clean' | 'not_scanned';
  scanEngine: string | null;
  /** Set when the scanner failed and the file was accepted anyway (the administrator's choice). */
  scanUnavailable: { engine: string; detail: string; warning: string } | null;
}

/**
 * Everything that can be decided from the name before reading any content. `limits` can only
 * narrow what the attachments settings allow, never widen it.
 */
export async function prepareFile(
  ctx: ModuleContext, rawName: unknown, limits: { maxBytes?: number; allowedExtensions?: string[] } = {},
): Promise<{ ok: true; file: Prepared } | { ok: false; fileName: string; refusal: Refusal }> {
  const settings = await readSettings(ctx);
  const fileName = sanitizeFileName(rawName);
  const extension = extensionOf(fileName);
  const allowedExtensions = limits.allowedExtensions
    ? settings.allowedExtensions.filter((e) => limits.allowedExtensions!.includes(e))
    : settings.allowedExtensions;
  const maxBytes = Math.max(0, Math.min(settings.maxBytes, limits.maxBytes ?? settings.maxBytes));
  if (!extension || BLOCKED_EXTENSIONS.has(extension) || !allowedExtensions.includes(extension)) {
    return {
      ok: false, fileName,
      refusal: {
        status: 415, code: 'type_not_allowed', reason: 'type not allowed', audit: true,
        message: extension
          ? `Files of type .${extension} cannot be attached. Allowed types: ${allowedExtensions.join(', ')}.`
          : `The file name needs an extension such as .pdf. Allowed types: ${allowedExtensions.join(', ')}.`,
      },
    };
  }
  return { ok: true, file: { fileName, extension, maxBytes, allowedExtensions } };
}

export const tooLarge = (maxBytes: number): Refusal => ({
  status: 413, code: 'too_large', reason: 'too large', audit: true,
  message: `The file is larger than the limit of ${formatBytes(maxBytes)}.`,
});

/**
 * Receives the bytes straight into storage (counting and hashing on the way), then checks the
 * content and runs the malware scanner. A refused file leaves nothing in storage.
 */
export async function receiveFile(
  ctx: ModuleContext, file: Prepared, body: Readable, declaredLength?: number,
): Promise<{ ok: true; file: Received } | { ok: false; refusal: Refusal }> {
  if (Number.isFinite(declaredLength) && declaredLength! > file.maxBytes) return { ok: false, refusal: tooLarge(file.maxBytes) };
  let storage: FileStorage;
  try {
    storage = ctx.app.attachmentStores.current();
  } catch (err) {
    console.error('[attachments] no storage for uploads:', (err as Error).message);
    return {
      ok: false,
      refusal: { status: 503, code: 'storage_unavailable', message: 'Files cannot be stored at the moment. Tell an administrator.', reason: 'storage unavailable', audit: false },
    };
  }
  const key = newStorageKey();
  const meter = new Meter(file.maxBytes);
  body.on('error', (err) => meter.destroy(err));
  try {
    await storage.put(key, body.pipe(meter));
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    if (err instanceof TooLargeError) return { ok: false, refusal: tooLarge(file.maxBytes) };
    throw err;
  }
  const size = meter.size;
  const sha256 = meter.digest();
  const discard = async (refusal: Omit<Refusal, 'audit'>) => {
    await storage.delete(key).catch(() => undefined);
    return { ok: false as const, refusal: { ...refusal, audit: true } };
  };
  if (size === 0) return discard({ status: 400, code: 'empty_file', message: 'The file is empty.', reason: 'empty' });

  // The content against the name, then the malware scanner.
  const verdict = checkContent(file.extension, meter.head);
  if (!verdict.ok) {
    return discard({
      status: 415, code: verdict.code, message: verdict.message,
      reason: verdict.code === 'executable' ? 'program or script' : 'content does not match the type',
    });
  }
  const scanner = ctx.app.fileScanner.current();
  let scan: ScanResult;
  try {
    scan = await scanner.scan({ fileName: file.fileName, extension: file.extension, size, sha256, open: () => storage.get(key) });
  } catch (err) {
    scan = { verdict: 'error', detail: err instanceof Error ? err.message : 'scanner failed' };
  }
  if (scan.verdict === 'infected') {
    return discard({ status: 422, code: 'malware', message: 'This file was refused by the malware scanner.', reason: `malware scanner ${scanner.name}: ${scan.detail ?? 'infected'}` });
  }
  let scanUnavailable: Received['scanUnavailable'] = null;
  if (scan.verdict === 'error') {
    // The administrator decides: refuse the file, or accept it as "Not scanned" with a warning.
    if ((await readScanner(ctx)).whenUnavailable === 'refuse') {
      return discard({
        status: 503, code: 'scan_failed', message: 'The file could not be checked for malware, so it was not accepted. Try again later.',
        reason: `malware scanner ${scanner.name} failed: ${scan.detail ?? 'no detail'}`,
      });
    }
    scanUnavailable = {
      engine: scanner.name, detail: scan.detail ?? 'no detail',
      warning: 'The malware scanner could not check this file, so it was accepted without a scan and marked "Not scanned".',
    };
  }
  const scanned = scan.verdict === 'clean';
  return {
    ok: true,
    file: {
      fileName: file.fileName, extension: file.extension, contentType: contentTypeFor(file.extension), size, sha256,
      driver: storage.driver, key, scanStatus: scanned ? 'clean' : 'not_scanned', scanEngine: scanned ? scanner.name : null, scanUnavailable,
    },
  };
}

/** Removes a received file's bytes (a caller that decided not to keep it after all). */
export async function discardReceived(ctx: ModuleContext, file: { driver: string; key: string }): Promise<void> {
  try {
    await ctx.app.attachmentStores.forDriver(file.driver).delete(file.key);
  } catch { /* already gone, or its store cannot be reached: the integrity check reports it */ }
}

/** The attachments row for a received file. `db` may be a transaction. */
export async function insertAttachment(
  db: Queryable, file: Received,
  owner: {
    recordType: string; recordId: string; kind?: 'file' | 'evidence'; description?: string | null;
    collectedOn?: string | null; expiresOn?: string | null; uploadedByName: string | null; userId: string | null;
  },
): Promise<Row> {
  const scanned = file.scanStatus === 'clean';
  return (await db.one<Row>(
    `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256,
       storage_driver, storage_key, kind, description, collected_on, expires_on, scan_status, scan_engine, scanned_at,
       uploaded_by_name, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,${scanned ? 'now()' : 'null'},$16,$17,$17) returning *`,
    [
      owner.recordType, owner.recordId, file.fileName, file.extension, file.contentType, file.size, file.sha256, file.driver, file.key,
      owner.kind ?? 'file', owner.description ?? null, owner.collectedOn ?? null, owner.expiresOn ?? null, file.scanStatus,
      file.scanEngine, owner.uploadedByName, owner.userId,
    ],
  ))!;
}

/**
 * Sends a stored file as a download, after checking it is there and unchanged. `problem` is
 * called (and must throw) when it is missing or fails its checksum, so the caller can audit it.
 */
export async function sendStoredFile(
  ctx: ModuleContext, reply: FastifyReply, att: Row,
  problem: (code: 'file_missing' | 'integrity', message: string, reason: string) => Promise<never>,
  beforeSend?: () => Promise<void>,
  opts: { inline?: boolean } = {},
): Promise<FastifyReply> {
  // A preview (E41-16) is served in place only for the image and PDF types `previewKind` accepts,
  // under their fixed type; everything else is refused before any byte is read.
  const inlineType = opts.inline ? previewContentType(att.extension, att.content_type) : null;
  if (opts.inline && !inlineType) return ctx.fail(415, 'no_preview', 'This kind of file cannot be shown in the browser. Download it instead.');
  let storage: FileStorage;
  try {
    storage = ctx.app.attachmentStores.forDriver(att.storage_driver);
  } catch (err) {
    console.error('[attachments] download:', (err as Error).message);
    return ctx.fail(503, 'storage_unavailable', 'The store that holds this file cannot be reached. Tell an administrator.');
  }
  const stat = await storage.stat(att.storage_key);
  if (!stat) await problem('file_missing', 'The stored file is missing. Tell an administrator.', 'stored file missing');

  // Verify before sending anything: read once to check the checksum, then again to send.
  const hash = createHash('sha256');
  for await (const chunk of await storage.get(att.storage_key)) hash.update(chunk as Buffer);
  if (hash.digest('hex') !== att.sha256) {
    await problem('integrity', 'This file failed its integrity check and was not sent. Tell an administrator.', 'checksum mismatch');
  }
  await beforeSend?.();
  reply.header('content-type', inlineType ?? downloadContentType(att.content_type));
  reply.header('content-length', stat!.size);
  reply.header('content-disposition', contentDisposition(att.file_name, Boolean(inlineType)));
  reply.header('x-content-type-options', 'nosniff');
  reply.header('cache-control', 'private, no-store');
  return reply.send(await storage.get(att.storage_key));
}

/** The strictest policy for a downloaded file; add as the route's `onSend`. */
export async function sandboxDownload(_req: unknown, reply: FastifyReply, payload: unknown) {
  reply.header('content-security-policy', "default-src 'none'; sandbox");
  return payload;
}
