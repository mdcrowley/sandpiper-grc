import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { convertDocx, fileOnlyReport } from './docx.ts';
import { boldPara, bullet, image, insertion, makeDocx, makePdf, para, pdfText, table } from './fixtures.ts';
import { stampPdf } from './stamp.ts';

// The Word converter and the PDF stamp, run in the sandbox (E43-06, E43-08). Invented text only.

describe('Word to Markdown', () => {
  it('keeps headings, lists, tables, bold text and images', async () => {
    const docx = makeDocx([
      para('Network change procedure', 'Title'),
      para('Purpose', 'Heading1'),
      boldPara('Every change to the ', 'depot network', ' is recorded.'),
      bullet('Raise a change request'),
      bullet('Get approval'),
      table([['Step', 'Owner'], ['Plan', 'Network team'], ['Pipe | test', 'Change board']]),
      image('Wiring diagram of the invented depot'),
    ], { image: true, footer: 'SOP-IT-014 Revision C Effective Date: 03/15/2024' });
    const r = await convertDocx(docx, 'procedure.docx');
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.markdown).toContain('# Network change procedure');
    expect(r.markdown).toContain('# Purpose');
    expect(r.markdown).toContain('**depot network**');
    expect(r.markdown).toMatch(/^- Raise a change request$/m);
    expect(r.markdown).toContain('| Step | Owner |');
    expect(r.markdown).toMatch(/\| --- \| --- \|/);
    expect(r.markdown).toContain('Pipe \\| test');
    expect(r.markdown).toContain('![Wiring diagram of the invented depot](attachment:pending-1)');
    expect(r.images).toHaveLength(1);
    expect(r.images[0].contentType).toBe('image/png');
    expect(r.report).toMatchObject({ status: 'converted', tracked_changes: false, images: 1 });
    expect(r.report.dropped).toContain('headers and footers');
    expect(r.report.suggested).toEqual({ version_label: 'Revision C', effective_on: '2024-03-15', doc_number: 'SOP-IT-014' });
  });

  it('reports tracked changes and comments', async () => {
    const r = await convertDocx(makeDocx([para('Body text'), insertion('Inserted words')], { comment: 'Check this' }), 'draft.docx');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.report.tracked_changes).toBe(true);
    expect(r.report.comments).toBe(1);
    expect(r.report.warnings.join(' ')).toMatch(/tracked changes/);
    expect(r.report.warnings.join(' ')).toMatch(/1 comment was left out/);
  });

  it('refuses a zip bomb before unpacking, and files that are not Word documents', async () => {
    const big = new Uint8Array(30 * 1024 * 1024); // compresses to almost nothing
    const bomb = makeDocx([para('x')], { extra: { 'word/media/filler.bin': big } });
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const r = await convertDocx(bomb, 'bomb.docx', { maxUnpacked: 10 * 1024 * 1024 });
    expect(r).toMatchObject({ ok: false, code: 'too_large' });
    const notWord = Buffer.from(zipSync({ 'hello.txt': strToU8('not a document') }));
    expect(await convertDocx(notWord, 'x.docx')).toMatchObject({ ok: false, code: 'not_word' });
    expect(await convertDocx(Buffer.from('plain text'), 'y.docx')).toMatchObject({ ok: false });
  });

  it('stops a conversion that takes too long', async () => {
    const r = await convertDocx(makeDocx([para('Slow')]), 'slow.docx', { timeoutMs: 1 });
    expect(r).toMatchObject({ ok: false, code: 'conversion_stopped' });
  });

  it('says why a legacy .doc or a PDF is kept as a file only', () => {
    expect(fileOnlyReport('old.doc', 'doc')).toMatchObject({ status: 'file_only', note: expect.stringMatching(/save it as \.docx/) });
    expect(fileOnlyReport('a.pdf', 'pdf').note).toMatch(/scanned PDF/);
  });
});

describe('controlled-copy stamp', () => {
  it('puts the control block and watermark on every page, in an embedded font', async () => {
    const pdf = await makePdf(['First page of the invented manual', 'Second page']);
    const out = await stampPdf(pdf, { header: 'MAN-OPS-001 · Invented operations manual · Rev. 2', footer: 'Version 2 · Page {page} of {pages} · Uncontrolled when printed', watermark: 'SUPERSEDED', restricted: true });
    const text = await pdfText(out);
    expect(text).toContain('First page of the invented manual');
    expect(text).toContain('MAN-OPS-001');
    expect(text).toContain('Page 1 of 2');
    expect(text).toContain('Page 2 of 2');
    expect(text).toContain('Restricted distribution');
    expect(text).toContain('SUPERSEDED');
    // No standard (unembedded) font was added.
    expect(out.toString('latin1')).not.toMatch(/\/BaseFont\s*\/Helvetica\b/);
  });

  it('refuses something that is not a PDF', async () => {
    await expect(stampPdf(Buffer.from('not a pdf'), { header: 'x', footer: 'y' })).rejects.toThrow(/could not be stamped/);
  });
});
