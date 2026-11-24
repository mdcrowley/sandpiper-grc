import PDFDocument from 'pdfkit';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import { testApp } from '../../test/helpers.ts';
import { previewKind } from './filetypes.ts';
import { extractText, TEXT_JOB } from './text.ts';

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
