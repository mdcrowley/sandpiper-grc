import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { testApp } from '../../test/helpers.ts';

// E45-51 and E45-52: a file attached in data load mode (chunked upload) is recorded as added by the
// person the load names, keeps the date it was first added, and is undone with the load. Outside a
// load a date is refused. Invented data.

let t: Awaited<ReturnType<typeof testApp>>;
let system = '';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function finishedUpload(name: string): Promise<string> {
  const file = Buffer.from(`Invented maintenance record for ${name}.\n`);
  const start = await t.api.post('/api/attachments/uploads', { file_name: name, size: file.length, sha256: sha(file) });
  expect(start.status, JSON.stringify(start.body)).toBe(201);
  expect((await t.api.post(`/api/attachments/uploads/${start.body.id}/parts/1`, { data: file.toString('base64') })).status).toBe(200);
  expect((await t.api.post(`/api/attachments/uploads/${start.body.id}/finish`, {})).status).toBe(200);
  return start.body.id;
}

beforeAll(async () => {
  t = await testApp();
  await t.db.query(`insert into users (username, email, display_name, status) values ('kfiler', 'k.filer@example.test', 'Kim Filer', 'disabled')`);
  system = (await t.api.post('/api/systems', { name: 'Invented depot yard system' })).body.id;
}, 60_000);
afterAll(async () => { await t?.close(); });

describe('files attached in data load mode', () => {
  it('refuse a given date outside a load', async () => {
    const upload = await finishedUpload('outside.txt');
    const res = await t.api.post(`/api/attachments/uploads/${upload}/attach`, { record_type: 'system', record_id: system, created_at: '2021-03-04' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.created_at).toBeTruthy();
    // Without a date it attaches as usual, by the caller, and is not listed as loaded.
    const ok = await t.api.post(`/api/attachments/uploads/${upload}/attach`, { record_type: 'system', record_id: system });
    expect(ok.status).toBe(201);
    expect((await t.db.one<Row>('select uploaded_by_name from attachments where id = $1', [ok.body.id]))!.uploaded_by_name).toBe('Test Admin');
    expect(await t.db.one(`select 1 from data_load_records where record_type = 'attachment' and record_id = $1`, [ok.body.id])).toBeUndefined();
  });

  it('keep the named person and the date, are listed with the load and undone with it', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true, days: 1 })).status).toBe(200);
    const upload = await finishedUpload('loaded.txt');
    const res = await t.api.post(`/api/attachments/uploads/${upload}/attach`, {
      record_type: 'system', record_id: system, created_at: '2021-03-04', on_behalf_of: 'kfiler',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const row = (await t.db.one<Row>('select uploaded_by_name, created_by, created_at from attachments where id = $1', [res.body.id]))!;
    expect(row.uploaded_by_name).toBe('Kim Filer');
    expect(new Date(row.created_at).toISOString().slice(0, 10)).toBe('2021-03-04');
    // A date in the future is refused even in a load.
    const later = await finishedUpload('later.txt');
    expect((await t.api.post(`/api/attachments/uploads/${later}/attach`, { record_type: 'system', record_id: system, created_at: '2999-01-01' })).status).toBe(400);

    const page = (await t.api.get('/api/admin/data-load')).body;
    expect(page.loads.find((l: Row) => l.record_type === 'attachment')).toMatchObject({ label: 'Files', remaining: 1 });
    const undo = await t.api.post('/api/admin/data-load/undo', { type: 'attachment', day: dayInZone() });
    expect(undo.status, JSON.stringify(undo.body)).toBe(200);
    expect(undo.body).toEqual({ deleted: 1, held: 0, missing: 0 });
    expect((await t.db.one<Row>('select deleted_at from attachments where id = $1', [res.body.id]))!.deleted_at).toBeTruthy();
    expect((await t.api.get(`/api/attachments?record_type=system&record_id=${system}`)).body.rows.map((r: Row) => r.file_name)).toEqual(['outside.txt']);
  });
});
