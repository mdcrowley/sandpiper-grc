import { createHash } from 'node:crypto';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from '../../../test/helpers.ts';
import { makeDocx, makePdf, para } from '../convert/fixtures.ts';
import { documentFilesStandIn } from '../convert/testing.ts';
import { isClutter, loadOrder, readArchive } from './manifest.ts';

// Documents > Import (E43-11): a .zip with manifest.csv, checked by a dry run that changes nothing,
// then loaded in data load mode with versions out of order, original statuses and dates, a parent,
// Office lock files and thumbnail caches skipped, and per-row errors. Invented data only.

let t: Awaited<ReturnType<typeof testApp>>;
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function upload(name: string, bytes: Buffer): Promise<string> {
  const s = await t.api.post('/api/attachments/uploads', { file_name: name, size: bytes.length, sha256: sha(bytes) });
  for (let n = 1; n <= s.body.part_count; n++) {
    await t.api.post(`/api/attachments/uploads/${s.body.id}/parts/${n}`, { data: bytes.subarray((n - 1) * s.body.part_size, n * s.body.part_size).toString('base64') });
  }
  const f = await t.api.post(`/api/attachments/uploads/${s.body.id}/finish`, {});
  expect(f.status, JSON.stringify(f.body)).toBe(200);
  return s.body.id;
}
async function finished(id: string) {
  for (let i = 0; i < 300; i++) {
    const r = await t.api.get(`/api/documents/imports/${id}`);
    if (r.body.status !== 'running') return r.body;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('import did not finish');
}

const MANIFEST = [
  'doc_number,title,document_type,department,owner,parent_number,access,version,version_label,status,approved_on,effective_on,superseded_on,approval_body,approval_reference,file',
  'SOP-IT-014,Invented network change procedure,sop,Invented IT,admin,POL-IT-001,restricted,2,Rev. B,published,2023-05-20,2023-06-01,,,,IT/SOP-IT-014 Rev B.docx',
  'SOP-IT-014,Invented network change procedure,sop,Invented IT,admin,POL-IT-001,restricted,1,Rev. A,superseded,2021-02-15,2021-03-01,2023-06-01,,,IT/old/SOP-IT-014 Rev A.pdf',
  'POL-IT-001,Invented information security policy,policy,Invented IT,admin,,organization,1,2020-1,published,2020-01-10,2020-02-01,,Invented board of directors,Resolution 2020-07,POL-IT-001.pdf',
  'POL-OLD-009,Invented travel policy,policy,,admin,,,1,,withdrawn,2009-01-01,2009-02-01,,,,legacy/travel.doc',
  'BAD-001,Invented broken row,policy,,,,,1,,published,not a date,,,,,missing.pdf',
  'BAD-002,Invented lock file row,policy,,,,,1,,,,,,,,~$lock.docx',
].join('\n');

let zip: Buffer;
beforeAll(async () => {
  t = await testApp({ extraModules: [documentFilesStandIn] });
  await t.api.post('/api/departments', { name: 'Invented IT' });
  const legacy = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(1024, 0)]);
  zip = Buffer.from(zipSync({
    'manifest.csv': strToU8(MANIFEST),
    'IT/SOP-IT-014 Rev B.docx': new Uint8Array(makeDocx([para('Network changes', 'Heading1'), para('Revision B text.')])),
    'IT/old/SOP-IT-014 Rev A.pdf': new Uint8Array(await makePdf(['Revision A of the invented procedure'])),
    'POL-IT-001.pdf': new Uint8Array(await makePdf(['Invented information security policy'])),
    'legacy/travel.doc': new Uint8Array(legacy),
    'IT/~$lock.docx': strToU8('lock'),
    'IT/Thumbs.db': strToU8('cache'),
    '__MACOSX/IT/._x': strToU8('mac'),
  }));
});
afterAll(async () => { await t.close(); });

describe('reading the package', () => {
  it('skips lock files and thumbnail caches, checks each row, and orders versions oldest first with parents before children', () => {
    expect(['IT/~$x.docx', 'Thumbs.db', 'a/.DS_Store', '__MACOSX/a', 'desktop.ini'].every(isClutter)).toBe(true);
    expect(isClutter('IT/SOP.docx')).toBe(false);
    const a = readArchive(zip);
    expect(a.problems).toEqual([]);
    expect(a.skipped.sort()).toEqual(['IT/Thumbs.db', 'IT/~$lock.docx', '__MACOSX/IT/._x']);
    const bad = a.rows.find((r) => r.values.doc_number === 'BAD-001')!;
    expect(bad.problems.join(' ')).toMatch(/approved_on "not a date"/);
    expect(bad.problems.join(' ')).toMatch(/"missing.pdf" is not in the archive/);
    expect(a.rows.find((r) => r.values.doc_number === 'BAD-002')!.problems.join(' ')).toMatch(/lock file/);
    const order = loadOrder(a.rows).map((r) => `${r.values.doc_number}:${r.values.version}`);
    expect(order.indexOf('POL-IT-001:1')).toBeLessThan(order.indexOf('SOP-IT-014:1'));
    expect(order.indexOf('SOP-IT-014:1')).toBeLessThan(order.indexOf('SOP-IT-014:2'));
  });

  it('refuses an archive without a manifest', () => {
    expect(readArchive(zipSync({ 'a.pdf': strToU8('x') })).problems.join(' ')).toMatch(/no manifest.csv/);
    expect(readArchive(new Uint8Array([1, 2, 3])).problems.join(' ')).toMatch(/not a readable .zip/);
  });
});

describe('importing', () => {
  it('needs document controller rights', async () => {
    const agent = await t.as('agent');
    expect((await agent.post('/api/documents/imports', { upload_id: '00000000-0000-4000-8000-000000000000' })).status).toBe(403);
  });

  it('checks everything in a dry run and changes nothing', async () => {
    const before = (await t.db.one<{ n: number }>('select count(*)::int as n from policies'))!.n;
    const r = await t.api.post('/api/documents/imports', { upload_id: await upload('package.zip', zip), dry_run: true });
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    const done = await finished(r.body.id);
    expect(done.status).toBe('done');
    expect(done.summary).toMatchObject({ rows: 6, ok: 4, errors: 2, documents_created: 0, versions_created: 0, skipped_files: 3 });
    const travel = done.results.find((x: any) => x.doc_number === 'POL-OLD-009');
    expect(travel.warnings.join(' ')).toMatch(/save it as \.docx/);
    expect(done.results.find((x: any) => x.doc_number === 'SOP-IT-014').action).toMatch(/create document/);
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from policies'))!.n).toBe(before);
  });

  it('loads the package in data load mode with original statuses and dates', async () => {
    await t.db.query('update sessions set confirmed_at = now()');
    expect((await t.api.post('/api/admin/data-load', { on: true })).status).toBe(200);
    const r = await t.api.post('/api/documents/imports', { upload_id: await upload('package.zip', zip) });
    const done = await finished(r.body.id);
    expect(done.status, JSON.stringify(done)).toBe('done');
    expect(done.summary, JSON.stringify(done.results)).toMatchObject({ rows: 6, ok: 4, errors: 2, documents_created: 3, versions_created: 4, converted: 1, file_only: 3 });
    const sop = (await t.api.get('/api/policies?f.doc_number=SOP-IT-014')).body.rows[0];
    expect(sop).toMatchObject({ title: 'Invented network change procedure', document_type: 'sop', access: 'restricted', status: 'published', current_version: 2 });
    const pol = (await t.api.get('/api/policies?f.doc_number=POL-IT-001')).body.rows[0];
    expect(sop.parent_id).toBe(pol.id);
    const versions = (await t.api.get(`/api/policies/${sop.id}/versions`)).body;
    const v1 = versions.find((v: any) => v.version === 1);
    const v2 = versions.find((v: any) => v.version === 2);
    expect(v1).toMatchObject({ status: 'superseded', version_label: 'Rev. A', content_kind: 'file', effective_on: '2021-03-01', superseded_on: '2023-06-01' });
    expect(v2).toMatchObject({ status: 'published', version_label: 'Rev. B', content_kind: 'markdown', effective_on: '2023-06-01' });
    expect(v2.body).toContain('Revision B text.');
    const polVersions = (await t.api.get(`/api/policies/${pol.id}/versions`)).body;
    expect(polVersions[0]).toMatchObject({ approval_body: 'Invented board of directors', approval_reference: 'Resolution 2020-07' });
    const travel = (await t.api.get('/api/policies?f.doc_number=POL-OLD-009')).body.rows[0];
    expect(travel.status).toBe('retired');
    // Nothing was sent: no acknowledgment requests for history.
    expect((await t.db.query('select 1 from policy_acknowledgements')).length).toBe(0);
    expect((await t.db.query(`select 1 from data_load_records where record_type = 'policy'`)).length).toBe(3);
    expect((await t.db.query(`select 1 from audit_events where action = 'policy.import_done'`)).length).toBe(1);
  });

  it('updates documents already there instead of creating them again', async () => {
    const before = (await t.db.one<{ n: number }>('select count(*)::int as n from policies where deleted_at is null'))!.n;
    const again = zipSync({ 'manifest.csv': strToU8('doc_number,title,version,version_label,status,effective_on,file\nPOL-IT-001,Invented information security policy (2024),2,2024-1,published,2024-02-01,p.pdf'), 'p.pdf': new Uint8Array(await makePdf(['2024 edition'])) });
    const r = await t.api.post('/api/documents/imports', { upload_id: await upload('again.zip', Buffer.from(again)) });
    const done = await finished(r.body.id);
    expect(done.summary, JSON.stringify(done.results)).toMatchObject({ documents_created: 0, documents_updated: 1, versions_created: 1 });
    expect((await t.db.one<{ n: number }>('select count(*)::int as n from policies where deleted_at is null'))!.n).toBe(before);
    const pol = (await t.api.get('/api/policies?f.doc_number=POL-IT-001')).body.rows[0];
    expect([pol.title, pol.current_version]).toEqual(['Invented information security policy (2024)', 2]);
  });
});
