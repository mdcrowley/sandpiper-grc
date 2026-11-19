import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { openArchiveFile, openArchiveStream, readArchiveInfo } from '../../ops/archive.ts';
import { describeArchive } from '../../ops/backup.ts';
import { ADMIN, testApp } from '../../test/helpers.ts';
import { startFakeS3, type FakeS3 } from './fakes.ts';
import { Readable } from 'node:stream';

const notified: any[] = [];
const notifier: ModuleDef = {
  key: 'testnotify',
  async register(ctx) {
    if (!ctx.app.hasDecorator('notify')) {
      (ctx.app as any).decorate('notify', async () => ({ sent: 1, skipped: 0 }));
    }
  },
};

const scratch = mkdtempSync(join(tmpdir(), 'grc-online-backup-'));
const CRED = { accessKeyId: 'AKIDTESTONLY', secretAccessKey: 'invented-secret-for-tests-only', region: 'test-region-1', bucket: 'grc-files' };
let t: Awaited<ReturnType<typeof testApp>>;
let s3: FakeS3;

async function entries(file: string, key: any = null) {
  const names: string[] = [];
  for await (const e of openArchiveFile(file, key)) {
    names.push(e.path);
    for await (const _ of e.body) { /* read */ }
  }
  return names;
}

beforeAll(async () => {
  process.env.GRC_BACKUP_DIR = join(scratch, 'work');
  t = await testApp({ extraModules: [notifier] });
  // Record notifications whether the real notifications module or the stand-in provides them.
  const realNotify = t.app.notify.bind(t.app);
  (t.app as any).notify = async (input: any) => { notified.push(input); return realNotify(input); };
  expect((await t.api.post('/api/auth/confirm', { password: ADMIN.password })).status).toBe(200);
  s3 = await startFakeS3(CRED);
});
afterAll(async () => {
  delete process.env.GRC_BACKUP_DIR;
  delete process.env.GRC_BACKUP_PASSPHRASE;
  await s3.close();
  await t.close();
  rmSync(scratch, { recursive: true, force: true });
});

describe('backups taken by the running server', () => {
  it('starts switched off, and checks the settings', async () => {
    const o = (await t.api.get('/api/backups')).body;
    expect(o.settings).toMatchObject({ enabled: false, time: '02:00', keep: 14, destination: 'folder', encrypt: false });
    expect(o.keySource).toBeNull();
    expect(o.runs).toEqual([]);
    const bad = await t.api.patch('/api/backups/settings', { enabled: true, folder: 'relative/path', time: '25:00', keep: 0, encrypt: true });
    expect(Object.keys(bad.body.error.fields).sort()).toEqual(['encrypt', 'folder', 'keep', 'time']);
    expect((await t.api.post('/api/backups/run', {})).body.error.code).toBe('not_configured');
    const requester = await t.as('requester');
    expect((await requester.get('/api/backups')).status).toBe(403);
  });

  it('writes a checked archive to a folder, keeps the newest ones, and records each run', async () => {
    const folder = join(scratch, 'second-location');
    const saved = await t.api.patch('/api/backups/settings', { folder, keep: 2 });
    expect(saved.status).toBe(200);
    expect(saved.body.destination).toBe(folder);
    const first = (await t.api.post('/api/backups/run', {})).body.run;
    expect(first).toMatchObject({ status: 'ok', verified: true, encrypted: false, trigger: 'manual' });
    expect(first.archive_name).toMatch(/^sandpiper-backup-\d{8}-\d{6}\.tar$/);
    const file = join(folder, first.archive_name);
    const names = await entries(file);
    expect(names[0]).toBe('archive.json');
    expect(names).toEqual(expect.arrayContaining(['manifest.json', 'tables/users.jsonl', 'tables/audit_events.jsonl', 'checksums.sha256']));
    expect((await describeArchive(file))).toMatchObject({ kind: 'online-backup', encrypted: false });

    await t.api.post('/api/backups/run', {});
    await t.api.post('/api/backups/run', {});
    expect(readdirSync(folder).filter((n) => n.endsWith('.tar'))).toHaveLength(2);
    const runs = (await t.api.get('/api/backups')).body.runs;
    expect(runs).toHaveLength(3);
    expect(runs[0].pruned.length + runs[1].pruned.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(scratch, 'work'))).toBe(true);
    expect(readdirSync(join(scratch, 'work')).flatMap((d) => readdirSync(join(scratch, 'work', d)))).toEqual([]); // nothing left behind
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'backup.run' order by id`);
    expect(audit[0].summary).toMatch(/^Backup sandpiper-backup-.* written to .* and checked there/);
  });

  it('encrypts when a key is set, and refuses encryption without one', async () => {
    process.env.GRC_BACKUP_PASSPHRASE = 'an invented passphrase for tests';
    const o = await t.api.patch('/api/backups/settings', { encrypt: true });
    expect(o.body.keySource).toMatch(/GRC_BACKUP_PASSPHRASE/);
    const run = (await t.api.post('/api/backups/run', {})).body.run;
    expect(run).toMatchObject({ status: 'ok', encrypted: true });
    expect(run.archive_name).toMatch(/\.tar\.sgrc$/);
    const file = join(scratch, 'second-location', run.archive_name);
    expect((await readArchiveInfo(file)).info).toMatchObject({ kind: 'online-backup' });
    await expect(entries(file)).rejects.toThrow(/encrypted/);
    expect(await entries(file, { kind: 'passphrase', passphrase: process.env.GRC_BACKUP_PASSPHRASE })).toContain('tables/users.jsonl');

    delete process.env.GRC_BACKUP_PASSPHRASE;
    const failed = (await t.api.post('/api/backups/run', {})).body.run;
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.message).toMatch(/no key is set/);
    expect(notified.at(-1)).toMatchObject({ permission: 'admin.administer', title: 'A backup failed', route: '/admin/backups' });
    await t.api.patch('/api/backups/settings', { encrypt: false });
  });

  it('reports a destination that cannot be written to', async () => {
    const blocker = join(scratch, 'not-a-folder');
    writeFileSync(blocker, 'a file where the folder should be');
    await t.api.patch('/api/backups/settings', { folder: blocker });
    const failed = (await t.api.post('/api/backups/run', {})).body;
    expect(failed.run).toMatchObject({ status: 'failed' });
    expect(failed.run.message).toMatch(/could not be written to/);
    expect(failed.overview.lastSuccess.status).toBe('ok');
    const audit = await t.db.query<{ summary: string }>(`select summary from audit_events where action = 'backup.failed' order by id desc limit 1`);
    expect(audit[0].summary).toMatch(/^Backup failed: /);
  });

  it('runs once a day at the chosen time, by itself', async () => {
    await t.api.patch('/api/backups/settings', { folder: join(scratch, 'daily'), enabled: false });
    expect(await t.app.backupScheduler.tick()).toBe('off');
    await t.api.patch('/api/backups/settings', { enabled: true, time: '00:00' });
    expect(await t.app.backupScheduler.tick()).toBe('ran');
    expect(await t.app.backupScheduler.tick()).toBe('not-due'); // already taken today
    const runs = (await t.api.get('/api/backups')).body.runs;
    expect(runs[0]).toMatchObject({ trigger: 'scheduled', status: 'ok' });
    // A long silence raises an alert, once a day.
    await t.db.query(`update backup_runs set started_at = now() - interval '3 days' where status = 'ok'`);
    notified.length = 0;
    await t.app.backupScheduler.tick();
    expect(notified[0]).toMatchObject({ title: 'Backups are overdue', oncePerDay: true });
    await t.api.patch('/api/backups/settings', { enabled: false });
  });

  it('writes to the object store under its own prefix', async () => {
    const storage = await t.api.patch('/api/attachments/admin/storage', {
      driver: 'disk', s3: { endpoint: s3.endpoint, region: CRED.region, bucket: CRED.bucket, prefix: 'grc', accessKeyId: CRED.accessKeyId, secretAccessKey: CRED.secretAccessKey },
    });
    expect(storage.status).toBe(200);
    const o = await t.api.patch('/api/backups/settings', { destination: 's3', s3Prefix: 'nightly' });
    expect(o.body.destination).toMatch(/^object store grc-files\/grc\/nightly\/ at http:\/\/127\.0\.0\.1:/);
    const run = (await t.api.post('/api/backups/run', {})).body.run;
    expect(run).toMatchObject({ status: 'ok', verified: true });
    const key = `grc/nightly/${run.archive_name}`;
    expect(s3.objects.has(key)).toBe(true);
    const names: string[] = [];
    for await (const e of openArchiveStream(Readable.from([s3.objects.get(key)!]), null)) { names.push(e.path); for await (const _ of e.body) { /* read */ } }
    expect(names).toContain('manifest.json');
  });
});
