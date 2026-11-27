// Document files (E43-06, E43-07, E43-08): converting a Word original to Markdown with its images kept
// as files on the document, the conversion preview, copying a PDF original's text into the document's
// search text once the attachments text job has read it, and the controlled-copy stamp.
//
// The document's own routes (developer A's versions routes) reach this through two decorators:
// `app.convertDocument` (a .docx attached to a record → Markdown + report, images stored on the same
// record) and `app.stampPdf`. Everything that parses a file runs in the sandbox (sandbox.ts).
import { Readable } from 'node:stream';
import type { FastifyRequest } from 'fastify';
import { inTrial } from '../../../core/db.ts';
import { UUID_RE } from '../../../core/errors.ts';
import { scheduleWork } from '../../../core/jobs/index.ts';
import type { ModuleContext, Row } from '../../../core/module.ts';
import { canReceiveFiles, insertAttachment, prepareFile, receiveFile, type Received } from '../../attachments/intake.ts';
import { readUploadBytes } from '../../attachments/uploads.ts';
import { setSearchTextFromFile } from '../search.ts';
import { convertDocx, CONVERT_MAX_BYTES, fileOnlyReport, type ConversionReport, type ConvertedImage } from './docx.ts';
import { stampPdf, type StampOptions } from './stamp.ts';

export { convertDocx, fileOnlyReport, type ConversionReport } from './docx.ts';
export { stampPdf, StampError, type StampOptions } from './stamp.ts';

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp', 'image/tiff': 'tif',
};
const TEXT_SYNC_KEY = 'policies.file_text_synced_at';
const TEN_MINUTES = 10 * 60_000;

/** The stored bytes of an attachment row (at most `max`). */
async function storedBytes(ctx: ModuleContext, att: Row, max: number): Promise<Buffer> {
  if (Number(att.size_bytes) > max) ctx.fail(413, 'too_large', `Files larger than ${Math.round(max / 1024 / 1024)} MB are not converted.`);
  const chunks: Buffer[] = [];
  for await (const c of await ctx.app.attachmentStores.forDriver(att.storage_driver).get(att.storage_key)) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/**
 * Stores the images of a converted document as files on its record, each through the usual intake
 * (type, content check, malware scanner), and puts their ids into the Markdown. An image of a type
 * that is not allowed (Windows metafiles, for example) is left out and reported.
 */
async function storeImages(ctx: ModuleContext, req: FastifyRequest, markdown: string, images: ConvertedImage[], owner: { recordType: string; recordId: string; fileName: string }, report: ConversionReport): Promise<string> {
  let out = markdown;
  let refused = 0;
  for (const img of images) {
    const ext = IMAGE_EXT[img.contentType.toLowerCase()];
    let id: string | null = null;
    if (ext && !inTrial()) {
      const prepared = await prepareFile(ctx, `${owner.fileName.replace(/\.[^.]+$/, '')}-image-${img.n}.${ext}`);
      if (prepared.ok) {
        const received = await receiveFile(ctx, prepared.file, Readable.from([Buffer.from(img.bytes)]), img.bytes.length);
        if (received.ok) {
          const row = await insertAttachment(ctx.db, received.file as Received, {
            recordType: owner.recordType, recordId: owner.recordId, kind: 'file',
            description: `Image ${img.n} from ${owner.fileName}${img.alt ? `: ${img.alt.slice(0, 300)}` : ''}`,
            uploadedByName: req.user?.displayName ?? null, userId: req.user?.id ?? null,
          });
          id = row.id as string;
        }
      }
    }
    if (id) {
      report.image_attachment_ids.push(id);
      out = out.split(`(attachment:pending-${img.n})`).join(`(attachment:${id})`);
    } else {
      refused += 1;
      out = out.replace(new RegExp(`!\\[[^\\]]*\\]\\(attachment:pending-${img.n}\\)`, 'g'), img.alt ? `*[Image: ${img.alt.replace(/[*_[\]]/g, '')}]*` : '');
    }
  }
  if (refused) report.warnings.push(`${refused} image${refused === 1 ? ' was' : 's were'} of a type that cannot be shown or stored (for example a Windows metafile) and ${refused === 1 ? 'was' : 'were'} left out.`);
  report.images = report.image_attachment_ids.length;
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

export interface ConvertInput { attachmentId: string; recordType: string; recordId: string; acceptAsIs?: boolean }

/**
 * Converts a .docx already attached to a record (the version's original). Images are stored on the
 * same record. Tracked changes are refused unless `acceptAsIs`. The caller has checked that the person
 * may change the record.
 */
export async function convertAttachment(ctx: ModuleContext, req: FastifyRequest, input: ConvertInput): Promise<{ markdown: string; report: ConversionReport }> {
  const att = UUID_RE.test(String(input.attachmentId ?? ''))
    ? await ctx.db.one<Row>(`select * from attachments where id = $1 and record_type = $2 and record_id = $3 and deleted_at is null and storage_driver <> 'link'`,
      [input.attachmentId, input.recordType, input.recordId])
    : undefined;
  if (!att) return ctx.fail(404, 'not_found', 'File not found on this document.');
  if (att.extension !== 'docx') return ctx.fail(422, 'not_convertible', `Only Word files (.docx) are converted. ${fileOnlyReport(att.file_name, att.extension).note}`);
  const bytes = await storedBytes(ctx, att, CONVERT_MAX_BYTES);
  const r = await convertDocx(bytes, att.file_name);
  if (!r.ok) return ctx.fail(r.status, r.code, r.message);
  // The version route passes the choice, or it is read from that request's own body (`accept_as_is`).
  const accept = input.acceptAsIs ?? ((req.body as Row | null)?.accept_as_is === true);
  if (r.report.tracked_changes && !accept) {
    return ctx.fail(422, 'tracked_changes', 'The Word file has tracked changes. Accept or reject them in Word and upload it again, or convert it as it is (insertions kept, deletions left out).');
  }
  const markdown = await storeImages(ctx, req, r.markdown, r.images, { recordType: input.recordType, recordId: input.recordId, fileName: att.file_name }, r.report);
  return { markdown, report: r.report };
}

/**
 * Copies the text the attachments text job has read from documents' PDF originals into their search
 * text, and marks a version whose original has no text at all as scanned. Works through the files
 * read since its last run.
 */
export async function syncFileTexts(ctx: ModuleContext): Promise<{ files: number; documents: number; scanned: number }> {
  const since = await ctx.settings.get<string | null>(TEXT_SYNC_KEY, null);
  const rows = await ctx.db.query<Row>(
    `select x.attachment_id, x.status, x.extracted_at from attachment_texts x join attachments a on a.id = x.attachment_id
     where a.record_type = 'policy' and a.deleted_at is null and x.status in ('indexed', 'empty')
       and ($1::timestamptz is null or x.extracted_at > $1::timestamptz)
     order by x.extracted_at limit 500`, [since]);
  let documents = 0;
  let scanned = 0;
  for (const r of rows) {
    if (r.status === 'empty') {
      const marked = await ctx.db.query(
        `update policy_versions set conversion = coalesce(conversion, '{}'::jsonb) || $2::jsonb
         where (source_attachment_id = $1 or rendition_attachment_id = $1) and content_kind = 'file' and not coalesce((conversion ->> 'scanned')::boolean, false) returning id`,
        [r.attachment_id, JSON.stringify({ scanned: true, note: 'Scanned: no text was found in this PDF, so it is found by title and number only (no OCR).' })]);
      scanned += marked.length;
    }
    documents += await setSearchTextFromFile(ctx, r.attachment_id);
  }
  if (rows.length) await ctx.settings.set(TEXT_SYNC_KEY, new Date(rows[rows.length - 1].extracted_at).toISOString());
  return { files: rows.length, documents, scanned };
}

export async function registerDocumentFiles(ctx: ModuleContext) {
  const { app } = ctx;

  if (!app.hasDecorator('convertDocument')) {
    app.decorate('convertDocument', (req: FastifyRequest, input: ConvertInput) => convertAttachment(ctx, req, input));
  }
  if (!app.hasDecorator('stampPdf')) app.decorate('stampPdf', (bytes: Buffer, opts: StampOptions) => stampPdf(bytes, opts));

  // Every ten minutes: PDF originals whose text has been read since (E43-07).
  await scheduleWork(ctx, 'policies.file_text_sync', () => syncFileTexts(ctx), { every: TEN_MINUTES, firstRunInMs: 200_000 });

  // The text read from a file version's original (a PDF, or a Word file kept as a file), for readers of
  // that version: what search finds, and what an assistant reads with read_document.
  app.get('/api/documents/:id/versions/:vid/text', { preHandler: ctx.requirePerm('policies.view') }, async (req) => {
    const p = req.params as Row;
    const policy = await ctx.resources.find('policy', p.id, req.user);
    if (!policy) return ctx.fail(404, 'not_found', 'Document not found.');
    const version = UUID_RE.test(String(p.vid ?? ''))
      ? await ctx.db.one<Row>('select id, status, content_kind, source_attachment_id, rendition_attachment_id, conversion from policy_versions where id = $1 and policy_id = $2', [p.vid, policy.id])
      : undefined;
    const editor = ctx.can(req.user, 'policies.edit') || ctx.can(req.user, 'policies.approve');
    if (!version || (!editor && !['published', 'superseded', 'withdrawn'].includes(version.status))) return ctx.fail(404, 'not_found', 'Version not found.');
    const files = [version.source_attachment_id, version.rendition_attachment_id].filter(Boolean);
    const row = files.length
      ? await ctx.db.one<Row>(
        `select x.status, x.detail, x.chars, x.content from attachment_texts x join attachments a on a.id = x.attachment_id
         where x.attachment_id = any($1::uuid[]) and a.deleted_at is null order by (x.status = 'indexed') desc, x.chars desc limit 1`, [files])
      : undefined;
    const max = Math.min(300_000, Math.max(1000, Number((req.query as Row).max_chars) || 100_000));
    const text = String(row?.content ?? '');
    return {
      status: !files.length ? 'no_file' : row ? row.status : 'waiting',
      detail: row?.detail ?? (files.length ? null : 'This version has no original file.'),
      scanned: row?.status === 'empty' || version.conversion?.scanned === true,
      chars: text.length, truncated: text.length > max, text: text.slice(0, max),
    };
  });
  ctx.describeRoute({
    method: 'GET', path: '/api/documents/:id/versions/:vid/text', tag: 'Documents', permission: 'policies.view',
    summary: "The text read from a version's original file (for search and assistants)",
    description: 'For readers of the version (drafts only for people who write or approve documents). `status`: indexed, empty (a scan with no text: `scanned` true), waiting (not read yet), failed, skipped or no_file. `max_chars` (default 100,000, at most 300,000).',
    query: { max_chars: 'Most characters returned.' },
    response: '{ status, detail, scanned, chars, truncated, text }',
  });

  // Preview of a conversion: nothing is saved (images are named, not stored).
  app.post('/api/documents/convert', { preHandler: ctx.requirePerm('policies.edit') }, async (req) => {
    const b = (req.body ?? {}) as Row;
    let bytes: Buffer;
    let fileName: string;
    let extension: string;
    if (b.upload_id) {
      if (!canReceiveFiles(ctx)) ctx.fail(503, 'files_unavailable', 'Files are not available in this installation.');
      const { upload, bytes: data } = await readUploadBytes(ctx, req, b.upload_id, CONVERT_MAX_BYTES);
      bytes = data; fileName = upload.file_name; extension = upload.extension;
    } else if (b.attachment_id) {
      const att = UUID_RE.test(String(b.attachment_id))
        ? await ctx.db.one<Row>(`select * from attachments where id = $1 and record_type = 'policy' and deleted_at is null and storage_driver <> 'link'`, [b.attachment_id])
        : undefined;
      // A file is reached only through a document the person may open.
      if (!att || !(await ctx.resources.find('policy', att.record_id, req.user))) ctx.fail(404, 'not_found', 'File not found.');
      bytes = await storedBytes(ctx, att!, CONVERT_MAX_BYTES); fileName = att!.file_name; extension = att!.extension;
    } else {
      return ctx.fail(400, 'validation', 'Give an upload_id or an attachment_id.', { upload_id: 'Give the finished upload, or a file on a document.' });
    }
    if (extension !== 'docx') return { markdown: '', report: fileOnlyReport(fileName, extension), images: [] };
    const r = await convertDocx(bytes, fileName);
    if (!r.ok) return ctx.fail(r.status, r.code, r.message);
    return {
      markdown: r.markdown, report: { ...r.report, would_refuse: r.report.tracked_changes && b.accept_as_is !== true },
      images: r.images.map((i) => ({ n: i.n, ref: `attachment:pending-${i.n}`, content_type: i.contentType, size: i.bytes.length, alt: i.alt })),
    };
  });
  ctx.describeRoute({
    method: 'POST', path: '/api/documents/convert', tag: 'Documents', permission: 'policies.edit',
    summary: 'Preview the Markdown a Word file converts to, with the conversion report (nothing is saved)',
    description: 'Body `{ upload_id? | attachment_id?, accept_as_is? }`: a finished chunked upload of yours, or a file on a document you may open. A .docx is converted in a sandboxed process (mammoth and turndown with GFM tables); images appear as `attachment:pending-N` and are stored only when the version is saved. Any other type answers an empty `markdown` and a `file_only` report saying why (a legacy .doc: save it as .docx). `report.would_refuse` is true when tracked changes would stop the save without `accept_as_is`.',
    body: { type: 'object', properties: { upload_id: { type: 'string' }, attachment_id: { type: 'string' }, accept_as_is: { type: 'boolean' } } },
    response: '{ markdown, report: { converter, file_name, status, tracked_changes, comments, images, dropped, warnings, suggested, note?, would_refuse }, images: [{ n, ref, content_type, size, alt }] }',
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    /** A .docx attached to a record, converted to Markdown with its images stored on the record (E43-06). */
    convertDocument(req: FastifyRequest, input: ConvertInput): Promise<{ markdown: string; report: ConversionReport }>;
    /** A PDF with the controlled-copy block and watermark on every page (E43-08). */
    stampPdf(bytes: Buffer, opts: StampOptions): Promise<Buffer>;
  }
}
