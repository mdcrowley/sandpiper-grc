import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/helpers.ts';
import { image, insertion, makeDocx, makePdf, para, pdfText, table } from './fixtures.ts';
import { documentFilesStandIn } from './testing.ts';

// Word originals converted on a document's version, their images kept as files only readers can see,
// file-only versions (PDF, legacy .doc), the PDF text reaching search, scanned PDFs, the preview and
// the controlled-copy stamp (E43-06, E43-07, E43-08). Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
type Api = typeof t.api;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** A finished chunked upload of `bytes`, sent as base64 parts. */
async function upload(api: Api, name: string, bytes: Buffer): Promise<string> {
  const s = await api.post('/api/attachments/uploads', { file_name: name, size: bytes.length, sha256: sha(bytes) });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  for (let n = 1; n <= s.body.part_count; n++) {
    const part = bytes.subarray((n - 1) * s.body.part_size, n * s.body.part_size);
    expect((await api.post(`/api/attachments/uploads/${s.body.id}/parts/${n}`, { data: part.toString('base64') })).status).toBe(200);
  }
  const f = await api.post(`/api/attachments/uploads/${s.body.id}/finish`, {});
  expect(f.status, JSON.stringify(f.body)).toBe(200);
  return s.body.id;
}
const runJobs = async (...types: string[]) => {
  for (const type of types) await t.app.jobs.enqueue(type, {}, { key: `test:${type}:${Math.random()}` });
  await t.app.jobs.runDue({ types });
};

let docId = '';
let restrictedId = '';

beforeAll(async () => {
  t = await testApp({ extraModules: [documentFilesStandIn] });
  docId = (await t.api.post('/api/policies', { title: 'Invented network change procedure', document_type: 'sop' })).body.id;
  restrictedId = (await t.api.post('/api/policies', { title: 'Invented incident playbook', document_type: 'procedure', access: 'restricted' })).body.id;
  expect(docId && restrictedId).toBeTruthy();
});
afterAll(async () => { await t.close(); });

describe('Word originals', () => {
  it('converts a .docx upload into the version text, keeps the original and stores its images on the document', async () => {
    const docx = makeDocx([para('Network changes', 'Heading1'), para('Every change is planned.'), table([['Step', 'Who'], ['Plan', 'Network team']]), image('Invented rack layout')], { image: true });
    const id = await upload(t.api, 'SOP network changes.docx', docx);
    const v = await t.api.post(`/api/policies/${docId}/versions`, { source_upload_id: id, convert: true, content_kind: 'markdown', version_label: 'Rev. A' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.content_kind).toBe('markdown');
    expect(v.body.body).toContain('# Network changes');
    expect(v.body.body).toContain('| Step | Who |');
    const img = /!\[Invented rack layout\]\(attachment:([0-9a-f-]{36})\)/.exec(v.body.body);
    expect(img, v.body.body).toBeTruthy();
    expect(v.body.conversion).toMatchObject({ status: 'converted', images: 1, image_attachment_ids: [img![1]] });
    // The original is a file on the document, and so is the image.
    const files = (await t.api.get(`/api/attachments?record_type=policy&record_id=${docId}`)).body.rows;
    expect(files.map((f: any) => f.file_name)).toEqual(expect.arrayContaining(['SOP network changes.docx', 'SOP network changes-image-1.png']));
    expect(v.body.source_attachment_id).toBe(files.find((f: any) => f.extension === 'docx').id);
    expect((await t.api.get(`/api/attachments/${img![1]}/preview`)).status).toBe(200);

    // The Word original is only for people who write or approve documents; a reader of the
    // document gets its pictures but not the editable file.
    const reader = await t.as('agent');
    expect((await reader.get(`/api/attachments/${img![1]}/preview`)).status).toBe(200);
    expect((await reader.get(`/api/attachments/${v.body.source_attachment_id}/download`)).status).toBe(403);
    expect((await t.api.get(`/api/attachments/${v.body.source_attachment_id}/download`)).status).toBe(200);
    // Once the version is approved its original stays.
    expect((await (await t.as('security_lead')).post(`/api/policies/${docId}/versions/${v.body.id}/approve`, {})).status).toBe(200);
    const removed = await t.api.del(`/api/attachments/${v.body.source_attachment_id}`);
    expect([removed.status, removed.body.error?.code]).toEqual([409, 'in_use']);
  });

  it('refuses tracked changes unless accepted as is, and keeps the upload free for another try', async () => {
    const id = await upload(t.api, 'draft.docx', makeDocx([para('Kept text'), insertion('Inserted text')]));
    const fresh = (await t.api.post('/api/policies', { title: 'Invented fare policy', document_type: 'policy' })).body.id;
    const refused = await t.api.post(`/api/policies/${fresh}/versions`, { source_upload_id: id, convert: true });
    expect([refused.status, refused.body.error.code]).toEqual([422, 'tracked_changes']);
    const id2 = await upload(t.api, 'draft.docx', makeDocx([para('Kept text'), insertion('Inserted text')]));
    const ok = await t.api.post(`/api/policies/${fresh}/versions`, { source_upload_id: id2, convert: true, accept_as_is: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.body).toContain('Inserted text');
    expect(ok.body.conversion.tracked_changes).toBe(true);
  });

  it('shows images only to people who may read the document', async () => {
    const id = await upload(t.api, 'playbook.docx', makeDocx([para('Isolate the host.'), image('Invented network map')], { image: true }));
    const v = await t.api.post(`/api/policies/${restrictedId}/versions`, { source_upload_id: id, convert: true });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const imageId = /attachment:([0-9a-f-]{36})/.exec(v.body.body)![1];
    const agent = await t.as('agent');
    expect((await agent.get(`/api/attachments/${imageId}/preview`)).status).toBe(404);
    expect((await agent.get(`/api/attachments?record_type=policy&record_id=${restrictedId}`)).status).toBe(404);
    expect((await t.api.get(`/api/attachments/${imageId}/preview`)).status).toBe(200);
  });
});

describe('file-only versions', () => {
  it('keeps a PDF as the version, reads its text into search, and flags a scanned one', async () => {
    const pdfDoc = (await t.api.post('/api/policies', { title: 'Invented bus maintenance manual', document_type: 'program' })).body.id;
    const pdf = await makePdf(['Brake inspection every invented thousand miles quellotrix']);
    const id = await upload(t.api, 'manual.pdf', pdf);
    const v = await t.api.post(`/api/policies/${pdfDoc}/versions`, { source_upload_id: id, content_kind: 'file' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.content_kind).toBe('file');
    const sub = await t.as('security_lead');
    await sub.post(`/api/policies/${pdfDoc}/versions/${v.body.id}/approve`, {});
    expect((await sub.post(`/api/policies/${pdfDoc}/versions/${v.body.id}/publish`, {})).status).toBe(200);
    await runJobs('attachments.text_index');
    await runJobs('policies.file_text_sync');
    const text = await t.api.get(`/api/documents/${pdfDoc}/versions/${v.body.id}/text`);
    expect(text.body).toMatchObject({ status: 'indexed', scanned: false });
    expect(text.body.text).toContain('quellotrix');
    const found = await t.api.get('/api/search?q=quellotrix');
    expect(JSON.stringify(found.body)).toContain(pdfDoc);
    // Printing the version gives the original PDF itself, with the control block stamped on it.
    const { createSession } = await import('../../../core/auth.ts');
    const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
    const printed = await t.app.inject({
      method: 'GET', url: `/api/policies/${pdfDoc}/versions/${v.body.id}/pdf`,
      headers: { cookie: `grc_session=${await createSession(t.db, admin!.id)}` },
    });
    expect(printed.statusCode, printed.body.slice(0, 200)).toBe(200);
    const printedText = await pdfText(printed.rawPayload);
    expect(printedText).toContain('quellotrix');
    expect(printedText).toContain('Uncontrolled when printed');
    expect(printedText).toContain('Page 1 of 1');

    const scanDoc = (await t.api.post('/api/policies', { title: 'Invented scanned bylaws', document_type: 'charter' })).body.id;
    const scan = await t.api.post(`/api/policies/${scanDoc}/versions`, { source_upload_id: await upload(t.api, 'bylaws-scan.pdf', await makePdf(['x'], { noText: true })), content_kind: 'file' });
    expect(scan.status).toBe(201);
    await runJobs('attachments.text_index');
    await runJobs('policies.file_text_sync');
    const scanned = await t.api.get(`/api/documents/${scanDoc}/versions/${scan.body.id}/text`);
    expect(scanned.body).toMatchObject({ status: 'empty', scanned: true, text: '' });
    const versions = (await t.api.get(`/api/policies/${scanDoc}/versions`)).body;
    expect(versions[0].conversion).toMatchObject({ scanned: true });
  });

  it('keeps a legacy .doc as the original with a note, and does not convert it', async () => {
    const legacy = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024, 0)]);
    const docDoc = (await t.api.post('/api/policies', { title: 'Invented 2009 travel policy', document_type: 'policy' })).body.id;
    const tryConvert = await t.api.post(`/api/policies/${docDoc}/versions`, { source_upload_id: await upload(t.api, 'travel.doc', legacy), convert: true });
    expect([tryConvert.status, tryConvert.body.error.code]).toEqual([422, 'not_convertible']);
    expect(tryConvert.body.error.message).toMatch(/save it as \.docx/);
    const preview = await t.api.post('/api/documents/convert', { upload_id: await upload(t.api, 'travel.doc', legacy) });
    expect(preview.body.report).toMatchObject({ status: 'file_only', note: expect.stringMatching(/Word 97-2003/) });
  });
});

describe('preview and stamp', () => {
  it('previews a conversion without saving anything', async () => {
    const before = (await t.db.one<{ n: number }>('select count(*)::int as n from attachments'))!.n;
    const id = await upload(t.api, 'preview.docx', makeDocx([para('Preview only'), image('Invented chart')], { image: true, footer: 'Rev. 4 Effective: 2022-01-10' }));
    const r = await t.api.post('/api/documents/convert', { upload_id: id });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.markdown).toContain('![Invented chart](attachment:pending-1)');
    expect(r.body.images).toEqual([expect.objectContaining({ n: 1, content_type: 'image/png' })]);
    expect(r.body.report.suggested).toMatchObject({ effective_on: '2022-01-10' });
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from attachments'))!.n).toBe(before);
    expect((await t.api.get(`/api/attachments/uploads/${id}`)).body.status).toBe('ready');
    expect((await (await t.as('agent')).post('/api/documents/convert', { upload_id: id })).status).toBe(403);
  });

  it('stamps a PDF through the decorator', async () => {
    const out = await t.app.stampPdf(await makePdf(['Invented manual page']), { header: 'MAN-001 Invented manual', footer: 'Page {page} of {pages}', watermark: 'OBSOLETE' });
    const text = await pdfText(out);
    expect(text).toContain('Page 1 of 1');
    expect(text).toContain('OBSOLETE');
  });
});
