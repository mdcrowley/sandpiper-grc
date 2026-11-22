// Printed tags for thermal label printers (E37-08): ZPL, the command language most label printers
// accept, for roll layouts. One label format (^XA ... ^XZ) per tag, drawn from the same plan as the
// PDF (print-label.ts), so the fields and their sizes match:
//  - the value and the line above in the printer's scalable font 0, centered in the same area, with
//    the baseline where the PDF has it (^FT with a one-line ^FB field block);
//  - the code drawn as filled boxes (^GB), module by module from the same encoding as the PDF, with
//    every module a whole number of printer dots (never smaller than planned when the label allows);
//  - the logo as a one-bit graphic (^GFA) fitted into its box, when it is a PNG.
// Field data goes through ^FH, so ^, ~, _ and \ in a value are sent as hexadecimal and can never be
// read as commands.
import { inflateSync } from 'node:zlib';
import { darkRuns, matrixRow } from './print-codes.ts';
import { LEGIBILITY, type LabelPlan, type TextPlacement } from './print-label.ts';

export const ZPL_DPI = [203, 300, 600] as const;
export type ZplDpi = (typeof ZPL_DPI)[number];

const dots = (mm: number, dpmm: number) => Math.round(mm * dpmm);

/** Field data with every character that could be read as a command sent as _hh (^FH). */
export function zplField(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (ch === '^' || ch === '~' || ch === '_' || ch === '\\' || c < 0x20 || c === 0x7f) out += `_${c.toString(16).padStart(2, '0').toUpperCase()}`;
    else out += ch; // other characters as UTF-8 (^CI28)
  }
  return out;
}

function textField(t: TextPlacement, dpmm: number): string {
  const h = Math.max(10, dots(t.fontSize, dpmm));
  const x = dots(t.x, dpmm);
  const w = Math.max(1, dots(t.width, dpmm));
  return `^FT${x},${dots(t.baseline, dpmm)}^A0N,${h},${h}^FB${w},1,0,C^FH^FD${zplField(t.text)}^FS`;
}

/** Module size in whole dots: as planned, rounded, but not below the legibility minimum when there is room. */
export function moduleDots(moduleMm: number, symbolModules: number, availableMm: number, dpmm: number, minMm: number): number {
  let m = Math.max(1, Math.round(moduleMm * dpmm));
  const room = Math.floor((availableMm * dpmm) / symbolModules);
  if (m > room) m = Math.max(1, room);
  while (m / dpmm < minMm - 1e-9 && (m + 1) <= room) m += 1;
  return m;
}

function codeFields(plan: LabelPlan, dpmm: number): string[] {
  const c = plan.code;
  if (!c) return [];
  const out: string[] = [];
  const sym = c.symbol;
  if (sym.kind === 'linear') {
    const total = sym.modules.length + 2 * sym.quiet;
    const plannedW = total * c.module;
    const m = moduleDots(c.module, total, plannedW, dpmm, LEGIBILITY.linearModuleMinMm);
    const x0 = dots(c.x, dpmm) + Math.round((plannedW * dpmm - total * m) / 2) + sym.quiet * m;
    const y0 = dots(c.y, dpmm);
    const h = dots(c.height, dpmm);
    for (const [s, n] of darkRuns(sym.modules)) out.push(`^FO${x0 + s * m},${y0}^GB${n * m},${h},${n * m}^FS`);
  } else {
    const total = sym.cols + 2 * sym.quiet;
    const plannedW = c.height;
    const m = moduleDots(c.module, total, plannedW, dpmm, LEGIBILITY.matrixModuleMinMm);
    const pad = Math.round((plannedW * dpmm - total * m) / 2);
    const x0 = dots(c.x, dpmm) + pad + sym.quiet * m;
    const y0 = dots(c.y, dpmm) + pad + sym.quiet * m;
    for (let y = 0; y < sym.rows; y += 1) {
      for (const [s, n] of darkRuns(matrixRow(sym, y))) out.push(`^FO${x0 + s * m},${y0 + y * m}^GB${n * m},${m},${Math.min(n * m, m)}^FS`);
    }
  }
  return out;
}

// ---------- the logo: PNG to a one-bit graphic ----------

export interface Bitmap { width: number; height: number; /** row-major, true = black */ black: boolean[] }

/**
 * Decodes a PNG (any color type, bit depths 1 to 16, not interlaced) to black and white: each pixel
 * over a white background, black where it is darker than mid-gray. Null when it cannot be read.
 */
export function pngToBitmap(png: Buffer): Bitmap | null {
  try {
    if (png.length < 33 || png.readUInt32BE(0) !== 0x89504e47) return null;
    let off = 8;
    let width = 0; let height = 0; let depth = 0; let color = 0; let interlace = 0;
    let palette: Buffer | null = null; let trns: Buffer | null = null;
    const idat: Buffer[] = [];
    while (off + 8 <= png.length) {
      const len = png.readUInt32BE(off);
      const type = png.toString('latin1', off + 4, off + 8);
      const data = png.subarray(off + 8, off + 8 + len);
      if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12]; }
      else if (type === 'PLTE') palette = data;
      else if (type === 'tRNS') trns = data;
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      off += 12 + len;
    }
    if (!width || !height || interlace || width * height > 4_000_000) return null;
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color as 0 | 2 | 3 | 4 | 6];
    if (!channels) return null;
    const bpp = Math.max(1, (channels * depth) / 8);
    const stride = Math.ceil((width * channels * depth) / 8);
    const raw = inflateSync(Buffer.concat(idat));
    const cur = Buffer.alloc(stride);
    const prev = Buffer.alloc(stride);
    const black: boolean[] = new Array(width * height).fill(false);
    const sample = (row: Buffer, i: number): number => {
      // The i-th sample of a row, scaled to 0..255.
      if (depth === 8) return row[i];
      if (depth === 16) return row[i * 2];
      const per = 8 / depth;
      const byte = row[Math.floor(i / per)];
      const shift = 8 - depth * ((i % per) + 1);
      const v = (byte >> shift) & ((1 << depth) - 1);
      return color === 3 ? v : Math.round((v * 255) / ((1 << depth) - 1));
    };
    for (let y = 0; y < height; y += 1) {
      const base = y * (stride + 1);
      const filter = raw[base];
      for (let i = 0; i < stride; i += 1) {
        const x = raw[base + 1 + i];
        const a = i >= bpp ? cur[i - Math.floor(bpp)] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - Math.floor(bpp)] : 0;
        let v = x;
        if (filter === 1) v = x + a;
        else if (filter === 2) v = x + b;
        else if (filter === 3) v = x + Math.floor((a + b) / 2);
        else if (filter === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        cur[i] = v & 0xff;
      }
      for (let px = 0; px < width; px += 1) {
        let r: number; let g: number; let bl: number; let alpha = 255;
        if (color === 3) {
          const idx = sample(cur, px);
          r = palette?.[idx * 3] ?? 0; g = palette?.[idx * 3 + 1] ?? 0; bl = palette?.[idx * 3 + 2] ?? 0;
          if (trns && idx < trns.length) alpha = trns[idx];
        } else if (color === 0 || color === 4) {
          r = g = bl = sample(cur, px * channels);
          if (color === 4) alpha = sample(cur, px * channels + 1);
        } else {
          r = sample(cur, px * channels); g = sample(cur, px * channels + 1); bl = sample(cur, px * channels + 2);
          if (color === 6) alpha = sample(cur, px * channels + 3);
        }
        const lum = 0.299 * r + 0.587 * g + 0.114 * bl;
        const onWhite = (lum * alpha + 255 * (255 - alpha)) / 255;
        black[y * width + px] = onWhite < 128;
      }
      cur.copy(prev);
    }
    return { width, height, black };
  } catch {
    return null;
  }
}

/** A bitmap fitted into a box (keeping its proportions, nearest pixel) as a ^GFA graphic field. */
export function graphicField(bmp: Bitmap, boxW: number, boxH: number, x: number, y: number, align: 'left' | 'center'): string | null {
  const scale = Math.min(boxW / bmp.width, boxH / bmp.height);
  const w = Math.max(1, Math.floor(bmp.width * scale));
  const h = Math.max(1, Math.floor(bmp.height * scale));
  if (w < 2 || h < 2) return null;
  const bytesPerRow = Math.ceil(w / 8);
  let hex = '';
  for (let yy = 0; yy < h; yy += 1) {
    const sy = Math.min(bmp.height - 1, Math.floor(yy / scale));
    for (let bx = 0; bx < bytesPerRow; bx += 1) {
      let byte = 0;
      for (let k = 0; k < 8; k += 1) {
        const xx = bx * 8 + k;
        if (xx < w && bmp.black[sy * bmp.width + Math.min(bmp.width - 1, Math.floor(xx / scale))]) byte |= 0x80 >> k;
      }
      hex += byte.toString(16).padStart(2, '0').toUpperCase();
    }
  }
  const total = bytesPerRow * h;
  const ox = x + (align === 'center' ? Math.floor((boxW - w) / 2) : 0);
  const oy = y + Math.floor((boxH - h) / 2);
  return `^FO${ox},${oy}^GFA,${total},${total},${bytesPerRow},${hex}^FS`;
}

export interface ZplInput {
  plans: LabelPlan[];
  dpi: ZplDpi;
  logo: Bitmap | null;
  /** Alignment test: the label's outline is printed around the sample. */
  test?: boolean;
}

/** One ZPL label format per plan, in order. */
export function renderZpl(input: ZplInput): string {
  const dpmm = input.dpi / 25.4;
  const out: string[] = [];
  for (const plan of input.plans) {
    const w = dots(plan.width, dpmm);
    const h = dots(plan.height, dpmm);
    const lines = ['^XA', '^CI28', `^PW${w}`, `^LL${h}`, '^LH0,0'];
    if (input.test) lines.push(`^FO0,0^GB${w},${h},2^FS`);
    if (plan.logo && input.logo) {
      const g = graphicField(input.logo, dots(plan.logo.width, dpmm), dots(plan.logo.height, dpmm), dots(plan.logo.x, dpmm), dots(plan.logo.y, dpmm), plan.topLine ? 'left' : 'center');
      if (g) lines.push(g);
    }
    if (plan.topLine) lines.push(textField(plan.topLine, dpmm));
    lines.push(...codeFields(plan, dpmm));
    lines.push(textField(plan.value, dpmm));
    lines.push('^PQ1', '^XZ');
    out.push(lines.join('\n'));
  }
  return `${out.join('\n')}\n`;
}
