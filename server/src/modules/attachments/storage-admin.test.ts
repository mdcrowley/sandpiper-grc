import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSession, SESSION_COOKIE } from '../../core/auth.ts';
import type { ModuleDef } from '../../core/module.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { FAKE_MALWARE_MARKER, startFakeClamd, startFakeS3, type FakeClamd, type FakeS3 } from './fakes.ts';
import { checkIntegrity, markOrphans, moveFiles, purgeRemoved } from './housekeeping.ts';
import { newStorageKey } from './storage.ts';

// An invented record type to attach files to; rows can be flagged restricted.
const fixtures: ModuleDef = {
  key: 'testfiles2',
  async seedDefaults(ctx) {
    await ctx.db.exec(`create table if not exists test_depots (
      id uuid primary key default gen_random_uuid(), name text not null, restricted boolean not null default false,
      created_at timestamptz not null default now(), created_by uuid,
      updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz)`);
  },
  async register(ctx) {
    ctx.defineResource({
      type: 'depot', table: 'test_depots', module: 'tickets', label: 'Depot', plural: 'Depots',
      path: '/api/depots', route: '/depots', titleField: 'name', restricted: 'flag',
      fields: { name: { label: 'Name', type: 'text', required: true }, restricted: { label: 'Restricted', type: 'boolean', default: false } },
    });
    if (!ctx.app.hasDecorator('notify')) {
      (ctx.app as any).decorate('notify', async () => ({ sent: 1, skipped: 0 }));
    }
  },
};
const notified: any[] = [];

const CRED = { accessKeyId: 'AKIDTESTONLY', secretAccessKey: 'invented-secret-for-tests-only', region: 'test-region-1', bucket: 'grc-files' };
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

let t: Awaited<ReturnType<typeof testApp>>;
let token: string;
let depot: string;
let clamd: FakeClamd;
let s3: FakeS3;

async function upload(name: string, data: Buffer, record = depot) {
  const res = await t.app.inject({
    method: 'PUT', url: `/api/attachments/upload?${new URLSearchParams({ record_type: 'depot', record_id: record, name })}`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, 'x-grc-csrf': '1', 'content-type': 'application/octet-stream' },
    payload: data,
  });
  return { status: res.statusCode, body: res.json() };
}
async function download(id: string) {
  const res = await t.app.inject({ method: 'GET', url: `/api/attachments/${id}/download`, headers: { cookie: `${SESSION_COOKIE}=${token}` } });
  return { status: res.statusCode, data: res.rawPayload };
}
const audits = (action: string) => t.db.query<{ summary: string }>('select summary from audit_events where action = $1 order by id', [action]);
const row = (id: string) => t.db.one<any>('select * from attachments where id = $1', [id]);

beforeAll(async () => {
  t = await testApp({ extraModules: [fixtures] });
  // Record notifications whether the real notifications module or the stand-in provides them.
  const realNotify = t.app.notify.bind(t.app);
  (t.app as any).notify = async (input: any) => { notified.push(input); return realNotify(input); };
  const admin = await t.db.one<{ id: string }>(`select id from users where username = 'admin'`);
  token = await createSession(t.db, admin!.id);
  expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
  depot = (await t.api.post('/api/depots', { name: 'North depot' })).body.id;
  clamd = await startFakeClamd();
  s3 = await startFakeS3(CRED);
});
afterAll(async () => {
  await clamd.close();
  await s3.close();
  await t.close();
});

describe('malware scanning with ClamAV', () => {
  it('is off by default, and needs a recent password to switch on', async () => {
    const overview = (await t.api.get('/api/attachments/admin/overview')).body;
    expect(overview.scanner).toMatchObject({ enabled: false, host: '127.0.0.1', port: 3310, whenUnavailable: 'accept' });
    expect(overview.storage.driver).toBe('disk');
    expect((await upload('plain.txt', Buffer.from('no scanner yet'))).body.scan_status).toBe('not_scanned');
    const other = await t.as('administrator');
    await t.db.query(`update sessions set confirmed_at = now() - interval '1 day' where user_id = $1`, [other.userId]);
    expect((await other.patch('/api/attachments/admin/scanner', { enabled: true })).body.error.code).toBe('reauth_required');
    const readOnly = await t.as('requester');
    expect((await readOnly.get('/api/attachments/admin/overview')).status).toBe(403);
  });

  it('checks every upload, refuses an infected file and audits it', async () => {
    const on = await t.api.patch('/api/attachments/admin/scanner', { enabled: true, port: clamd.port, timeoutSeconds: 5 });
    expect(on.status).toBe(200);
    expect((await t.api.get('/api/attachments/config')).body.scanner).toBe('clamav');
    const test = (await t.api.post('/api/attachments/admin/scanner/test', {})).body;
    expect(test).toMatchObject({ ok: true, engine: 'ClamAV 1.4.1', signatures: '27470' });

    const clean = await upload('timetable.txt', Buffer.from('Route 4 runs every ten minutes'));
    expect(clean.body).toMatchObject({ scan_status: 'clean', scan_engine: 'clamav' });
    expect(clamd.scanned.at(-1)!.toString()).toBe('Route 4 runs every ten minutes');

    const infected = await upload('bad.txt', Buffer.from(`hidden ${FAKE_MALWARE_MARKER} inside`));
    expect(infected.status).toBe(422);
    expect(infected.body.error.code).toBe('malware');
    expect((await t.db.query(`select 1 from attachments where file_name = 'bad.txt'`)).length).toBe(0);
    expect((await audits('attachment.refused')).map((a) => a.summary)).toContain('File refused: bad.txt (malware scanner clamav: Sandpiper.Test.Marker)');
  });

  it('accepts files as "Not scanned" with a warning when the scanner is down, or refuses them if told to', async () => {
    const down = await startFakeClamd();
    await down.close();
    await t.api.patch('/api/attachments/admin/scanner', { port: down.port });
    const accepted = await upload('while-down.txt', Buffer.from('accepted anyway'));
    expect(accepted.status).toBe(201);
    expect(accepted.body.scan_status).toBe('not_scanned');
    expect(accepted.body.scan_warning).toMatch(/could not check this file/);
    expect((await audits('attachment.scan_unavailable')).at(-1)!.summary).toMatch(/^File accepted without a malware scan: while-down.txt \(malware scanner clamav failed: unavailable/);

    await t.api.patch('/api/attachments/admin/scanner', { whenUnavailable: 'refuse' });
    const refused = await upload('refused.txt', Buffer.from('not accepted'));
    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe('scan_failed');
    expect((await t.api.post('/api/attachments/admin/scanner/test', {})).body).toMatchObject({ ok: false });
    await t.api.patch('/api/attachments/admin/scanner', { port: clamd.port, whenUnavailable: 'accept' });
  });

  it('scans files attached earlier and removes an infected one, telling administrators', async () => {
    await t.api.patch('/api/attachments/admin/scanner', { enabled: false });
    expect((await t.api.get('/api/attachments/config')).body.scanner).toBe('none');
    const earlierBad = (await upload('earlier-bad.txt', Buffer.from(`old ${FAKE_MALWARE_MARKER}`))).body;
    const earlierGood = (await upload('earlier-good.txt', Buffer.from('old but fine'))).body;
    expect(earlierBad.scan_status).toBe('not_scanned');
    expect((await t.api.post('/api/attachments/admin/rescan', {})).body.error.code).toBe('no_scanner');

    await t.api.patch('/api/attachments/admin/scanner', { enabled: true });
    const result = (await t.api.post('/api/attachments/admin/rescan', {})).body;
    expect(result).toMatchObject({ infected: 1, errors: 0, remaining: 0, engine: 'clamav' });
    expect(result.clean).toBeGreaterThanOrEqual(2);
    expect(await row(earlierGood.id)).toMatchObject({ scan_status: 'clean', scan_engine: 'clamav', deleted_at: null });
    const bad = await row(earlierBad.id);
    expect(bad).toMatchObject({ scan_status: 'infected', removed_reason: 'infected' });
    expect(bad.purged_at).not.toBeNull();
    expect((await download(earlierBad.id)).status).toBe(404);
    expect(await t.app.attachmentStores.local.stat(bad.storage_key)).toBeNull();
    expect((await audits('attachment.quarantine')).at(-1)!.summary).toContain('earlier-bad.txt');
    expect(notified.at(-1)).toMatchObject({ permission: 'admin.administer', title: expect.stringContaining('Malware found in 1 attached file') });
    await t.api.patch('/api/attachments/admin/scanner', { enabled: false });
  });
});

describe('object storage', () => {
  const s3Settings = () => ({
    driver: 's3', s3: { endpoint: s3.endpoint, region: CRED.region, bucket: CRED.bucket, pathStyle: true, prefix: 'files', accessKeyId: CRED.accessKeyId, secretAccessKey: CRED.secretAccessKey },
  });

  it('refuses settings that do not work and keeps the local disk', async () => {
    const bad = await t.api.patch('/api/attachments/admin/storage', { ...s3Settings(), s3: { ...s3Settings().s3, secretAccessKey: 'wrong' } });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('store_unreachable');
    expect((await t.api.get('/api/attachments/admin/overview')).body.storage.driver).toBe('disk');
    const missing = await t.api.patch('/api/attachments/admin/storage', { driver: 's3', s3: { endpoint: 'ftp://x' } });
    expect(Object.keys(missing.body.error.fields)).toEqual(expect.arrayContaining(['endpoint', 'bucket']));
    const tried = await t.api.post('/api/attachments/admin/storage/test', { s3: s3Settings().s3 });
    expect(tried.body).toMatchObject({ ok: true });
  });

  it('stores new files in the object store, keeps older ones readable, and never shows the secret', async () => {
    const before = (await upload('on-disk.txt', Buffer.from('kept on disk'))).body;
    const saved = await t.api.patch('/api/attachments/admin/storage', s3Settings());
    expect(saved.status).toBe(200);
    expect(saved.body.s3).toMatchObject({ prefix: 'files/', secretSet: true });
    expect(JSON.stringify(saved.body)).not.toContain(CRED.secretAccessKey);
    const stored = await t.db.one<{ value: any }>(`select value from settings where key = 'attachments.storage'`);
    expect(JSON.stringify(stored!.value)).not.toContain(CRED.secretAccessKey);
    expect(stored!.value.s3.secret).toMatch(/^enc:v1:/);

    const after = (await upload('in-store.txt', Buffer.from('kept in the store'))).body;
    expect((await row(after.id)).storage_driver).toBe('s3');
    expect(s3.objects.get(`files/${(await row(after.id)).storage_key}`)?.toString()).toBe('kept in the store');
    expect((await download(after.id)).data.toString()).toBe('kept in the store');
    expect((await download(before.id)).data.toString()).toBe('kept on disk');
    const usage = (await t.api.get('/api/attachments/admin/overview')).body.usage;
    expect(usage.byDriver.map((d: any) => d.driver)).toEqual(['memory', 's3']);
  });

  it('moves every file to the other store, checking each one', async () => {
    const lines: string[] = [];
    const ctx = { app: t.app, db: t.db, audit: t.ctx.audit, settings: t.ctx.settings, resources: t.ctx.resources, fail: t.ctx.fail } as any;
    const toS3 = await moveFiles(ctx, 's3', (l) => lines.push(l));
    expect(toS3.failed).toBe(0);
    expect(toS3.moved).toBeGreaterThan(3);
    expect((await t.db.query(`select 1 from attachments where purged_at is null and storage_driver <> 's3'`)).length).toBe(0);
    const any = await t.db.one<any>(`select * from attachments where file_name = 'on-disk.txt'`);
    expect((await download(any.id)).data.toString()).toBe('kept on disk');
    expect(await t.app.attachmentStores.local.stat(any.storage_key)).toBeNull();

    // And back again (the object store's copy is removed once the disk copy is checked).
    await t.api.patch('/api/attachments/admin/storage', { driver: 'disk' });
    const toDisk = await moveFiles(ctx, 'disk');
    expect(toDisk).toMatchObject({ failed: 0, moved: toS3.moved + toS3.skipped });
    expect([...s3.objects.keys()].filter((k) => /^files\/[0-9a-f]{2}\//.test(k))).toEqual([]);
    expect((await download(any.id)).data.toString()).toBe('kept on disk');
    expect((await audits('attachment.move')).length).toBe(2);
  });
});

describe('removed files: restore, purge, deleted records, integrity', () => {
  it('lists removed files, puts one back, and purges the rest after the period', async () => {
    const keep = (await upload('put-back.txt', Buffer.from('restore me'))).body;
    const lose = (await upload('let-go.txt', Buffer.from('purge me'))).body;
    await t.api.del(`/api/attachments/${keep.id}`);
    await t.api.del(`/api/attachments/${lose.id}`);
    const removed = (await t.api.get('/api/attachments/admin/removed')).body;
    expect(removed.purgeDays).toBe(30);
    const names = removed.rows.map((r: any) => r.file_name);
    expect(names).toEqual(expect.arrayContaining(['put-back.txt', 'let-go.txt']));
    expect(removed.rows.find((r: any) => r.file_name === 'let-go.txt')).toMatchObject({ removed_reason: 'removed', record_label: 'North depot', can_restore: true });

    expect((await t.api.post(`/api/attachments/admin/removed/${keep.id}/restore`, {})).status).toBe(200);
    expect((await download(keep.id)).data.toString()).toBe('restore me');
    expect((await audits('attachment.restore')).at(-1)!.summary).toMatch(/^Removed file put back: put-back.txt/);

    expect((await t.api.patch('/api/attachments/admin/purge', { purgeDays: -1 })).status).toBe(400);
    expect((await t.api.patch('/api/attachments/admin/purge', { purgeDays: 7 })).body).toEqual({ purgeDays: 7 });
    const ctx = { app: t.app, db: t.db, audit: t.ctx.audit, settings: t.ctx.settings, resources: t.ctx.resources } as any;
    expect((await purgeRemoved(ctx, new Date(Date.now() + 6 * 86_400_000))).purged).toBe(0);
    const lostKey = (await row(lose.id)).storage_key;
    const result = await purgeRemoved(ctx, new Date(Date.now() + 8 * 86_400_000));
    expect(result.purged).toBeGreaterThanOrEqual(1);
    expect((await row(lose.id)).purged_at).not.toBeNull();
    expect(await t.app.attachmentStores.local.stat(lostKey)).toBeNull();
    expect((await audits('attachment.purge')).some((a) => a.summary === 'Removed file purged from storage after 7 days: let-go.txt (8 bytes)')).toBe(true);
    expect((await t.api.post(`/api/attachments/admin/removed/${lose.id}/restore`, {})).status).toBe(404);

    await t.api.patch('/api/attachments/admin/purge', { purgeDays: 0 });
    const never = (await upload('kept-forever.txt', Buffer.from('x'))).body;
    await t.api.del(`/api/attachments/${never.id}`);
    expect((await purgeRemoved(ctx, new Date(Date.now() + 9999 * 86_400_000))).purged).toBe(0);
    await t.api.patch('/api/attachments/admin/purge', { purgeDays: 30 });
  });

  it('marks the files of a record deleted for good as removed, and never deletes a record', async () => {
    const doomed = (await t.api.post('/api/depots', { name: 'Closed depot' })).body.id;
    const soft = (await t.api.post('/api/depots', { name: 'Archived depot' })).body.id;
    const f1 = (await upload('closed.txt', Buffer.from('a'), doomed)).body;
    const f2 = (await upload('archived.txt', Buffer.from('b'), soft)).body;
    await t.api.del(`/api/depots/${soft}`); // soft delete: its files stay for the retention review
    await t.db.query('delete from test_depots where id = $1', [doomed]); // as a retention review's final removal would
    const ctx = { app: t.app, db: t.db, audit: t.ctx.audit, resources: t.ctx.resources } as any;
    expect(await markOrphans(ctx)).toBe(1);
    expect(await row(f1.id)).toMatchObject({ removed_reason: 'record_gone' });
    expect((await row(f2.id)).deleted_at).toBeNull();
    expect(await t.db.one('select 1 from test_depots where id = $1', [soft])).toBeTruthy();
    expect((await t.api.post(`/api/attachments/admin/removed/${f1.id}/restore`, {})).status).toBe(409);
  });

  it('hides removed files of restricted records from administrators without security.view', async () => {
    const hidden = (await t.api.post('/api/depots', { name: 'Zebra control room', restricted: true })).body.id;
    const f = (await upload('zebra-plan.txt', Buffer.from('z'), hidden)).body;
    await t.api.del(`/api/attachments/${f.id}`);
    expect((await t.api.get('/api/attachments/admin/removed')).body.rows.some((r: any) => r.file_name === 'zebra-plan.txt')).toBe(true);
    const role = await t.db.one<{ id: string }>(`insert into roles (key, name) values ('files_admin_test', 'Files admin (test)') returning id`);
    await t.db.query(`insert into role_permissions (role_id, permission) values ($1, 'admin.administer'), ($1, 'tickets.view')`, [role!.id]);
    const limited = await t.as('files_admin_test');
    const rows = (await limited.get('/api/attachments/admin/removed')).body.rows;
    expect(rows.some((r: any) => r.file_name === 'zebra-plan.txt')).toBe(false);
    expect(rows.some((r: any) => r.file_name === 'kept-forever.txt')).toBe(true);
    expect((await limited.post(`/api/attachments/admin/removed/${f.id}/restore`, {})).status).toBe(404);
  });

  it('reports stored files with no record and records with no stored file', async () => {
    const local = t.app.attachmentStores.local;
    const stray = newStorageKey();
    await local.put(stray, Readable.from([Buffer.from('stray bytes')]));
    const victim = (await upload('will-vanish.txt', Buffer.from('gone'))).body;
    await local.delete((await row(victim.id)).storage_key);
    const report = (await t.api.post('/api/attachments/admin/check', {})).body;
    expect(report.missing.map((m: any) => m.file_name)).toContain('will-vanish.txt');
    expect(report.unreferenced.map((u: any) => u.key)).toContain(stray);
    expect((await audits('attachment.check')).length).toBe(1);
    const direct = await checkIntegrity({ app: t.app, db: t.db } as any);
    expect(direct.missingCount).toBe(report.missingCount);
    expect(sha(Buffer.from('x'))).toHaveLength(64);
  });
});
