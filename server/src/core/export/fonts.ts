// Fonts for server-made PDFs beyond the standard Helvetica (E12-14).
//
// The standard PDF fonts print Western European text only (Windows-1252). For anything else
// (Greek, Cyrillic, Hebrew, Arabic, Chinese, Japanese, Korean, Indic scripts, symbols) the PDF
// builder embeds a TrueType or OpenType font, only the glyphs used (a subset). No font ships with
// the application: it uses the fonts the machine already has, or those an administrator names.
//
//   GRC_PDF_FONTS   Font files to use, in order of preference, separated by the platform's path
//                   separator (";" on Windows, ":" elsewhere). A collection (.ttc) may name one
//                   font with "#": `/fonts/NotoSansCJK-Regular.ttc#NotoSansCJKjp-Regular`.
//                   "none" switches embedding off. When unset, well-known system fonts are used
//                   (Noto and DejaVu on Linux, Arial Unicode on macOS, Segoe UI, Arial, YaHei,
//                   Yu Gothic, Malgun Gothic and Nirmala on Windows).
//
// The bold face of each font is found beside it by its usual file name (Regular -> Bold,
// segoeui -> segoeuib, arial -> arialbd); without one, bold text is printed in the regular face.
// Fonts are read with fontkit, which PDFKit already uses: no package is added.
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, delimiter, dirname, extname, join } from 'node:path';

export interface FontFace {
  /** The name the PDF builder registers it under. */
  key: string;
  path: string;
  /** For a collection: which font in it. */
  postscript?: string;
  has(codePoint: number): boolean;
  /** True when the font lays this text out right to left (fontkit reverses the glyphs of a right-to-left script). */
  reverses(text: string): boolean;
}
export interface FontFamily { regular: FontFace; bold: FontFace }

interface KitFont { postscriptName: string; hasGlyphForCodePoint(cp: number): boolean; layout(text: string): { direction?: string }; fonts?: KitFont[] }
type FontKit = { openSync(path: string, postscriptName?: string): KitFont };

let kit: FontKit | null | undefined;
function fontkit(): FontKit | null {
  if (kit === undefined) {
    try {
      // fontkit is PDFKit's own dependency; resolve it from PDFKit so that it is the copy PDFKit uses.
      const req = createRequire(import.meta.url);
      kit = createRequire(req.resolve('pdfkit'))('fontkit') as FontKit;
    } catch {
      kit = null;
    }
  }
  return kit;
}

const WIN = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
const win = (f: string) => join(WIN, 'Fonts', f);

/** Well-known system fonts with wide coverage, most general first. Missing files are skipped. */
export const SYSTEM_FONTS: string[] = [
  // Linux (Debian and Ubuntu, Fedora, Arch, Alpine)
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/google-noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf',
  '/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf',
  // macOS
  '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
  '/Library/Fonts/Arial Unicode.ttf',
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  // Windows
  win('segoeui.ttf'), win('arial.ttf'), win('msyh.ttc'), win('YuGothR.ttc'), win('malgun.ttf'), win('Nirmala.ttc'), win('seguisym.ttf'),
];

/** The usual file name of a font's bold face, beside it. */
export function boldSibling(path: string): string | null {
  const dir = dirname(path);
  const ext = extname(path);
  const name = basename(path, ext);
  const tries = [
    name.replace(/-Regular$/i, '-Bold'), name.replace(/Regular$/i, 'Bold'), `${name}-Bold`, `${name}b`, `${name}bd`, `${name}B`,
    name.replace(/R$/, 'B'), name.replace(/ Unicode$/, ' Unicode Bold'), `${name} Bold`,
  ].filter((n) => n !== name);
  for (const n of [...new Set(tries)]) {
    for (const e of [ext, ext.toLowerCase(), ext.toUpperCase()]) {
      const p = join(dir, `${n}${e}`);
      if (isFile(p)) return p;
    }
  }
  return null;
}

const isFile = (p: string) => { try { return existsSync(p) && statSync(p).isFile(); } catch { return false; } };

function open(entry: string, key: string): FontFace | null {
  const k = fontkit();
  if (!k) return null;
  const [path, wanted] = entry.split('#');
  if (!isFile(path)) return null;
  try {
    let font = k.openSync(path, wanted || undefined);
    // A collection opened without a name: its first font.
    if (font.fonts?.length) font = font.fonts[0];
    if (typeof font.hasGlyphForCodePoint !== 'function') return null;
    const cache = new Map<number, boolean>();
    const dirs = new Map<string, boolean>();
    return {
      key, path, postscript: font.postscriptName && /\.(ttc|dfont)$/i.test(path) ? font.postscriptName : undefined,
      has: (cp) => { let v = cache.get(cp); if (v === undefined) { v = font.hasGlyphForCodePoint(cp); cache.set(cp, v); } return v; },
      reverses: (text) => {
        let v = dirs.get(text);
        if (v === undefined) {
          try { v = font.layout(text).direction === 'rtl'; } catch { v = false; }
          if (dirs.size > 5000) dirs.clear();
          dirs.set(text, v);
        }
        return v;
      },
    };
  } catch {
    return null;
  }
}

let families: FontFamily[] | undefined;

/** The fonts to embed, in order of preference (worked out once, on first use). */
export function pdfFonts(): FontFamily[] {
  if (families) return families;
  const setting = (process.env.GRC_PDF_FONTS ?? '').trim();
  const entries = setting.toLowerCase() === 'none' ? [] : setting ? setting.split(delimiter).map((s) => s.trim()).filter(Boolean) : SYSTEM_FONTS;
  families = [];
  entries.forEach((entry, i) => {
    const regular = open(entry, `grc-font-${i}`);
    if (!regular) {
      if (setting) console.warn(`[pdf] the font "${entry}" in GRC_PDF_FONTS could not be read; it is skipped.`);
      return;
    }
    const sibling = entry.includes('#') ? null : boldSibling(regular.path);
    const bold = (sibling && open(sibling, `grc-font-${i}-bold`)) || regular;
    families!.push({ regular, bold });
  });
  return families;
}

/** For tests: forget the fonts found, so that a changed GRC_PDF_FONTS is read again. */
export function resetPdfFonts() { families = undefined; }

// ---------------------------------------------------------------------------------------------
// Text direction (E12-16). PDFKit shapes Arabic and Hebrew but prints the words of a sentence in
// the order they were typed, left to right. The essentials of the Unicode Bidirectional Algorithm
// (UAX #9) put them in display order: the paragraph direction from its first strong character
// (P2, P3), the weak-type rules (W1 to W7), the neutral rules (N1, N2), the implicit levels (I1,
// I2), and, per printed line, trailing white space at the paragraph level (L1), reordering (L2) and
// mirrored brackets (L4). Explicit embeddings and isolates (U+202A to U+202E, U+2066 to U+2069) are
// not applied: they are ignored like other invisible formatting characters, and the left-to-right
// and right-to-left marks (U+200E, U+200F, U+061C) count as the strong characters they stand for.
// Written here rather than taken from a package: the essentials are short, need no data files, and
// the application adds no npm package for a feature this small.

export type BidiClass = 'L' | 'R' | 'AL' | 'EN' | 'ES' | 'ET' | 'AN' | 'CS' | 'NSM' | 'BN' | 'B' | 'S' | 'WS' | 'ON';

// Characters whose class is not L, as [first, last, class], sorted. Anything not listed is L.
// The scripts in use today and their punctuation are covered; rarer historic scripts take the
// usual direction of their block.
const BIDI_RANGES: [number, number, BidiClass][] = [
  [0x00, 0x08, 'BN'], [0x09, 0x09, 'S'], [0x0a, 0x0a, 'B'], [0x0b, 0x0b, 'S'], [0x0c, 0x0c, 'WS'], [0x0d, 0x0d, 'B'],
  [0x0e, 0x1b, 'BN'], [0x1c, 0x1e, 'B'], [0x1f, 0x1f, 'S'], [0x20, 0x20, 'WS'], [0x21, 0x22, 'ON'], [0x23, 0x25, 'ET'],
  [0x26, 0x2a, 'ON'], [0x2b, 0x2b, 'ES'], [0x2c, 0x2c, 'CS'], [0x2d, 0x2d, 'ES'], [0x2e, 0x2f, 'CS'], [0x30, 0x39, 'EN'],
  [0x3a, 0x3a, 'CS'], [0x3b, 0x40, 'ON'], [0x5b, 0x60, 'ON'], [0x7b, 0x7e, 'ON'], [0x7f, 0x84, 'BN'], [0x85, 0x85, 'B'],
  [0x86, 0x9f, 'BN'], [0xa0, 0xa0, 'CS'], [0xa1, 0xa1, 'ON'], [0xa2, 0xa5, 'ET'], [0xa6, 0xa9, 'ON'], [0xab, 0xac, 'ON'],
  [0xad, 0xad, 'BN'], [0xae, 0xaf, 'ON'], [0xb0, 0xb1, 'ET'], [0xb2, 0xb3, 'EN'], [0xb4, 0xb4, 'ON'], [0xb6, 0xb8, 'ON'],
  [0xb9, 0xb9, 'EN'], [0xbb, 0xbf, 'ON'], [0xd7, 0xd7, 'ON'], [0xf7, 0xf7, 'ON'],
  [0x2b9, 0x2ba, 'ON'], [0x2c2, 0x2cf, 'ON'], [0x2d2, 0x2df, 'ON'], [0x2e5, 0x2ed, 'ON'], [0x2ef, 0x2ff, 'ON'],
  [0x300, 0x36f, 'NSM'], [0x374, 0x375, 'ON'], [0x37e, 0x37e, 'ON'], [0x384, 0x385, 'ON'], [0x387, 0x387, 'ON'],
  [0x483, 0x489, 'NSM'], [0x58a, 0x58a, 'ON'], [0x58d, 0x58e, 'ON'], [0x58f, 0x58f, 'ET'],
  // Hebrew
  [0x590, 0x590, 'R'], [0x591, 0x5bd, 'NSM'], [0x5be, 0x5be, 'R'], [0x5bf, 0x5bf, 'NSM'], [0x5c0, 0x5c0, 'R'],
  [0x5c1, 0x5c2, 'NSM'], [0x5c3, 0x5c3, 'R'], [0x5c4, 0x5c5, 'NSM'], [0x5c6, 0x5c6, 'R'], [0x5c7, 0x5c7, 'NSM'], [0x5c8, 0x5ff, 'R'],
  // Arabic, Syriac, Thaana, NKo and their neighbors
  [0x600, 0x605, 'AN'], [0x606, 0x607, 'ON'], [0x608, 0x608, 'AL'], [0x609, 0x60a, 'ET'], [0x60b, 0x60b, 'AL'], [0x60c, 0x60c, 'CS'],
  [0x60d, 0x60d, 'AL'], [0x60e, 0x60f, 'ON'], [0x610, 0x61a, 'NSM'], [0x61b, 0x64a, 'AL'], [0x64b, 0x65f, 'NSM'], [0x660, 0x669, 'AN'],
  [0x66a, 0x66a, 'ET'], [0x66b, 0x66c, 'AN'], [0x66d, 0x66f, 'AL'], [0x670, 0x670, 'NSM'], [0x671, 0x6d5, 'AL'], [0x6d6, 0x6dc, 'NSM'],
  [0x6dd, 0x6dd, 'AN'], [0x6de, 0x6de, 'ON'], [0x6df, 0x6e4, 'NSM'], [0x6e5, 0x6e6, 'AL'], [0x6e7, 0x6e8, 'NSM'], [0x6e9, 0x6e9, 'ON'],
  [0x6ea, 0x6ed, 'NSM'], [0x6ee, 0x6ef, 'AL'], [0x6f0, 0x6f9, 'EN'], [0x6fa, 0x710, 'AL'], [0x711, 0x711, 'NSM'], [0x712, 0x72f, 'AL'],
  [0x730, 0x74a, 'NSM'], [0x74b, 0x7a5, 'AL'], [0x7a6, 0x7b0, 'NSM'], [0x7b1, 0x7bf, 'AL'], [0x7c0, 0x7ea, 'R'], [0x7eb, 0x7f3, 'NSM'],
  [0x7f4, 0x7f5, 'R'], [0x7f6, 0x7f9, 'ON'], [0x7fa, 0x7fc, 'R'], [0x7fd, 0x7fd, 'NSM'], [0x7fe, 0x815, 'R'], [0x816, 0x82d, 'NSM'],
  [0x82e, 0x858, 'R'], [0x859, 0x85b, 'NSM'], [0x85c, 0x85f, 'R'], [0x860, 0x88f, 'AL'], [0x890, 0x891, 'AN'], [0x892, 0x89f, 'NSM'],
  [0x8a0, 0x8c9, 'AL'], [0x8ca, 0x8e1, 'NSM'], [0x8e2, 0x8e2, 'AN'], [0x8e3, 0x902, 'NSM'],
  // Marks of the Indic and Thai scripts that sit on their letters.
  [0x93a, 0x93a, 'NSM'], [0x93c, 0x93c, 'NSM'], [0x941, 0x948, 'NSM'], [0x94d, 0x94d, 'NSM'], [0x951, 0x957, 'NSM'], [0x962, 0x963, 'NSM'],
  [0xe31, 0xe31, 'NSM'], [0xe34, 0xe3a, 'NSM'], [0xe3f, 0xe3f, 'ET'], [0xe47, 0xe4e, 'NSM'],
  [0x1680, 0x1680, 'WS'], [0x17db, 0x17db, 'ET'], [0x180e, 0x180e, 'BN'],
  [0x2000, 0x200a, 'WS'], [0x200b, 0x200d, 'BN'], [0x200e, 0x200e, 'L'], [0x200f, 0x200f, 'R'], [0x2010, 0x2027, 'ON'],
  [0x2028, 0x2028, 'WS'], [0x2029, 0x2029, 'B'], [0x202a, 0x202e, 'BN'], [0x202f, 0x202f, 'CS'], [0x2030, 0x2034, 'ET'],
  [0x2035, 0x2043, 'ON'], [0x2044, 0x2044, 'CS'], [0x2045, 0x205e, 'ON'], [0x205f, 0x205f, 'WS'], [0x2060, 0x206f, 'BN'],
  [0x2070, 0x2070, 'EN'], [0x2074, 0x2079, 'EN'], [0x207a, 0x207b, 'ES'], [0x207c, 0x207e, 'ON'], [0x2080, 0x2089, 'EN'],
  [0x208a, 0x208b, 'ES'], [0x208c, 0x208e, 'ON'], [0x20a0, 0x20cf, 'ET'], [0x20d0, 0x20f0, 'NSM'], [0x2100, 0x2101, 'ON'],
  [0x2103, 0x2106, 'ON'], [0x2108, 0x2109, 'ON'], [0x2114, 0x2114, 'ON'], [0x2116, 0x2118, 'ON'], [0x211e, 0x2123, 'ON'],
  [0x2125, 0x2125, 'ON'], [0x2127, 0x2127, 'ON'], [0x2129, 0x2129, 'ON'], [0x212e, 0x212e, 'ET'], [0x213a, 0x213b, 'ON'],
  [0x2140, 0x2144, 'ON'], [0x214a, 0x214d, 'ON'], [0x2150, 0x215f, 'ON'], [0x2189, 0x218b, 'ON'], [0x2190, 0x2211, 'ON'],
  [0x2212, 0x2212, 'ES'], [0x2213, 0x2213, 'ET'], [0x2214, 0x2335, 'ON'], [0x237b, 0x2394, 'ON'], [0x2396, 0x2429, 'ON'],
  [0x2440, 0x244a, 'ON'], [0x2460, 0x2487, 'ON'], [0x2488, 0x249b, 'EN'], [0x24ea, 0x26ab, 'ON'], [0x26ad, 0x27ff, 'ON'],
  [0x2900, 0x2b73, 'ON'], [0x2b76, 0x2bff, 'ON'], [0x2ce5, 0x2cea, 'ON'], [0x2cf9, 0x2cff, 'ON'], [0x2e00, 0x2e5d, 'ON'],
  [0x2e80, 0x2fff, 'ON'], [0x3000, 0x3000, 'WS'], [0x3001, 0x3004, 'ON'], [0x3008, 0x3020, 'ON'], [0x302a, 0x302d, 'NSM'],
  [0x3030, 0x3030, 'ON'], [0x3036, 0x3037, 'ON'], [0x303d, 0x303f, 'ON'], [0x3099, 0x309a, 'NSM'], [0x309b, 0x309c, 'ON'],
  [0x30a0, 0x30a0, 'ON'], [0x30fb, 0x30fb, 'ON'], [0xa490, 0xa4c6, 'ON'],
  [0xfb1d, 0xfb1d, 'R'], [0xfb1e, 0xfb1e, 'NSM'], [0xfb1f, 0xfb28, 'R'], [0xfb29, 0xfb29, 'ES'], [0xfb2a, 0xfb4f, 'R'],
  [0xfb50, 0xfd3d, 'AL'], [0xfd3e, 0xfd4f, 'ON'], [0xfd50, 0xfdcf, 'AL'], [0xfdf0, 0xfdfc, 'AL'], [0xfdfd, 0xfdff, 'ON'],
  [0xfe00, 0xfe0f, 'NSM'], [0xfe10, 0xfe19, 'ON'], [0xfe20, 0xfe2f, 'NSM'], [0xfe30, 0xfe4f, 'ON'], [0xfe50, 0xfe50, 'CS'],
  [0xfe51, 0xfe51, 'ON'], [0xfe52, 0xfe52, 'CS'], [0xfe54, 0xfe54, 'ON'], [0xfe55, 0xfe55, 'CS'], [0xfe56, 0xfe5e, 'ON'],
  [0xfe5f, 0xfe5f, 'ET'], [0xfe60, 0xfe61, 'ON'], [0xfe62, 0xfe63, 'ES'], [0xfe64, 0xfe68, 'ON'], [0xfe69, 0xfe6a, 'ET'],
  [0xfe6b, 0xfe6b, 'ON'], [0xfe70, 0xfefe, 'AL'], [0xfeff, 0xfeff, 'BN'], [0xff01, 0xff02, 'ON'], [0xff03, 0xff05, 'ET'],
  [0xff06, 0xff0a, 'ON'], [0xff0b, 0xff0b, 'ES'], [0xff0c, 0xff0c, 'CS'], [0xff0d, 0xff0d, 'ES'], [0xff0e, 0xff0f, 'CS'],
  [0xff10, 0xff19, 'EN'], [0xff1a, 0xff1a, 'CS'], [0xff1b, 0xff20, 'ON'], [0xff3b, 0xff40, 'ON'], [0xff5b, 0xff65, 'ON'],
  [0xffe0, 0xffe1, 'ET'], [0xffe2, 0xffe4, 'ON'], [0xffe5, 0xffe6, 'ET'], [0xffe8, 0xffee, 'ON'], [0xfff9, 0xfffd, 'ON'],
  [0x10800, 0x10cff, 'R'], [0x10d00, 0x10d3f, 'AL'], [0x10e60, 0x10e7e, 'AN'], [0x10e80, 0x10f2f, 'R'],
  [0x10f30, 0x10f6f, 'AL'], [0x10f70, 0x10fff, 'R'], [0x1d7ce, 0x1d7ff, 'EN'], [0x1e800, 0x1ec6f, 'R'], [0x1ec70, 0x1ecbf, 'AL'],
  [0x1ecc0, 0x1ecff, 'R'], [0x1ed00, 0x1ed4f, 'AL'], [0x1ed50, 0x1edff, 'R'], [0x1ee00, 0x1eeff, 'AL'], [0x1ef00, 0x1efff, 'R'],
  [0x1f000, 0x1f0ff, 'ON'], [0x1f100, 0x1f10a, 'EN'], [0x1f10b, 0x1f10f, 'ON'], [0x1f300, 0x1faff, 'ON'],
  [0xe0001, 0xe007f, 'BN'], [0xe0100, 0xe01ef, 'NSM'],
];

/** The bidirectional class of a character (UAX #9, table 4); unlisted characters are L. */
export function bidiClass(cp: number): BidiClass {
  if (cp === 0x61c) return 'AL'; // the Arabic letter mark
  let lo = 0;
  let hi = BIDI_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b, c] = BIDI_RANGES[mid];
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return c;
  }
  return 'L';
}

/** Invisible characters that only steer direction; they are never printed. */
export const isDirectionMark = (cp: number) => cp === 0x200e || cp === 0x200f || cp === 0x61c || (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069);

/** True when the text holds a right-to-left character or a direction mark, so it needs reordering. */
export function needsBidi(text: string): boolean {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x590) continue;
    const c = bidiClass(cp);
    if (c === 'R' || c === 'AL' || c === 'AN' || isDirectionMark(cp)) return true;
  }
  return false;
}

/**
 * The embedding level of each character of one paragraph (no line breaks), and the paragraph's
 * own level: 0 when its first strong character is left-to-right (or it has none), 1 when it is
 * right-to-left. `base` forces the paragraph direction.
 */
export function bidiLevels(chars: string[], base?: 0 | 1): { levels: number[]; base: 0 | 1 } {
  const types: BidiClass[] = chars.map((ch) => bidiClass(ch.codePointAt(0)!));
  // P2, P3: the paragraph level.
  let level: 0 | 1 = base ?? 0;
  if (base === undefined) {
    for (const x of types) {
      if (x === 'L') { level = 0; break; }
      if (x === 'R' || x === 'AL') { level = 1; break; }
    }
  }
  const sos: BidiClass = level ? 'R' : 'L';
  const n = types.length;
  // X9: formatting characters (BN) are skipped by the rules that follow and take the level of
  // what comes before them.
  const idx = types.map((_, i) => i).filter((i) => types[i] !== 'BN');
  const t = idx.map((i) => types[i]);
  const m = t.length;
  // W1: a non-spacing mark takes the type of the character before it.
  for (let k = 0; k < m; k++) if (t[k] === 'NSM') t[k] = k ? t[k - 1] : sos;
  // W2: European digits after Arabic letters are Arabic digits. W3: Arabic letters are R.
  let strong: BidiClass = sos;
  for (let k = 0; k < m; k++) {
    if (t[k] === 'L' || t[k] === 'R' || t[k] === 'AL') strong = t[k];
    else if (t[k] === 'EN' && strong === 'AL') t[k] = 'AN';
  }
  for (let k = 0; k < m; k++) if (t[k] === 'AL') t[k] = 'R';
  // W4: one separator between two numbers of the same kind joins them.
  for (let k = 1; k < m - 1; k++) {
    if (t[k] === 'ES' && t[k - 1] === 'EN' && t[k + 1] === 'EN') t[k] = 'EN';
    else if (t[k] === 'CS' && t[k - 1] === t[k + 1] && (t[k - 1] === 'EN' || t[k - 1] === 'AN')) t[k] = t[k - 1];
  }
  // W5: terminators (currency signs, percent) next to European digits become digits.
  for (let k = 0; k < m; k++) {
    if (t[k] !== 'ET') continue;
    let e = k;
    while (e < m && t[e] === 'ET') e++;
    if ((k > 0 && t[k - 1] === 'EN') || (e < m && t[e] === 'EN')) for (let j = k; j < e; j++) t[j] = 'EN';
    k = e - 1;
  }
  // W6: other separators and terminators are neutral.
  for (let k = 0; k < m; k++) if (t[k] === 'ES' || t[k] === 'ET' || t[k] === 'CS') t[k] = 'ON';
  // W7: European digits in left-to-right context are L.
  strong = sos;
  for (let k = 0; k < m; k++) {
    if (t[k] === 'L' || t[k] === 'R') strong = t[k];
    else if (t[k] === 'EN' && strong === 'L') t[k] = 'L';
  }
  // N1, N2: a run of neutrals between two characters of the same direction takes it (numbers count
  // as right-to-left); otherwise it takes the paragraph's direction.
  const dir = (x: BidiClass): 'L' | 'R' | null => (x === 'L' ? 'L' : x === 'R' || x === 'EN' || x === 'AN' ? 'R' : null);
  const resolved: ('L' | 'R' | 'EN' | 'AN')[] = t.map((x) => (x === 'L' || x === 'R' || x === 'EN' || x === 'AN' ? x : 'L'));
  for (let k = 0; k < m; k++) {
    if (dir(t[k])) continue;
    let e = k;
    while (e < m && !dir(t[e])) e++;
    const before = k > 0 ? dir(t[k - 1])! : sos;
    const after = e < m ? dir(t[e])! : sos;
    const fill = before === after ? before : sos;
    for (let j = k; j < e; j++) resolved[j] = fill as 'L' | 'R';
    k = e - 1;
  }
  // I1, I2: implicit levels.
  const levels = new Array<number>(n).fill(level);
  idx.forEach((i, k) => {
    const x = resolved[k];
    if (level === 0) levels[i] = x === 'R' ? 1 : x === 'AN' || x === 'EN' ? 2 : 0;
    else levels[i] = x === 'L' || x === 'EN' || x === 'AN' ? 2 : 1;
  });
  for (let i = 0; i < n; i++) if (types[i] === 'BN') levels[i] = i ? levels[i - 1] : level;
  // L1, for tabs: a tab and the white space before it return to the paragraph level.
  for (let i = 0; i < n; i++) {
    if (types[i] !== 'S') continue;
    levels[i] = level;
    for (let j = i - 1; j >= 0 && (types[j] === 'WS' || types[j] === 'BN'); j--) levels[j] = level;
  }
  return { levels, base: level };
}

const MIRROR_PAIRS = '()<>[]{}«»‹›⁅⁆⁽⁾₍₎≤≥∈∋⟨⟩⟪⟫〈〉《》「」『』【】〔〕〖〗〘〙〚〛﴾﴿（）＜＞［］｛｝｢｣';
const MIRROR = new Map<string, string>();
for (let i = 0; i < MIRROR_PAIRS.length; i += 2) {
  MIRROR.set(MIRROR_PAIRS[i], MIRROR_PAIRS[i + 1]);
  MIRROR.set(MIRROR_PAIRS[i + 1], MIRROR_PAIRS[i]);
}
/** The mirrored form of a bracket or similar paired character, for right-to-left text (L4). */
export const mirrored = (ch: string) => MIRROR.get(ch) ?? ch;

/** White space that returns to the paragraph level at the end of a line (L1). */
export const isTrailingSpace = (ch: string) => { const c = bidiClass(ch.codePointAt(0)!); return c === 'WS' || c === 'BN' || c === 'S'; };

/**
 * The display order of one line, as indexes into its characters from left to right (L2). White
 * space at the line's end is put back at the paragraph level first (L1).
 */
export function visualOrder(chars: string[], levels: number[], paragraph: number): number[] {
  const lv = [...levels];
  for (let i = lv.length - 1; i >= 0 && isTrailingSpace(chars[i]); i--) lv[i] = paragraph;
  const order = lv.map((_, i) => i);
  if (!lv.length) return order;
  const max = Math.max(...lv);
  const odd = lv.filter((l) => l % 2 === 1);
  const lowestOdd = odd.length ? Math.min(...odd) : max + 1;
  for (let level = max; level >= lowestOdd; level--) {
    for (let i = 0; i < order.length; i++) {
      if (lv[order[i]] < level) continue;
      let e = i;
      while (e < order.length && lv[order[e]] >= level) e++;
      const slice = order.slice(i, e).reverse();
      order.splice(i, e - i, ...slice);
      i = e - 1;
    }
  }
  return order;
}

/** One line of text in display order, with direction marks dropped and brackets mirrored. */
export function toVisual(text: string, base?: 0 | 1): string {
  const chars = [...text];
  const { levels, base: p } = bidiLevels(chars, base);
  return visualOrder(chars, levels, p)
    .filter((i) => !isDirectionMark(chars[i].codePointAt(0)!))
    .map((i) => (levels[i] % 2 ? mirrored(chars[i]) : chars[i])).join('');
}
