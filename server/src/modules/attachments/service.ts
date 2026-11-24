// Shared pieces of the attachments module: settings, the upload meter, validation of the
// descriptive fields, and the shape of an attachment as the API returns it.
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { fileURLToPath } from 'node:url';
import type { ModuleContext, Row } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import {
  BLOCKED_EXTENSIONS, DEFAULT_ALLOWED_EXTENSIONS, HEAD_BYTES, isValidExtension, normalizeExtensions, previewKind, typeGroup,
} from './filetypes.ts';

export const SETTING_MAX_BYTES = 'attachments.max_bytes';
export const SETTING_EXTENSIONS = 'attachments.allowed_extensions';
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;
const MB = 1024 * 1024;
export const MAX_MB_CEILING = 2048;

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The data folder this application instance uses. Core passes it as `ctx.dataDir` when it
 * has been wired in; until then it is worked out the same way server/src/main.ts does.
 * Under the test runner it is always memory, so tests can never write into a real folder.
 */
export function dataDirFor(ctx: ModuleContext): string {
  const fromCore = (ctx as ModuleContext & { dataDir?: string }).dataDir;
  if (fromCore) return fromCore;
  if (process.env.VITEST) return 'memory';
  return process.env.GRC_DATA_DIR ?? resolve(here, '../../../../data');
}

export interface FileSettings { maxBytes: number; allowedExtensions: string[] }

export async function readSettings(ctx: ModuleContext): Promise<FileSettings> {
  const rawMax = Number(await ctx.settings.get<unknown>(SETTING_MAX_BYTES, DEFAULT_MAX_BYTES));
  const maxBytes = Number.isFinite(rawMax) && rawMax >= 1 ? Math.min(rawMax, MAX_MB_CEILING * MB) : DEFAULT_MAX_BYTES;
  const raw = await ctx.settings.get<unknown>(SETTING_EXTENSIONS, DEFAULT_ALLOWED_EXTENSIONS);
  // A blocked type stays blocked even if the stored setting has been edited by hand.
  const allowedExtensions = normalizeExtensions(raw).filter((e) => isValidExtension(e) && !BLOCKED_EXTENSIONS.has(e));
  return { maxBytes, allowedExtensions };
}

/** Validates a settings change. Returns what to store, or throws a 400 with a message per field. */
export function validateSettings(ctx: ModuleContext, body: Row): Partial<{ maxBytes: number; allowedExtensions: string[] }> {
  const fields: Record<string, string> = {};
  const out: Partial<{ maxBytes: number; allowedExtensions: string[] }> = {};
  if (body.maxMb !== undefined) {
    const mb = Number(body.maxMb);
    if (!Number.isInteger(mb) || mb < 1 || mb > MAX_MB_CEILING) fields.maxMb = `Enter a whole number of megabytes from 1 to ${MAX_MB_CEILING}.`;
    else out.maxBytes = mb * MB;
  }
  if (body.allowedExtensions !== undefined) {
    const list = normalizeExtensions(body.allowedExtensions);
    const bad = list.filter((e) => !isValidExtension(e));
    const blocked = list.filter((e) => BLOCKED_EXTENSIONS.has(e));
    if (!list.length) fields.allowedExtensions = 'List at least one file type.';
    else if (bad.length) fields.allowedExtensions = `Not a file type: ${bad.join(', ')}. Use letters and numbers only, for example pdf.`;
    else if (blocked.length) fields.allowedExtensions = `Programs and scripts can never be allowed: ${blocked.join(', ')}.`;
    else out.allowedExtensions = list;
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  return out;
}

export class TooLargeError extends Error {}

/** Counts, hashes and keeps the first bytes of a stream as it passes; fails once over the limit. */
export class Meter extends Transform {
  size = 0;
  private readonly hash = createHash('sha256');
  private readonly parts: Buffer[] = [];
  private kept = 0;
  private readonly max: number;

  constructor(max: number) {
    super();
    this.max = max;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.size += chunk.length;
    if (this.size > this.max) return done(new TooLargeError());
    this.hash.update(chunk);
    if (this.kept < HEAD_BYTES) {
      const part = Buffer.from(chunk.subarray(0, HEAD_BYTES - this.kept));
      this.parts.push(part);
      this.kept += part.length;
    }
    done(null, chunk);
  }

  get head(): Buffer {
    return Buffer.concat(this.parts);
  }

  digest(): string {
    return this.hash.digest('hex');
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} bytes`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
}

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export interface Descriptive { kind: 'file' | 'evidence'; description: string | null; collected_on: string | null; expires_on: string | null }

/**
 * Validates kind, description and the evidence dates. `existing` is the current row when
 * updating, so that a partial change is checked against what is already stored.
 */
export function validateDescriptive(ctx: ModuleContext, input: Row, existing?: Row): Descriptive {
  const fields: Record<string, string> = {};
  const pick = (name: string) => (input[name] !== undefined ? input[name] : existing?.[name]);

  const kind = String(pick('kind') ?? 'file');
  if (kind !== 'file' && kind !== 'evidence') fields.kind = 'Choose "file" or "evidence".';

  const rawDescription = pick('description');
  const description = rawDescription === null || rawDescription === undefined ? '' : String(rawDescription).trim();
  if (description.length > 2000) fields.description = 'Keep the description under 2,000 characters.';

  let collected: string | null = null;
  let expires: string | null = null;
  if (kind === 'evidence') {
    const today = todayInZone();
    const c = pick('collected_on');
    const e = pick('expires_on');
    if (c === null || c === undefined || c === '') collected = today;
    else if (!isDate(c)) fields.collected_on = 'Collected on must be a date (YYYY-MM-DD).';
    else if (c > today) fields.collected_on = 'Collected on cannot be in the future.';
    else collected = c;
    if (e !== null && e !== undefined && e !== '') {
      if (!isDate(e)) fields.expires_on = 'Expires on must be a date (YYYY-MM-DD).';
      else if (collected && e < collected) fields.expires_on = 'Expires on cannot be before the date the evidence was collected.';
      else expires = e;
    }
  }
  if (Object.keys(fields).length) ctx.fail(400, 'validation', 'Check the highlighted fields.', fields);
  return { kind: kind as Descriptive['kind'], description: description || null, collected_on: collected, expires_on: expires };
}

/** An attachment as the API returns it. The storage key never leaves the server. */
export function present(row: Row): Row {
  const link = row.storage_driver === 'link';
  return {
    id: row.id,
    record_type: row.record_type,
    record_id: row.record_id,
    file_name: row.file_name,
    extension: row.extension,
    type_group: link ? 'link' : typeGroup(row.extension),
    // Evidence by link (E36-05): an address kept elsewhere, never fetched by the server.
    is_link: link,
    link_url: link ? row.link_url ?? null : null,
    link_title: link ? row.link_title ?? null : null,
    last_checked_on: link ? row.last_checked_on ?? null : null,
    checked_by_name: link ? row.checked_by_name ?? null : null,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    kind: row.kind,
    description: row.description,
    collected_on: row.collected_on,
    expires_on: row.expires_on,
    scan_status: row.scan_status,
    scan_engine: row.scan_engine,
    uploaded_by: row.created_by,
    uploaded_by_name: row.uploaded_by_name,
    uploaded_at: row.created_at,
    updated_at: row.updated_at,
    // E41-16: 'image' or 'pdf' when the file can be shown in the browser (GET /api/attachments/:id/preview).
    preview: link ? null : previewKind(row.extension, row.content_type),
  };
}
