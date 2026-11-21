// A small XLSX reader: enough of Office Open XML to take the cells out of a spreadsheet that a
// person saved from a spreadsheet program (or exported from this application). Shared and inline
// strings, numbers, booleans, and dates (cells whose number format is a date format) come back
// typed. Formulas are never worked out: a formula cell gives the value the program last stored.
import { strFromU8, unzipSync } from 'fflate';
import { serialToWall, wallDate, wallToInstant } from '../export/zone.ts';

export type CellValue = string | number | boolean | null;
export interface ReadSheet { name: string; rows: CellValue[][] }

export class XlsxError extends Error {}

/**
 * Limits that keep a hostile file (a "zip bomb", a giant sheet) from exhausting the server.
 * `cells` bounds the cells (filled or not) held for all sheets together.
 */
export const XLSX_LIMITS = { partBytes: 64 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, rows: 100_000, columns: 500, cells: 5_000_000 };

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
// Bounded quantifiers: linear in the length of the text.
export const unescapeXml = (s: string) => (s.includes('&') ? s.replace(/&(#x[0-9a-f]{1,8}|#\d{1,9}|[a-z]{1,8});/gi, (m, e: string) => {
  if (e[0] === '#') {
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  }
  return ENTITY[e.toLowerCase()] ?? m;
}) : s);

// ---------- a linear XML scanner (SP-02) ----------
// Every search below is an indexOf that moves forward, and a missing closing tag stops the scan,
// so the work is linear in the size of the part however the file is crafted. (Lazy regular
// expressions such as `<row>([\s\S]*?)</row>` rescanned to the end for every unclosed tag.)

/** Whether `<name` at `at` is that element (and not `<nameMore`). */
function isElementAt(xml: string, at: number, name: string): boolean {
  const ch = xml.charCodeAt(at + 1 + name.length);
  // whitespace, ">", "/"
  return ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 62 || ch === 47;
}

interface Element { /** The attributes of the opening tag. */ attrs: Map<string, string>; /** The content, or null for `<name/>`. */ body: string | null }

/** The attributes of an opening tag ("<c r="A1" t='s'>" without the brackets), read once, linearly. */
function attrsOf(tag: string): Map<string, string> {
  const map = new Map<string, string>();
  const n = tag.length;
  let i = 0;
  while (i < n) {
    const eq = tag.indexOf('=', i);
    if (eq < 0) break;
    const key = tag.slice(i, eq).trim().split(/\s+/).pop() ?? '';
    let q = eq + 1;
    while (q < n && (tag[q] === ' ' || tag[q] === '\t' || tag[q] === '\n' || tag[q] === '\r')) q += 1;
    const quote = tag[q];
    if (quote !== '"' && quote !== "'") { i = q; continue; }
    const end = tag.indexOf(quote, q + 1);
    if (end < 0) break;
    if (key && !map.has(key)) map.set(key, unescapeXml(tag.slice(q + 1, end)));
    i = end + 1;
  }
  return map;
}

/** Every `<name ...>` opening tag (attributes only), in order. */
function* openTags(xml: string, name: string, from = 0, to = xml.length): Generator<Map<string, string>> {
  let i = from;
  for (;;) {
    const at = xml.indexOf(`<${name}`, i);
    if (at < 0 || at >= to) return;
    if (!isElementAt(xml, at, name)) { i = at + 1; continue; }
    const gt = xml.indexOf('>', at);
    if (gt < 0 || gt >= to) return;
    yield attrsOf(xml.slice(at + 1 + name.length, xml[gt - 1] === '/' ? gt - 1 : gt));
    i = gt + 1;
  }
}

/** Every `<name ...>...</name>` or `<name/>` element (not nested in itself), in order. */
function* elements(xml: string, name: string, from = 0, to = xml.length): Generator<Element> {
  const close = `</${name}>`;
  let i = from;
  for (;;) {
    const at = xml.indexOf(`<${name}`, i);
    if (at < 0 || at >= to) return;
    if (!isElementAt(xml, at, name)) { i = at + 1; continue; }
    const gt = xml.indexOf('>', at);
    if (gt < 0 || gt >= to) return;
    const selfClosing = xml[gt - 1] === '/';
    const attrs = attrsOf(xml.slice(at + 1 + name.length, selfClosing ? gt - 1 : gt));
    if (selfClosing) { yield { attrs, body: null }; i = gt + 1; continue; }
    const end = xml.indexOf(close, gt + 1);
    // Not closed: the rest of the part is not well formed and is left out.
    if (end < 0 || end + close.length > to) return;
    yield { attrs, body: xml.slice(gt + 1, end) };
    i = end + close.length;
  }
}

/** The content of the first `<name>...</name>`, or ''. */
const firstBody = (xml: string, name: string): string => {
  for (const e of elements(xml, name)) return e.body ?? '';
  return '';
};

/** The text of every <t> in a fragment (rich text runs are joined; phonetic runs are left out). */
function textOf(fragment: string): string {
  let clean = fragment;
  if (fragment.includes('<rPh')) {
    // Phonetic runs removed in one forward pass.
    const parts: string[] = [];
    let i = 0;
    for (;;) {
      const at = fragment.indexOf('<rPh', i);
      if (at < 0) { parts.push(fragment.slice(i)); break; }
      parts.push(fragment.slice(i, at));
      const end = fragment.indexOf('</rPh>', at);
      if (end < 0) break;
      i = end + 6;
    }
    clean = parts.join('');
  }
  let out = '';
  for (const e of elements(clean, 't')) out += unescapeXml(e.body ?? '');
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
  for (const e of elements(text('xl/sharedStrings.xml'), 'si')) shared.push(textOf(e.body ?? ''));

  // Which cell styles are dates (and date-times).
  const custom = new Map<number, string>();
  const styles = text('xl/styles.xml');
  for (const a of openTags(styles, 'numFmt')) {
    const id = Number(a.get('numFmtId'));
    const code = a.get('formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, code);
  }
  const xfs = firstBody(styles, 'cellXfs');
  const styleKind: ('date' | 'datetime' | 'time' | null)[] = [];
  for (const a of openTags(xfs, 'xf')) {
    const id = Number(a.get('numFmtId') ?? 0);
    if (custom.has(id)) {
      const c = classifyFormat(custom.get(id)!);
      styleKind.push(c.date ? (c.time ? 'datetime' : 'date') : null);
    } else if (BUILTIN_DATE.has(id)) styleKind.push(BUILTIN_TIME_ONLY.has(id) ? 'time' : id === 22 ? 'datetime' : 'date');
    else styleKind.push(null);
  }
  let date1904 = false;
  for (const a of openTags(workbook, 'workbookPr')) { date1904 = /^(1|true)$/i.test(a.get('date1904') ?? ''); break; }

  // Sheet names and where their parts are.
  const rels = new Map<string, string>();
  for (const a of openTags(text('xl/_rels/workbook.xml.rels'), 'Relationship')) {
    const id = a.get('Id');
    const target = a.get('Target');
    if (id && target) rels.set(id, resolve('xl/workbook.xml', target));
  }
  const out: ReadSheet[] = [];
  const budget = { cells: XLSX_LIMITS.cells };
  for (const a of openTags(workbook, 'sheet')) {
    const name = a.get('name') ?? `Sheet${out.length + 1}`;
    const rid = a.get('r:id') ?? a.get('id');
    if (a.get('state') === 'hidden' || a.get('state') === 'veryHidden') continue;
    if (onlySheet !== undefined && name !== onlySheet) continue;
    const part = rid ? rels.get(rid) : undefined;
    out.push({ name, rows: part ? readSheet(text(part), shared, styleKind, date1904, budget) : [] });
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
  return [...openTags(workbook, 'sheet')]
    .filter((a) => !['hidden', 'veryHidden'].includes(a.get('state') ?? ''))
    .map((a) => a.get('name') ?? '');
}

/** The content of the first `<name>...</name>` in a cell, or undefined. */
function child(body: string, name: string): string | undefined {
  if (!body.includes(`<${name}`)) return undefined;
  for (const e of elements(body, name)) return e.body ?? '';
  return undefined;
}

function readSheet(xml: string, shared: string[], styleKind: ('date' | 'datetime' | 'time' | null)[], date1904: boolean, budget: { cells: number }): CellValue[][] {
  const rows: CellValue[][] = [];
  const data = firstBody(xml, 'sheetData');
  let nextRow = 0;
  const tooLarge = () => new XlsxError('The spreadsheet has too many cells to read. Remove empty rows and columns, or split it.');
  for (const rm of elements(data, 'row')) {
    const rAttr = rm.attrs.get('r');
    const r = rAttr ? Number(rAttr) - 1 : nextRow;
    if (!Number.isInteger(r) || r < 0) continue;
    nextRow = r + 1;
    if (r >= XLSX_LIMITS.rows) throw new XlsxError(`The sheet has more than ${XLSX_LIMITS.rows} rows.`);
    const row: CellValue[] = [];
    let nextCol = 0;
    for (const cm of elements(rm.body ?? '', 'c')) {
      const ref = cm.attrs.get('r');
      const c = ref ? columnIndex(ref) : nextCol;
      nextCol = c + 1;
      if (c < 0 || c >= XLSX_LIMITS.columns) continue;
      const body = cm.body ?? '';
      const t = cm.attrs.get('t') ?? 'n';
      const raw = child(body, 'v');
      let v: CellValue = null;
      if (t === 's') v = raw !== undefined ? shared[Number(raw)] ?? '' : null;
      else if (t === 'inlineStr') v = textOf(child(body, 'is') ?? '');
      else if (t === 'str') v = raw !== undefined ? unescapeXml(raw) : null;
      else if (t === 'b') v = raw === '1' || raw === 'true';
      else if (t === 'e') v = null;
      else if (t === 'd') v = raw !== undefined ? unescapeXml(raw) : null;
      else if (raw !== undefined && raw.trim() !== '') {
        const n = Number(raw);
        const kind = styleKind[Number(cm.attrs.get('s') ?? 0)] ?? null;
        v = Number.isFinite(n) ? (kind ? dateValue(n + (date1904 ? 1462 : 0), kind) : n) : unescapeXml(raw);
      }
      row[c] = v;
    }
    budget.cells -= Math.max(1, row.length);
    if (budget.cells < 0) throw tooLarge();
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
