// Files that arrive by email (E15-06) are stored exactly as an upload would be: the same
// allowed types, the content checked against the name, the malware scanner, the size limit
// and the same store, through the attachments module's own pieces. Nothing is stored when the
// attachments module is not loaded.
import { Readable } from 'node:stream';
import type { ModuleContext, Row } from '../../core/module.ts';
import { BLOCKED_EXTENSIONS, checkContent, contentTypeFor, extensionOf, sanitizeFileName } from '../attachments/filetypes.ts';
import { readScanner } from '../attachments/config.ts';
import { formatBytes, Meter, readSettings, TooLargeError } from '../attachments/service.ts';
import { newStorageKey } from '../attachments/storage.ts';

export interface StoredFile { ok: true; id: string; fileName: string }
export interface RefusedFile { ok: false; fileName: string; reason: string }

export function canStoreFiles(ctx: ModuleContext): boolean {
  return ctx.app.hasDecorator('attachmentStores') && ctx.app.hasDecorator('fileScanner');
}

/** Stores one file on a ticket. Never throws for a refused file: says why instead. */
export async function storeTicketFile(
  ctx: ModuleContext,
  ticket: { id: string; ref?: string | null },
  file: { fileName: string; content: Buffer },
  by: { userId: string | null; name: string },
): Promise<StoredFile | RefusedFile> {
  const fileName = sanitizeFileName(file.fileName);
  if (!canStoreFiles(ctx)) return { ok: false, fileName, reason: 'files cannot be stored here' };
  const refuse = async (reason: string): Promise<RefusedFile> => {
    await ctx.audit(null, { action: 'attachment.refused', recordType: 'ticket', recordId: ticket.id, summary: `File from an email refused: ${fileName} (${reason})` });
    return { ok: false, fileName, reason };
  };
  const settings = await readSettings(ctx);
  const extension = extensionOf(fileName);
  if (!extension || BLOCKED_EXTENSIONS.has(extension) || !settings.allowedExtensions.includes(extension)) return refuse('type not allowed');
  if (file.content.length === 0) return refuse('empty');
  if (file.content.length > settings.maxBytes) return refuse(`larger than ${formatBytes(settings.maxBytes)}`);

  const storage = ctx.app.attachmentStores.current();
  const key = newStorageKey();
  const meter = new Meter(settings.maxBytes);
  try {
    await storage.put(key, Readable.from([file.content]).pipe(meter));
  } catch (err) {
    await storage.delete(key).catch(() => undefined);
    if (err instanceof TooLargeError) return refuse('too large');
    throw err;
  }
  const discard = async (reason: string) => { await storage.delete(key).catch(() => undefined); return refuse(reason); };
  const sha256 = meter.digest();
  const verdict = checkContent(extension, meter.head);
  if (!verdict.ok) return discard(verdict.code === 'executable' ? 'program or script' : 'content does not match the type');

  const scanner = ctx.app.fileScanner.current();
  let scan: { verdict: string; detail?: string };
  try {
    scan = await scanner.scan({ fileName, extension, size: meter.size, sha256, open: () => storage.get(key) });
  } catch (err) {
    scan = { verdict: 'error', detail: err instanceof Error ? err.message : 'scanner failed' };
  }
  if (scan.verdict === 'infected') return discard(`malware scanner ${scanner.name}: ${scan.detail ?? 'infected'}`);
  if (scan.verdict === 'error' && (await readScanner(ctx)).whenUnavailable === 'refuse') return discard(`malware scanner ${scanner.name} failed`);
  const scanned = scan.verdict === 'clean';
  const row = (await ctx.db.one<Row>(
    `insert into attachments (record_type, record_id, file_name, extension, content_type, size_bytes, sha256,
       storage_driver, storage_key, kind, scan_status, scan_engine, scanned_at, uploaded_by_name, created_by, updated_by)
     values ('ticket',$1,$2,$3,$4,$5,$6,$7,$8,'file',$9,$10,${scanned ? 'now()' : 'null'},$11,$12,$12) returning id`,
    [ticket.id, fileName, extension, contentTypeFor(extension), meter.size, sha256, storage.driver, key,
      scanned ? 'clean' : 'not_scanned', scanned ? scanner.name : null, by.name.slice(0, 200), by.userId],
  ))!;
  await ctx.audit(null, {
    action: 'attachment.upload', recordType: 'ticket', recordId: ticket.id,
    summary: `File attached from an email: ${fileName} (${formatBytes(meter.size)})`,
    after: { attachment_id: row.id, file_name: fileName, size_bytes: meter.size, scan_status: scanned ? 'clean' : 'not_scanned' },
  });
  return { ok: true, id: row.id, fileName };
}

