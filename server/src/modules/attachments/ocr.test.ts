import { createRequire } from 'node:module';
import { deflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { availableOcrLanguages, BUNDLED_LANG_DIR, chosenOcrLanguages, ocrLanguages, ocrState, resetOcrState } from './ocr.ts';
import { extractText, indexFileTexts } from './text.ts';

// E43-15: a PDF with no text layer (a scan) is recognized as scanned; with the OCR engine installed and
// the bundled language data, its pictures are read in the separate reader process, with no outside
// request. The engine (the tesseract.js package) may be missing: the scan then stays found by title
// and number only, with the reason recorded. Invented content only.

const engine = (() => { try { createRequire(import.meta.url).resolve('tesseract.js'); return true; } catch { return false; } })();

// Block letters, 5 by 7, for a picture of text without a font or a canvas.
const FONT: Record<string, string[]> = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
/** A grey PNG of `text` in block letters. */
function textPng(text: string, scale = 6): Buffer {
  const w = (text.length * 6 + 4) * scale;
  const h = 11 * scale;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(w + 1, 255); row[0] = 0;
    const gy = Math.floor(y / scale) - 2;
    if (gy >= 0 && gy < 7) {
      for (let i = 0; i < text.length; i++) {
        const g = FONT[text[i]] ?? FONT[' '];
        for (let gx = 0; gx < 5; gx++) if (g[gy][gx] === '1') for (let s = 0; s < scale; s++) row[1 + (2 + i * 6 + gx) * scale + s] = 0;
      }
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
/** An image-only PDF: a "scan" with no text layer. */
function scannedPdf(text: string): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: 'A4' });
    const parts: Buffer[] = [];
    doc.on('data', (c: Buffer) => parts.push(c));
    doc.on('end', () => resolve(Buffer.concat(parts)));
    doc.image(textPng(text), 40, 60, { width: 400 });
    doc.end();
  });
}

describe('OCR settings', () => {
  afterEach(() => resetOcrState());
  it('can be switched off, checks the languages and needs their data in the folder', () => {
    expect(ocrState({ GRC_OCR: 'off' })).toMatchObject({ ready: false, reason: expect.stringMatching(/switched off/) });
    if (!engine) {
      expect(ocrState({})).toMatchObject({ ready: false, reason: expect.stringMatching(/not installed/) });
      return;
    }
    expect(ocrState({})).toMatchObject({ ready: true, job: { langs: 'eng', langPath: BUNDLED_LANG_DIR, gzip: true } });
    expect(ocrState({ GRC_OCR_LANGS: 'eng; rm' })).toMatchObject({ ready: false });
    expect(ocrState({ GRC_OCR_LANGS: 'eng+xyz' })).toMatchObject({ ready: false, reason: expect.stringMatching(/"xyz"/) });
  });
});

describe('reading scanned PDFs', () => {
  it('marks a PDF with no text layer as scanned', async () => {
    const r = await extractText(await scannedPdf('DEPOT FUEL'), 'pdf');
    expect(r).toMatchObject({ ok: true, scanned: true });
  }, 30_000);

  it.skipIf(!engine)('reads the words of a scan with the bundled language data, in the reader process', async () => {
    const state = ocrState({});
    expect(state.ready).toBe(true);
    if (!state.ready) return;
    const r = await extractText(await scannedPdf('DEPOT FUEL'), 'pdf', { ocr: state.job, timeoutMs: 120_000, maxMemoryMb: 1024 });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    if (r.ok) {
      expect(r.ocr).toBe(true);
      expect(r.text.toUpperCase()).toMatch(/FUEL/);
    }
  }, 150_000);
});

describe('the text job and scans', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); }, 60_000);
  afterAll(async () => { delete process.env.GRC_OCR; await t?.close(); });

  it('records why a scan was not read when OCR is off', async () => {
    process.env.GRC_OCR = 'off';
    const system = (await t.api.post('/api/systems', { name: 'Invented scanned records system' })).body.id;
    const pdf = await scannedPdf('DEPOT FUEL');
    const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    const token = await createSession(t.db, adminId);
    const up = await t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'system', record_id: system, name: 'scan.pdf' })}`,
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: pdf,
    });
    expect(up.statusCode, up.body).toBe(201);
    const r = await indexFileTexts(t.ctx, 25, { timeoutMs: 30_000 });
    expect(r.empty + r.indexed).toBeGreaterThanOrEqual(1);
    const row = await t.db.one<Row>(
      `select x.status, x.detail from attachment_texts x join attachments a on a.id = x.attachment_id where a.record_id = $1`, [system]);
    expect(row).toMatchObject({ status: 'empty', detail: expect.stringMatching(/scanned: no text layer; reading scans \(OCR\) is switched off/) });
  }, 90_000);
});

// E46-56: the languages are chosen in Administration from the bundled English and Spanish data (or the
// files in GRC_OCR_LANG_DIR); the choice applies to the reader and puts unread scans back in the queue.
describe('OCR languages chosen in Administration', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  beforeAll(async () => { t = await testApp(); }, 60_000);
  afterAll(async () => { delete process.env.GRC_OCR; delete process.env.GRC_OCR_LANGS; await t?.close(); });
  afterEach(() => resetOcrState());

  it('bundles English and Spanish data and builds the job from the choice', () => {
    expect(availableOcrLanguages({}).map((l) => [l.code, l.name])).toEqual([['eng', 'English'], ['spa', 'Spanish']]);
    expect(availableOcrLanguages({ GRC_OCR_LANG_DIR: 'Z:/invented/nowhere' })).toEqual([]);
    expect(ocrLanguages({}, null)).toEqual({ langs: 'eng', source: 'default' });
    expect(ocrLanguages({ GRC_OCR_LANGS: 'spa' }, null)).toEqual({ langs: 'spa', source: 'environment' });
    expect(ocrLanguages({ GRC_OCR_LANGS: 'spa' }, ['eng', 'spa'])).toEqual({ langs: 'eng+spa', source: 'setting' });
    expect(chosenOcrLanguages(['eng', 'eng', 'spa; rm', 'spa'])).toEqual(['eng', 'spa']);
    expect(chosenOcrLanguages('eng')).toBeNull();
    if (!engine) return;
    expect(ocrState({}, ['eng', 'spa'])).toMatchObject({ ready: true, job: { langs: 'eng+spa', langPath: BUNDLED_LANG_DIR, gzip: true } });
    expect(ocrState({}, ['fra'])).toMatchObject({ ready: false, reason: expect.stringMatching(/"fra".*Administration/) });
  });

  it('shows the languages, refuses ones without data, saves the choice and queues unread scans again', async () => {
    process.env.GRC_OCR = 'off';
    const system = (await t.api.post('/api/systems', { name: 'Invented scanned timetables system' })).body.id;
    const adminId = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
    const token = await createSession(t.db, adminId);
    const up = await t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'system', record_id: system, name: 'timetable-scan.pdf' })}`,
      headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' }, payload: await scannedPdf('DEPOT FUEL'),
    });
    expect(up.statusCode, up.body).toBe(201);
    await indexFileTexts(t.ctx, 25, { timeoutMs: 30_000 });

    const before = await t.api.get('/api/attachments/admin/ocr');
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ switched_off: true, ready: false, folder: 'bundled', chosen: ['eng'], source: 'default', max_languages: 4, scans_not_read: 1 });
    expect(before.body.languages).toEqual([{ code: 'eng', name: 'English' }, { code: 'spa', name: 'Spanish' }]);

    expect((await t.api.put('/api/attachments/admin/ocr', { languages: [] })).status).toBe(400);
    const unknown = await t.api.put('/api/attachments/admin/ocr', { languages: ['eng', 'fra'] });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fields.languages).toMatch(/fra/);
    expect((await t.api.put('/api/attachments/admin/ocr', { languages: ['eng', 'spa', 'a1', 'b2', 'c3'] })).status).toBe(400);
    const agent = await t.as('agent');
    expect((await agent.get('/api/attachments/admin/ocr')).status).toBe(403);

    const saved = await t.api.put('/api/attachments/admin/ocr', { languages: ['spa', 'eng'] });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ chosen: ['eng', 'spa'], source: 'setting', requeued: 1, scans_not_read: 0 });
    expect(await t.ctx.settings.get('attachments.ocr_languages', null)).toEqual(['eng', 'spa']);
    const events = (await t.db.query<Row>(`select action from audit_events where record_id = 'attachments.ocr_languages'`)).map((r) => r.action);
    expect(events).toEqual(expect.arrayContaining(['setting.change', 'attachments.ocr_requeue']));

    // The reader uses the choice: with OCR on, the scan is read in English and Spanish.
    if (!engine) return;
    delete process.env.GRC_OCR;
    await indexFileTexts(t.ctx, 25, { timeoutMs: 150_000 });
    const row = await t.db.one<Row>(
      `select x.status, x.detail, x.content from attachment_texts x join attachments a on a.id = x.attachment_id where a.record_id = $1`, [system]);
    expect(row).toMatchObject({ status: 'indexed', detail: 'read by OCR (eng+spa)' });
    expect(String(row!.content).toUpperCase()).toMatch(/FUEL/);
    // Reading again on request: the scans read before go back in the queue too.
    const again = await t.api.put('/api/attachments/admin/ocr', { languages: ['spa'], reread: true });
    expect(again.body).toMatchObject({ chosen: ['spa'], requeued: 1 });
  }, 240_000);
});
