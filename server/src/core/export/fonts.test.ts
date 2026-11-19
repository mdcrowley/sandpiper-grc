import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { boldSibling, pdfFonts, resetPdfFonts, SYSTEM_FONTS } from './fonts.ts';
import { fontFor, PdfBuilder, printable } from './pdf.ts';
import { pdfText } from './testing.ts';

// E12-14: text outside Windows-1252 is printed with an embedded font from the machine (or GRC_PDF_FONTS).
const before = process.env.GRC_PDF_FONTS;
afterEach(() => { if (before === undefined) delete process.env.GRC_PDF_FONTS; else process.env.GRC_PDF_FONTS = before; resetPdfFonts(); });

const system = SYSTEM_FONTS.filter((p) => existsSync(p));
const fontsHere = (() => { resetPdfFonts(); return pdfFonts(); })();
const greekFont = fontsHere.find((f) => f.regular.has(0x3b1));

describe('fonts for server-made PDFs', () => {
  it('keeps Western European text in the standard font, so nothing is embedded', async () => {
    expect(fontFor('Depot café – “north”', false).face).toBeNull();
    const pdf = new PdfBuilder({ title: 'Plain report', meta: ['Generated today'] });
    pdf.table([{ header: 'Name' }], [['Bus garage']]);
    const file = await pdf.finish();
    expect(file.toString('latin1')).not.toContain('/FontFile2');
    expect(pdfText(file)).toContain('Bus garage');
  });

  it('prints "?" for characters no font has, and only then', () => {
    process.env.GRC_PDF_FONTS = 'none';
    resetPdfFonts();
    expect(pdfFonts()).toEqual([]);
    expect(fontFor('Αθήνα depot', false).text).toBe('????? depot');
    expect(printable('Bus – “Depot” café ✓ 東京')).toBe('Bus – “Depot” café ? ??');
  });

  it('skips a named font that cannot be read, and finds bold faces beside regular ones', () => {
    process.env.GRC_PDF_FONTS = ['/no/such/font.ttf', ...system.slice(0, 1)].join(delimiter);
    resetPdfFonts();
    expect(pdfFonts().length).toBe(system.length ? 1 : 0);
    expect(boldSibling('/no/such/NotoSans-Regular.ttf')).toBeNull();
  });

  it.skipIf(!fontsHere.some((f) => f.regular.has(0x72b6)))('picks the font that has every character of a piece of text', () => {
    // Segoe UI, DejaVu or Noto Sans come first but have no Chinese: a font further down the list that has it is used.
    const pick = fontFor('状态', false);
    expect(pick.face?.has(0x72b6)).toBe(true);
    expect(pick.text).toBe('状态');
  });

  it.skipIf(!greekFont)('embeds a font for Greek, Cyrillic and other scripts, in regular and bold', async () => {
    const pick = fontFor('Οδηγός λεωφορείου · Водитель', false);
    expect(pick.face).not.toBeNull();
    expect(pick.text).not.toContain('?');
    const pdf = new PdfBuilder({ title: 'Αμαξοστάσιο Βόρειο', subtitle: 'Депо', meta: ['Generated today'], watermark: 'Ограничено' });
    pdf.heading('Σύνοψη');
    pdf.table([{ header: 'Όνομα' }, { header: 'Count', align: 'right' }], [['Λεωφορείο', '3'], ['Трамвай', '4']], { boldLast: true });
    pdf.chart('bar', [{ label: 'Λεωφορείο', value: 3 }, { label: 'Трамвай', value: 4 }], 'Οχήματα');
    pdf.keyValues([{ label: 'Τοποθεσία', value: 'Βόρειο' }]);
    pdf.figures([{ label: 'Σύνολο', value: '7' }]);
    pdf.markdown('- Πρώτο\n- Второй');
    const file = await pdf.finish();
    const raw = file.toString('latin1');
    expect(raw).toContain('/FontFile2');
    // The subset carries a map back to the characters, so the text can be searched and copied.
    expect(raw).toContain('/ToUnicode');
    // The Latin parts are still in Helvetica.
    expect(pdfText(file)).toContain('Generated today');
  });
});
