import PDFDocument from 'pdfkit';
import { strToU8, zipSync } from 'fflate';
import { createDeflate } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { testApp } from '../../test/helpers.ts';
import { previewKind } from './filetypes.ts';
import { extractText, indexFileTexts, TEXT_JOB } from './text.ts';

// E41-16: the text inside attached PDF, Word and plain-text files is read by a background job and
// found by the global search under the record's own visibility; images and PDFs can be shown in the
// browser (inline, only those types, the sandbox policy kept).

let t: Awaited<ReturnType<typeof testApp>>;
let adminId = '';

function pdfWith(text: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.text('Invented inspection report');
    doc.addPage().text(text);
    doc.end();
  });
}

function docxWith(text: string): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>Depot procedure</w:t></w:r></w:p>
<w:p><w:r><w:instrText> HYPERLINK "fieldcodeword" </w:instrText></w:r><w:r><w:t xml:space="preserve">${text} &amp; more</w:t></w:r><w:r><w:tab/><w:t>end</w:t></w:r></w:p>
</w:body></w:document>`;
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'word/document.xml': strToU8(xml),
  }));
}

/**
 * A small PDF whose embedded font is a compressed stream that unpacks to `mb` megabytes of zeros
 * (wave 23 security review, S1): pdf.js unpacks it into memory outside the heap limit.
 */
async function fontBombPdf(mb: number): Promise<Buffer> {
  const d = createDeflate({ level: 9 });
  const out: Buffer[] = [];
  d.on('data', (c: Buffer) => out.push(c));
  const ended = new Promise((res) => d.on('end', res));
  const chunk = Buffer.alloc(1024 * 1024, 0);
  for (let i = 0; i < mb; i++) if (!d.write(chunk)) await new Promise((res) => d.once('drain', res));
  d.end();
  await ended;
  const stream = Buffer.concat(out);
  const content = Buffer.from('BT /F1 12 Tf 10 10 Td (hello) Tj ET\n');
  const objects: Array<string | Buffer[]> = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    [Buffer.from(`<< /Length ${content.length} >> stream\n`), content, Buffer.from('\nendstream')],
    '<< /Type /Font /Subtype /TrueType /BaseFont /Bomb /FirstChar 32 /LastChar 126 /FontDescriptor 6 0 R >>',
    '<< /Type /FontDescriptor /FontName /Bomb /Flags 32 /FontBBox [0 0 1000 1000] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 /FontFile2 7 0 R >>',
    [Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >> stream\n`), stream, Buffer.from('\nendstream')],
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  let pos = parts[0].length;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pos);
    const bufs = [Buffer.from(`${i + 1} 0 obj `), ...(typeof body === 'string' ? [Buffer.from(body)] : body), Buffer.from(' endobj\n')];
    for (const b of bufs) { parts.push(b); pos += b.length; }
  });
  const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  parts.push(Buffer.from(`${xref}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  return Buffer.concat(parts);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function upload(recordType: string, recordId: string, name: string, payload: Buffer) {
  const token = await createSession(t.db, adminId);
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: recordType, record_id: recordId, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload,
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}
const runText = () => t.app.jobs.runDue({ types: [TEXT_JOB] });
const search = async (api: typeof t.api, q: string) => { const r = await api.get(`/api/search?q=${encodeURIComponent(q)}`); if (!Array.isArray(r.body)) throw new Error(r.text); return r.body as any[]; };

beforeAll(async () => {
  t = await testApp();
  adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('reading the text of attached files', () => {
  it('reads PDF, Word and plain text in a worker, leaving out field codes', async () => {
    const pdf = await extractText(await pdfWith('Quokkafence clearance measured at the north yard'), 'pdf');
    expect(pdf).toMatchObject({ ok: true });
    expect((pdf as any).text).toContain('Quokkafence clearance');
    const docx = await extractText(docxWith('Wallabyrail inspection'), 'docx');
    expect(docx.ok && docx.text).toBe('Depot procedure\nWallabyrail inspection & more end');
    expect((docx as any).text).not.toContain('fieldcodeword');
    const utf16 = await extractText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Numbatbrake log', 'utf16le')]), 'txt');
    expect(utf16).toEqual({ ok: true, text: 'Numbatbrake log' });
  });

  it('gives up on a damaged file and on one that takes too long', async () => {
    expect(await extractText(Buffer.from('%PDF-1.7\nnot really a pdf'), 'pdf')).toMatchObject({ ok: false });
    expect(await extractText(Buffer.from('PK\u0003\u0004 broken zip'), 'docx')).toMatchObject({ ok: false });
    const slow = await extractText(await pdfWith('Slow words'), 'pdf', { timeoutMs: 1 });
    expect(slow).toMatchObject({ ok: false, error: expect.stringMatching(/longer than/) });
  });

  it('finds a record by the words inside its files, under the record\'s visibility', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Signal archive server' })).body;
    const risk = (await t.api.post('/api/risks', { title: 'Restricted invented risk' })).body;
    expect(risk.id).toBeTruthy();
    await upload('system', sys.id, 'report.pdf', await pdfWith('The bilbyswitch relay failed twice'));
    await upload('system', sys.id, 'procedure.docx', docxWith('Echidnaplate torque values'));
    await upload('system', sys.id, 'notes.txt', Buffer.from('Platypusvalve replaced on Tuesday'));
    await upload('risk', risk.id, 'secret.txt', Buffer.from('Dingocipher password rotation'));
    await runText();

    const states = await t.db.query<{ status: string }>(`select status from attachment_texts`);
    expect(states.map((s) => s.status)).toEqual(['indexed', 'indexed', 'indexed', 'indexed']);
    for (const word of ['bilbyswitch', 'echidnaplate', 'platypusvalve']) {
      const hits = await search(t.api, word);
      expect(hits.find((h) => h.id === sys.id), word).toMatchObject({ type: 'system', matched: 'attachment' });
    }
    const hit = (await search(t.api, 'bilbyswitch')).find((h) => h.id === sys.id);
    expect(hit.snippet).toMatch(/^report\.pdf: .*bilbyswitch/i);
    expect(hit.snippetParts.some((p: any) => p.match && /bilbyswitch/i.test(p.text))).toBe(true);

    // The admin sees the restricted risk's file; an agent (no risks, no security.view) does not,
    // and a requester (no systems.view) finds neither.
    expect((await search(t.api, 'dingocipher')).map((h) => h.id)).toContain(risk.id);
    const agent = await t.as('agent');
    expect((await search(agent, 'dingocipher'))).toEqual([]);
    expect((await search(agent, 'platypusvalve')).map((h) => h.id)).toContain(sys.id);
    const requester = await t.as('requester');
    expect(await search(requester, 'platypusvalve')).toEqual([]);

    // The list of files says which were read.
    const files = (await t.api.get(`/api/attachments?record_type=system&record_id=${sys.id}`)).body.rows;
    expect(files.map((f: any) => f.text_status)).toEqual(['indexed', 'indexed', 'indexed']);
  });

  it('forgets a removed file\'s text at once and reads it again when it is put back', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Removed text host' })).body;
    const file = await upload('system', sys.id, 'gone.txt', Buffer.from('Cassowarylatch removed soon'));
    await runText();
    expect((await search(t.api, 'cassowarylatch')).map((h) => h.id)).toContain(sys.id);
    expect((await t.api.del(`/api/attachments/${file.id}`)).status).toBe(200);
    expect(await t.db.one(`select 1 from attachment_texts where attachment_id = $1`, [file.id])).toBeUndefined();
    expect(await search(t.api, 'cassowarylatch')).toEqual([]);
    await t.db.query(`update attachments set deleted_at = null, removed_reason = null where id = $1`, [file.id]);
    await t.app.jobs.enqueue(TEXT_JOB, {});
    await runText();
    expect((await search(t.api, 'cassowarylatch')).map((h) => h.id)).toContain(sys.id);
  });

  it('records a file it cannot read once, and never reads links or other types', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Odd files host' })).body;
    const bad = await upload('system', sys.id, 'broken.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x41)]));
    const img = await upload('system', sys.id, 'photo.png', PNG);
    await runText();
    expect(await t.db.one(`select status from attachment_texts where attachment_id = $1`, [bad.id])).toMatchObject({ status: 'failed' });
    expect(await t.db.one(`select status from attachment_texts where attachment_id = $1`, [img.id])).toBeUndefined();
  });
});

describe('a file that makes the reader run away (wave 23 security review, S1)', () => {
  // The reader runs in its own process with a memory cap; these tests use a low cap and a bomb that
  // unpacks to more than it, so they stay quick and light.
  const CAP_MB = 300;
  let bomb: Buffer;
  beforeAll(async () => { bomb = await fontBombPdf(600); }, 60_000);
  const ctx = () => ({ db: t.db, app: t.app }) as any;
  const state = (id: string) => t.db.one<{ status: string; attempts: number; detail: string | null }>(
    `select status, attempts, detail from attachment_texts where attachment_id = $1`, [id]);

  it('stops a PDF whose font unpacks to gigabytes, outside the server process', async () => {
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const before = process.memoryUsage().arrayBuffers;
    const r = await extractText(bomb, 'pdf', { maxMemoryMb: CAP_MB });
    expect(r).toEqual({ ok: false, error: 'needed too much memory', stopped: true });
    // Nothing was unpacked in this process.
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * 1024 * 1024);
  }, 60_000);

  it('records the attempt before reading, tries once more, then marks the file failed for good', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Bomb host' })).body;
    const file = await upload('system', sys.id, 'bomb.pdf', bomb);
    await indexFileTexts(ctx(), 25, { maxMemoryMb: CAP_MB });
    // Stopped by the memory cap, or by the time limit on a machine under heavy load: either way stopped, not read.
    const STOPPED = /needed too much memory|took longer than 30 seconds/;
    expect(await state(file.id)).toMatchObject({ status: 'reading', attempts: 1, detail: expect.stringMatching(STOPPED) });
    await indexFileTexts(ctx(), 25, { maxMemoryMb: CAP_MB });
    expect(await state(file.id)).toMatchObject({ status: 'failed', attempts: 2, detail: expect.stringMatching(/(memory|30 seconds); it is not read again/) });
    const again = await indexFileTexts(ctx(), 25, { maxMemoryMb: CAP_MB });
    expect(again.read).toBe(0);
    expect(await state(file.id)).toMatchObject({ status: 'failed', attempts: 2 });
  }, 120_000);

  it('after the server went down while reading, tries once more, and gives up after a second time', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Crash host' })).body;
    const once = await upload('system', sys.id, 'once.txt', Buffer.from('Bandicootgear after one crash'));
    const twice = await upload('system', sys.id, 'twice.txt', Buffer.from('Wombatlever after two crashes'));
    // As the server leaves it when it dies in the middle of reading.
    await t.db.query(`insert into attachment_texts (attachment_id, status, detail, attempts) values ($1, 'reading', 'reading did not finish', 1), ($2, 'reading', 'reading did not finish', 2)`, [once.id, twice.id]);
    await runText();
    expect(await state(once.id)).toMatchObject({ status: 'indexed', attempts: 2 });
    expect(await state(twice.id)).toMatchObject({ status: 'failed', attempts: 2, detail: expect.stringMatching(/stopped while reading this file, twice/) });
    expect((await search(t.api, 'bandicootgear')).map((h) => h.id)).toContain(sys.id);
    expect(await search(t.api, 'wombatlever')).toEqual([]);
  });

  it('does not read a file a vendor sent while it waits to be taken over', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Held file host' })).body;
    const file = await upload('system', sys.id, 'held.txt', Buffer.from('Quollbracket from a vendor'));
    await t.db.query(`update attachments set record_type = 'vendor_response_link' where id = $1`, [file.id]);
    await runText();
    expect(await state(file.id)).toBeUndefined();
    // Taken over: read like any other file.
    await t.db.query(`update attachments set record_type = 'system' where id = $1`, [file.id]);
    await t.app.jobs.enqueue(TEXT_JOB, {});
    await runText();
    expect(await state(file.id)).toMatchObject({ status: 'indexed', attempts: 1 });
  });
});

describe('previewing files in the browser', () => {
  it('serves images and PDFs inline with the sandbox policy, and nothing else', async () => {
    const sys = (await t.api.post('/api/systems', { name: 'Preview host' })).body;
    const img = await upload('system', sys.id, 'photo.png', PNG);
    const pdf = await upload('system', sys.id, 'plan.pdf', await pdfWith('Preview text'));
    const txt = await upload('system', sys.id, 'plain.txt', Buffer.from('Plain words'));
    expect([img.preview, pdf.preview, txt.preview]).toEqual(['image', 'pdf', null]);

    const token = await createSession(t.db, adminId);
    const get = (url: string, cookie = token) => t.app.inject({ method: 'GET', url, headers: { cookie: `${SESSION_COOKIE}=${cookie}` } });
    const shown = await get(`/api/attachments/${img.id}/preview`);
    expect(shown.statusCode).toBe(200);
    expect(shown.headers['content-type']).toBe('image/png');
    expect(shown.headers['content-disposition']).toMatch(/^inline; filename="photo.png"/);
    expect(shown.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(shown.headers['x-content-type-options']).toBe('nosniff');
    const shownPdf = await get(`/api/attachments/${pdf.id}/preview`);
    expect([shownPdf.statusCode, shownPdf.headers['content-type'], String(shownPdf.headers['content-disposition']).split(';')[0]]).toEqual([200, 'application/pdf', 'inline']);

    expect((await get(`/api/attachments/${txt.id}/preview`)).json().error.code).toBe('no_preview');
    // A download stays an attachment.
    expect((await get(`/api/attachments/${img.id}/download`)).headers['content-disposition']).toMatch(/^attachment;/);
    // Someone who may not see the record gets "not found".
    const requester = await t.as('requester');
    const theirs = await t.db.one<{ id: string }>(`select id from users where id = $1`, [requester.userId]);
    expect((await get(`/api/attachments/${img.id}/preview`, await createSession(t.db, theirs!.id))).statusCode).toBe(404);
  });

  it('never previews types a browser could run', () => {
    expect(previewKind('svg', 'image/svg+xml')).toBeNull();
    expect(previewKind('html', 'text/html')).toBeNull();
    expect(previewKind('png', 'text/html')).toBeNull();
    expect(previewKind('PDF', 'application/pdf')).toBe('pdf');
  });
});
