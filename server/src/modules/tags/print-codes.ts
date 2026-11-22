// The codes a printed tag can carry (E37-08): a Code 128 barcode, a QR code or a Data Matrix code,
// each holding the tag value and nothing else. Encoding is done by bwip-js (MIT; pure JavaScript, no
// network, no native parts), which covers all three symbologies; this file turns its output into the
// plain module grid the PDF and the ZPL renderers both draw, so both outputs carry the same symbol.
import bwipjs from 'bwip-js';
import type { LabelCode } from '../../../../shared/asset-tags-api.ts';

/** A linear symbol: one entry per module across, true where it is a bar. Quiet zones not included. */
export interface LinearSymbol { kind: 'linear'; modules: boolean[]; quiet: number }
/** A 2D symbol: `rows` × `cols` modules, row-major, true where dark. Quiet zone not included. */
export interface MatrixSymbol { kind: 'matrix'; cols: number; rows: number; dark: boolean[]; quiet: number }
export type CodeSymbol = LinearSymbol | MatrixSymbol;

/** Quiet zones, in modules, on each side (ISO/IEC 15417: 10; ISO/IEC 18004: 4; ISO/IEC 16022: 1, doubled here for cameras). */
export const QUIET_ZONE: Record<Exclude<LabelCode, 'none'>, number> = { code128: 10, qr: 4, datamatrix: 2 };

/** Codes refuse anything that reads as an address, so a tag never sends a phone anywhere (spec §3.5). */
export function looksLikeAddress(value: string): boolean {
  const v = value.trim().toLowerCase();
  return /^[a-z][a-z0-9+.-]*:/.test(v) || v.includes('://') || v.startsWith('www.') || /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v);
}

export class CodeError extends Error {
  constructor(public code: 'address' | 'characters' | 'too_long', message: string) { super(message); }
}

/**
 * Encodes a value. Throws CodeError when the value cannot go in a code: it looks like an address, it
 * holds characters outside printable ASCII (the codes and handheld scanners read those reliably), or
 * the symbology cannot hold it.
 */
export function encode(code: Exclude<LabelCode, 'none'>, value: string): CodeSymbol {
  if (looksLikeAddress(value)) throw new CodeError('address', `"${value}" looks like a web or email address, and a tag's code never holds an address.`);
  if (!/^[\x20-\x7e]+$/.test(value)) throw new CodeError('characters', `"${value}" holds characters a code on a tag cannot carry (use letters, digits and common punctuation).`);
  try {
    if (code === 'code128') {
      const [r] = bwipjs.raw({ bcid: 'code128', text: value }) as Array<{ sbs: number[] }>;
      const modules: boolean[] = [];
      r.sbs.forEach((w, i) => { for (let k = 0; k < w; k += 1) modules.push(i % 2 === 0); });
      return { kind: 'linear', modules, quiet: QUIET_ZONE.code128 };
    }
    const bcid = code === 'qr' ? 'qrcode' : 'datamatrix';
    // QR: error correction level M (15 %), the usual choice for labels. Data Matrix: square symbol.
    const opts = code === 'qr' ? { bcid, text: value, eclevel: 'M' } : { bcid, text: value };
    const [r] = bwipjs.raw(opts as never) as Array<{ pixs: number[]; pixx: number; pixy: number }>;
    return { kind: 'matrix', cols: r.pixx, rows: r.pixy, dark: r.pixs.map((p) => p === 1), quiet: QUIET_ZONE[code] };
  } catch (err) {
    throw new CodeError('too_long', `"${value}" cannot be put in a ${codeName(code)}: ${err instanceof Error ? err.message.replace(/^bwipp\.\w+#?\d*:\s*/i, '') : 'encoding failed'}.`);
  }
}

export function codeName(code: LabelCode): string {
  return code === 'code128' ? 'Code 128 barcode' : code === 'qr' ? 'QR code' : code === 'datamatrix' ? 'Data Matrix code' : 'text only';
}

/** Modules across, quiet zones included. */
export function symbolWidth(s: CodeSymbol): number {
  return (s.kind === 'linear' ? s.modules.length : s.cols) + 2 * s.quiet;
}
/** Modules down for a 2D symbol, quiet zone included. */
export function symbolHeight(s: MatrixSymbol): number {
  return s.rows + 2 * s.quiet;
}

/** Runs of dark modules in one row: [start, length] pairs (for drawing as few rectangles as possible). */
export function darkRuns(row: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= row.length; i += 1) {
    const d = i < row.length && row[i];
    if (d && start < 0) start = i;
    else if (!d && start >= 0) { out.push([start, i - start]); start = -1; }
  }
  return out;
}

export function matrixRow(s: MatrixSymbol, y: number): boolean[] {
  return s.dark.slice(y * s.cols, (y + 1) * s.cols);
}
