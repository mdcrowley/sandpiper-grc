import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { writeXlsx } from '../export/xlsx.ts';
import { readUpload } from './read.ts';
import { readXlsx, XlsxError } from './xlsx.ts';

// SP-02: crafted spreadsheets used to take time quadratic in the size of the sheet XML (a 2 KB
// upload blocked the whole server for 22 s). Bounds are generous for slow machines.

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** A minimal workbook whose one sheet's XML (and optionally shared strings and styles) is given. */
function book(sheetXml: string, extra: Record<string, string> = {}): Uint8Array {
  const files: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(sheetXml),
  };
  for (const [k, v] of Object.entries(extra)) files[k] = strToU8(v);
  return zipSync(files, { level: 9 });
}

function timed<T>(fn: () => T): { value: T | Error; ms: number } {
  const started = Date.now();
  let value: T | Error;
  try { value = fn(); } catch (err) { value = err as Error; }
  return { value, ms: Date.now() - started };
}

describe('hostile spreadsheets (SP-02)', () => {
  it('reads the 2 KB "unclosed rows" file quickly', () => {
    const file = book(`<worksheet><sheetData>${'<row>'.repeat(120_000)}</sheetData></worksheet>`);
    expect(file.length).toBeLessThan(4096);
    const { value, ms } = timed(() => readUpload({ fileName: 'x.xlsx', content: b64(file) }));
    expect(ms).toBeLessThan(2000);
    expect((value as Error).message).toMatch(/no data rows|empty/);
  });

  it('reads other crafted parts in linear time', () => {
    const cases = [
      book(`<worksheet><sheetData><row>${'<c>'.repeat(300_000)}</row></sheetData></worksheet>`),
      book(`<worksheet>${'<sheetData>'.repeat(200_000)}</worksheet>`),
      book(`<worksheet><sheetData><row><c>${'<v>'.repeat(300_000)}</c></row></sheetData></worksheet>`),
      book(`<worksheet><sheetData><row><c r="${'r="'.repeat(300_000)}"/></row></sheetData></worksheet>`),
      book('<worksheet><sheetData/></worksheet>', { 'xl/sharedStrings.xml': `<sst>${'<si><t>'.repeat(200_000)}</sst>` }),
      book('<worksheet><sheetData/></worksheet>', { 'xl/styles.xml': `<styleSheet>${'<numFmt '.repeat(300_000)}${'<cellXfs>'.repeat(100_000)}</styleSheet>` }),
      book(`<worksheet><sheetData><row><c t="inlineStr"><is>${'<rPh>'.repeat(200_000)}</is></c></row></sheetData></worksheet>`),
      book(`<worksheet><sheetData><row><c t="str"><v>${'&#1'.repeat(300_000)}</v></c></row></sheetData></worksheet>`),
    ];
    for (const file of cases) {
      const { ms } = timed(() => readXlsx(file));
      expect(ms).toBeLessThan(2000);
    }
  });

  it('refuses a sheet with too many cells instead of building it', () => {
    const row = (r: number) => `<row r="${r}"><c r="SF${r}"><v>1</v></c></row>`;
    const file = book(`<worksheet><sheetData>${Array.from({ length: 20_000 }, (_, i) => row(i + 1)).join('')}</sheetData></worksheet>`);
    const { value, ms } = timed(() => readXlsx(file));
    expect(value).toBeInstanceOf(XlsxError);
    expect((value as Error).message).toContain('too many cells');
    expect(ms).toBeLessThan(3000);
  });

  it('still reads ordinary files the same way', () => {
    const file = writeXlsx({ sheets: [{ name: 'Gizmos', columns: [{ header: 'Name', type: 'text' }, { header: 'Due', type: 'date' }, { header: 'Cost', type: 'currency' }, { header: 'On', type: 'boolean' }],
      rows: [['Café <relay> & "co"', '2026-07-01', 310.25, true], [null, null, -1, false]] }] });
    const [sheet] = readXlsx(file);
    expect(sheet.rows).toEqual([['Name', 'Due', 'Cost', 'On'], ['Café <relay> & "co"', '2026-07-01', 310.25, 'Yes'], [null, null, -1, 'No']]);
    // Hand-made parts: attributes in single quotes, rich text with a phonetic run, gaps.
    const hand = book(`<worksheet><sheetData><row r='2'><c r='B2' t='inlineStr'><is><r><t>Wa</t></r><rPh><t>x</t></rPh><r><t xml:space="preserve">y side</t></r></is></c></row></sheetData></worksheet>`);
    expect(readXlsx(hand)[0].rows).toEqual([[], [null, 'Way side']]);
  });
});
