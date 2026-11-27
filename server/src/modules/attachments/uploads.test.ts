import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { expireUploads, UPLOAD_PART_BYTES } from './uploads.ts';

// Chunked uploads (E43-07): parts in any order, as raw bytes or base64, the SHA-256 check, the size
// limit, the malware scanner, ownership, attaching under the record's rules, and expiry. Invented data.

const fixtures: ModuleDef = {
  key: 'testuploads',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_crates (
      id uuid primary key default gen_random_uuid(), name text not null, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid, updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'crate', table: 'test_crates', module: 'tickets', label: 'Crate', plural: 'Crates', path: '/api/crates', route: '/crates',
      titleField: 'name', restricted: 'flag',
      fields: { name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean', default: false } },
    });
  },
};

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
let t: Awaited<ReturnType<typeof testApp>>;
let crate = '';

/** A text file of `size` bytes with a recognizable pattern. */
const textOf = (size: number, seed = 'Invented depot inspection log line. ') => Buffer.from(seed.repeat(Math.ceil(size / seed.length)).slice(0, size));

async function part(id: string, n: number, bytes: Buffer, raw = false) {
  if (raw) {
    const res = await t.app.inject({
      method: 'PUT', url: `/api/attachments/uploads/${id}/parts/${n}`, payload: bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-grc-csrf': '1', cookie: adminCookie },
    });
    return { status: res.statusCode, body: res.json() };
  }
  return t.api.post(`/api/attachments/uploads/${id}/parts/${n}`, { data: bytes.toString('base64') });
}
let adminCookie = '';

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  // The admin's session cookie, for the raw-bytes calls.
  const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  adminCookie = `${SESSION_COOKIE}=${await createSession(t.db, admin!.id)}`;
  crate = (await t.api.post('/api/crates', { name: 'Invented spare parts crate' })).body.id;
});
afterAll(async () => { await t.close(); });

describe('chunked uploads', () => {
  it('takes parts in any order, as base64 or raw bytes, checks the SHA-256 and attaches once', async () => {
    const file = textOf(UPLOAD_PART_BYTES * 2 + 1234);
    const start = await t.api.post('/api/attachments/uploads', { file_name: 'depot-log.txt', size: file.length, sha256: sha(file) });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(start.body).toMatchObject({ part_count: 3, part_size: UPLOAD_PART_BYTES, status: 'receiving', missing_parts: [1, 2, 3] });
    const id = start.body.id;
    const pieces = [file.subarray(0, UPLOAD_PART_BYTES), file.subarray(UPLOAD_PART_BYTES, 2 * UPLOAD_PART_BYTES), file.subarray(2 * UPLOAD_PART_BYTES)];
    expect((await part(id, 3, pieces[2])).status).toBe(200);
    // A part of the wrong size is refused.
    const wrong = await part(id, 1, pieces[2]);
    expect([wrong.status, wrong.body.error.code]).toEqual([400, 'part_size']);
    expect((await part(id, 1, pieces[0])).body.missing_parts).toEqual([2]);
    // Finishing early names the missing part.
    const early = await t.api.post(`/api/attachments/uploads/${id}/finish`, {});
    expect([early.status, early.body.error.code]).toEqual([409, 'parts_missing']);
    // A part sent again replaces the earlier one (here raw bytes).
    expect((await part(id, 2, pieces[1], true)).status).toBe(200);
    expect((await part(id, 2, pieces[1])).body.missing_parts).toEqual([]);
    const done = await t.api.post(`/api/attachments/uploads/${id}/finish`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: 'ready', sha256: sha(file), size: file.length });
    // Only the final file is stored: the parts are gone.
    const stores = (t.app as any).attachmentStores.local.files as Map<string, Buffer>;
    const row = await t.db.one<any>('select storage_key, parts from uploads_pending where id = $1', [id]);
    expect(row.parts).toEqual({});
    expect(stores.get(row.storage_key)!.equals(file)).toBe(true);

    const attached = await t.api.post(`/api/attachments/uploads/${id}/attach`, { record_type: 'crate', record_id: crate, description: 'Loaded in parts' });
    expect(attached.status, JSON.stringify(attached.body)).toBe(201);
    expect(attached.body).toMatchObject({ file_name: 'depot-log.txt', size_bytes: file.length, sha256: sha(file), description: 'Loaded in parts' });
    const again = await t.api.post(`/api/attachments/uploads/${id}/attach`, { record_type: 'crate', record_id: crate });
    expect([again.status, again.body.error.code]).toEqual([409, 'upload_used']);
    const audit = await t.db.query<any>(`select action, summary from audit_events where record_id = $1 or record_id = $2 order by id`, [id, crate]);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['attachment.upload_received', 'attachment.upload']));
  });

  it('refuses a file whose SHA-256 does not match, and keeps nothing', async () => {
    const file = textOf(5000);
    const start = await t.api.post('/api/attachments/uploads', { file_name: 'notes.txt', size: file.length, sha256: sha(Buffer.from('something else')) });
    await part(start.body.id, 1, file);
    const before = ((t.app as any).attachmentStores.local.files as Map<string, Buffer>).size;
    const r = await t.api.post(`/api/attachments/uploads/${start.body.id}/finish`, {});
    expect([r.status, r.body.error.code]).toEqual([422, 'checksum_mismatch']);
    expect(((t.app as any).attachmentStores.local.files as Map<string, Buffer>).size).toBe(before - 1);
    expect((await t.api.get(`/api/attachments/uploads/${start.body.id}`)).body.status).toBe('failed');
    // A part with a SHA-256 that does not match is refused at once.
    const s2 = await t.api.post('/api/attachments/uploads', { file_name: 'notes.txt', size: 10 });
    const bad = await t.api.post(`/api/attachments/uploads/${s2.body.id}/parts/1`, { data: Buffer.from('0123456789').toString('base64'), sha256: sha(Buffer.from('x')) });
    expect([bad.status, bad.body.error.code]).toEqual([422, 'checksum_mismatch']);
  });

  it('checks the type and the size limit before any byte, and the content and scanner at the end', async () => {
    expect((await t.api.post('/api/attachments/uploads', { file_name: 'tool.exe', size: 10 })).body.error.code).toBe('type_not_allowed');
    await t.db.query(`insert into settings (key, value) values ('attachments.max_bytes', '100000'::jsonb) on conflict (key) do update set value = excluded.value`);
    const big = await t.api.post('/api/attachments/uploads', { file_name: 'big.txt', size: 100_001 });
    expect([big.status, big.body.error.code]).toEqual([413, 'too_large']);
    await t.db.query(`delete from settings where key = 'attachments.max_bytes'`);
    // A file named .pdf that is not one.
    const fake = Buffer.from('plain words, not a PDF at all');
    const s = await t.api.post('/api/attachments/uploads', { file_name: 'policy.pdf', size: fake.length });
    await part(s.body.id, 1, fake);
    const r = await t.api.post(`/api/attachments/uploads/${s.body.id}/finish`, {});
    expect(r.status).toBe(415);
    // The malware scanner sees the whole joined file.
    t.app.fileScanner.use({
      name: 'test-engine',
      async scan(f) {
        const chunks: Buffer[] = [];
        for await (const c of await f.open()) chunks.push(c as Buffer);
        return Buffer.concat(chunks).toString('latin1').includes('TEST-SIGNATURE') ? { verdict: 'infected', detail: 'Test.Signature' } : { verdict: 'clean' };
      },
    });
    try {
      const evil = Buffer.concat([textOf(UPLOAD_PART_BYTES), Buffer.from('TEST-SIGNATURE')]);
      const e = await t.api.post('/api/attachments/uploads', { file_name: 'evil.txt', size: evil.length });
      await part(e.body.id, 1, evil.subarray(0, UPLOAD_PART_BYTES));
      await part(e.body.id, 2, evil.subarray(UPLOAD_PART_BYTES));
      const f = await t.api.post(`/api/attachments/uploads/${e.body.id}/finish`, {});
      expect([f.status, f.body.error.code]).toEqual([422, 'malware']);
    } finally {
      t.app.fileScanner.reset();
    }
  });

  it('belongs to the person who started it, and attaches only where they may change files', async () => {
    const other = await t.as('requester');
    const file = Buffer.from('Invented note for the crate');
    const s = await t.api.post('/api/attachments/uploads', { file_name: 'note.txt', size: file.length });
    expect((await other.get(`/api/attachments/uploads/${s.body.id}`)).status).toBe(404);
    expect((await other.post(`/api/attachments/uploads/${s.body.id}/parts/1`, { data: file.toString('base64') })).status).toBe(404);
    await part(s.body.id, 1, file);
    await t.api.post(`/api/attachments/uploads/${s.body.id}/finish`, {});
    expect((await other.post(`/api/attachments/uploads/${s.body.id}/attach`, { record_type: 'crate', record_id: crate })).status).toBe(404);

    // The requester's own upload cannot go onto a record they may not change, or a restricted one they cannot see.
    const mine = await other.post('/api/attachments/uploads', { file_name: 'mine.txt', size: file.length });
    await other.post(`/api/attachments/uploads/${mine.body.id}/parts/1`, { data: file.toString('base64') });
    expect((await other.post(`/api/attachments/uploads/${mine.body.id}/finish`, {})).status).toBe(200);
    const denied = await other.post(`/api/attachments/uploads/${mine.body.id}/attach`, { record_type: 'crate', record_id: crate });
    expect([403, 404]).toContain(denied.status);
    const hidden = (await t.api.post('/api/crates', { name: 'Invented sealed crate', restricted: true })).body.id;
    const agent = await t.as('agent');
    const a = await agent.post('/api/attachments/uploads', { file_name: 'a.txt', size: file.length });
    await agent.post(`/api/attachments/uploads/${a.body.id}/parts/1`, { data: file.toString('base64') });
    await agent.post(`/api/attachments/uploads/${a.body.id}/finish`, {});
    expect((await agent.post(`/api/attachments/uploads/${a.body.id}/attach`, { record_type: 'crate', record_id: hidden })).status).toBe(404);
    expect((await agent.post(`/api/attachments/uploads/${a.body.id}/attach`, { record_type: 'crate', record_id: crate })).status).toBe(201);
  });

  it('expires unused uploads with their bytes, and can be canceled', async () => {
    const file = textOf(3000);
    const s = await t.api.post('/api/attachments/uploads', { file_name: 'late.txt', size: file.length });
    await part(s.body.id, 1, file);
    const files = (t.app as any).attachmentStores.local.files as Map<string, Buffer>;
    const before = files.size;
    await t.db.query(`update uploads_pending set expires_at = now() - interval '1 minute' where id = $1`, [s.body.id]);
    expect((await t.api.get(`/api/attachments/uploads/${s.body.id}`)).status).toBe(404);
    expect((await expireUploads(t as any)).removed).toBeGreaterThanOrEqual(1);
    expect(files.size).toBe(before - 1);
    const c = await t.api.post('/api/attachments/uploads', { file_name: 'cancel.txt', size: file.length });
    await part(c.body.id, 1, file);
    await t.api.post(`/api/attachments/uploads/${c.body.id}/finish`, {});
    expect((await t.api.del(`/api/attachments/uploads/${c.body.id}`)).body).toEqual({ ok: true });
    expect(files.size).toBe(before - 1);
  });
});
