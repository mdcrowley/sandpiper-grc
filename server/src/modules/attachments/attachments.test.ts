import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { todayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';
import { checkContent, contentDisposition, extensionOf, sanitiseFileName } from './filetypes.ts';
import { diskStorage, newStorageKey } from './storage.ts';

// Invented record types: an ordinary one whose rows can be flagged restricted, and a wholly restricted one.
const fixtures: ModuleDef = {
  key: 'testfiles',
  async seedDefaults(ctx) {
    await ctx.db.exec(`
      create table if not exists test_widgets (
        id uuid primary key default gen_random_uuid(), ref text, name text not null,
        restricted boolean not null default false,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);
      create table if not exists test_secrets (
        id uuid primary key default gen_random_uuid(), title text not null,
        created_at timestamptz not null default now(), created_by uuid,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz);`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'widget', table: 'test_widgets', module: 'tickets', label: 'Widget', plural: 'Widgets',
      path: '/api/widgets', route: '/widgets', titleField: 'name', ref: { field: 'ref', prefix: 'W-' }, restricted: 'flag',
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        restricted: { label: 'Restricted', type: 'boolean', default: false },
      },
    });
    ctx.defineResource({
      type: 'secret', table: 'test_secrets', module: 'tickets', label: 'Secret', plural: 'Secrets',
      path: '/api/secrets', route: '/secrets', titleField: 'title', restricted: true,
      fields: { title: { label: 'Title', type: 'text', required: true } },
    });
  },
};

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n', 'latin1'), Buffer.alloc(300, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const PROGRAM = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(120, 0), Buffer.from('This program cannot be run in DOS mode')]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const day = (offset: number) => todayInZone(new Date(Date.now() + offset * 86_400_000));

let t: Awaited<ReturnType<typeof testApp>>;
let admin: string;
let widget: string;
let hidden: string;
let secret: string;

async function tokenFor(userId: string) { return createSession(t.db, userId); }

async function upload(token: string | null, params: Record<string, string>, data: Buffer | Readable, headers: Record<string, string> = {}) {
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams(params)}`,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      'x-grc-csrf': '1', 'content-type': 'application/octet-stream', ...headers,
    },
    payload: data,
  });
  let body: any = null;
  try { body = res.json(); } catch { /* not JSON */ }
  return { status: res.statusCode, body };
}

async function download(token: string, id: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/attachments/${id}/download`, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  return { status: res.statusCode, headers: res.headers, data: res.rawPayload, text: res.body };
}

const on = (id: string, name: string, extra: Record<string, string> = {}) => ({ record_type: 'widget', record_id: id, name, ...extra });
const events = (action: string, recordId: string) =>
  t.db.query<{ summary: string; after: any; before: any }>('select summary, before, after from audit_events where action = $1 and record_id = $2 order by id', [action, recordId]);

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  const adminRow = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  admin = await tokenFor(adminRow!.id);
  widget = (await t.api.post('/api/widgets', { name: 'Open widget' })).body.id;
  hidden = (await t.api.post('/api/widgets', { name: 'Zebra confidential', restricted: true })).body.id;
  secret = (await t.api.post('/api/secrets', { title: 'Zebra secret' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('upload and download', () => {
  it('round-trips a file with its checksum, safe download headers and an audit event', async () => {
    const up = await upload(admin, on(widget, 'Quarterly report.pdf', { description: 'Signed copy' }), PDF);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({
      file_name: 'Quarterly report.pdf', extension: 'pdf', content_type: 'application/pdf', size_bytes: PDF.length,
      sha256: sha(PDF), kind: 'file', description: 'Signed copy', scan_status: 'not_scanned', uploaded_by_name: 'Test Admin',
    });
    expect(up.body.storage_key).toBeUndefined();

    const list = await t.api.get(`/api/attachments?record_type=widget&record_id=${widget}`);
    expect(list.body.canEdit).toBe(true);
    expect(list.body.rows.map((r: any) => r.id)).toContain(up.body.id);

    const got = await download(admin, up.body.id);
    expect(got.status).toBe(200);
    expect(got.data.equals(PDF)).toBe(true);
    expect(sha(got.data)).toBe(up.body.sha256);
    expect(got.headers['content-disposition']).toBe(`attachment; filename="Quarterly report.pdf"; filename*=UTF-8''Quarterly%20report.pdf`);
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(got.headers['content-type']).toBe('application/pdf');

    const audit = await events('attachment.upload', widget);
    expect(audit.at(-1)!.summary).toContain('Quarterly report.pdf');
    expect(audit.at(-1)!.after.sha256).toBe(sha(PDF));
    // The upload shows in the record's own history.
    const history = await t.api.get(`/api/history?record_type=widget&record_id=${widget}`);
    expect(history.body.some((h: any) => h.action === 'attachment.upload')).toBe(true);
    // A download from an ordinary record is not audited.
    expect((await events('attachment.download', widget)).length).toBe(0);
  });

  it('stores the bytes under a random key, never under the file name', async () => {
    const row = await t.db.one<{ storage_key: string; file_name: string }>('select storage_key, file_name from attachments limit 1');
    expect(row!.storage_key).toMatch(/^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/);
    expect(row!.storage_key).not.toContain('report');
  });

  it('needs a session and the CSRF header', async () => {
    expect((await upload(null, on(widget, 'a.pdf'), PDF)).status).toBe(401);
    expect((await upload(admin, on(widget, 'a.pdf'), PDF, { 'x-grc-csrf': '0' })).status).toBe(403);
    expect((await t.anon.get(`/api/attachments?record_type=widget&record_id=${widget}`)).status).toBe(401);
  });

  it('refuses a body that is not a raw file, and an empty file', async () => {
    const json = await t.app.inject({
      method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams(on(widget, 'a.pdf'))}`,
      headers: { cookie: `${SESSION_COOKIE}=${admin}`, 'x-grc-csrf': '1' }, payload: { not: 'a file' },
    });
    expect(json.statusCode).toBe(415);
    const empty = await upload(admin, on(widget, 'empty.txt'), Readable.from([]));
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('empty_file');
  });

  it('refuses a download whose stored content no longer matches its checksum', async () => {
    const up = await upload(admin, on(widget, 'tamper.pdf'), PDF);
    await t.db.query(`update attachments set sha256 = repeat('0', 64) where id = $1`, [up.body.id]);
    const got = await download(admin, up.body.id);
    expect(got.status).toBe(500);
    expect(JSON.parse(got.text).error.code).toBe('integrity');
    expect((await events('attachment.integrity_failure', widget)).length).toBe(1);
  });
});

describe('size limit', () => {
  it('accepts a file larger than the JSON body limit when the setting allows it', async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024, 0x41)]);
    const up = await upload(admin, on(widget, 'big.pdf'), big);
    expect(up.status).toBe(201);
    expect(up.body.size_bytes).toBe(big.length);
    expect((await download(admin, up.body.id)).data.length).toBe(big.length);
  });

  it('refuses files over the configured limit, by declared length and while streaming', async () => {
    expect((await t.api.patch('/api/attachments/settings', { maxMb: 1 })).body.maxBytes).toBe(1024 * 1024);
    const over = Buffer.concat([PDF, Buffer.alloc(1024 * 1024, 0x41)]);
    const declared = await upload(admin, on(widget, 'over.pdf'), over);
    expect(declared.status).toBe(413);
    expect(declared.body.error.code).toBe('too_large');
    expect(declared.body.error.message).toContain('1.0 MB');
    // No Content-Length (a chunked body): the limit is enforced as the bytes arrive.
    const chunks = Array.from({ length: 40 }, () => Buffer.alloc(64 * 1024, 0x41));
    const streamed = await upload(admin, on(widget, 'stream.txt'), Readable.from(chunks));
    expect(streamed.status).toBe(413);
    const before = (await t.db.one<{ c: number }>(`select count(*)::int c from attachments where file_name in ('over.pdf', 'stream.txt')`))!.c;
    expect(before).toBe(0);
    expect((await events('attachment.refused', widget)).filter((e) => e.summary.includes('too large')).length).toBe(2);
    // Exactly at the limit is fine.
    const exact = Buffer.concat([PDF, Buffer.alloc(1024 * 1024 - PDF.length, 0x41)]);
    expect((await upload(admin, on(widget, 'exact.pdf'), exact)).status).toBe(201);
    await t.api.patch('/api/attachments/settings', { maxMb: 25 });
  });

  it('validates the settings and keeps them to administrators', async () => {
    const agent = await t.as('agent');
    expect((await agent.patch('/api/attachments/settings', { maxMb: 500 })).status).toBe(403);
    expect((await t.api.patch('/api/attachments/settings', { maxMb: 0 })).body.error.fields.maxMb).toBeDefined();
    const config = await agent.get('/api/attachments/config');
    expect(config.body).toMatchObject({ maxBytes: 25 * 1024 * 1024, scanner: 'none', canAdminister: false });
    expect(config.body.allowedExtensions).toContain('pdf');
    expect((await t.db.query(`select 1 from audit_events where action = 'setting.change' and record_id = 'attachments.max_bytes'`)).length).toBe(2);
  });
});

describe('file types', () => {
  it('refuses types that are not on the allow-list, and programs always', async () => {
    for (const name of ['setup.exe', 'page.html', 'drawing.svg', 'macro.docm', 'run.ps1', 'no-extension', 'report.pdf.exe']) {
      const res = await upload(admin, on(widget, name), PDF);
      expect(res.status, name).toBe(415);
      expect(res.body.error.code, name).toBe('type_not_allowed');
    }
    const add = await t.api.patch('/api/attachments/settings', { allowedExtensions: 'pdf, exe' });
    expect(add.status).toBe(400);
    expect(add.body.error.fields.allowedExtensions).toMatch(/never be allowed/);
  });

  it('lets an administrator change the allow-list', async () => {
    const original = (await t.api.get('/api/attachments/config')).body.allowedExtensions;
    expect((await upload(admin, on(widget, 'plan.dwg'), Buffer.from('AC1032 drawing bytes'))).status).toBe(415);
    await t.api.patch('/api/attachments/settings', { allowedExtensions: [...original, '.DWG'] });
    const ok = await upload(admin, on(widget, 'plan.dwg'), Buffer.from('AC1032 drawing bytes'));
    expect(ok.status).toBe(201);
    expect(ok.body.content_type).toBe('application/octet-stream');
    // An unknown type is still refused when its content is a program.
    expect((await upload(admin, on(widget, 'tool.dwg'), PROGRAM)).body.error.code).toBe('executable');
    await t.api.patch('/api/attachments/settings', { allowedExtensions: ['pdf'] });
    expect((await upload(admin, on(widget, 'photo.png'), PNG)).status).toBe(415);
    await t.api.patch('/api/attachments/settings', { allowedExtensions: original });
  });

  it('refuses content that does not match the extension', async () => {
    const cases: [string, Buffer, string][] = [
      ['photo.png', PDF, 'type_mismatch'],
      ['report.pdf', PNG, 'type_mismatch'],
      ['report.pdf', Buffer.from('<html><script>alert(1)</script></html>'), 'type_mismatch'],
      ['notes.txt', PDF, 'type_mismatch'],
      ['notes.txt', Buffer.from([0x41, 0x00, 0x42, 0x00, 0x01, 0x02]), 'type_mismatch'],
      ['sheet.xlsx', Buffer.from('not a zip archive at all'), 'type_mismatch'],
      ['invoice.pdf', PROGRAM, 'executable'],
      ['readme.txt', Buffer.from('#!/bin/sh\nrm -rf /\n'), 'executable'],
      ['archive.zip', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), 'executable'],
    ];
    for (const [name, data, code] of cases) {
      const res = await upload(admin, on(widget, name), data);
      expect(res.status, name).toBe(415);
      expect(res.body.error.code, name).toBe(code);
    }
    expect((await upload(admin, on(widget, 'photo.png'), PNG)).status).toBe(201);
    expect((await upload(admin, on(widget, 'notes.txt'), Buffer.from('Plain notes.\nSecond line.\n'))).status).toBe(201);
    expect((await upload(admin, on(widget, 'book.xlsx'), Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40, 7)]))).status).toBe(201);
    expect(checkContent('csv', Buffer.from('MZ123,name\n1,a\n'))).toEqual({ ok: true });
  });

  it('never serves a stored type that a browser could run as a page', async () => {
    const original = (await t.api.get('/api/attachments/config')).body.allowedExtensions;
    await t.api.patch('/api/attachments/settings', { allowedExtensions: [...original, 'html', 'svg'] });
    for (const [name, data] of [['page.html', '<html><script>alert(1)</script></html>'], ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>']]) {
      const up = await upload(admin, on(widget, name), Buffer.from(data));
      expect(up.status).toBe(201);
      const got = await download(admin, up.body.id);
      expect(got.headers['content-type']).toBe('application/octet-stream');
      expect(String(got.headers['content-disposition'])).toMatch(/^attachment;/);
      expect(got.headers['x-content-type-options']).toBe('nosniff');
    }
    await t.api.patch('/api/attachments/settings', { allowedExtensions: original });
  });
});

describe('file names and storage paths', () => {
  it('reduces hostile and odd names to a safe display name', async () => {
    expect(sanitiseFileName('..\\..\\Windows\\System32\\evil.pdf')).toBe('evil.pdf');
    expect(sanitiseFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFileName('C:\\fakepath\\Report.PDF')).toBe('Report.PDF');
    expect(sanitiseFileName('a\r\nSet-Cookie: x=1.pdf')).toBe('aSet-Cookie_ x=1.pdf');
    expect(sanitiseFileName('invoice\u202Efdp.exe')).toBe('invoicefdp.exe');
    expect(sanitiseFileName('nul\u0000byte.txt')).toBe('nulbyte.txt');
    expect(sanitiseFileName('  report.pdf. . ')).toBe('report.pdf');
    expect(sanitiseFileName('.htaccess')).toBe('htaccess');
    expect(sanitiseFileName('CON.pdf')).toBe('_CON.pdf');
    expect(sanitiseFileName('')).toBe('file');
    expect(sanitiseFileName('...')).toBe('file');
    const long = sanitiseFileName(`${'x'.repeat(400)}.pdf`);
    expect(long.length).toBe(180);
    expect(extensionOf(long)).toBe('pdf');
    expect(extensionOf('archive.tar.GZ')).toBe('gz');
    expect(extensionOf('weird.p d f')).toBe('');
    expect(contentDisposition('a"b;c%.pdf')).toBe(`attachment; filename="a_b_c_.pdf"; filename*=UTF-8''a%22b%3Bc%25.pdf`);
  });

  it('keeps traversal attempts and unusual names out of the storage path', async () => {
    const traversal = await upload(admin, on(widget, '..\\..\\..\\outside\\evil.pdf'), PDF);
    expect(traversal.status).toBe(201);
    expect(traversal.body.file_name).toBe('evil.pdf');
    expect((await upload(admin, on(widget, '../../etc/passwd'), PDF)).status).toBe(415);

    const odd = await upload(admin, on(widget, 'Bericht \u2013 Gr\u00f6\u00dfe \u2713 (final).pdf'), PDF);
    expect(odd.status).toBe(201);
    const got = await download(admin, odd.body.id);
    expect(got.status).toBe(200);
    const disposition = String(got.headers['content-disposition']);
    expect(disposition).toContain('filename="Bericht _ Gr__e _ (final).pdf"');
    expect(decodeURIComponent(disposition.split("UTF-8''")[1])).toBe('Bericht \u2013 Gr\u00f6\u00dfe \u2713 (final).pdf');
    expect(disposition).not.toMatch(/[\r\n]/);

    const keys = await t.db.query<{ storage_key: string }>('select storage_key from attachments');
    expect(keys.every((k) => /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{32}$/.test(k.storage_key))).toBe(true);
  });

  it('the disk driver writes only inside its folder and cleans up after a failed write', async () => {
    const root = await mkdtemp(join(tmpdir(), 'sandpiper-files-test-'));
    try {
      const disk = diskStorage(root);
      const key = newStorageKey();
      await disk.put(key, Readable.from([PDF]));
      expect(await disk.stat(key)).toEqual({ size: PDF.length });
      const chunks: Buffer[] = [];
      for await (const c of await disk.get(key)) chunks.push(c as Buffer);
      expect(Buffer.concat(chunks).equals(PDF)).toBe(true);

      for (const bad of ['../../outside', '..\\..\\outside', 'aa/bb/../../../../outside', '/etc/passwd', 'C:\\x', 'aa/bb/short', '']) {
        await expect(disk.put(bad, Readable.from([PDF])), bad).rejects.toThrow(/Invalid storage key/);
        await expect(disk.get(bad), bad).rejects.toThrow(/Invalid storage key/);
        await expect(disk.delete(bad), bad).rejects.toThrow(/Invalid storage key/);
      }

      const failing = newStorageKey();
      const broken = new Readable({ read() { this.push(Buffer.from('partial')); this.destroy(new Error('connection lost')); } });
      await expect(disk.put(failing, broken)).rejects.toThrow(/connection lost/);
      expect(await disk.stat(failing)).toBeNull();
      const folder = join(root, failing.slice(0, 2), failing.slice(3, 5));
      expect(await readdir(folder)).toEqual([]);

      await disk.delete(key);
      expect(await disk.stat(key)).toBeNull();
      await disk.delete(key); // already gone: still succeeds
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('permissions and restricted records', () => {
  it('lets a viewer list and download but not add, change or remove', async () => {
    const up = await upload(admin, on(widget, 'shared.pdf'), PDF);
    const pm = await t.as('project_manager'); // holds tickets.view only
    const pmToken = await tokenFor(pm.userId);
    const list = await pm.get(`/api/attachments?record_type=widget&record_id=${widget}`);
    expect(list.status).toBe(200);
    expect(list.body.canEdit).toBe(false);
    expect((await download(pmToken, up.body.id)).status).toBe(200);
    expect((await upload(pmToken, on(widget, 'mine.pdf'), PDF)).status).toBe(403);
    expect((await pm.patch(`/api/attachments/${up.body.id}`, { description: 'x' })).status).toBe(403);
    expect((await pm.del(`/api/attachments/${up.body.id}`)).status).toBe(403);

    const viewer = await t.as('executive_viewer'); // no tickets permission at all
    const viewerToken = await tokenFor(viewer.userId);
    expect((await viewer.get(`/api/attachments?record_type=widget&record_id=${widget}`)).status).toBe(404);
    expect((await download(viewerToken, up.body.id)).status).toBe(404);
    expect((await upload(viewerToken, on(widget, 'mine.pdf'), PDF)).status).toBe(404);
  });

  it('keeps the files of restricted records invisible to an ordinary agent', async () => {
    const onFlagged = await upload(admin, on(hidden, 'zebra-plan.pdf', { kind: 'evidence', expires_on: day(5) }), PDF);
    const onSecret = await upload(admin, { record_type: 'secret', record_id: secret, name: 'zebra-secret.pdf' }, PDF);
    expect(onFlagged.status).toBe(201);
    expect(onSecret.status).toBe(201);

    const agent = await t.as('agent'); // tickets.* but not security.view
    const token = await tokenFor(agent.userId);
    const missing = await download(token, '00000000-0000-4000-8000-000000000000');
    expect(missing.status).toBe(404);

    for (const att of [onFlagged.body, onSecret.body]) {
      const list = await agent.get(`/api/attachments?record_type=${att.record_type}&record_id=${att.record_id}`);
      expect(list.status).toBe(404);
      expect(list.text).not.toContain('zebra');
      const got = await download(token, att.id);
      expect(got.status).toBe(404);
      // Exactly the answer given for a file that does not exist.
      expect(got.text).toBe(missing.text);
      expect((await agent.patch(`/api/attachments/${att.id}`, { description: 'x' })).text).toBe(missing.text);
      expect((await agent.del(`/api/attachments/${att.id}`)).text).toBe(missing.text);
      expect((await upload(token, { record_type: att.record_type, record_id: att.record_id, name: 'mine.pdf' }, PDF)).status).toBe(404);
    }
    const expiring = await agent.get('/api/attachments/evidence-expiring?days=30');
    expect(expiring.status).toBe(200);
    expect(JSON.stringify(expiring.body)).not.toContain('zebra');
    // Nothing was changed or removed by the refused calls.
    expect((await t.db.one<{ c: number }>(`select count(*)::int c from attachments where file_name like 'zebra%' and deleted_at is null and description is null`))!.c).toBe(2);

    const lead = await t.as('security_lead');
    const leadToken = await tokenFor(lead.userId);
    expect((await lead.get(`/api/attachments?record_type=widget&record_id=${hidden}`)).body.rows.length).toBe(1);
    expect((await lead.get('/api/attachments/evidence-expiring?days=30')).body.rows.map((r: any) => r.file_name)).toContain('zebra-plan.pdf');
    expect((await download(leadToken, onFlagged.body.id)).status).toBe(200);
    expect((await download(leadToken, onSecret.body.id)).status).toBe(200);
    // Downloads from restricted records are audited.
    expect((await events('attachment.download', hidden)).length).toBe(1);
    expect((await events('attachment.download', secret))[0].summary).toContain('zebra-secret.pdf');
  });

  it('answers not found for unknown record types, bad ids and deleted records', async () => {
    expect((await t.api.get('/api/attachments?record_type=nonsense&record_id=' + widget)).status).toBe(404);
    expect((await t.api.get('/api/attachments?record_type=widget&record_id=not-a-uuid')).status).toBe(404);
    expect((await t.api.get('/api/attachments')).status).toBe(404);
    expect((await download(admin, 'not-a-uuid')).status).toBe(404);
    const gone = (await t.api.post('/api/widgets', { name: 'Short-lived' })).body.id;
    const up = await upload(admin, on(gone, 'orphan.pdf'), PDF);
    await t.api.del(`/api/widgets/${gone}`);
    expect((await download(admin, up.body.id)).status).toBe(404);
  });
});

describe('evidence', () => {
  it('records collection and expiry dates and validates them', async () => {
    const plain = await upload(admin, on(widget, 'plain.pdf', { collected_on: day(-3), expires_on: day(9) }), PDF);
    expect(plain.body).toMatchObject({ kind: 'file', collected_on: null, expires_on: null });

    const defaulted = await upload(admin, on(widget, 'policy-signoff.pdf', { kind: 'evidence' }), PDF);
    expect(defaulted.body).toMatchObject({ kind: 'evidence', collected_on: day(0), expires_on: null });

    const bad = await upload(admin, on(widget, 'bad.pdf', { kind: 'evidence', collected_on: day(-2), expires_on: day(-5) }), PDF);
    expect(bad.status).toBe(400);
    expect(bad.body.error.fields.expires_on).toMatch(/before/);
    expect((await upload(admin, on(widget, 'bad.pdf', { kind: 'evidence', collected_on: day(3) }), PDF)).body.error.fields.collected_on).toMatch(/future/);
    expect((await upload(admin, on(widget, 'bad.pdf', { kind: 'evidence', collected_on: '03/04/2026' }), PDF)).body.error.fields.collected_on).toBeDefined();
    expect((await upload(admin, on(widget, 'bad.pdf', { kind: 'other' }), PDF)).body.error.fields.kind).toBeDefined();
  });

  it('lists evidence that has expired or soon will, soonest first', async () => {
    const soon = await upload(admin, on(widget, 'scan-report.pdf', { kind: 'evidence', collected_on: day(-300), expires_on: day(20) }), PDF);
    const past = await upload(admin, on(widget, 'old-certificate.pdf', { kind: 'evidence', collected_on: day(-400), expires_on: day(-10) }), PDF);
    const later = await upload(admin, on(widget, 'far-off.pdf', { kind: 'evidence', collected_on: day(-1), expires_on: day(200) }), PDF);

    const res = await t.api.get('/api/attachments/evidence-expiring?days=30');
    expect(res.body.days).toBe(30);
    const mine = res.body.rows.filter((r: any) => r.record_id === widget);
    expect(mine.map((r: any) => r.id)).toEqual([past.body.id, soon.body.id]);
    expect(mine[0]).toMatchObject({ expired: true, days_left: -10, record_label: 'W-00001 Open widget', record_type_label: 'Widget', record_route: `/widgets/${widget}` });
    expect(mine[1]).toMatchObject({ expired: false, days_left: 20 });
    const wide = await t.api.get('/api/attachments/evidence-expiring?days=365');
    expect(wide.body.rows.map((r: any) => r.id)).toContain(later.body.id);
    expect((await t.api.get('/api/attachments/evidence-expiring?days=abc')).body.days).toBe(90);

    // Changing the dates is audited with before and after, and moves it out of the list.
    const patched = await t.api.patch(`/api/attachments/${soon.body.id}`, { expires_on: day(120), description: 'Renewed' });
    expect(patched.body).toMatchObject({ expires_on: day(120), description: 'Renewed', collected_on: day(-300) });
    const change = (await events('attachment.update', widget)).at(-1)!;
    expect(change.before).toMatchObject({ expires_on: day(20), description: null });
    expect(change.after).toEqual({ expires_on: day(120), description: 'Renewed' });
    expect((await t.api.get('/api/attachments/evidence-expiring?days=30')).body.rows.map((r: any) => r.id)).not.toContain(soon.body.id);
    expect((await t.api.patch(`/api/attachments/${soon.body.id}`, { expires_on: day(-350) })).status).toBe(400);
    // Turning evidence back into an ordinary file clears its dates.
    expect((await t.api.patch(`/api/attachments/${past.body.id}`, { kind: 'file' })).body).toMatchObject({ kind: 'file', collected_on: null, expires_on: null });
    // A change that changes nothing writes no event.
    const count = (await events('attachment.update', widget)).length;
    await t.api.patch(`/api/attachments/${soon.body.id}`, { description: 'Renewed' });
    expect((await events('attachment.update', widget)).length).toBe(count);
  });
});

describe('removal', () => {
  it('soft-deletes: gone from lists and downloads, kept in the table, audited', async () => {
    const up = await upload(admin, on(widget, 'to-remove.pdf', { kind: 'evidence', expires_on: day(3) }), PDF);
    expect((await t.api.del(`/api/attachments/${up.body.id}`)).status).toBe(200);
    const list = await t.api.get(`/api/attachments?record_type=widget&record_id=${widget}`);
    expect(list.body.rows.map((r: any) => r.id)).not.toContain(up.body.id);
    expect((await download(admin, up.body.id)).status).toBe(404);
    expect((await t.api.patch(`/api/attachments/${up.body.id}`, { description: 'x' })).status).toBe(404);
    expect((await t.api.del(`/api/attachments/${up.body.id}`)).status).toBe(404);
    expect((await t.api.get('/api/attachments/evidence-expiring?days=30')).body.rows.map((r: any) => r.id)).not.toContain(up.body.id);
    const row = await t.db.one<{ deleted_at: string | null }>('select deleted_at from attachments where id = $1', [up.body.id]);
    expect(row!.deleted_at).not.toBeNull();
    const removed = (await events('attachment.delete', widget)).at(-1)!;
    expect(removed.summary).toBe('File removed: to-remove.pdf');
    expect(removed.before.sha256).toBe(sha(PDF));
  });
});

describe('malware scanning hook', () => {
  it('offers every file to the registered scanner and acts on its verdict', async () => {
    const seen: string[] = [];
    t.app.fileScanner.use({
      name: 'test-engine',
      async scan(file) {
        seen.push(file.fileName);
        const chunks: Buffer[] = [];
        for await (const c of await file.open()) chunks.push(c as Buffer);
        const text = Buffer.concat(chunks).toString('latin1');
        if (text.includes('SCANNER-BREAKS')) throw new Error('engine offline');
        return text.includes('TEST-SIGNATURE') ? { verdict: 'infected', detail: 'Test.Signature' } : { verdict: 'clean' };
      },
    });
    try {
      const clean = await upload(admin, on(widget, 'checked.txt'), Buffer.from('ordinary text'));
      expect(clean.body).toMatchObject({ scan_status: 'clean', scan_engine: 'test-engine' });
      expect((await t.api.get('/api/attachments/config')).body.scanner).toBe('test-engine');

      const infected = await upload(admin, on(widget, 'bad.txt'), Buffer.from('contains TEST-SIGNATURE here'));
      expect(infected.status).toBe(422);
      expect(infected.body.error.code).toBe('malware');
      expect(infected.body.error.message).not.toContain('Test.Signature');
      const failed = await upload(admin, on(widget, 'unlucky.txt'), Buffer.from('SCANNER-BREAKS'));
      expect(failed.status).toBe(503);
      expect(failed.body.error.code).toBe('scan_failed');

      expect(seen).toEqual(['checked.txt', 'bad.txt', 'unlucky.txt']);
      expect((await t.db.query(`select 1 from attachments where file_name in ('bad.txt', 'unlucky.txt')`)).length).toBe(0);
      const refused = (await events('attachment.refused', widget)).map((e) => e.summary);
      expect(refused).toContain('File refused: bad.txt (malware scanner test-engine: Test.Signature)');
      expect(refused.some((s) => s.includes('unlucky.txt') && s.includes('engine offline'))).toBe(true);
    } finally {
      t.app.fileScanner.reset();
    }
    expect((await upload(admin, on(widget, 'after.txt'), Buffer.from('ordinary text'))).body.scan_status).toBe('not_scanned');
  });
});
