// Server-made PDF documents (PDFKit). One builder serves list exports, reports, dashboards,
// report packs and record fact sheets: headings, paragraphs, fact lists, tables that break across
// pages with the header row repeated, simple vector charts (bar, line, pie), page numbers and, for
// restricted content, a watermark on every page. Every file is a tagged PDF meeting PDF/UA
// (E41-13; see PdfBuilder below and the check in pdfua.ts).
//
// Fonts: text that Windows-1252 covers (Western European languages) is printed in the
// application's own Arimo (fonts/, with Helvetica's widths, embedded as a subset, as PDF/UA needs every font
// embedded). Any other text (Greek, Cyrillic, Hebrew, Arabic, Chinese, Japanese, Korean and so on)
// is printed in a TrueType or OpenType font from the machine, or from GRC_PDF_FONTS, with only
// the glyphs used embedded (see fonts.ts).
//
// Text that one font prints whole, left to right, goes straight to PDFKit. Text holding
// right-to-left characters, or mixing scripts that no single font covers, is laid out here (E12-16):
// each character takes a font that has it (the one before it when it can, so runs stay long), the
// text is broken into lines, and each line is put in display order by the bidirectional algorithm
// (fonts.ts) and printed run by run. Only a character that no available font has prints as "?".
import PDFDocument from 'pdfkit';
import { baseFont, bidiClass, bidiLevels, isDirectionMark, mirrored, needsBidi, pdfFonts, visualOrder, type FontFace } from './fonts.ts';

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
  /**
   * A faint diagonal word on every page, such as DRAFT, SUPERSEDED or OBSOLETE (E43-16): a printed
   * document's status. Shown instead of the diagonal RESTRICTED (the restricted line at the top stays).
   * Page furniture, so it is an artifact: screen readers skip it; say the status in the text as well.
   */
  mark?: string | null;
  /**
   * A line at the top of every page, the first included (E46-57), such as "Controlled copy 3 · Invented
   * depot binder": who a printed copy belongs to. Printed in bold, after the restricted line when there
   * is one, in place of the running title. Page furniture (an artifact): say it in the text as well.
   */
  pageLine?: string | null;
  appName?: string;
  landscape?: boolean;
  /** A cover page with the title, subtitle and meta; the body starts on page 2. */
  cover?: boolean;
  author?: string;
  /** The document's language (BCP 47), recorded for screen readers. Default `en-US`. */
  lang?: string;
  /**
   * The organization (Administration > Organization, `printBranding` in core/organization.ts): its
   * name and address lines in the footer of every page, its logo on the first page, its brand color
   * for rules.
   */
  branding?: { name: string; lines: string[]; logo: Buffer | null; color: string | null } | null;
}

export interface PdfColumn { header: string; align?: 'left' | 'right'; /** Relative width; worked out from the content when left out. */ weight?: number }
export interface ChartPoint { label: string; value: number }
/** One line of a chart over time: a value for each label (null where there is none). */
export interface ChartSeries { name: string; values: (number | null)[] }

type Struct = PDFKit.PDFStructureElement;
export type StructOptions = { alt?: string; lang?: string; scope?: 'Row' | 'Column' | 'Both' };

/** XML text: PDFKit copies the document properties into the XMP metadata as they are. */
const xml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[ch]!);

/**
 * A new PDFKit document that is tagged for PDF/UA (E41-13): marked as tagged with a structure tree,
 * its language, its title shown in place of the file name, and the PDF/UA identifier in its XMP
 * metadata. Every PDF the server makes starts here (PdfBuilder, and the label printer, which draws
 * its own pages). The caller tags its content and sets fonts with `setBaseFont` (never the
 * standard fonts, which are not embedded).
 */
export function taggedDocument(o: { title: string; author?: string; appName?: string; subject?: string | null; lang?: string } & PDFKit.PDFDocumentOptions): PDFKit.PDFDocument {
  const { title: given, author, appName, subject, lang, ...rest } = o;
  const title = clean(given).trim() || clean(appName ?? '').trim() || 'Document';
  const doc = new PDFDocument({
    ...rest,
    // Document properties are stored as Unicode, so they need no font.
    info: {
      Title: title, Author: clean(author ?? ''), Creator: clean(appName ?? 'Sandpiper GRC'), Producer: 'Sandpiper GRC',
      ...(subject ? { Subject: clean(subject) } : {}),
    },
    pdfVersion: '1.7', tagged: true, lang: lang || 'en-US', displayTitle: true, subset: 'PDF/UA' as PDFKit.Mixins.PDFSubsets,
  });
  // PDFKit writes the properties into the XMP metadata without escaping them: a title such as
  // "Risks & issues" would make the metadata unreadable. Escape them for that step only.
  const raw = doc as unknown as { endMetadata(): void; info: Record<string, unknown> };
  const endMetadata = raw.endMetadata.bind(raw);
  raw.endMetadata = () => {
    const keep = raw.info;
    raw.info = Object.fromEntries(Object.entries(keep).map(([k, v]) => [k, typeof v === 'string' ? xml(v) : v]));
    try { endMetadata(); } finally { raw.info = keep; }
  };
  return doc;
}

/** Sets the application's own font (embedded; registered on first use), or Helvetica when its files are missing. */
export function setBaseFont(doc: PDFKit.PDFDocument, bold: boolean): void {
  const b = baseFont();
  if (!b) { doc.font(bold ? 'Helvetica-Bold' : 'Helvetica'); return; }
  const key = bold ? 'grc-base-bold' : 'grc-base';
  const known = (doc as unknown as { _registeredFonts?: Record<string, unknown> })._registeredFonts;
  if (!known?.[key]) doc.registerFont(key, bold ? b.bold : b.regular);
  doc.font(key);
}

/** A structure element (PDFKit's `struct`, with options its type description lacks, such as a table header's scope). */
export function structOf(doc: PDFKit.PDFDocument, type: string, opts: StructOptions, children?: PDFKit.PDFStructureElementChild | PDFKit.PDFStructureElementChild[]): PDFKit.PDFStructureElement {
  return (doc.struct as (this: unknown, t: string, o: object, c: unknown) => PDFKit.PDFStructureElement).call(doc, type, opts, children ?? null);
}

/** Drawing that is not content (rules, shading, page furniture): marked as an artifact, which screen readers skip. */
export function asArtifact(doc: PDFKit.PDFDocument, draw: () => void, type: 'Layout' | 'Pagination' = 'Layout'): void {
  doc.markContent('Artifact', { type });
  draw();
  doc.endMarkedContent();
}

/** A chart's data in words, for its alternative text (what a screen reader says instead of the drawing). */
export function chartAlt(label: string, points: ChartPoint[], kind: string): string {
  const what = kind === 'pie' ? 'Pie chart' : kind === 'line' ? 'Line chart' : 'Bar chart';
  const text = `${what}: ${label}. ${points.map((p) => `${p.label}: ${formatNumber(p.value)}`).join('; ')}.`;
  return text.length > 1500 ? `${text.slice(0, 1497)}...` : text;
}

/**
 * Builds a PDF. Every file is tagged for PDF/UA (E41-13): a structure tree in reading order
 * (headings H1 to H3 that never skip a level, paragraphs, lists, tables with header cells, charts
 * as figures with a text alternative), the document's language and title (shown as the window
 * title), every font embedded, and page furniture (headers, footers, page numbers, the watermark,
 * rules and shading) marked as artifacts that screen readers skip.
 */
export class PdfBuilder {
  readonly doc: PDFKit.PDFDocument;
  private chunks: Buffer[] = [];
  private done: Promise<Buffer>;
  private readonly opts: PdfOptions;
  private readonly registered = new Set<string>();
  /** The brand color for rules: the organization's when it has one. */
  private readonly brand: string;
  /** The document's structure element: every tagged part is added under it, in reading order. */
  private readonly root: Struct;
  /** The level of the last heading, so that levels never skip (H1, then H2, then H3). */
  private level = 0;
  /** How far wanted levels are moved up, once a document has skipped one (sub-headings straight under the title). */
  private shift = 0;

  constructor(opts: PdfOptions) {
    this.opts = opts;
    this.brand = opts.branding?.color && /^#[0-9a-f]{6}$/i.test(opts.branding.color) ? opts.branding.color : BRAND;
    this.doc = taggedDocument({
      title: opts.title, author: opts.author, appName: opts.appName, subject: opts.subtitle, lang: opts.lang,
      size: 'A4', layout: opts.landscape ? 'landscape' : 'portrait', bufferPages: true,
      margins: { top: 64, bottom: 56, left: 48, right: 48 },
      // Content streams are compressed; tests inflate them to read the text back.
      compress: true,
    });
    this.root = this.doc.struct('Document');
    this.doc.addStructure(this.root);
    this.done = new Promise((resolve, reject) => {
      this.doc.on('data', (c: Buffer) => this.chunks.push(c));
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
    });
    this.base(false);
    this.doc.fontSize(10).fillColor(INK);
    if (opts.cover) this.coverPage(); else this.titleBlock();
  }

  // ---------- tagging ----------

  /** Adds a structure element whose content `draw` prints, under `parent`, in reading order. */
  private tag(type: string, draw: () => void, opts: StructOptions = {}, parent: Struct = this.root) {
    parent.add(this.el(type, opts, draw));
  }

  /** A structure element with its children (elements, or a function that prints its content when the element is placed). */
  private el(type: string, opts: StructOptions, children: PDFKit.PDFStructureElementChild | PDFKit.PDFStructureElementChild[]): Struct {
    return structOf(this.doc, type, opts, children);
  }

  /** Opens a grouping element (a table, a list, a row) under `parent`; the caller ends it. */
  private group(type: string, parent: Struct = this.root): Struct {
    const el = this.doc.struct(type);
    parent.add(el);
    return el;
  }

  /** Drawing that is not content (rules, shading, page furniture): marked as an artifact, which screen readers skip. */
  private artifact(draw: () => void, type: 'Layout' | 'Pagination' = 'Layout') {
    asArtifact(this.doc, draw, type);
  }

  /** The heading tag for a wanted level: never more than one deeper than the heading before it. */
  private headingTag(wanted: number): string {
    let lv = wanted - this.shift;
    // A document whose first headings under the title are sub-headings: those, and every heading
    // after them, move up by the levels skipped, so headings of one level stay siblings.
    if (lv > this.level + 1) { this.shift += lv - (this.level + 1); lv = this.level + 1; }
    this.level = Math.max(1, Math.min(lv, 6));
    return `H${this.level}`;
  }

  // ---------- fonts ----------

  /** The application's own font (embedded), or Helvetica when its files are missing. */
  private base(bold: boolean) {
    setBaseFont(this.doc, bold);
  }

  /** The organization's logo, fitted into a box, as a figure named after the organization; nothing when there is none or it cannot be read. */
  private logo(x: number, y: number, w: number, h: number, align: 'left' | 'right') {
    const logo = this.opts.branding?.logo;
    if (!logo) return;
    const draw = () => {
      try {
        this.doc.image(logo, x, y, { fit: [w, h], valign: 'center', ...(align === 'right' ? { align: 'right' as const } : {}) });
      } catch {
        // A picture PDFKit cannot read is left out rather than failing the export.
      }
    };
    const name = clean(this.opts.branding?.name ?? '').trim();
    if (name) this.tag('Figure', draw, { alt: `${name} logo` });
    else this.artifact(draw);
  }

  /** Sets the font that can print `text` (bold or regular) and returns the text to print with it. */
  private t(text: unknown, bold = false): string {
    const { face, text: out } = fontFor(text, bold);
    this.useFace(face, bold);
    return out;
  }

  /** Sets an embedded font (registering it on first use) or the base one. */
  private useFace(face: FontFace | null, bold: boolean) {
    if (!face) {
      this.base(bold);
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

  /** Starts a new page. Tagged content that is still open carries on there. */
  newPage() {
    this.doc.continueOnNewPage();
  }

  /** Starts a new page when less than `h` points are left on this one. */
  ensure(h: number) {
    if (this.doc.y + h > this.bottom) this.newPage();
  }

  private metaLines() {
    const { doc } = this;
    for (const line of this.opts.meta ?? []) {
      this.tag('P', () => { doc.fontSize(9.5).fillColor(MUTED); this.write(line, this.left, doc.y, { width: this.width }); });
    }
    doc.fillColor(INK);
  }

  private titleBlock() {
    const { doc } = this;
    // The organization's logo in the top margin, at the right (where a restricted marking is not).
    if (!this.opts.watermark) this.logo(this.left + this.width - 140, 14, 140, 40, 'right');
    this.tag(this.headingTag(1), () => { doc.fontSize(20).fillColor(INK); this.write(this.opts.title, this.left, doc.page.margins.top, { width: this.width, bold: true }); });
    if (this.opts.subtitle) this.tag('P', () => { doc.fontSize(11).fillColor(MUTED); this.write(this.opts.subtitle, doc.x, doc.y, { width: this.width }); });
    doc.moveDown(0.3);
    this.metaLines();
    doc.moveDown(0.4);
    this.artifact(() => doc.moveTo(this.left, doc.y).lineTo(this.left + this.width, doc.y).lineWidth(1.5).strokeColor(this.brand).stroke());
    doc.moveDown(0.8);
  }

  private coverPage() {
    const { doc } = this;
    const top = doc.page.height * 0.32;
    this.logo(this.left, top - 120, 220, 72, 'left');
    this.artifact(() => doc.rect(this.left, top - 28, 56, 5).fill(this.brand));
    this.tag(this.headingTag(1), () => { doc.fontSize(28).fillColor(INK); this.write(this.opts.title, this.left, top, { width: this.width, bold: true }); });
    if (this.opts.subtitle) this.tag('P', () => { doc.moveDown(0.3).fontSize(13).fillColor(MUTED); this.write(this.opts.subtitle, doc.x, doc.y, { width: this.width }); });
    doc.moveDown(1);
    this.metaLines();
    if (this.opts.watermark) {
      this.tag('P', () => {
        doc.moveDown(1).fontSize(10).fillColor(DANGER);
        this.write(`${this.opts.watermark}. Contains restricted records: do not pass on.`, doc.x, doc.y, { width: this.width, bold: true });
      });
    }
    this.newPage();
  }

  /** A heading: level 1 for a section, 2 for a part of one (tagged H2 and H3 under the title's H1). */
  heading(text: string, level: 1 | 2 = 1) {
    const { doc } = this;
    this.ensure(level === 1 ? 60 : 40);
    if (doc.y > doc.page.margins.top + 4) doc.moveDown(level === 1 ? 0.8 : 0.5);
    this.tag(this.headingTag(level + 1), () => {
      doc.fontSize(level === 1 ? 14 : 11.5).fillColor(INK);
      this.write(text, this.left, doc.y, { width: this.width, bold: true });
    });
    doc.moveDown(0.3);
    this.base(false);
    doc.fontSize(10);
  }

  paragraph(text: string, opts: { muted?: boolean; size?: number } = {}) {
    const { doc } = this;
    this.tag('P', () => {
      doc.fontSize(opts.size ?? 10).fillColor(opts.muted ? MUTED : INK);
      this.write(text, this.left, doc.y, { width: this.width });
    });
    doc.fillColor(INK).moveDown(0.4);
  }

  /** A shaded line of text: "not available", "no records" and the like. */
  note(text: string) {
    const { doc } = this;
    doc.fontSize(9.5);
    const h = this.heightOf(text, this.width - 20) + 14;
    this.ensure(h + 6);
    const y = doc.y;
    this.artifact(() => doc.roundedRect(this.left, y, this.width, h, 4).fill(BAND));
    this.tag('P', () => { doc.fontSize(9.5).fillColor(MUTED); this.write(text, this.left + 10, y + 7, { width: this.width - 20 }); });
    doc.fillColor(INK);
    doc.y = y + h + 8;
  }

  /** Simple Markdown: headings, bullets, numbered items and paragraphs (bold and italic marks are removed). */
  markdown(source: string) {
    const strip = (s: string) => s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1$2');
    let list: { el: Struct; ordered: boolean } | null = null;
    const close = () => { list?.el.end(); list = null; };
    for (const block of String(source ?? '').slice(0, 20000).split(/\r?\n/)) {
      const line = block.trim();
      if (!line) continue;
      const h = /^(#{1,3})\s+(.*)$/.exec(line);
      const li = /^(?:([-*])|(\d+)[.)])\s+(.*)$/.exec(line);
      if (!li) close();
      if (h) this.heading(strip(h[2]), 2);
      else if (li) {
        const { doc } = this;
        const ordered = Boolean(li[2]);
        if (list && list.ordered !== ordered) close();
        if (!list) list = { el: this.group('L'), ordered };
        const bullet = ordered ? `${li[2]}.` : '•';
        doc.fontSize(10).fillColor(INK);
        this.ensure(14);
        const y = doc.y;
        list.el.add(this.el('LI', {}, [
          this.el('Lbl', {}, () => { this.base(false); doc.fontSize(10).fillColor(INK); doc.text(bullet, this.left + 6, y, { width: 18 }); }),
          this.el('LBody', {}, () => { doc.fontSize(10).fillColor(INK); this.write(strip(li[3]), this.left + 24, y, { width: this.width - 24 }); }),
        ]));
        doc.moveDown(0.15);
      } else this.paragraph(strip(line));
    }
    close();
  }

  /** Label and value pairs, one per line (a record's fact sheet): a two-column table with the labels as row headers. */
  keyValues(items: { label: string; value: string }[]) {
    const { doc } = this;
    const labelW = Math.min(170, this.width * 0.3);
    const table = this.group('Table');
    const body = this.group('TBody', table);
    for (const item of items) {
      doc.fontSize(10);
      const h = Math.max(this.heightOf(item.value || '—', this.width - labelW - 12), this.heightOf(item.label, labelW - 8, true), 12) + 8;
      this.ensure(h);
      const y = doc.y;
      body.add(this.el('TR', {}, [
        this.el('TH', { scope: 'Row' }, () => { doc.fontSize(9.5).fillColor(MUTED); this.write(item.label, this.left, y + 4, { width: labelW - 8, bold: true }); }),
        this.el('TD', {}, () => { doc.fontSize(10).fillColor(INK); this.write(item.value || '—', this.left + labelW, y + 4, { width: this.width - labelW }); }),
      ]));
      this.artifact(() => doc.moveTo(this.left, y + h).lineTo(this.left + this.width, y + h).lineWidth(0.5).strokeColor(RULE).stroke());
      doc.y = y + h + 1;
    }
    body.end();
    table.end();
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
      const y = rowY;
      this.artifact(() => doc.roundedRect(x, y, w, 58, 6).lineWidth(0.8).strokeColor(RULE).stroke());
      // One paragraph per figure: the number, then what it counts.
      this.tag('P', () => {
        doc.fontSize(20).fillColor(INK);
        this.write(item.value || '0', x + 10, y + 8, { width: w - 20, lineBreak: false, ellipsis: true, bold: true });
        doc.fontSize(9).fillColor(MUTED);
        this.write(item.label, x + 10, y + 38, { width: w - 20, lineBreak: false, ellipsis: true });
      });
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

  /**
   * Lays the table out, yielding after each row. Tagged as a table: a header row of column
   * headers (TH), then a row (TR) of cells (TD) per record; with `boldFirstColumn` the first cell
   * of each row is its row header. The header repeated on later pages is an artifact, so it is
   * read once.
   */
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
    const lefts = widths.map((_, i) => this.left + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const cell = (c: string, i: number, y: number, style: 'head' | 'body' | 'bold') => () => {
      doc.fontSize(fontSize).fillColor(INK);
      this.write(c, lefts[i] + pad, y + pad, { width: widths[i] - pad * 2, align: columns[i].align === 'right' ? 'right' : 'left', bold: isBold(style, i) });
    };
    /** Draws a row: shading and rule as artifacts, the cells tagged under `parent` (or as an artifact when it is a repeated header). */
    const drawRow = (cells: string[], y: number, h: number, style: 'head' | 'body' | 'bold', shade: boolean, parent: Struct | null) => {
      if (style === 'head') this.artifact(() => doc.rect(this.left, y, this.width, h).fill(BAND));
      else if (shade) this.artifact(() => doc.rect(this.left, y, this.width, h).fill('#f7fafa'));
      if (parent) {
        parent.add(this.el('TR', {}, cells.map((c, i) => {
          const header = style === 'head' || Boolean(opts.boldFirstColumn && i === 0);
          const scope = style === 'head' ? 'Column' : 'Row';
          return this.el(header ? 'TH' : 'TD', header ? { scope } : {}, cell(c, i, y, style));
        })));
      } else {
        this.artifact(() => cells.forEach((c, i) => cell(c, i, y, style)()), 'Pagination');
      }
      this.artifact(() => doc.moveTo(this.left, y + h).lineTo(this.left + this.width, y + h).lineWidth(style === 'head' ? 1 : 0.4).strokeColor(style === 'head' ? this.brand : RULE).stroke());
    };
    const head = columns.map((c) => cellText(c.header));
    const headH = rowHeight(head, 'head');
    const table = this.group('Table');
    const drawHead = (parent: Struct | null) => { const y = doc.y; drawRow(head, y, headH, 'head', false, parent); doc.y = y + headH; };
    this.ensure(headH + 20);
    const thead = this.group('THead', table);
    drawHead(thead);
    thead.end();
    const tbody = this.group('TBody', table);
    for (let n = 0; n < rows.length; n++) {
      const raw = rows[n];
      const cells = columns.map((_, i) => cellText(raw[i]));
      const style = opts.boldLast && n === rows.length - 1 ? 'bold' : 'body';
      const h = Math.min(rowHeight(cells, style), this.bottom - this.doc.page.margins.top - headH - 4);
      if (doc.y + h > this.bottom) { this.newPage(); drawHead(null); }
      const y = doc.y;
      drawRow(cells, y, h, style, n % 2 === 1, tbody);
      doc.y = y + h;
      yield;
    }
    tbody.end();
    table.end();
    doc.x = this.left;
    doc.moveDown(0.6);
  }

  /** A vector chart drawn from labeled values: horizontal bars, a line over time, or a pie. Tagged as a figure whose text alternative lists the values. */
  chart(kind: 'bar' | 'line' | 'pie', points: ChartPoint[], label: string) {
    const data = points.filter((p) => Number.isFinite(p.value)).slice(0, kind === 'pie' ? 8 : kind === 'line' ? 60 : 24);
    if (!data.length || data.every((p) => p.value === 0)) return;
    if (kind === 'line') { this.trend(data.map((p) => p.label), [{ name: label, values: data.map((p) => p.value) }], label); return; }
    // Room for the start of the chart first, so that its figure starts on the page it is drawn on.
    this.ensure(kind === 'pie' ? 70 * 2 + 40 : Math.min(data.length, 10) * 16 + 24);
    this.tag('Figure', () => (kind === 'pie' ? this.pie(data, label) : this.bars(data, label)), { alt: chartAlt(label, data, kind) });
  }

  /**
   * A line chart over time with one line per series (for example open risks by level, month by
   * month), with a legend when there is more than one. Labels are the points in time, oldest first.
   */
  trend(labels: string[], series: ChartSeries[], label: string) {
    const lines = series.filter((s) => s.values.some((v) => v !== null && Number.isFinite(v))).slice(0, SERIES.length);
    if (!labels.length || !lines.length) return;
    const h = 170;
    this.ensure(h + 50 + (lines.length > 1 ? Math.ceil(lines.length / 3) * 14 : 0));
    const words = lines.length === 1
      ? `Line chart: ${label}. ${labels.map((l, i) => `${l}: ${lines[0].values[i] === null ? 'no figure' : formatNumber(lines[0].values[i]!)}`).join('; ')}.`
      : `Line chart: ${label}. ${labels.map((l, i) => `${l}: ${lines.map((s) => `${s.name} ${s.values[i] === null ? 'no figure' : formatNumber(s.values[i]!)}`).join(', ')}`).join('; ')}.`;
    this.tag('Figure', () => this.lines(labels.slice(0, 60), lines.map((s) => ({ ...s, values: s.values.slice(0, 60) })), label, h), { alt: words.length > 1500 ? `${words.slice(0, 1497)}...` : words });
  }

  private bars(data: ChartPoint[], label: string) {
    const { doc } = this;
    const rowH = 16;
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
      this.base(true);
      doc.fontSize(8.5).fillColor(INK).text(formatNumber(p.value), this.left + nameW + trackW + 8, y + 3, { width: valueW, align: 'right', lineBreak: false });
      doc.y = y + rowH;
    }
    doc.x = this.left;
    doc.moveDown(0.6);
  }

  private lines(labels: string[], series: ChartSeries[], label: string, h: number) {
    const { doc } = this;
    doc.fontSize(8).fillColor(MUTED);
    this.write(label, this.left, doc.y, { width: this.width });
    const top = doc.y + 6;
    const axisW = 40;
    const x0 = this.left + axisW;
    const plotW = this.width - axisW - 8;
    const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
    const max = Math.max(...all, 0);
    const min = Math.min(0, ...all);
    const span = max - min || 1;
    const yOf = (v: number) => top + h - ((v - min) / span) * h;
    const xOf = (i: number) => x0 + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
    // Grid and scale.
    for (let g = 0; g <= 4; g++) {
      const v = min + (span * g) / 4;
      const y = yOf(v);
      doc.moveTo(x0, y).lineTo(x0 + plotW, y).lineWidth(0.4).strokeColor(RULE).stroke();
      this.base(false);
      doc.fontSize(7).fillColor(MUTED).text(formatNumber(v), this.left, y - 4, { width: axisW - 6, align: 'right', lineBreak: false });
    }
    series.forEach((s, k) => {
      const color = SERIES[k % SERIES.length];
      // A gap where a month has no figure: the line restarts after it.
      let drawing = false;
      s.values.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) { drawing = false; return; }
        if (!drawing) doc.moveTo(xOf(i), yOf(v)); else doc.lineTo(xOf(i), yOf(v));
        drawing = true;
      });
      doc.lineWidth(1.6).strokeColor(color).stroke();
      s.values.forEach((v, i) => { if (v !== null && Number.isFinite(v)) doc.circle(xOf(i), yOf(v), 2.2).fill(color); });
    });
    // Labels: first, last and a few between, so they never overlap.
    const step = Math.max(1, Math.ceil(labels.length / 6));
    labels.forEach((l, i) => {
      if (i % step !== 0 && i !== labels.length - 1) return;
      doc.fontSize(7).fillColor(MUTED);
      this.write(l, xOf(i) - 40, top + h + 4, { width: 80, align: 'center', lineBreak: false, ellipsis: true });
    });
    let y = top + h + 22;
    if (series.length > 1) {
      // Legend: a swatch and the series name, three to a line.
      const colW = this.width / 3;
      series.forEach((s, k) => {
        const x = this.left + (k % 3) * colW;
        if (k && k % 3 === 0) y += 14;
        doc.rect(x, y + 1, 8, 8).fill(SERIES[k % SERIES.length]);
        doc.fontSize(8.5).fillColor(INK);
        this.write(s.name, x + 14, y, { width: colW - 20, lineBreak: false, ellipsis: true });
      });
      y += 18;
    }
    doc.fillColor(INK);
    doc.x = this.left;
    doc.y = y;
  }

  private pie(data: ChartPoint[], label: string) {
    const { doc } = this;
    const r = 70;
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

  /** Writes headers, footers, page numbers and the watermark on every page (all artifacts), and returns the file. */
  async finish(): Promise<Buffer> {
    const { doc } = this;
    this.root.end();
    const range = doc.bufferedPageRange();
    const total = range.count;
    for (let i = range.start; i < range.start + total; i++) {
      doc.switchToPage(i);
      const { margins } = doc.page;
      const keep = margins.bottom;
      margins.bottom = 0; // writing in the margin must not start a new page
      const w = doc.page.width - margins.left - margins.right;
      this.artifact(() => {
        const mark = (this.opts.mark ?? '').trim().toUpperCase().slice(0, 24) || (this.opts.watermark ? 'RESTRICTED' : '');
        if (mark) {
          doc.save();
          doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
          this.base(true);
          doc.fontSize(mark.length > 12 ? 48 : 64).fillColor(DANGER).fillOpacity(0.07)
            .text(mark, 0, doc.page.height / 2 - 32, { width: doc.page.width, align: 'center', lineBreak: false });
          doc.restore();
          doc.fillOpacity(1);
        }
        const pageLine = clean(this.opts.pageLine ?? '').trim();
        if (this.opts.watermark) {
          doc.fontSize(8).fillColor(DANGER);
          this.write([this.opts.watermark, pageLine].filter(Boolean).join(' · '), margins.left, 24, { width: w, align: 'center', lineBreak: false, ellipsis: true, bold: true });
        } else if (pageLine) {
          doc.fontSize(8).fillColor(INK);
          this.write(pageLine, margins.left, 24, { width: w, align: 'center', lineBreak: false, ellipsis: true, bold: true });
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
        this.base(false);
        doc.text(`Page ${i + 1} of ${total}`, margins.left + w / 2, doc.page.height - 34, { width: w / 2, align: 'right', lineBreak: false });
      }, 'Pagination');
      margins.bottom = keep;
    }
    doc.end();
    return this.done;
  }
}

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const formatNumber = (v: number) => (Number.isFinite(v) ? numberFmt.format(v) : '');
