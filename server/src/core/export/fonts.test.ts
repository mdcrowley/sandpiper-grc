import { existsSync } from 'node:fs';
import { delimiter } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bidiClass, bidiLevels, boldSibling, pdfFonts, resetPdfFonts, SYSTEM_FONTS, toVisual } from './fonts.ts';
import { facesFor, fontFor, layoutText, needsRuns, PdfBuilder, printable } from './pdf.ts';
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

// E12-16: right-to-left text in display order, and text mixing scripts printed run by run.
describe('text direction and mixed scripts in PDFs', () => {
  it('puts right-to-left text in display order (Unicode bidirectional algorithm)', () => {
    expect(toVisual('שלום עולם')).toBe('םלוע םולש');
    // A left-to-right sentence keeps its order; the Hebrew word and the number after it read right to left.
    expect(toVisual('Depot שלום 12')).toBe('Depot 12 םולש');
    expect(toVisual('Depot שלום, bus')).toBe('Depot םולש, bus');
    // European digits after Arabic letters are Arabic numbers and keep their own order.
    expect(toVisual('رقم 123')).toBe('123 مقر');
    expect(toVisual('الخط 7 إلى المحطة')).toBe('ةطحملا ىلإ 7 طخلا');
    // Brackets are mirrored in right-to-left text, and a percentage stays whole.
    expect(toVisual('(שלום)')).toBe('(םולש)');
    expect(toVisual('מחיר: 25%')).toBe('25% :ריחמ');
    // Direction marks steer and are not printed.
    expect(toVisual('‏12 abc')).toBe('abc 12');
    expect(bidiLevels([...'abc']).base).toBe(0);
    expect(bidiLevels([...'אבג abc']).base).toBe(1);
    expect(bidiClass(0x5d0)).toBe('R');
    expect(bidiClass(0x627)).toBe('AL');
    expect(bidiClass(0x41)).toBe('L');
  });

  it('breaks a right-to-left paragraph into lines before reordering each line', () => {
    // Every character measures 1, so the line width is the number of characters.
    const measure = (_f: unknown, s: string) => [...s].length;
    const any = { key: 'test', path: '', has: () => true, reverses: () => false };
    const fonts = [{ regular: any, bold: any }];
    const lines = layoutText('אבג דהו זחט', false, measure, { width: 7, fonts });
    expect(lines.map((l) => l.runs.map((r) => r.visual).join(''))).toEqual(['והד גבא', 'טחז']);
    expect(lines.every((l) => l.rtl)).toBe(true);
    // One line with an ellipsis: the beginning of the text is kept.
    const one = layoutText('Depot north garage', false, measure, { width: 8, oneLine: true, fonts });
    expect(one).toHaveLength(1);
    expect(one[0].runs.map((r) => r.visual).join('')).toBe('Depot n…');
  });

  it('leaves text one font prints whole, left to right, to PDFKit', () => {
    expect(needsRuns('Depot café', false)).toBe(false);
    expect(needsRuns('שלום', false)).toBe(true);
  });

  const hebrew = fontsHere.find((f) => f.regular.has(0x5e9) && f.regular.has(0x627));
  it.skipIf(!hebrew)('hands a right-to-left run to the font whole, in the order the font expects', () => {
    const lines = layoutText('Depot שלום עולם 12', false, (_f, s) => [...s].length, { fonts: fontsHere });
    const runs = lines[0].runs;
    expect(runs.map((r) => r.visual).join('')).toBe('Depot 12 םלוע םולש');
    const rtl = runs.find((r) => r.face && /[א-ת]/.test(r.visual))!;
    // fontkit lays a Hebrew run out right to left itself, so it is given the typed order.
    expect(rtl.text).toBe([...rtl.visual].reverse().join(''));
  });

  const cjk = fontsHere.find((f) => f.regular.has(0x72b6));
  const noCjk = fontsHere.find((f) => f.regular.has(0x5e9) && !f.regular.has(0x72b6));
  it.skipIf(!cjk || !noCjk)('prints text mixing scripts no single font covers, run by run, without "?"', () => {
    const fonts = [noCjk!, cjk!];
    const text = 'Depot שלום 状态 Αμαξοστάσιο';
    expect(fontFor(text, false, fonts).text).toContain('?');
    const { faces, out } = facesFor([...text], false, fonts);
    expect(out.join('')).not.toContain('?');
    expect(new Set(faces).size).toBeGreaterThan(1);
  });

  it.skipIf(!hebrew)('makes a PDF with Hebrew, Arabic and mixed text in every part', async () => {
    const pdf = new PdfBuilder({ title: 'דוח תחנות', subtitle: 'تقرير المحطات', meta: ['Generated today', 'מסנן: סטטוס = פתוח'], watermark: 'מוגבל' });
    pdf.heading('Summary סיכום');
    pdf.paragraph('הקו 7 עובר דרך המסוף הצפוני (Depot North) ומגיע לתחנה המרכזית בשעה 08:30. '.repeat(4));
    pdf.table([{ header: 'שם' }, { header: 'Count', align: 'right' }], [['אוטובוס', '3'], ['حافلة', '4'], ['Bus שלום', '5']], { boldLast: true });
    pdf.chart('bar', [{ label: 'אוטובוס', value: 3 }, { label: 'حافلة', value: 4 }], 'רכבים');
    pdf.chart('pie', [{ label: 'אוטובוס', value: 3 }, { label: 'حافلة', value: 4 }], 'רכבים');
    pdf.keyValues([{ label: 'מיקום', value: 'المحطة الشمالية' }]);
    pdf.figures([{ label: 'סה"כ', value: '7' }]);
    pdf.note('אין רשומות');
    pdf.markdown('- ראשון\n- ثاني');
    const file = await pdf.finish();
    const raw = file.toString('latin1');
    expect(raw).toContain('/FontFile2');
    expect(raw).toContain('/ToUnicode');
    expect(pdfText(file)).toContain('Generated today');
  });
});
