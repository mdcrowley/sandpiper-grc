// Controlled-copy stamping of a file-only PDF version (E43-08): every page gets the control block (a
// header with the document number and title, "Restricted distribution" when it is restricted, a footer
// with the version, effective date, page x of y and "Uncontrolled when printed") and, when it applies,
// a DRAFT, SUPERSEDED or OBSOLETE watermark. pdf-lib (MIT) reads the original inside the sandbox
// (sandbox.ts), never in the server process; the block is drawn by PDFKit in the application's own
// embedded Arimo font (core/export/fonts), never a standard font.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSandboxed } from './sandbox.ts';

const FONTS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../core/export/fonts');
export const STAMP_MAX_PAGES = 2_000;
export const STAMP_MAX_BYTES = 100 * 1024 * 1024;

export interface StampOptions {
  /** Top line, for example "SOP-IT-014 · Network change procedure · Rev. C". */
  header: string;
  /** Bottom line; `{page}` and `{pages}` are replaced on each page. */
  footer: string;
  watermark?: 'DRAFT' | 'SUPERSEDED' | 'OBSOLETE' | null;
  /** Adds "Restricted distribution" to the top line. */
  restricted?: boolean;
}

export class StampError extends Error {
  constructor(message: string, public code: string) { super(message); }
}

/** The PDF with the control block on every page. Throws StampError when the PDF cannot be stamped. */
export async function stampPdf(bytes: Buffer, options: StampOptions, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  if (bytes.length > STAMP_MAX_BYTES) throw new StampError(`PDFs larger than ${STAMP_MAX_BYTES / 1024 / 1024} MB are not stamped.`, 'too_large');
  const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 400);
  const r = await runSandboxed<{ bytes: Uint8Array; pages: number }>('stamp', bytes, {
    maxPages: STAMP_MAX_PAGES, fontRegular: resolve(FONTS, 'Arimo-Regular.ttf'), fontBold: resolve(FONTS, 'Arimo-Bold.ttf'),
    options: { header: clean(options.header), footer: clean(options.footer), watermark: options.watermark ?? null, restricted: !!options.restricted },
  }, opts);
  if (!r.ok) {
    throw new StampError(r.code === 'encrypted' ? 'The PDF is protected by a password, so it cannot be stamped.' : `The PDF could not be stamped (${r.error}).`, r.code ?? 'stamp_failed');
  }
  return Buffer.from(r.result.bytes.buffer, r.result.bytes.byteOffset, r.result.bytes.byteLength);
}
