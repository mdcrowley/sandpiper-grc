// A small Office Open XML spreadsheet (XLSX) writer: shared strings, a bold header row, typed
// cells (numbers, currency, dates and date-times as real spreadsheet dates in the organisation's
// time zone, yes/no), a frozen header, an auto-filter and column widths. The package is zipped
// with fflate; nothing else is needed.
import { strToU8, zipSync, type Zippable } from 'fflate';
import { CURRENCY } from '../config.ts';
import { wallClock, wallToSerial } from './zone.ts';

export type CellType = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean' | 'percent';

export interface SheetColumn {
  header: string;
  type: CellType;
  /** Width in characters; worked out from the content when left out. */
  width?: number;
}

export interface Sheet {
  name: string;
  columns: SheetColumn[];
  rows: unknown[][];
  /** Lines written above the table (title, filters, generated time). The table starts below them. */
  preface?: string[];
  /** Restricted export: a red line under the table, and the same text in the printed page header. */
  watermark?: string;
}

export interface WorkbookInput {
  sheets: Sheet[];
  title?: string;
  author?: string;
}

// Style indexes (cellXfs order in styles.xml below).
const S = { text: 0, header: 1, date: 2, datetime: 3, currency: 4, number: 5, percent: 6, title: 7, warn: 8, muted: 9 } as const;

const xmlEsc = (s: string) => s
  // Characters XML 1.0 cannot carry at all.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
  .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** "A", "B", ... "Z", "AA" for a zero-based column index. */
export function columnName(i: number): string {
  let n = i + 1;
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function currencyFormat(): string {
  let symbol = CURRENCY;
  try {
    symbol = new Intl.NumberFormat('en', { style: 'currency', currency: CURRENCY, currencyDisplay: 'narrowSymbol' })
      .formatToParts(0).find((p) => p.type === 'currency')?.value ?? CURRENCY;
  } catch { /* unknown code: show the code */ }
  const quoted = `"${symbol.replace(/"/g, '')}"`;
  return `${quoted}#,##0.00;-${quoted}#,##0.00`;
}

const STYLES = () => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="166" formatCode="${xmlEsc(currencyFormat())}"/><numFmt numFmtId="167" formatCode="0.0&quot;%&quot;"/></numFmts>
<fonts count="5"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF14252B"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF951B1B"/><name val="Calibri"/><family val="2"/></font><font><sz val="10"/><color rgb="FF50626A"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EEEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF17656F"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

class SharedStrings {
  private index = new Map<string, number>();
  readonly list: string[] = [];
  count = 0;
  add(s: string): number {
    this.count += 1;
    let i = this.index.get(s);
    if (i === undefined) { i = this.list.length; this.list.push(s); this.index.set(s, i); }
    return i;
  }
  xml(): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${this.count}" uniqueCount="${this.list.length}">${
      this.list.map((s) => `<si><t xml:space="preserve">${xmlEsc(s)}</t></si>`).join('')}</sst>`;
  }
}

/** A value as a spreadsheet date serial, or null when it is not a date. */
function dateSerial(v: unknown, type: 'date' | 'datetime'): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split('-').map(Number);
    return wallToSerial({ y, m, d, h: 0, mi: 0, s: 0 });
  }
  const at = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(at.getTime())) return null;
  const w = wallClock(at);
  return type === 'date' ? wallToSerial({ ...w, h: 0, mi: 0, s: 0 }) : wallToSerial(w);
}

/** Text a person reads for a value that has no typed cell. */
export function plainText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const MAX_CELL = 32_767; // longest text a spreadsheet cell holds

function cellXml(ref: string, v: unknown, type: CellType, ss: SharedStrings): string {
  if (v === null || v === undefined || v === '') return '';
  if (type === 'number' || type === 'currency' || type === 'percent') {
    const n = typeof v === 'number' ? v : Number(v);
    if (typeof v !== 'boolean' && Number.isFinite(n) && String(v).trim() !== '') {
      return `<c r="${ref}" s="${type === 'currency' ? S.currency : type === 'percent' ? S.percent : S.number}"><v>${n}</v></c>`;
    }
  } else if (type === 'date' || type === 'datetime') {
    const serial = dateSerial(v, type);
    if (serial !== null) return `<c r="${ref}" s="${type === 'date' ? S.date : S.datetime}"><v>${Number(serial.toFixed(8))}</v></c>`;
  } else if (type === 'boolean' && typeof v === 'boolean') {
    return `<c r="${ref}" t="s"><v>${ss.add(v ? 'Yes' : 'No')}</v></c>`;
  }
  // Text is always a shared string, never a formula: nothing in a cell is ever worked out.
  return `<c r="${ref}" t="s"><v>${ss.add(plainText(v).slice(0, MAX_CELL))}</v></c>`;
}

function widthOf(col: SheetColumn, rows: unknown[][], i: number): number {
  if (col.width) return col.width;
  const fixed = col.type === 'date' ? 12 : col.type === 'datetime' ? 17 : col.type === 'currency' ? 14 : 0;
  let longest = col.header.length + 2;
  for (const row of rows.slice(0, 500)) {
    const s = plainText(row[i]);
    const first = s.split(/\r?\n/)[0];
    longest = Math.max(longest, Math.min(first.length, 60) + 1);
  }
  return Math.max(8, Math.min(60, Math.max(fixed, longest)));
}

/** A sheet name the spreadsheet accepts: at most 31 characters, none of []:*?/\, unique in the book. */
export function sheetName(raw: string, taken: Set<string>): string {
  const base = (raw.replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

function sheetXml(sheet: Sheet, ss: SharedStrings): { xml: string; filterRef: string | null } {
  const out: string[] = [];
  const preface = sheet.preface ?? [];
  let r = 0;
  for (const [i, line] of preface.entries()) {
    r += 1;
    out.push(`<row r="${r}"><c r="A${r}" t="s" s="${i === 0 ? S.title : S.muted}"><v>${ss.add(line)}</v></c></row>`);
  }
  if (preface.length) r += 1; // a blank line before the table
  const headerRow = r + 1;
  const cols = sheet.columns;
  r += 1;
  out.push(`<row r="${r}">${cols.map((c, i) => `<c r="${columnName(i)}${r}" t="s" s="${S.header}"><v>${ss.add(c.header)}</v></c>`).join('')}</row>`);
  for (const row of sheet.rows) {
    r += 1;
    out.push(`<row r="${r}">${cols.map((c, i) => cellXml(`${columnName(i)}${r}`, row[i], c.type, ss)).join('')}</row>`);
  }
  const lastData = r;
  if (sheet.watermark) {
    r += 2;
    out.push(`<row r="${r}"><c r="A${r}" t="s" s="${S.warn}"><v>${ss.add(sheet.watermark)}</v></c></row>`);
  }
  const lastCol = columnName(Math.max(0, cols.length - 1));
  const filterRef = cols.length ? `A${headerRow}:${lastCol}${Math.max(lastData, headerRow)}` : null;
  const pane = `<pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/>`;
  const widths = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${widthOf(c, sheet.rows, i)}" customWidth="1"/>`).join('');
  const header = sheet.watermark ? `<headerFooter><oddHeader>&amp;C&amp;"-,Bold"${xmlEsc(sheet.watermark.replace(/&/g, '&&'))}</oddHeader><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>` : '<headerFooter><oddFooter>&amp;CPage &amp;P of &amp;N</oddFooter></headerFooter>';
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr filterMode="false"><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${lastCol}${Math.max(r, 1)}"/>
<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${widths ? `<cols>${widths}</cols>` : ''}
<sheetData>${out.join('')}</sheetData>
${filterRef ? `<autoFilter ref="${filterRef}"/>` : ''}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup orientation="${cols.length > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>
${header}
</worksheet>`;
  return { xml, filterRef };
}

/** Builds the workbook and returns the bytes of the .xlsx file. */
export function writeXlsx(input: WorkbookInput): Uint8Array {
  const ss = new SharedStrings();
  const taken = new Set<string>();
  const sheets = (input.sheets.length ? input.sheets : [{ name: 'Sheet1', columns: [], rows: [] }]).map((s) => ({ ...s, name: sheetName(s.name, taken) }));
  const files: Zippable = {};
  const defined: string[] = [];
  sheets.forEach((s, i) => {
    const { xml, filterRef } = sheetXml(s, ss);
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(xml);
    if (filterRef) {
      const abs = filterRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xmlEsc(s.name.replace(/'/g, "''"))}'!${abs}</definedName>`);
    }
  });
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files['[Content_Types].xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${
  sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  files['_rels/.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  files['docProps/core.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(input.title ?? sheets[0].name)}</dc:title><dc:creator>${xmlEsc(input.author ?? '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`);
  files['docProps/app.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Sandpiper GRC</Application></Properties>`);
  files['xl/workbook.xml'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${
  sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
}</sheets>${defined.length ? `<definedNames>${defined.join('')}</definedNames>` : ''}</workbook>`);
  files['xl/_rels/workbook.xml.rels'] = strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${
  sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`);
  files['xl/styles.xml'] = strToU8(STYLES());
  files['xl/sharedStrings.xml'] = strToU8(ss.xml());
  return zipSync(files, { level: 6 });
}

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
