import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { PdfBuilder } from '../../core/export/pdf.ts';
import { checkPdfUa } from '../../core/export/pdfua.ts';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { makePdf, pdfText } from '../policies/convert/fixtures.ts';
// @ts-expect-error plain JavaScript module of the board book sandbox
import { tokenize } from './book-structure.mjs';
import { appendPdfs, inspectPdfs } from './book-sandbox.ts';

// E45-61: the structure of a tagged PDF paper is merged into the board book, so the whole book passes
// the PDF/UA check with the paper's own tags (headings, tables, lists, figures) instead of artifacts.
// Invented papers only.

/** A tagged paper, made by the application's own PDF builder. */
async function taggedPaper(title: string, opts: { lang?: string } = {}): Promise<Buffer> {
  const b = new PdfBuilder({ title, appName: 'Invented app', lang: opts.lang });
  b.heading('Invented service changes', 1);
  b.paragraph('Invented tagged paper text about route frequency.');
  b.heading('Invented detail', 2);
  b.markdown('- Invented first point\n- Invented second point');
  b.table([{ header: 'Route', weight: 1 }, { header: 'Buses', weight: 1, align: 'right' }], [['Invented 1', '4'], ['Invented 2', '6']]);
  b.chart('bar', [{ label: 'Invented depot', value: 12 }, { label: 'Invented yard', value: 7 }], 'Invented buses by depot');
  b.newPage();
  b.paragraph('Invented second page of the tagged paper.');
  return b.finish();
}

/** Every structure element of a file, with its dictionary. */
function elements(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of('S')) instanceof PDFName && obj.get(PDFName.of('P'))) out.push(obj);
  }
  return out;
}
const roleOf = (d: PDFDict) => (d.get(PDFName.of('S')) as PDFName).decodeText();

/**
 * A tagged paper with the faults real papers have: custom types through a role map, a skipped heading
 * level, a figure without alternative text, a list item holding a P, drawing outside marked content,
 * marked content the tree does not point at, and an unmatched EMC. In Spanish.
 */
async function messyPaper(): Promise<Buffer> {
  const doc = await PDFDocument.load(await taggedPaper('Invented informe', { lang: 'es-ES' }));
  const els = elements(doc);
  let lbody = false;
  let h2 = false;
  for (const el of els) {
    const role = roleOf(el);
    if (role === 'P') el.set(PDFName.of('S'), PDFName.of('Parrafo'));
    if (role === 'Table') el.set(PDFName.of('S'), PDFName.of('Tabla'));
    if (role === 'LBody' && !lbody) { el.set(PDFName.of('S'), PDFName.of('P')); lbody = true; }
    if (role === 'H2' && !h2) { el.set(PDFName.of('S'), PDFName.of('H4')); h2 = true; }
    if (role === 'Figure') el.delete(PDFName.of('Alt'));
  }
  const root = doc.context.lookup(doc.catalog.get(PDFName.of('StructTreeRoot'))) as PDFDict;
  root.set(PDFName.of('RoleMap'), doc.context.obj({ Parrafo: 'P', Tabla: 'Table' }));
  const page = doc.getPages()[0];
  const extra = doc.context.register(doc.context.stream('0.5 w 20 20 m 60 20 l S /P <</MCID 999>> BDC 20 30 m 60 30 l S EMC EMC'));
  const contents = page.node.get(PDFName.of('Contents'));
  page.node.set(PDFName.of('Contents'), doc.context.obj([contents as PDFRef, extra]));
  return Buffer.from(await doc.save());
}

/** A book like the board book: title, an "Appendices" H2 and a table. */
async function book(): Promise<Buffer> {
  const b = new PdfBuilder({ title: 'Invented meeting: board book', appName: 'Invented app', cover: true });
  b.heading('Agenda', 1);
  b.paragraph('Invented agenda.');
  b.heading('Appendices', 1);
  b.table([{ header: 'Appendix', weight: 1 }, { header: 'Paper', weight: 4 }], [['A', 'Invented paper']]);
  return b.finish();
}

/** The structure tree of every page as pdf.js reads it. */
async function trees(pdf: Buffer): Promise<Row[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const out: Row[] = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getStructTree()) as Row);
  await task.destroy();
  return out;
}
const find = (node: Row | null, test: (n: Row) => boolean): Row | null => {
  if (!node) return null;
  if (test(node)) return node;
  for (const c of node.children ?? []) { const f = find(c, test); if (f) return f; }
  return null;
};

describe('merging the structure of tagged papers into the board book', () => {
  it('tells tagged papers from untagged ones', async () => {
    const r = await inspectPdfs([await taggedPaper('Invented tagged'), await makePdf(['Invented untagged page']), await messyPaper()]);
    expect(r).toMatchObject([{ ok: true, pages: 2, tagged: true }, { ok: true, pages: 1, tagged: false, untagged: expect.stringMatching(/not a tagged PDF/) }, { ok: true, pages: 2, tagged: true }]);
  }, 60_000);

  it('keeps a tagged paper\'s tags and passes the PDF/UA check', async () => {
    const paper = await taggedPaper('Invented staff report');
    expect((await checkPdfUa(paper)).failures).toEqual([]);
    const own = await book();
    const merged = await appendPdfs(own, [paper], ['Appendix A: Invented staff report.pdf']);
    const ua = await checkPdfUa(merged);
    expect(ua.failures).toEqual([]);
    expect(ua.pages).toBe((await checkPdfUa(own)).pages + 2);
    // The paper's headings, list, table and figure are in the book's tree, under a Part named after the appendix.
    for (const role of ['Part', 'L', 'LI', 'LBody', 'Table', 'TR', 'TH', 'TD', 'Figure']) expect(ua.roles).toContain(role);
    expect(ua.figures).toContain('Bar chart: Invented buses by depot. Invented depot: 12; Invented yard: 7.');
    const pages = await trees(merged);
    const part = find(pages[pages.length - 1], (n) => n.role === 'Part');
    expect(part).toMatchObject({ role: 'Part' });
    expect(await pdfText(merged)).toContain('Invented second page of the tagged paper.');
  }, 60_000);

  it('repairs the faults of a messy tagged paper and keeps its language', async () => {
    const paper = await messyPaper();
    const before = (await checkPdfUa(paper)).failures.join('\n');
    expect(before).toMatch(/neither tagged nor marked as artifacts/);
    expect(before).toMatch(/marked content 999 is not part of the structure tree/);
    expect(before).toMatch(/figure has no alternative text/);
    expect(before).toMatch(/heading level is skipped/);
    expect(before).toMatch(/P element sits inside a LI/);
    const merged = await appendPdfs(await book(), [paper], ['Appendix A: Invented informe.pdf']);
    const ua = await checkPdfUa(merged);
    expect(ua.failures).toEqual([]);
    expect(ua.roles).toContain('Table');
    expect(ua.roles).not.toContain('Parrafo');
    expect(ua.figures.some((f) => /A picture in Appendix A: Invented informe\.pdf; the paper gave no description/.test(f))).toBe(true);
    const pages = await trees(merged);
    expect(find(pages[pages.length - 2], (n) => n.role === 'Part')).toMatchObject({ lang: 'es-ES' });
  }, 60_000);

  it('appends several papers, tagged and untagged, with one ParentTree entry per tagged page', async () => {
    const merged = await appendPdfs(await book(), [await taggedPaper('Invented one'), await makePdf(['Invented scan-like page']), await taggedPaper('Invented two')],
      ['Appendix A: one', 'Appendix B: two', 'Appendix C: three']);
    expect((await checkPdfUa(merged)).failures).toEqual([]);
    const doc = await PDFDocument.load(merged);
    const parts = elements(doc).filter((e) => roleOf(e) === 'Part');
    expect(parts.length).toBe(2);
    const root = doc.context.lookup(doc.catalog.get(PDFName.of('StructTreeRoot'))) as PDFDict;
    const keys = new Set(doc.getPages().map((p) => (p.node.get(PDFName.of('StructParents')) as PDFNumber | undefined)?.asNumber()).filter((k) => k !== undefined));
    const nums = (doc.context.lookup(root.get(PDFName.of('ParentTree'))) as PDFDict).get(PDFName.of('Nums')) as PDFArray;
    expect(nums.size() / 2).toBe(keys.size);
    expect((root.get(PDFName.of('ParentTreeNextKey')) as PDFNumber).asNumber()).toBe(Math.max(...keys) + 1);
    // The untagged paper's page is one artifact.
    const untagged = doc.getPages()[doc.getPageCount() - 3];
    expect(untagged.node.get(PDFName.of('StructParents'))).toBeUndefined();
    const first = doc.context.lookup((untagged.node.get(PDFName.of('Contents')) as PDFArray).get(0)) as PDFRawStream;
    expect(Buffer.from(first.contents).toString('latin1')).toContain('/Artifact BMC');
  }, 60_000);

  it('merges a hand-made tree: one top element, content references across pages, an annotation reference, properties by name', async () => {
    const doc = await PDFDocument.create();
    const [p1, p2] = [doc.addPage([300, 300]), doc.addPage([300, 300])];
    const ctx = doc.context;

    p1.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Figure <</MCID 0>> BDC 10 10 m 100 100 l S EMC 5 5 m 6 6 l S')));
    p2.node.set(PDFName.of('Contents'), ctx.register(ctx.stream('/Figure /mc0 BDC 10 10 100 50 re f EMC /Artifact BMC 0 0 m 1 1 l S EMC')));
    p2.node.set(PDFName.of('Resources'), ctx.obj({ Properties: { mc0: { MCID: 0 } } }));
    const rootRef = ctx.nextRef();
    const docRef = ctx.nextRef();
    const figRef = ctx.nextRef();
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10] }));
    ctx.assign(figRef, ctx.obj({
      Type: 'StructElem', S: 'Figure', P: docRef, Alt: PDFString.of('Invented route map across two pages'),
      K: [{ Type: 'MCR', Pg: p1.ref, MCID: 0 }, { Type: 'MCR', Pg: p2.ref, MCID: 0 }, { Type: 'OBJR', Obj: annot, Pg: p1.ref }],
    }));
    ctx.assign(docRef, ctx.obj({ Type: 'StructElem', S: 'Document', P: rootRef, K: figRef }));
    ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: docRef }));
    doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef);
    doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }));
    const paper = Buffer.from(await doc.save());
    const merged = await appendPdfs(await book(), [paper], ['Appendix A: Invented route map']);
    const ua = await checkPdfUa(merged);
    expect(ua.failures).toEqual([]);
    expect(ua.figures).toContain('Invented route map across two pages');
    const pages = await trees(merged);
    for (const tree of pages.slice(-2)) expect(find(tree, (n) => n.role === 'Figure')).toMatchObject({ alt: 'Invented route map across two pages' });
  }, 60_000);

  it('reads content streams with strings, dictionaries and inline images', () => {
    const ops = tokenize(Buffer.from('BT (a \\) (b) c) Tj ET /P <</MCID 3 /Lang (es)>> BDC q BI /W 2 /H 1 /BPC 8 /CS /G ID \u0001EI EI Q EMC [<0041> 2 (x)] TJ', 'latin1'));
    expect(ops.map((o: Row) => o.op)).toEqual(['BT', 'Tj', 'ET', 'BDC', 'q', 'EI', 'Q', 'EMC', 'TJ']);
    expect(ops[3].operands[1].dict.get('MCID')).toEqual({ num: 3 });
  });
});

describe('the board book with a tagged PDF paper', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => {
    process.env.GRC_MODULES = 'governance,attachments,policies,workflows,notifications';
    t = await testApp();
  }, 60_000);
  afterAll(async () => { await t?.close(); });

  it('says which papers are tagged and passes the PDF/UA check', async () => {
    const c = await t.api.post('/api/committees', { name: 'Invented tagged papers board', kind: 'governing_body' });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const m = await t.api.post('/api/meetings', { committee_id: c.body.id, title: 'Invented meeting with tagged papers', scheduled_at: `${dayInZone(9)}T18:00:00Z` });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const a = await t.api.post(`/api/meetings/${m.body.id}/agenda`, { title: 'Invented service report' });
    const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    const cookie = await createSession(t.db, adminId);
    for (const [name, data] of [['Tagged report.pdf', await taggedPaper('Invented tagged report')], ['Plain report.pdf', await makePdf(['Invented plain report'])]] as const) {
      const up = await t.app.inject({
        method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'meeting', record_id: m.body.id, name })}`,
        headers: { cookie: `${SESSION_COOKIE}=${cookie}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: data,
      });
      expect(up.statusCode, up.body).toBe(201);
      expect((await t.api.post(`/api/meetings/${m.body.id}/agenda/${a.body.id}/papers`, { kind: 'file', attachment_id: up.json().id })).status).toBe(201);
    }
    const res = await t.app.inject({ method: 'GET', url: `/api/meetings/${m.body.id}/book`, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    expect(res.statusCode).toBe(200);
    const ua = await checkPdfUa(res.rawPayload);
    expect(ua.failures).toEqual([]);
    expect(ua.roles).toContain('Part');
    const text = await pdfText(res.rawPayload);
    expect(text).toContain('Appended as appendix A: 2 pages');
    expect(text).toMatch(/Appended as appendix B: 1 page, from page \d+ of this file \(not tagged for screen readers/);
    expect(text).toContain('Screen readers');
    expect(text).toContain('Invented tagged paper text about route frequency.');
    const audit = await t.db.one<Row>(`select after from audit_log where action = 'meeting.book' order by created_at desc limit 1`).catch(() => undefined);
    if (audit) expect(audit.after).toMatchObject({ appended: 2, tagged: 1 });
  }, 120_000);
});
