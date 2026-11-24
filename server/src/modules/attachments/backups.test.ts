import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModuleDef } from '../../core/module.ts';
import { openArchiveFile, openArchiveStream, readArchiveInfo } from '../../ops/archive.ts';
import { describeArchive } from '../../ops/backup.ts';
import { repoRoot } from '../../ops/files.ts';
import { DEFAULT_BACKUPS } from './backups.ts';
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

/**
 * "Back up now" (E40-11): queued as a background job, which the test runs at once (the poller does
 * not run under tests); answers the run it made and the page's overview afterwards.
 */
async function backupNow(): Promise<{ run: any; overview: any; jobId: string; job: any }> {
  const res = await t.api.post('/api/backups/run', {});
  expect(res.status).toBe(200);
  expect(res.body.overview.queued).toMatchObject({ status: 'queued' });
  const job = await t.app.jobs.runNow(res.body.jobId);
  const overview = (await t.api.get('/api/backups')).body;
  const run = overview.runs.find((r: any) => r.job_id === res.body.jobId);
  return { run, overview, jobId: res.body.jobId, job };
}

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

// The server's own backups copy the embedded database; with a PostgreSQL server they are refused
// and pg_dump is used instead, so these tests do not apply to a real server (GRC_TEST_DATABASE_URL).
describe.skipIf(Boolean(process.env.GRC_TEST_DATABASE_URL))('backups taken by the running server', () => {
  it('starts switched off, and checks the settings', async () => {
    const o = (await t.api.get('/api/backups')).body;
    expect(o.settings).toMatchObject({ enabled: false, time: '03:30', keep: 14, destination: 'folder', encrypt: false });
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
    const first = (await backupNow()).run;
    expect(first).toMatchObject({ status: 'ok', verified: true, encrypted: false, trigger: 'manual' });
    expect(first.archive_name).toMatch(/^sandpiper-backup-\d{8}-\d{6}\.tar$/);
    const file = join(folder, first.archive_name);
    expect(first.created_by).toBeTruthy(); // the person who asked, though a background job ran it
    expect(first.progress).toBeNull();
    const job = await t.db.one<any>(`select status, result from jobs where id = $1`, [first.job_id]);
    expect(job).toMatchObject({ status: 'done', result: { archive: first.archive_name } });
    expect((await t.db.query(`select 1 from audit_events where action = 'backup.requested'`)).length).toBe(1);
    const names = await entries(file);
    expect(names[0]).toBe('archive.json');
    expect(names).toEqual(expect.arrayContaining(['manifest.json', 'tables/users.jsonl', 'tables/audit_events.jsonl', 'checksums.sha256']));
    expect((await describeArchive(file))).toMatchObject({ kind: 'online-backup', encrypted: false });

    await backupNow();
    await backupNow();
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
    const run = (await backupNow()).run;
    expect(run).toMatchObject({ status: 'ok', encrypted: true });
    expect(run.archive_name).toMatch(/\.tar\.sgrc$/);
    const file = join(scratch, 'second-location', run.archive_name);
    expect((await readArchiveInfo(file)).info).toMatchObject({ kind: 'online-backup' });
    await expect(entries(file)).rejects.toThrow(/encrypted/);
    expect(await entries(file, { kind: 'passphrase', passphrase: process.env.GRC_BACKUP_PASSPHRASE })).toContain('tables/users.jsonl');

    delete process.env.GRC_BACKUP_PASSPHRASE;
    const failed = (await backupNow()).run;
    expect(failed).toMatchObject({ status: 'failed' });
    expect(failed.message).toMatch(/no key is set/);
    expect(notified.at(-1)).toMatchObject({ permission: 'admin.administer', title: 'A backup failed', route: '/admin/backups' });
    await t.api.patch('/api/backups/settings', { encrypt: false });
  });

  it('reports a destination that cannot be written to', async () => {
    const blocker = join(scratch, 'not-a-folder');
    writeFileSync(blocker, 'a file where the folder should be');
    await t.api.patch('/api/backups/settings', { folder: blocker });
    const failed = await backupNow();
    expect(failed.job).toMatchObject({ status: 'dead' });
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
    const run = (await backupNow()).run;
    expect(run).toMatchObject({ status: 'ok', verified: true });
    const key = `grc/nightly/${run.archive_name}`;
    expect(s3.objects.has(key)).toBe(true);
    const names: string[] = [];
    for await (const e of openArchiveStream(Readable.from([s3.objects.get(key)!]), null)) { names.push(e.path); for await (const _ of e.body) { /* read */ } }
    expect(names).toContain('manifest.json');
  });

  it('records progress while it runs, and refuses a second Back up now while one waits (E40-11)', async () => {
    const stages: string[] = [];
    const query = t.db.query.bind(t.db);
    (t.db as any).query = async (sql: string, params?: unknown[]) => {
      if (sql.includes('set progress') && Array.isArray(params)) stages.push(JSON.parse(String(params[1])).stage);
      return query(sql, params);
    };
    try {
      const first = await t.api.post('/api/backups/run', {});
      expect(first.status).toBe(200);
      const second = await t.api.post('/api/backups/run', {});
      expect(second.status).toBe(409);
      await t.app.jobs.runNow(first.body.jobId);
    } finally {
      (t.db as any).query = query;
    }
    expect(stages).toEqual(expect.arrayContaining(['export', 'archive', 'upload', 'check', 'prune']));
    const o = (await t.api.get('/api/backups')).body;
    expect(o.running).toBe(false);
    expect(o.queued).toBeNull();
    expect(o.runs[0]).toMatchObject({ status: 'ok', progress: null });
  });
});

// E40-11: dumps made by deploy/postgres/pg-backup.sh are checked and recorded, and an old or damaged
// newest dump is told to the administrators once.
describe('PostgreSQL dumps made by the documented script', () => {
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const dump = (folder: string, stamp: string, content: string, at: Date, extra: Record<string, unknown> = {}) => {
    const name = `grc-db-${stamp}.dump`;
    const data = Buffer.from(content);
    writeFileSync(join(folder, name), data);
    writeFileSync(join(folder, `${name}.json`), JSON.stringify({
      kind: 'sandpiper-pg-dump', file: name, startedAt: at.toISOString(), finishedAt: at.toISOString(),
      bytes: data.length, sha256: sha(data), entries: 42, pgDumpVersion: '17.2', ...extra,
    }));
    return name;
  };
  const open = async () => (await t.db.query<{ key: string; title: string }>(`select key, title from ops_alerts where cleared_at is null and starts_with(key, 'backup.pg_dump')`));

  it('checks each new dump once, warns when the newest is too old or damaged, and clears when fixed', async () => {
    const folder = join(scratch, 'pg-dumps');
    mkdirSync(folder, { recursive: true });
    expect((await t.api.patch('/api/backups/settings', { pgDumpFolder: 'relative' })).body.error.fields.pgDumpFolder).toMatch(/full path/);
    expect((await t.api.patch('/api/backups/settings', { pgDumpMaxAgeHours: 0 })).body.error.fields.pgDumpMaxAgeHours).toBeTruthy();
    expect((await t.api.patch('/api/backups/settings', { pgDumpFolder: folder, pgDumpMaxAgeHours: 26 })).status).toBe(200);

    // Nothing there yet: overdue.
    let r = await t.app.backupScheduler.checkPgDumps();
    expect(r.problem).toMatch(/No checked dump/);
    expect((await open()).map((a) => a.key)).toEqual(['backup.pg_dump_overdue']);

    const old = dump(folder, '20300101-021500', 'an old invented dump', new Date(Date.now() - 50 * 3600_000));
    const fresh = dump(folder, '20300103-021500', 'a recent invented dump', new Date(Date.now() - 2 * 3600_000));
    writeFileSync(join(folder, 'grc-db-20300104-021500.dump'), 'still being written: no record yet');
    r = await t.app.backupScheduler.checkPgDumps();
    expect(r).toMatchObject({ checked: 2, newest: fresh, problem: null });
    expect(await open()).toEqual([]);
    const o = (await t.api.get('/api/backups')).body;
    expect(o.pgDumps.map((d: any) => [d.archive_name, d.status])).toEqual([[fresh, 'ok'], [old, 'ok']]);
    expect(o.lastPgDump.archive_name).toBe(fresh);
    expect(o.pgDumpOverdue).toBe(false);
    expect(o.runs.every((x: any) => x.trigger !== 'pg_dump')).toBe(true); // the server's own runs stay apart
    expect((await t.app.backupScheduler.checkPgDumps()).checked).toBe(0); // each is checked once

    // A damaged newest dump: told once, by its own alert.
    const bad = dump(folder, '20300105-021500', 'the content the record describes', new Date());
    writeFileSync(join(folder, bad), 'the content the record describes, changed');
    r = await t.app.backupScheduler.checkPgDumps();
    expect(r.checked).toBe(1);
    expect((await open()).map((a) => a.key)).toEqual(['backup.pg_dump_bad']);
    const row = await t.db.one<any>(`select status, message from backup_runs where archive_name = $1`, [bad]);
    expect(row).toMatchObject({ status: 'failed' });
    expect(row.message).toMatch(/size|checksum/);
    expect((await t.db.query(`select 1 from audit_events where action = 'backup.pg_dump_failed'`)).length).toBe(1);

    // A good one after it clears that; time passing past the limit raises "overdue".
    dump(folder, '20300106-021500', 'the next invented dump', new Date());
    await t.app.backupScheduler.checkPgDumps();
    expect(await open()).toEqual([]);
    r = await t.app.backupScheduler.checkPgDumps(new Date(Date.now() + 30 * 3600_000));
    expect(r.problem).toMatch(/hours old/);
    expect((await open()).map((a) => a.key)).toEqual(['backup.pg_dump_overdue']);
    await t.api.patch('/api/backups/settings', { pgDumpFolder: '' });
    await t.app.backupScheduler.checkPgDumps();
    expect(await open()).toEqual([]);
  });
});

// OP-12: the stop-and-copy backup's scheduled task stops the server; the server's own backup
// must not be due at the same time by default.
describe('default backup times', () => {
  it('stagger the server\'s own backup from the scheduled stop-and-copy backup', () => {
    const ps = /\[string\]\$At = '(\d\d:\d\d)'/.exec(readFileSync(join(repoRoot, 'grc.ps1'), 'utf8'))?.[1];
    const sh = /\bat=(\d\d:\d\d)\b/.exec(readFileSync(join(repoRoot, 'grc.sh'), 'utf8'))?.[1];
    expect(ps).toMatch(/^\d\d:\d\d$/);
    expect(sh).toBe(ps);
    const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    expect(Math.abs(minutes(DEFAULT_BACKUPS.time) - minutes(ps!))).toBeGreaterThanOrEqual(60);
  });
});
