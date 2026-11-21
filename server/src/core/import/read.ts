// Turns an uploaded file (CSV or XLSX) into a table: a header row and data rows. Everything after
// this step is the same for both kinds of file.
import { readXlsx, XlsxError, type CellValue } from './xlsx.ts';

export const IMPORT_LIMITS = { bytes: 5 * 1024 * 1024, rows: 5000, columns: 200 };

export class ImportFileError extends Error {}

export interface ImportTable {
  kind: 'csv' | 'xlsx';
  /** Sheet names (XLSX only) and the one read. */
  sheets: string[];
  sheet: string | null;
  headers: string[];
  rows: CellValue[][];
  /** The file's line (or sheet row) number of each data row. */
  lines: number[];
  /** How an uploaded CSV file was decoded (null for XLSX and pasted text). */
  encoding: 'utf-8' | 'windows-1252' | null;
  /** Things the person should know before importing (shown with the check). */
  warnings: string[];
}

/** The warning given when a CSV file was not UTF-8 and was read as Windows-1252 (BS-9). */
export const WINDOWS_1252_WARNING = 'The file is not UTF-8, so it was read as Windows-1252 (Excel "CSV (Comma delimited)" on Windows). '
  + 'Check that accented letters and symbols look right in the sample; if not, save it from Excel as "CSV UTF-8" and choose it again.';

/**
 * CSV bytes as text: UTF-8 when they are valid UTF-8 (with or without a byte order mark),
 * otherwise Windows-1252, the code page Excel on Windows writes "CSV (Comma delimited)" in.
 * Decoding non-UTF-8 bytes as UTF-8 used to turn every accented letter into "�" without a word.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: 'utf-8' | 'windows-1252' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** RFC 4180 style: quoted cells, doubled quotes, delimiters and line breaks inside quotes. */
export function parseCsv(input: string, delimiter = ','): string[][] {
  const text = input.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** The delimiter the header line uses most: comma, semicolon, tab or pipe. */
export function sniffDelimiter(text: string): string {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : ',';
}

const isXlsx = (name: string, bytes: Uint8Array) => /\.xlsx$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);

/** Decodes the upload: `content` is base64; `text` is CSV typed or pasted in. */
export function readUpload(input: { fileName?: unknown; content?: unknown; text?: unknown; sheet?: unknown; delimiter?: unknown }): ImportTable {
  const name = typeof input.fileName === 'string' ? input.fileName : '';
  let bytes: Uint8Array | null = null;
  let text: string | null = typeof input.text === 'string' ? input.text : null;
  if (typeof input.content === 'string' && input.content) {
    const b64 = input.content.replace(/^data:[^,]*,/, '');
    if (b64.length > Math.ceil(IMPORT_LIMITS.bytes / 3) * 4 + 8) throw new ImportFileError(`The file is larger than ${IMPORT_LIMITS.bytes / 1024 / 1024} MB.`);
    bytes = new Uint8Array(Buffer.from(b64, 'base64'));
  }
  if (!bytes && !text?.trim()) throw new ImportFileError('Choose a CSV or Excel (.xlsx) file first.');
  if (/\.xls$/i.test(name)) throw new ImportFileError('Older Excel files (.xls) cannot be read. Save the sheet as .xlsx or CSV.');

  let table: CellValue[][];
  let sheets: string[] = [];
  let sheet: string | null = null;
  let kind: 'csv' | 'xlsx' = 'csv';
  let encoding: ImportTable['encoding'] = null;
  const warnings: string[] = [];
  if (bytes && isXlsx(name, bytes)) {
    kind = 'xlsx';
    let read;
    try { read = readXlsx(bytes); } catch (err) {
      throw new ImportFileError(err instanceof XlsxError ? err.message : 'This spreadsheet could not be read.');
    }
    if (!read.length) throw new ImportFileError('The spreadsheet has no sheets.');
    sheets = read.map((s) => s.name);
    const wanted = typeof input.sheet === 'string' && input.sheet ? read.find((s) => s.name === input.sheet) : undefined;
    if (typeof input.sheet === 'string' && input.sheet && !wanted) throw new ImportFileError(`The spreadsheet has no sheet called "${input.sheet}".`);
    // By default the first sheet with something in it.
    const chosen = wanted ?? read.find((s) => s.rows.some((r) => r.some((v) => v !== null && v !== ''))) ?? read[0];
    sheet = chosen.name;
    table = chosen.rows;
  } else {
    if (bytes) {
      if (bytes.length > IMPORT_LIMITS.bytes) throw new ImportFileError(`The file is larger than ${IMPORT_LIMITS.bytes / 1024 / 1024} MB.`);
      ({ text, encoding } = decodeCsvBytes(bytes));
      if (encoding === 'windows-1252') warnings.push(WINDOWS_1252_WARNING);
    }
    if (text!.length > IMPORT_LIMITS.bytes) throw new ImportFileError(`The file is larger than ${IMPORT_LIMITS.bytes / 1024 / 1024} MB.`);
    if (text!.includes('\u0000')) throw new ImportFileError('This does not look like a CSV file. Choose a CSV or Excel (.xlsx) file.');
    const delimiter = typeof input.delimiter === 'string' && input.delimiter.length === 1 ? input.delimiter : sniffDelimiter(text!);
    table = parseCsv(text!, delimiter);
  }
  // Leading empty rows are skipped; the first row with content is the header. Line numbers are
  // the file's own (a spreadsheet's row numbers; for CSV, the record's position counting the header).
  const blank = (r: CellValue[]) => !r || r.every((v) => v === null || String(v).trim() === '');
  let at = 0;
  while (at < table.length && blank(table[at])) at++;
  const head = table[at] ?? [];
  const headers = head.map((h, i) => (h === null || String(h).trim() === '' ? `Column ${i + 1}` : String(h).trim()));
  if (!headers.length) throw new ImportFileError('The file is empty.');
  if (headers.length > IMPORT_LIMITS.columns) throw new ImportFileError(`The file has more than ${IMPORT_LIMITS.columns} columns.`);
  const rows: CellValue[][] = [];
  const lines: number[] = [];
  for (let i = at + 1; i < table.length; i++) {
    if (blank(table[i])) continue;
    rows.push(table[i]);
    lines.push(i + 1);
  }
  if (!rows.length) throw new ImportFileError('The file has a header row but no data rows.');
  if (rows.length > IMPORT_LIMITS.rows) throw new ImportFileError(`Import at most ${IMPORT_LIMITS.rows} rows at a time; this file has ${rows.length}.`);
  return { kind, sheets, sheet, headers, rows, lines, encoding, warnings };
}
