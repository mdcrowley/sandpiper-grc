// Word (.docx) to Markdown (E43-06): mammoth (BSD-2-Clause) reads the document into HTML with a style
// map, turndown with its GFM plugin (MIT) writes Markdown with tables. Both run in the sandbox
// (sandbox.ts); this file only shapes the result and the conversion report. Nothing is stored here.
import { runSandboxed } from './sandbox.ts';
import { SANDBOX_MAX_UNPACKED } from './sandbox.ts';

export const CONVERTER = 'mammoth + turndown (GFM tables)';
/** The largest Word file converted. */
export const CONVERT_MAX_BYTES = 50 * 1024 * 1024;

export interface ConvertedImage { n: number; contentType: string; alt: string; bytes: Uint8Array }

export interface ConversionReport {
  converter: string;
  file_name: string;
  /** converted: the text is the Markdown; file_only: the original is the text (PDF, legacy .doc, others). */
  status: 'converted' | 'file_only';
  tracked_changes: boolean;
  comments: number;
  images: number;
  image_attachment_ids: string[];
  /** Kinds of content left out: text boxes, SmartArt, charts, embedded objects, headers and footers, comments. */
  dropped: string[];
  warnings: string[];
  /** Hints found in headers and footers, offered as metadata, never applied by themselves. */
  suggested: { version_label?: string; effective_on?: string; doc_number?: string };
  /** For a file-only version: why it was not converted and what search can find. */
  note?: string;
  scanned?: boolean;
}

export type ConvertOutcome =
  | { ok: true; markdown: string; images: ConvertedImage[]; report: ConversionReport }
  | { ok: false; status: number; code: string; message: string };

interface WorkerResult { markdown: string; images: ConvertedImage[]; report: Pick<ConversionReport, 'tracked_changes' | 'comments' | 'dropped' | 'warnings' | 'suggested'> }

/** Converts a Word file's bytes. Tracked changes are reported, not refused: the caller decides. */
export async function convertDocx(bytes: Buffer, fileName: string, opts: { timeoutMs?: number; maxMemoryMb?: number; maxUnpacked?: number } = {}): Promise<ConvertOutcome> {
  if (bytes.length > CONVERT_MAX_BYTES) return { ok: false, status: 413, code: 'too_large', message: `Word files larger than ${CONVERT_MAX_BYTES / 1024 / 1024} MB are not converted. Keep it as a file-only version.` };
  const r = await runSandboxed<WorkerResult>('docx', bytes, { maxUnpacked: opts.maxUnpacked ?? SANDBOX_MAX_UNPACKED }, opts);
  if (!r.ok) {
    if (r.code === 'not_word') return { ok: false, status: 422, code: 'not_word', message: 'This is not a Word document that can be converted (save it as .docx in Word).' };
    if (r.code === 'too_large') return { ok: false, status: 422, code: 'too_large', message: `The Word file could not be converted: ${r.error}.` };
    if (r.code === 'memory' || r.code === 'time') return { ok: false, status: 422, code: 'conversion_stopped', message: `The Word file could not be converted: it ${r.code === 'time' ? r.error : 'needed too much memory'}. Keep it as a file-only version.` };
    return { ok: false, status: 422, code: 'conversion_failed', message: `The Word file could not be converted (${r.error}). Keep it as a file-only version.` };
  }
  const w = r.result;
  const report: ConversionReport = {
    converter: CONVERTER, file_name: fileName, status: 'converted',
    tracked_changes: w.report.tracked_changes, comments: w.report.comments, images: w.images.length, image_attachment_ids: [],
    dropped: w.report.dropped, warnings: [...w.report.warnings], suggested: w.report.suggested,
  };
  if (report.tracked_changes) report.warnings.unshift('The document has tracked changes. Accept or reject the changes in Word first; converted as is, insertions are kept and deletions left out.');
  if (report.comments) report.warnings.push(`${report.comments} comment${report.comments === 1 ? ' was' : 's were'} left out.`);
  if (report.dropped.some((d) => d !== 'comments')) report.warnings.push(`Left out: ${report.dropped.filter((d) => d !== 'comments').join(', ')}. Check the text against the original.`);
  return { ok: true, markdown: w.markdown, images: w.images, report };
}

/** The report for a file kept as it is: a PDF (its text is read for search), a legacy .doc, anything else. */
export function fileOnlyReport(fileName: string, extension: string): ConversionReport {
  const ext = extension.toLowerCase();
  const note = ext === 'pdf'
    ? 'Kept as a PDF. Its text is read for search; a scanned PDF with no text is found by title and number only.'
    : ext === 'doc'
      ? 'Could not convert: this is a Word 97-2003 file (.doc). Open it in Word and save it as .docx to convert it. It is kept as the original file, found by title and number only.'
      : `Could not convert: .${ext || '?'} files are kept as the original file only, found by title and number.`;
  return {
    converter: CONVERTER, file_name: fileName, status: 'file_only', tracked_changes: false, comments: 0, images: 0, image_attachment_ids: [],
    dropped: [], warnings: ext === 'pdf' ? [] : [note], suggested: {}, note,
  };
}
