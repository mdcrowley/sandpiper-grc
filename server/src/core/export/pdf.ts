// Server-made PDF documents (PDFKit). One builder serves list exports, reports, dashboards,
// report packs and record fact sheets: headings, paragraphs, fact lists, tables that break across
// pages with the header row repeated, simple vector charts (bar, line, pie), page numbers and, for
// restricted content, a watermark on every page.
//
// Fonts: text that Windows-1252 covers (Western European languages) is printed in PDFKit's
// built-in Helvetica, so nothing is embedded. Any other text (Greek, Cyrillic, Hebrew, Arabic,
// Chinese, Japanese, Korean and so on) is printed in a TrueType or OpenType font from the machine,
// or from GRC_PDF_FONTS, with only the glyphs used embedded (see fonts.ts).
//
// Text that one font prints whole, left to right, goes straight to PDFKit. Text holding
// right-to-left characters, or mixing scripts that no single font covers, is laid out here (E12-16):
// each character takes a font that has it (the one before it when it can, so runs stay long), the
// text is broken into lines, and each line is put in display order by the bidirectional algorithm
// (fonts.ts) and printed run by run. Only a character that no available font has prints as "?".
import PDFDocument from 'pdfkit';
import { bidiClass, bidiLevels, isDirectionMark, mirrored, needsBidi, pdfFonts, visualOrder, type FontFace } from './fonts.ts';

export const PDF_TYPE = 'application/pdf';

const INK = '#14252b';
const MUTED = '#50626a';
const RULE = '#dbe3e5';
const BAND = '#edf2f3';
const BRAND = '#17656f';
const DANGER = '#951b1b';
export const SERIES = ['#2a78d6', '#eb6834', '#1aa976', '#c88800', '#e56c9a', '#008300', '#6250d6', '#e34948'];

// Windows-1252 characters above 0x7f that are not Latin-1 (the standard fonts can print these too).
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const standard = (ch: string, c: number) => c === 10 || (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(ch);

/** Line breaks, tabs, look-alike spaces and the minus sign made plain; control characters dropped. */
function clean(v: unknown): string {
  let s = '';
  for (const ch of String(v ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ')) {
    const c = ch.codePointAt(0)!;
    if (c === 0x2212) s += '-';
    else if (c === 0x2009 || c === 0x202f || c === 0x200b) s += ' ';
    else if (c < 0x20 && c !== 10) continue;
    else if (c >= 0x7f && c < 0xa0) continue;
    else s += ch;
  }
  return s;
}

/** Text the standard fonts can print: anything outside Windows-1252 becomes "?". */
export function printable(v: unknown): string {
  let s = '';
  for (const ch of clean(v)) s += standard(ch, ch.codePointAt(0)!) ? ch : '?';
  return s;
}

/**
 * The font for a piece of text, and the text as it will be printed. Windows-1252 text keeps the
 * standard font; other text takes the first embedded font that has every character, or else the
 * one with the most, and any character still missing becomes "?".
 */
export function fontFor(v: unknown, bold: boolean, fonts = pdfFonts()): { face: FontFace | null; text: string } {
  const s = clean(v);
  const chars = [...s];
  if (chars.every((ch) => standard(ch, ch.codePointAt(0)!))) return { face: null, text: s };
  const faces = fonts.map((f) => (bold ? f.bold : f.regular));
  // Spaces and line breaks are printed by any font: judge a font by the other characters.
  const needed = [...new Set(chars.map((ch) => ch.codePointAt(0)!).filter((c) => c !== 10 && c !== 0x20))];
  let best: FontFace | null = null;
  let bestScore = -1;
  for (const face of faces) {
    const score = needed.filter((c) => face.has(c)).length;
    if (score === needed.length) { best = face; bestScore = score; break; }
    if (score > bestScore) { best = face; bestScore = score; }
  }
  if (!best || bestScore === 0) return { face: null, text: printable(s) };
  const face = best;
  return { face, text: chars.map((ch) => { const c = ch.codePointAt(0)!; return c === 10 || c === 0x20 || face.has(c) ? ch : '?'; }).join('') };
}

const questionMarks = (s: string) => s.split('?').length - 1;

/**
 * True when a piece of text needs the run layout: it holds right-to-left characters, or the single
 * font `fontFor` would choose lacks some of its characters that another available font has.
 */
export function needsRuns(v: unknown, bold: boolean, fonts = pdfFonts()): boolean {
  const s = clean(v);
  if (needsBidi(s)) return true;
  const pick = fontFor(s, bold, fonts);
  if (questionMarks(pick.text) === questionMarks(s)) return false;
  const { out } = facesFor([...s], bold, fonts);
  return questionMarks(out.join('')) < questionMarks(pick.text);
}

/**
 * A font for each character: the one before it when that one has it (so runs stay long), otherwise
 * the standard font for Windows-1252 characters, otherwise the first embedded font that has it.
 * `out` is what is printed: "?" for a character no font has, nothing for a direction mark.
 */
export function facesFor(chars: string[], bold: boolean, fonts = pdfFonts()): { faces: (FontFace | null)[]; out: string[] } {
  const faces: (FontFace | null)[] = [];
  const out: string[] = [];
  const list = fonts.map((f) => (bold ? f.bold : f.regular));
  let prev: FontFace | null | undefined;
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (isDirectionMark(cp)) { faces.push(prev ?? null); out.push(''); continue; }
    const std = standard(ch, cp);
    let face: FontFace | null | undefined;
    if (prev !== undefined && (prev === null ? std : prev.has(cp))) face = prev;
    else if (std) face = null;
    else face = list.find((f) => f.has(cp));
    if (face === undefined) { faces.push(null); out.push('?'); prev = null; continue; }
    faces.push(face);
    out.push(ch);
    prev = face;
  }
  return { faces, out };
}

/** A piece of a printed line in one font and one direction. */
export interface TextRun {
  face: FontFace | null;
  /** The characters as they appear, left to right. */
  visual: string;
  /** The text handed to the font: `visual`, or reversed when the font lays its script out right to left itself. */
  text: string;
  width: number;
}
export interface TextLine { runs: TextRun[]; width: number; /** The paragraph reads right to left (its "left" alignment is the right edge). */ rtl: boolean }
export type MeasureRun = (face: FontFace | null, text: string) => number;

const isSpace = (ch: string) => { const c = bidiClass(ch.codePointAt(0)!); return c === 'WS' || c === 'S'; };
// Chinese, Japanese and Korean ideographs and kana may break between any two characters.
const breaksAnywhere = (ch: string) => { const c = ch.codePointAt(0)!; return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff9f) || (c >= 0x20000 && c <= 0x3ffff); };

/**
 * Lays text out in lines of runs: fonts per character, lines broken at spaces (and between
 * ideographs) to fit `width`, each line in display order. With `oneLine`, the text is kept on one
 * line and, when `width` is given and it does not fit, shortened with an ellipsis.
 */
export function layoutText(v: unknown, bold: boolean, measure: MeasureRun, opts: { width?: number; oneLine?: boolean; fonts?: ReturnType<typeof pdfFonts> } = {}): TextLine[] {
  const fonts = opts.fonts ?? pdfFonts();
  let s = clean(v);
  if (opts.oneLine) s = s.replace(/\n+/g, ' ');
  const lines: TextLine[] = [];
  for (const para of s.split('\n')) {
    const chars = [...para];
    const { faces, out } = facesFor(chars, bold, fonts);
    const { levels, base } = bidiLevels(chars);
    const widthOf = (a: number, b: number) => {
      let w = 0;
      for (let i = a; i < b;) {
        let j = i + 1;
        while (j < b && faces[j] === faces[i]) j++;
        const text = out.slice(i, j).join('');
        if (text) w += measure(faces[i], text);
        i = j;
      }
      return w;
    };
    const line = (a: number, b: number): TextLine => {
      const sub = chars.slice(a, b);
      const lv = levels.slice(a, b);
      // L1: white space at the end of the line goes back to the paragraph level.
      for (let i = lv.length - 1; i >= 0 && (isSpace(sub[i]) || out[a + i] === ''); i--) lv[i] = base;
      const order = visualOrder(sub, lv, base).filter((i) => out[a + i] !== '');
      const runs: TextRun[] = [];
      let cur: number[] = [];
      const flush = () => {
        if (!cur.length) return;
        const face = faces[a + cur[0]];
        const odd = lv[cur[0]] % 2 === 1;
        const visual = cur.map((i) => (odd ? mirrored(out[a + i]) : out[a + i])).join('');
        const text = face && face.reverses(visual) ? [...visual].reverse().join('') : visual;
        runs.push({ face, visual, text, width: measure(face, text) });
        cur = [];
      };
      for (const i of order) {
        if (cur.length) {
          const last = cur[cur.length - 1];
          const odd = lv[last] % 2 === 1;
          const same = faces[a + i] === faces[a + last] && lv[i] % 2 === lv[last] % 2 && i === last + (odd ? -1 : 1);
          if (!same) flush();
        }
        cur.push(i);
      }
      flush();
      return { runs, width: runs.reduce((n, r) => n + r.width, 0), rtl: base === 1 };
    };
    if (opts.oneLine || !opts.width) {
      let full = line(0, chars.length);
      if (opts.oneLine && opts.width && full.width > opts.width + 0.01) {
        // Keep the longest beginning that fits with an ellipsis after it.
        const fits = (n: number) => layoutText(`${chars.slice(0, n).join('').trimEnd()}…`, bold, measure, { fonts, oneLine: true })[0];
        let lo = 0;
        let hi = chars.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (fits(mid).width <= opts.width) lo = mid; else hi = mid - 1;
        }
        full = fits(lo);
      }
      lines.push(full);
      continue;
    }
    // Break opportunities: after white space, and around ideographs.
    const units: [number, number][] = [];
    let start = 0;
    for (let i = 1; i <= chars.length; i++) {
      if (i === chars.length || (isSpace(chars[i - 1]) && !isSpace(chars[i])) || (breaksAnywhere(chars[i]) && !isSpace(chars[i - 1])) || (breaksAnywhere(chars[i - 1]) && !isSpace(chars[i]))) {
        units.push([start, i]);
        start = i;
      }
    }
    if (!units.length) { lines.push(line(0, 0)); continue; }
    const max = opts.width;
    let a = units[0][0];
    let b = a;
    const trimmed = (x: number, y: number) => { let e = y; while (e > x && isSpace(chars[e - 1])) e--; return e; };
    for (const [ua, ub] of units) {
      if (b > a && widthOf(a, trimmed(a, ub)) > max) { lines.push(line(a, trimmed(a, b))); a = ua; }
      // A word longer than the line is broken between characters.
      let x = a;
      for (let i = Math.max(a, ua) + 1; i <= trimmed(ua, ub); i++) {
        if (i - x > 1 && widthOf(x, i) > max) { lines.push(line(x, i - 1)); x = i - 1; a = x; }
      }
      b = ub;
    }
    lines.push(line(a, trimmed(a, b)));
  }
  return lines;
}

export interface PdfOptions {
  title: string;
  subtitle?: string | null;
  /** Lines under the title: generated time, who for, filters applied. */
  meta?: string[];
  /** Restricted content: this line is printed in red at the top of every page, with a faint diagonal mark. */
  watermark?: string | null;
  appName?: string;
  landscape?: boolean;
  /** A cover page with the title, subtitle and meta; the body starts on page 2. */
  cover?: boolean;
  author?: string;
  /**
   * The organization (Administration > Organization, `printBranding` in core/organization.ts): its
   * name and address lines in the footer of every page, its logo on the first page, its brand color
   * for rules.
   */
  branding?: { name: string; lines: string[]; logo: Buffer | null; color: string | null } | null;
}

export interface PdfColumn { header: string; align?: 'left' | 'right'; /** Relative width; worked out from the content when left out. */ weight?: number }
export interface ChartPoint { label: string; value: number }

export class PdfBuilder {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;
  private readonly opts: PdfOptions;
  private readonly registered = new Set<string>();
  /** The brand color for rules: the organization's when it has one. */
  private readonly brand: string;

  constructor(opts: PdfOptions) {
    this.opts = opts;
    this.brand = opts.branding?.color && /^#[0-9a-f]{6}$/i.test(opts.branding.color) ? opts.branding.color : BRAND;
    this.doc = new PDFDocument({
      size: 'A4', layout: opts.landscape ? 'landscape' : 'portrait', bufferPages: true,
      margins: { top: 64, bottom: 56, left: 48, right: 48 },
      // Document properties are stored as Unicode, so they need no font.
      info: { Title: clean(opts.title), Author: clean(opts.author ?? ''), Creator: clean(opts.appName ?? 'Sandpiper GRC'), Producer: 'Sandpiper GRC' },
      // Content streams are compressed; tests inflate them to read the text back.
      compress: true,
    });
    this.done = new Promise((resolve, reject) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
    this.doc.font('Helvetica').fontSize(10).fillColor(INK);
    if (opts.cover) this.coverPage(); else this.titleBlock();
  }

  /** The organization's logo, fitted into a box; nothing when there is none or it cannot be read. */
  private logo(x: number, y: number, w: number, h: number, align: 'left' | 'right') {
    const logo = this.opts.branding?.logo;
    if (!logo) return;
    try {
      this.doc.image(logo, x, y, { fit: [w, h], valign: 'center', ...(align === 'right' ? { align: 'right' as const } : {}) });
    } catch {
      // A picture PDFKit cannot read is left out rather than failing the export.
    }
  }

  /** Sets the font that can print `text` (bold or regular) and returns the text to print with it. */
  private t(text: unknown, bold = false): string {
    const { face, text: out } = fontFor(text, bold);
    this.useFace(face, bold);
    return out;
  }

  /** Sets an embedded font (registering it on first use) or the standard one. */
  private useFace(face: FontFace | null, bold: boolean) {
    if (!face) {
      this.doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      return;
    }
    if (!this.registered.has(face.key)) {
      // PDFKit embeds only the glyphs used (a subset).
      if (face.postscript) this.doc.registerFont(face.key, face.path, face.postscript);
      else this.doc.registerFont(face.key, face.path);
      this.registered.add(face.key);
    }
    this.doc.font(face.key);
  }

  // An embedded run is laid out whole (an empty feature list makes PDFKit shape it in one piece
  // rather than word by word), so that a right-to-left run comes out in order.
  private runOpts(face: FontFace | null): PDFKit.Mixins.TextOptions { return face ? { features: [] } : {}; }

  /** The run layout of a piece of text, or null when one font prints it whole, left to right. */
  private runs(text: unknown, bold: boolean, width?: number, oneLine?: boolean): TextLine[] | null {
    if (!needsRuns(text, bold)) return null;
    return layoutText(text, bold, (face, s) => { this.useFace(face, bold); return this.doc.widthOfString(s, this.runOpts(face)); }, { width, oneLine });
  }

  /** Height and baseline of a laid-out line: the tallest of its fonts. */
  private metrics(line: TextLine, bold: boolean) {
    const doc = this.doc as PDFKit.PDFDocument & { _font: { ascender: number }; _fontSize: number };
    let height = 0;
    let ascent = 0;
    const faces = line.runs.length ? line.runs.map((r) => r.face) : [null];
    for (const face of faces) {
      this.useFace(face, bold);
      height = Math.max(height, doc.currentLineHeight(true));
      ascent = Math.max(ascent, (doc._font.ascender / 1000) * doc._fontSize);
    }
    return { height, ascent };
  }

  /**
   * Prints text at (x, y) in the current size and color: PDFKit's own `text` when one font prints it
   * whole, otherwise line by line and run by run. Leaves `doc.y` below the text (unless `lineBreak`
   * is false) and `doc.x` at `x`, as PDFKit does.
   */
  private write(text: unknown, x: number, y: number, o: { width?: number; align?: 'left' | 'right' | 'center'; bold?: boolean; lineBreak?: boolean; ellipsis?: boolean } = {}) {
    const { doc } = this;
    const bold = Boolean(o.bold);
    const lines = this.runs(text, bold, o.width, o.lineBreak === false);
    if (!lines) {
      const opts: PDFKit.Mixins.TextOptions = { width: o.width, align: o.align, lineBreak: o.lineBreak, ellipsis: o.ellipsis };
      for (const k of Object.keys(opts) as (keyof typeof opts)[]) if (opts[k] === undefined) delete opts[k];
      doc.text(this.t(text, bold), x, y, opts);
      return;
    }
    let top = y;
    for (const line of lines) {
      const { height, ascent } = this.metrics(line, bold);
      const room = o.width ?? line.width;
      // "left" means the start of the line: the right edge for a right-to-left paragraph.
      const align = o.align === 'center' ? 'center' : o.align === 'right' || line.rtl ? 'right' : 'left';
      let cx = align === 'center' ? x + (room - line.width) / 2 : align === 'right' ? x + room - line.width : x;
      for (const run of line.runs) {
        this.useFace(run.face, bold);
        doc.text(run.text, cx, top + ascent, { ...this.runOpts(run.face), lineBreak: false, baseline: 'alphabetic' });
        cx += run.width;
      }
      top += height;
    }
    doc.x = x;
    doc.y = o.lineBreak === false ? y : top;
  }

  /** The height text takes at a width, in the current size. */
  private heightOf(text: unknown, width: number, bold = false): number {
    const lines = this.runs(text, bold, width);
    if (!lines) return this.doc.heightOfString(this.t(text, bold), { width });
    return lines.reduce((h, line) => h + this.metrics(line, bold).height, 0);
  }

  /** The width of text on one line, in the current size. */
  private widthOf(text: unknown, bold = false): number {
    const lines = this.runs(text, bold);
    if (!lines) return this.doc.widthOfString(this.t(text, bold));
    return Math.max(0, ...lines.map((l) => l.width));
  }

  get left() { return this.doc.page.margins.left; }
  get width() { return this.doc.page.width - this.doc.page.margins.left - this.doc.page.margins.right; }
  get bottom() { return this.doc.page.height - this.doc.page.margins.bottom; }

  /** Starts a new page when less than `h` points are left on this one. */
  ensure(h: number) {
    if (this.doc.y + h > this.bottom) this.doc.addPage();
  }

  private metaLines() {
    const { doc } = this;
    doc.fontSize(9.5).fillColor(MUTED);
    for (const line of this.opts.meta ?? []) this.write(line, this.left, doc.y, { width: this.width });
    doc.fillColor(INK);
  }

  private titleBlock() {
    const { doc } = this;
    // The organization's logo in the top margin, at the right (where a restricted marking is not).
    if (!this.opts.watermark) this.logo(this.left + this.width - 140, 14, 140, 40, 'right');
    doc.fontSize(20).fillColor(INK);
    this.write(this.opts.title, this.left, doc.page.margins.top, { width: this.width, bold: true });
    if (this.opts.subtitle) { doc.fontSize(11).fillColor(MUTED); this.write(this.opts.subtitle, doc.x, doc.y, { width: this.width }); }
    doc.moveDown(0.3);
    this.metaLines();
    doc.moveDown(0.4);
    doc.moveTo(this.left, doc.y).lineTo(this.left + this.width, doc.y).lineWidth(1.5).strokeColor(this.brand).stroke();
    doc.moveDown(0.8);
  }

  private coverPage() {
    const { doc } = this;
    const top = doc.page.height * 0.32;
    this.logo(this.left, top - 120, 220, 72, 'left');
    doc.rect(this.left, top - 28, 56, 5).fill(this.brand);
    doc.fontSize(28).fillColor(INK);
    this.write(this.opts.title, this.left, top, { width: this.width, bold: true });
    if (this.opts.subtitle) { doc.moveDown(0.3).fontSize(13).fillColor(MUTED); this.write(this.opts.subtitle, doc.x, doc.y, { width: this.width }); }
    doc.moveDown(1);
    this.metaLines();
    if (this.opts.watermark) {
      doc.moveDown(1).fontSize(10).fillColor(DANGER);
      this.write(`${this.opts.watermark}. Contains restricted records: do not pass on.`, doc.x, doc.y, { width: this.width, bold: true });
    }
    doc.addPage();
  }

  heading(text: string, level: 1 | 2 = 1) {
    const { doc } = this;
    this.ensure(level === 1 ? 60 : 40);
    if (doc.y > doc.page.margins.top + 4) doc.moveDown(level === 1 ? 0.8 : 0.5);
    doc.fontSize(level === 1 ? 14 : 11.5).fillColor(INK);
    this.write(text, this.left, doc.y, { width: this.width, bold: true });
    doc.moveDown(0.3).font('Helvetica').fontSize(10);
  }

  paragraph(text: string, opts: { muted?: boolean; size?: number } = {}) {
    const { doc } = this;
    doc.fontSize(opts.size ?? 10).fillColor(opts.muted ? MUTED : INK);
    this.write(text, this.left, doc.y, { width: this.width });
    doc.fillColor(INK).moveDown(0.4);
  }

  /** A shaded line of text: "not available", "no records" and the like. */
  note(text: string) {
    const { doc } = this;
    doc.fontSize(9.5);
    const h = this.heightOf(text, this.width - 20) + 14;
    this.ensure(h + 6);
    const y = doc.y;
    doc.roundedRect(this.left, y, this.width, h, 4).fill(BAND);
    doc.fillColor(MUTED);
    this.write(text, this.left + 10, y + 7, { width: this.width - 20 });
    doc.fillColor(INK);
    doc.y = y + h + 8;
  }

  /** Simple Markdown: headings, bullets, numbered items and paragraphs (bold and italic marks are removed). */
  markdown(source: string) {
    const strip = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2');
    for (const block of String(source ?? '').slice(0, 20000).split(/\r?\n/)) {
      const line = block.trim();
      if (!line) continue;
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      const li = /^(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
      if (h) this.heading(strip(h[2]), 2);
      else if (li) {
        const { doc } = this;
        const bullet = li[2] ? `${li[2]}.` : '•';
        doc.font('Helvetica').fontSize(10).fillColor(INK);
        this.ensure(14);
        const y = doc.y;
        doc.text(bullet, this.left + 6, y, { width: 18 });
        this.write(strip(li[3]), this.left + 24, y, { width: this.width - 24 });
        doc.moveDown(0.15);
      } else this.paragraph(strip(line));
    }
  }

  /** Label and value pairs, one per line (a record's fact sheet). */
  keyValues(items: { label: string; value: string }[]) {
    const { doc } = this;
    const labelW = Math.min(170, this.width * 0.3);
    for (const item of items) {
      doc.fontSize(10);
      const h = Math.max(this.heightOf(item.value || '—', this.width - labelW - 12), this.heightOf(item.label, labelW - 8, true), 12) + 8;
      this.ensure(h);
      const y = doc.y;
      doc.fontSize(9.5).fillColor(MUTED);
      this.write(item.label, this.left, y + 4, { width: labelW - 8, bold: true });
      doc.fontSize(10).fillColor(INK);
      this.write(item.value || '—', this.left + labelW, y + 4, { width: this.width - labelW });
      doc.moveTo(this.left, y + h).lineTo(this.left + this.width, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
      doc.y = y + h + 1;
    }
    doc.moveDown(0.5);
  }

  /** Large figures in boxes (a report that is one total). */
  figures(items: { label: string; value: string }[]) {
    const { doc } = this;
    const w = 160;
    const perRow = Math.max(1, Math.floor((this.width + 12) / (w + 12)));
    let rowY = doc.y;
    items.forEach((item, i) => {
      if (i % perRow === 0) {
        if (i) doc.y = rowY + 70;
        this.ensure(64);
        rowY = doc.y;
      }
      const x = this.left + (i % perRow) * (w + 12);
      doc.roundedRect(x, rowY, w, 58, 6).lineWidth(0.8).strokeColor(RULE).stroke();
      doc.fontSize(20).fillColor(INK);
      this.write(item.value || '0', x + 10, rowY + 8, { width: w - 20, lineBreak: false, ellipsis: true, bold: true });
      doc.fontSize(9).fillColor(MUTED);
      this.write(item.label, x + 10, rowY + 38, { width: w - 20, lineBreak: false, ellipsis: true });
    });
    doc.fillColor(INK);
    doc.x = this.left;
    doc.y = rowY + 70;
  }

  /**
   * A table that breaks across pages, repeating its header row. Long cells wrap (cut at 600
   * characters); `boldLast` sets the last row in bold (a totals row).
   */
  table(columns: PdfColumn[], rows: string[][], opts: { boldLast?: boolean; boldFirstColumn?: boolean } = {}) {
    const steps = this.tableSteps(columns, rows, opts);
    while (!steps.next().done) { /* all at once */ }
  }

  /**
   * The same table, giving the event loop a turn every `every` rows (OP-01), so a long list export
   * does not keep every other request waiting while it is laid out.
   */
  async tableAsync(columns: PdfColumn[], rows: string[][], opts: { boldLast?: boolean; boldFirstColumn?: boolean; every?: number } = {}): Promise<void> {
    const every = Math.max(1, opts.every ?? 50);
    let n = 0;
    const steps = this.tableSteps(columns, rows, opts);
    while (!steps.next().done) {
      n += 1;
      if (n % every === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  /** Lays the table out, yielding after each row. */
  private *tableSteps(columns: PdfColumn[], rows: string[][], opts: { boldLast?: boolean; boldFirstColumn?: boolean }): Generator<void> {
    const { doc } = this;
    if (!columns.length) return;
    const pad = 4;
    const fontSize = columns.length > 8 ? 7.5 : 8.5;
    // Widths from the measured text: each column wants its longest line (capped at 240 points) and
    // needs at least its longest word, so short values such as references never break mid-word.
    const sample = rows.slice(0, 200);
    const measure = (s: string, bold: boolean) => { doc.fontSize(fontSize); return this.widthOf(s, bold); };
    const longestWord = (s: string, bold: boolean) => Math.max(0, ...s.split(/\s+/).map((w) => measure(w, bold)));
    const want = columns.map((c, i) => c.weight !== undefined ? 0 : Math.min(240, Math.max(measure(c.header, true), ...sample.map((r) => measure(String(r[i] ?? '').slice(0, 120), false)))) + pad * 2 + 1);
    const need = columns.map((c, i) => c.weight !== undefined ? 0 : Math.min(140, Math.max(longestWord(c.header, true), ...sample.map((r) => longestWord(String(r[i] ?? '').slice(0, 120), false)))) + pad * 2 + 1);
    let widths: number[];
    if (columns.some((c) => c.weight !== undefined)) {
      const total = columns.reduce((n, c) => n + (c.weight ?? 10), 0);
      widths = columns.map((c) => ((c.weight ?? 10) / total) * this.width);
    } else {
      const wantTotal = want.reduce((a, b) => a + b, 0);
      if (wantTotal <= this.width) {
        // Room to spare: share it out in proportion to what each column wants.
        widths = want.map((w) => w + ((this.width - wantTotal) * w) / wantTotal);
      } else {
        // Too wide: every column keeps what it needs; the rest of the room goes by how much more each wants.
        const needTotal = Math.min(need.reduce((a, b) => a + b, 0), this.width);
        const scale = needTotal / Math.max(1, need.reduce((a, b) => a + b, 0));
        const base = need.map((n) => n * scale);
        const extra = want.map((w, i) => Math.max(0, w - base[i]));
        const extraTotal = extra.reduce((a, b) => a + b, 0) || 1;
        widths = base.map((b, i) => b + ((this.width - needTotal) * extra[i]) / extraTotal);
      }
    }
    const cellText = (s: unknown) => String(s ?? '').slice(0, 600);
    const isBold = (style: 'head' | 'body' | 'bold', i: number) => style !== 'body' || Boolean(opts.boldFirstColumn && i === 0);
    const rowHeight = (cells: string[], style: 'head' | 'body' | 'bold') => {
      doc.fontSize(fontSize);
      return Math.max(...cells.map((c, i) => this.heightOf(c || ' ', widths[i] - pad * 2, isBold(style, i)))) + pad * 2;
    };
    const drawRow = (cells: string[], y: number, h: number, style: 'head' | 'body' | 'bold', shade: boolean) => {
      if (style === 'head') doc.rect(this.left, y, this.width, h).fill(BAND);
      else if (shade) doc.rect(this.left, y, this.width, h).fill('#f7fafa');
      let x = this.left;
      doc.fontSize(fontSize).fillColor(INK);
      cells.forEach((c, i) => {
        this.write(c, x + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align === 'right' ? 'right' : 'left', bold: isBold(style, i) });
        x += widths[i];
      });
      doc.moveTo(this.left, y + h).lineTo(this.left + this.width, y + h).lineWidth(style === 'head' ? 1 : 0.4).strokeColor(style === 'head' ? this.brand : RULE).stroke();
    };
    const head = columns.map((c) => cellText(c.header));
    const headH = rowHeight(head, 'head');
    const drawHead = () => { const y = doc.y; drawRow(head, y, headH, 'head', false); doc.y = y + headH; };
    this.ensure(headH + 20);
    drawHead();
    for (let n = 0; n < rows.length; n++) {
      const raw = rows[n];
      const cells = columns.map((_, i) => cellText(raw[i]));
      const style = opts.boldLast && n === rows.length - 1 ? 'bold' : 'body';
      const h = Math.min(rowHeight(cells, style), this.bottom - this.doc.page.margins.top - headH - 4);
      if (doc.y + h > this.bottom) { doc.addPage(); drawHead(); }
      const y = doc.y;
      drawRow(cells, y, h, style, n % 2 === 1);
      doc.y = y + h;
      yield;
    }
    doc.x = this.left;
    doc.moveDown(0.6);
  }

  /** A vector chart drawn from labeled values: horizontal bars, a line over time, or a pie. */
  chart(kind: 'bar' | 'line' | 'pie', points: ChartPoint[], label: string) {
    const data = points.filter((p) => Number.isFinite(p.value)).slice(0, kind === 'pie' ? 8 : kind === 'line' ? 60 : 24);
    if (!data.length || data.every((p) => p.value === 0)) return;
    if (kind === 'pie') this.pie(data, label);
    else if (kind === 'line') this.line(data, label);
    else this.bars(data, label);
  }

  private bars(data: ChartPoint[], label: string) {
    const { doc } = this;
    const rowH = 16;
    this.ensure(Math.min(data.length, 10) * rowH + 24);
    const nameW = Math.min(170, this.width * 0.3);
    const valueW = 56;
    const trackW = this.width - nameW - valueW - 16;
    const max = Math.max(...data.map((p) => p.value), 0) || 1;
    doc.fontSize(8).fillColor(MUTED);
    this.write(label, this.left, doc.y, { width: this.width });
    doc.moveDown(0.2);
    for (const p of data) {
      this.ensure(rowH);
      const y = doc.y;
      doc.fontSize(8.5).fillColor(INK);
      this.write(p.label, this.left, y + 3, { width: nameW - 8, lineBreak: false, ellipsis: true });
      doc.rect(this.left + nameW, y + 2, trackW, rowH - 5).fill(BAND);
      const w = Math.max(0.5, (Math.max(0, p.value) / max) * trackW);
      doc.rect(this.left + nameW, y + 2, w, rowH - 5).fill(SERIES[0]);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text(formatNumber(p.value), this.left + nameW + trackW + 8, y + 3, { width: valueW, align: 'right', lineBreak: false });
      doc.y = y + rowH;
    }
    doc.x = this.left;
    doc.moveDown(0.6);
  }

  private line(data: ChartPoint[], label: string) {
    const { doc } = this;
    const h = 170;
    this.ensure(h + 50);
    doc.fontSize(8).fillColor(MUTED);
    this.write(label, this.left, doc.y, { width: this.width });
    const top = doc.y + 6;
    const axisW = 40;
    const x0 = this.left + axisW;
    const plotW = this.width - axisW - 8;
    const max = Math.max(...data.map((p) => p.value), 0);
    const min = Math.min(0, ...data.map((p) => p.value));
    const span = max - min || 1;
    const yOf = (v: number) => top + h - ((v - min) / span) * h;
    const xOf = (i: number) => x0 + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
    // Grid and scale.
    for (let g = 0; g <= 4; g++) {
      const v = min + (span * g) / 4;
      const y = yOf(v);
      doc.moveTo(x0, y).lineTo(x0 + plotW, y).lineWidth(0.4).strokeColor(RULE).stroke();
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(formatNumber(v), this.left, y - 4, { width: axisW - 6, align: 'right', lineBreak: false });
    }
    doc.moveTo(xOf(0), yOf(data[0].value));
    data.forEach((p, i) => { if (i) doc.lineTo(xOf(i), yOf(p.value)); });
    doc.lineWidth(1.6).strokeColor(SERIES[0]).stroke();
    data.forEach((p, i) => doc.circle(xOf(i), yOf(p.value), 2.2).fill(SERIES[0]));
    // Labels: first, last and a few between, so they never overlap.
    const step = Math.max(1, Math.ceil(data.length / 6));
    data.forEach((p, i) => {
      if (i % step !== 0 && i !== data.length - 1) return;
      doc.fontSize(7).fillColor(MUTED);
      this.write(p.label, xOf(i) - 40, top + h + 4, { width: 80, align: 'center', lineBreak: false, ellipsis: true });
    });
    doc.fillColor(INK);
    doc.x = this.left;
    doc.y = top + h + 22;
  }

  private pie(data: ChartPoint[], label: string) {
    const { doc } = this;
    const r = 70;
    this.ensure(r * 2 + 40);
    doc.fontSize(8).fillColor(MUTED);
    this.write(label, this.left, doc.y, { width: this.width });
    const top = doc.y + 6;
    const cx = this.left + r + 4;
    const cy = top + r;
    const values = data.map((p) => Math.max(0, p.value));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      if (sweep <= 0) return;
      if (sweep >= Math.PI * 2 - 1e-6) { doc.circle(cx, cy, r).fill(SERIES[i % SERIES.length]); return; }
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      const [x1, y1] = [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
      const [x2, y2] = [cx + r * Math.cos(end), cy + r * Math.sin(end)];
      doc.path(`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`).fill(SERIES[i % SERIES.length]);
      doc.path(`M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)}`).lineWidth(1.2).strokeColor('#ffffff').stroke();
      angle = end;
    });
    // Legend with values and shares.
    let ly = top + 4;
    const lx = cx + r + 28;
    data.forEach((p, i) => {
      doc.rect(lx, ly + 1, 8, 8).fill(SERIES[i % SERIES.length]);
      doc.fontSize(8.5).fillColor(INK);
      this.write(`${p.label}: ${formatNumber(p.value)} (${formatNumber((Math.max(0, p.value) / total) * 100)}%)`, lx + 14, ly, { width: this.left + this.width - lx - 14, lineBreak: false, ellipsis: true });
      ly += 15;
    });
    doc.x = this.left;
    doc.y = Math.max(top + r * 2, ly) + 14;
  }

  /** Writes headers, footers, page numbers and the watermark on every page, and returns the file. */
  async finish(): Promise<Buffer> {
    const { doc } = this;
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = range.start; i < range.start + total; i++) {
      doc.switchToPage(i);
      const { margins } = doc.page;
      const keep = margins.bottom;
      margins.bottom = 0; // writing in the margin must not start a new page
      const w = doc.page.width - margins.left - margins.right;
      if (this.opts.watermark) {
        doc.save();
        doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
        doc.font('Helvetica-Bold').fontSize(64).fillColor(DANGER).fillOpacity(0.07)
          .text('RESTRICTED', 0, doc.page.height / 2 - 32, { width: doc.page.width, align: 'center', lineBreak: false });
        doc.restore();
        doc.fillOpacity(1);
        doc.fontSize(8).fillColor(DANGER);
        this.write(this.opts.watermark, margins.left, 24, { width: w, align: 'center', lineBreak: false, ellipsis: true, bold: true });
      } else if (i > 0) {
        doc.fontSize(8).fillColor(MUTED);
        this.write(this.opts.title, margins.left, 28, { width: w, lineBreak: false, ellipsis: true });
      }
      doc.fontSize(8).fillColor(MUTED);
      // The organization's name beside the application's, and its address and contacts underneath.
      const names = [...new Set([this.opts.branding?.name, this.opts.appName].filter((n): n is string => Boolean(n)))];
      this.write(names.join(' · '), margins.left, doc.page.height - 34, { width: w / 2, lineBreak: false, ellipsis: true });
      const lines = this.opts.branding?.lines ?? [];
      if (lines.length) {
        doc.fontSize(7).fillColor(MUTED);
        this.write(lines.join(' · '), margins.left, doc.page.height - 23, { width: w, lineBreak: false, ellipsis: true });
        doc.fontSize(8);
      }
      doc.font('Helvetica').text(`Page ${i + 1} of ${total}`, margins.left + w / 2, doc.page.height - 34, { width: w / 2, align: 'right', lineBreak: false });
      margins.bottom = keep;
    }
    doc.end();
    return this.done;
  }
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const formatNumber = (v: number) => (Number.isFinite(v) ? numberFmt.format(v) : '');
