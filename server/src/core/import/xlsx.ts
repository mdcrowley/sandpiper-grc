// A small XLSX reader: enough of Office Open XML to take the cells out of a spreadsheet that a
// person saved from a spreadsheet program (or exported from this application). Shared and inline
// strings, numbers, booleans, and dates (cells whose number format is a date format) come back
// typed. Formulas are never worked out: a formula cell gives the value the program last stored.
import { strFromU8, unzipSync } from 'fflate';
import { serialToWall, wallDate, wallToInstant } from '../export/zone.ts';

export type CellValue = string | number | boolean | null;
export interface ReadSheet { name: string; rows: CellValue[][] }

export class XlsxError extends Error {}

/** Limits that keep a hostile file (a "zip bomb", a giant sheet) from exhausting the server. */
export const XLSX_LIMITS = { partBytes: 64 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, rows: 100_000, columns: 500 };

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeXml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }
  return ENTITY[e.toLowerCase()] ?? m;
});

const attr = (tag: string, name: string): string | undefined => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? unescapeXml(m[2] ?? m[3] ?? '') : undefined;
};

/** The text of every <t> in a fragment (rich text runs are joined; phonetic runs are left out). */
function textOf(fragment: string): string {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) out += unescapeXml(m[1] ?? '');
  return out;
}

const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
const BUILTIN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47]);

/** Whether a number format shows a date (d, m, y outside quotes and brackets), and whether it shows a time. */
function classifyFormat(code: string): { date: boolean; time: boolean } {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '').toLowerCase();
  const date = /[dy]/.test(bare) || (/m/.test(bare) && !/h|s/.test(bare));
  const time = /h|s/.test(bare);
  return { date: date || (time && !/0|#/.test(bare)), time };
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const resolve = (base: string, target: string) => {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const seg of target.split('/')) { if (seg === '..') parts.pop(); else if (seg !== '.') parts.push(seg); }
  return parts.join('/');
};

/** Reads every sheet (or only `onlySheet`) of an XLSX file. */
export function readXlsx(bytes: Uint8Array, onlySheet?: string): ReadSheet[] {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(file) {
        if (!/\.(xml|rels)$/i.test(file.name)) return false;
        if (file.originalSize > XLSX_LIMITS.partBytes) throw new XlsxError('The spreadsheet is too large to read.');
        total += file.originalSize;
        if (total > XLSX_LIMITS.totalBytes) throw new XlsxError('The spreadsheet is too large to read.');
        return true;
      },
    });
  } catch (err) {
    if (err instanceof XlsxError) throw err;
    throw new XlsxError('This is not a spreadsheet file that can be read (.xlsx).');
  }
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : '');
  const workbook = text('xl/workbook.xml');
  if (!workbook) throw new XlsxError('This is not a spreadsheet file that can be read (.xlsx).');

  // Shared strings.
  const shared: string[] = [];
  for (const m of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(textOf(m[1] ?? ''));

  // Which cell styles are dates (and date-times).
  const custom = new Map<number, string>();
  const styles = text('xl/styles.xml');
  for (const m of styles.matchAll(/<numFmt\s[^>]*>/g)) {
    const id = Number(attr(m[0], 'numFmtId'));
    const code = attr(m[0], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? '';
  const styleKind: ('date' | 'datetime' | 'time' | null)[] = [];
  for (const m of xfs.matchAll(/<xf\s[^>]*?\/?>/g)) {
    const id = Number(attr(m[0], 'numFmtId') ?? 0);
    if (custom.has(id)) {
      const c = classifyFormat(custom.get(id)!);
      styleKind.push(c.date ? (c.time ? 'datetime' : 'date') : null);
    } else if (BUILTIN_DATE.has(id)) styleKind.push(BUILTIN_TIME_ONLY.has(id) ? 'time' : id === 22 ? 'datetime' : 'date');
    else styleKind.push(null);
  }
  const date1904 = /<workbookPr\s[^>]*date1904\s*=\s*"(1|true)"/i.test(workbook);

  // Sheet names and where their parts are.
  const rels = new Map<string, string>();
  for (const m of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\s[^>]*>/g)) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) rels.set(id, resolve('xl/workbook.xml', target));
  }
  const out: ReadSheet[] = [];
  for (const m of workbook.matchAll(/<sheet\s[^>]*>/g)) {
    const name = attr(m[0], 'name') ?? `Sheet${out.length + 1}`;
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    if (attr(m[0], 'state') === 'hidden' || attr(m[0], 'state') === 'veryHidden') continue;
    if (onlySheet !== undefined && name !== onlySheet) continue;
    const part = rid ? rels.get(rid) : undefined;
    out.push({ name, rows: part ? readSheet(text(part), shared, styleKind, date1904) : [] });
  }
  return out;
}

/** Names of the visible sheets, without reading their cells. */
export function xlsxSheetNames(bytes: Uint8Array): string[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name === 'xl/workbook.xml' && f.originalSize < XLSX_LIMITS.partBytes });
  } catch {
    throw new XlsxError('This is not a spreadsheet file that can be read (.xlsx).');
  }
  const workbook = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : '';
  return [...workbook.matchAll(/<sheet\s[^>]*>/g)]
    .filter((m) => !['hidden', 'veryHidden'].includes(attr(m[0], 'state') ?? ''))
    .map((m) => attr(m[0], 'name') ?? '');
}

function readSheet(xml: string, shared: string[], styleKind: ('date' | 'datetime' | 'time' | null)[], date1904: boolean): CellValue[][] {
  const rows: CellValue[][] = [];
  const data = /<sheetData[^>]*>([\s\S]*?)<\/sheetData>/.exec(xml)?.[1] ?? '';
  let nextRow = 0;
  for (const rm of data.matchAll(/<row(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = rm[1] ? attr(rm[1], 'r') : undefined;
    const r = rAttr ? Number(rAttr) - 1 : nextRow;
    nextRow = r + 1;
    if (r >= XLSX_LIMITS.rows) throw new XlsxError(`The sheet has more than ${XLSX_LIMITS.rows} rows.`);
    const row: CellValue[] = [];
    let nextCol = 0;
    for (const cm of (rm[2] ?? '').matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = cm[1] ?? '';
      const ref = attr(tag, 'r');
      const c = ref ? columnIndex(ref) : nextCol;
      nextCol = c + 1;
      if (c >= XLSX_LIMITS.columns) continue;
      const body = cm[2] ?? '';
      const t = attr(tag, 't') ?? 'n';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let v: CellValue = null;
      if (t === 's') v = raw !== undefined ? shared[Number(raw)] ?? '' : null;
      else if (t === 'inlineStr') v = textOf(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (t === 'str') v = raw !== undefined ? unescapeXml(raw) : null;
      else if (t === 'b') v = raw === '1' || raw === 'true';
      else if (t === 'e') v = null;
      else if (t === 'd') v = raw !== undefined ? unescapeXml(raw) : null;
      else if (raw !== undefined && raw.trim() !== '') {
        const n = Number(raw);
        const kind = styleKind[Number(attr(tag, 's') ?? 0)] ?? null;
        v = Number.isFinite(n) ? (kind ? dateValue(n + (date1904 ? 1462 : 0), kind) : n) : unescapeXml(raw);
      }
      row[c] = v;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = null;
    rows[r] = row;
  }
  for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
  return rows;
}

/** A date serial as text: "YYYY-MM-DD" for a date, an ISO instant (organization time zone) for a date and time. */
function dateValue(serial: number, kind: 'date' | 'datetime' | 'time'): CellValue {
  const w = serialToWall(serial);
  if (kind === 'time') return `${String(w.h).padStart(2, '0')}:${String(w.mi).padStart(2, '0')}`;
  if (kind === 'date' || (w.h === 0 && w.mi === 0 && w.s === 0)) return wallDate(w);
  return wallToInstant(w).toISOString();
}
