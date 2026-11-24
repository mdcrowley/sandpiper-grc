import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { PdfBuilder } from './pdf.ts';
import { checkPdfUa } from './pdfua.ts';
import { pdfText } from './testing.ts';

// E41-13: every PDF the server makes is tagged and passes an automated PDF/UA-1 check.

const untagged = () => new Promise<Buffer>((resolve) => {
  const doc = new PDFDocument();
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.text('Plain text in a standard font');
  doc.rect(10, 10, 50, 50).fill('#ff0000');
  doc.end();
});

describe('PDF/UA check', () => {
  it('fails a plain, untagged PDF on every count', async () => {
    const r = await checkPdfUa(await untagged());
    expect(r.failures.join('\n')).toMatch(/not marked as tagged/);
    expect(r.failures.join('\n')).toMatch(/no natural language/);
    expect(r.failures.join('\n')).toMatch(/neither tagged nor marked as artifacts/);
    expect(r.failures.join('\n')).toMatch(/not embedded/);
    expect(r.failures.join('\n')).toMatch(/no structure tree/);
  });

  it('passes a document using every part of the builder, with a cover, restricted marking and a long table', async () => {
    const pdf = new PdfBuilder({
      title: 'Board report: risks & issues <draft>', subtitle: 'Quarter to date', meta: ['As at today', 'Prepared for a reviewer'],
      cover: true, watermark: 'Restricted export by a reviewer', appName: 'Sandpiper GRC', author: 'A reviewer',
      branding: { name: 'Example Transit', lines: ['1 Depot Road'], logo: null, color: '#225588' },
    });
    pdf.heading('Summary');
    pdf.paragraph('Every figure counts every record.');
    pdf.figures([{ label: 'Open risks', value: '12' }, { label: 'Overdue actions', value: '3' }]);
    pdf.note('Nothing else to report.');
    pdf.markdown('## Highlights\n- First point\n- Second point\n1. Numbered\n2. Again\n\nA closing line.');
    pdf.keyValues([{ label: 'Owner', value: 'Safety team' }, { label: 'Due', value: 'Next month' }]);
    pdf.heading('Figures over time');
    pdf.trend(['Jan 2026', 'Feb 2026', 'Mar 2026'], [{ name: 'High', values: [3, 4, null] }, { name: 'Low', values: [5, 2, 1] }], 'Open risks by level');
    pdf.chart('bar', [{ label: 'Open', value: 4 }, { label: 'Closed', value: 7 }], 'Count by status');
    pdf.chart('pie', [{ label: 'Bus', value: 4 }, { label: 'Rail', value: 3 }], 'Count by mode');
    pdf.chart('line', [{ label: 'Q1', value: 4 }, { label: 'Q2', value: 6 }], 'Count by quarter');
    pdf.table([{ header: 'Reference' }, { header: 'Title' }, { header: 'Count', align: 'right' }],
      Array.from({ length: 120 }, (_, i) => [`R-${i}`, `Row ${i} with a longer title that wraps`, String(i)]), { boldLast: true, boldFirstColumn: true });
    const file = await pdf.finish();
    const r = await checkPdfUa(file);
    expect(r.failures).toEqual([]);
    expect(r.lang).toBe('en-US');
    expect(r.title).toBe('Board report: risks & issues <draft>');
    // Title, section, its Markdown sub-heading, the next section.
    expect(r.headings).toEqual(['H1', 'H2', 'H3', 'H2']);
    expect(r.roles).toEqual(expect.arrayContaining(['Document', 'Table', 'THead', 'TBody', 'TR', 'TH', 'TD', 'L', 'LI', 'Lbl', 'LBody', 'Figure', 'P']));
    expect(r.figures.some((a) => a.startsWith('Line chart: Open risks by level. Jan 2026: High 3, Low 5'))).toBe(true);
    expect(r.figures.some((a) => a.includes('Bar chart: Count by status. Open: 4; Closed: 7'))).toBe(true);
    expect(r.pages).toBeGreaterThan(3);
    // The text still reads back through the embedded font's map.
    expect(pdfText(file)).toContain('Every figure counts every record.');
  });

  it('keeps heading levels from skipping when a document starts with a sub-heading', async () => {
    const pdf = new PdfBuilder({ title: 'Audit report' });
    pdf.heading('Scope', 2);
    pdf.heading('Detail', 2);
    pdf.paragraph('Text');
    const r = await checkPdfUa(await pdf.finish());
    expect(r.failures).toEqual([]);
    expect(r.headings).toEqual(['H1', 'H2', 'H2']);
  });

  it('records another language when asked', async () => {
    const pdf = new PdfBuilder({ title: 'Rapport', lang: 'fr-CA' });
    pdf.paragraph('Bonjour');
    const r = await checkPdfUa(await pdf.finish());
    expect(r.failures).toEqual([]);
    expect(r.lang).toBe('fr-CA');
  });
});
