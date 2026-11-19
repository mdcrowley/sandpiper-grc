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
}
export interface FontFamily { regular: FontFace; bold: FontFace }

interface KitFont { postscriptName: string; hasGlyphForCodePoint(cp: number): boolean; fonts?: KitFont[] }
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
    return {
      key, path, postscript: font.postscriptName && /\.(ttc|dfont)$/i.test(path) ? font.postscriptName : undefined,
      has: (cp) => { let v = cache.get(cp); if (v === undefined) { v = font.hasGlyphForCodePoint(cp); cache.set(cp, v); } return v; },
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
