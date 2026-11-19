import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../core/db.ts';
import { migrate } from '../core/migrate.ts';
import { createBackup, listBackups, pruneBackups, readManifest, resolveBackup, restoreBackup, verifyBackup } from './backup.ts';
import { repoRoot, serverPid } from './files.ts';
import { migrationsOnDisk, readAppliedMigrations } from './migrations.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-ops-backup-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const coreMigrations = [{ scope: 'core', dir: join(repoRoot, 'server/src/core/migrations') }];
const core = migrationsOnDisk().filter((m) => m.startsWith('core/'));

/** A data folder made of plain files: enough for everything that does not open the database. */
function fakeData(name: string) {
  const dataDir = join(scratch, name, 'data');
  const backupsDir = join(scratch, name, 'backups');
  mkdirSync(join(dataDir, 'pg', 'base'), { recursive: true });
  mkdirSync(join(dataDir, 'files', 'ab'), { recursive: true });
  writeFileSync(join(dataDir, 'pg', 'PG_VERSION'), '17\n');
  writeFileSync(join(dataDir, 'pg', 'base', '1'), 'original database page');
  writeFileSync(join(dataDir, 'files', 'ab', 'evidence.txt'), 'original attachment');
  writeFileSync(join(dataDir, 'server.log'), 'log line');
  return { dataDir, backupsDir };
}
const at = (minute: number) => new Date(2030, 0, 31, 9, minute, 0);

describe('backup and restore', () => {
  it('brings a real database and its files back to the moment of the backup', async () => {
    const dataDir = join(scratch, 'real', 'data');
    const backupsDir = join(scratch, 'real', 'backups');

    let db = await openDb(dataDir);
    await migrate(db, coreMigrations);
    await db.query(`insert into departments (name) values ('Before the backup')`);
    await db.close();
    mkdirSync(join(dataDir, 'files'), { recursive: true });
    writeFileSync(join(dataDir, 'files', 'note.txt'), 'first version');

    const migrations = await readAppliedMigrations(dataDir);
    expect(core).toContain('core/001_core.sql');
    expect(migrations).toEqual(core);
    const backup = await createBackup({ dataDir, backupsDir, migrations, now: at(0) });
    expect(backup.name).toBe('20300131-090000');
    expect(backup.manifest.migrations).toEqual(core);
    expect(backup.manifest.appVersion).toMatch(/^\d+\.\d+/);
    expect(backup.manifest.files.some((f) => f.path === 'files/note.txt')).toBe(true);
    expect(backup.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && !f.path.includes('\\'))).toBe(true);
    expect((await verifyBackup(backup.dir)).problems).toEqual([]);

    // Change the data after the backup.
    db = await openDb(dataDir);
    await db.query(`insert into departments (name) values ('After the backup')`);
    await db.query(`delete from departments where name = 'Before the backup'`);
    await db.close();
    writeFileSync(join(dataDir, 'files', 'note.txt'), 'second version');
    writeFileSync(join(dataDir, 'files', 'added-later.txt'), 'should disappear');

    const result = await restoreBackup({
      backupDir: backup.dir, dataDir, backupsDir,
      codeMigrations: [...core, 'core/900_later.sql'],
      currentMigrations: await readAppliedMigrations(dataDir),
      now: at(5),
    });
    expect(result.pendingMigrations).toEqual(['core/900_later.sql']);

    db = await openDb(dataDir);
    const names = (await db.query<{ name: string }>('select name from departments order by name')).map((r) => r.name);
    await db.close();
    expect(names).toEqual(['Before the backup']);
    expect(readFileSync(join(dataDir, 'files', 'note.txt'), 'utf8')).toBe('first version');
    expect(existsSync(join(dataDir, 'files', 'added-later.txt'))).toBe(false);

    // The replaced data was kept as a complete, restorable backup of its own.
    expect(result.safetyCopy?.name).toBe('20300131-090500-pre-restore');
    expect(result.safetyCopy?.manifest.label).toBe('pre-restore');
    expect((await verifyBackup(result.safetyCopy!.dir)).problems).toEqual([]);
    expect(readFileSync(join(result.safetyCopy!.dir, 'data', 'files', 'note.txt'), 'utf8')).toBe('second version');

    // ...and restoring the safety copy undoes the restore.
    await restoreBackup({ backupDir: result.safetyCopy!.dir, dataDir, backupsDir, codeMigrations: core, currentMigrations: null, now: at(10) });
    db = await openDb(dataDir);
    const again = (await db.query<{ name: string }>('select name from departments order by name')).map((r) => r.name);
    await db.close();
    expect(again).toEqual(['After the backup']);
  }, 240_000); // creates a database on disk and copies it three times: slow on a busy machine

  it('leaves logs and the process file out, and never calls a half-written folder a backup', async () => {
    const { dataDir, backupsDir } = fakeData('contents');
    writeFileSync(join(dataDir, 'grc.pid'), '999999999'); // stale: no such process
    expect(serverPid(dataDir)).toBeNull();
    const backup = await createBackup({ dataDir, backupsDir, migrations: null, now: at(0) });
    expect(backup.manifest.files.map((f) => f.path)).toEqual(['files/ab/evidence.txt', 'pg/PG_VERSION', 'pg/base/1']);
    expect(backup.manifest.migrations).toBeNull();

    mkdirSync(join(backupsDir, '20300131-091500.partial', 'data'), { recursive: true });
    mkdirSync(join(backupsDir, 'made-by-hand'), { recursive: true });
    expect(listBackups(backupsDir).map((b) => b.name)).toEqual(['20300131-090000']);
    expect(() => readManifest(join(backupsDir, 'made-by-hand'))).toThrow(/not a backup made by this command/);
  });

  it('refuses a tampered backup and leaves the current data alone', async () => {
    const { dataDir, backupsDir } = fakeData('tampered');
    const restore = (backupDir: string) =>
      restoreBackup({ backupDir, dataDir, backupsDir, codeMigrations: [], currentMigrations: null, now: at(30) });

    const changed = await createBackup({ dataDir, backupsDir, migrations: null, now: at(1) });
    appendFileSync(join(changed.dir, 'data', 'pg', 'base', '1'), '!');
    const missing = await createBackup({ dataDir, backupsDir, migrations: null, now: at(2) });
    rmSync(join(missing.dir, 'data', 'files', 'ab', 'evidence.txt'));
    const added = await createBackup({ dataDir, backupsDir, migrations: null, now: at(3) });
    writeFileSync(join(added.dir, 'data', 'pg', 'planted'), 'x');
    const sameSize = await createBackup({ dataDir, backupsDir, migrations: null, now: at(4) });
    writeFileSync(join(sameSize.dir, 'data', 'pg', 'base', '1'), 'ORIGINAL database page');

    writeFileSync(join(dataDir, 'pg', 'base', '1'), 'current database page');
    await expect(restore(changed.dir)).rejects.toThrow(/failed verification[\s\S]*size differs: pg\/base\/1/);
    await expect(restore(missing.dir)).rejects.toThrow(/missing: files\/ab\/evidence.txt/);
    await expect(restore(added.dir)).rejects.toThrow(/not in the manifest: pg\/planted/);
    await expect(restore(sameSize.dir)).rejects.toThrow(/checksum differs: pg\/base\/1/);
    await expect(restore(join(backupsDir, 'nowhere'))).rejects.toThrow(/no manifest.json/);

    expect(readFileSync(join(dataDir, 'pg', 'base', '1'), 'utf8')).toBe('current database page');
    expect(listBackups(backupsDir).some((b) => b.manifest.label === 'pre-restore')).toBe(false); // nothing was started
  });

  it('refuses to run while the server is up', async () => {
    const { dataDir, backupsDir } = fakeData('running');
    const backup = await createBackup({ dataDir, backupsDir, migrations: null, now: at(0) });
    writeFileSync(join(dataDir, 'grc.pid'), String(process.pid)); // a process that exists
    await expect(createBackup({ dataDir, backupsDir, migrations: null, now: at(1) })).rejects.toThrow(/server is running/);
    await expect(
      restoreBackup({ backupDir: backup.dir, dataDir, backupsDir, codeMigrations: [], currentMigrations: null }),
    ).rejects.toThrow(/server is running/);
  });

  it('refuses a backup made by newer code unless forced', async () => {
    const { dataDir, backupsDir } = fakeData('newer');
    const backup = await createBackup({ dataDir, backupsDir, migrations: ['core/001_core.sql', 'core/009_future.sql'], now: at(0) });
    const opts = { backupDir: backup.dir, dataDir, backupsDir, codeMigrations: ['core/001_core.sql'], currentMigrations: null, now: at(1) };
    await expect(restoreBackup(opts)).rejects.toThrow(/newer version[\s\S]*core\/009_future.sql/);
    expect(listBackups(backupsDir)).toHaveLength(1);
    const forced = await restoreBackup({ ...opts, force: true });
    expect(forced.safetyCopy).not.toBeNull();
  });

  it('prunes to the newest n and finds a backup by name, path or "latest"', async () => {
    const { dataDir, backupsDir } = fakeData('prune');
    for (const minute of [1, 2, 3, 4]) await createBackup({ dataDir, backupsDir, migrations: null, now: at(minute) });
    const twin = await createBackup({ dataDir, backupsDir, migrations: null, now: at(4) }); // same second
    expect(twin.name).toBe('20300131-090400_2');
    mkdirSync(join(backupsDir, 'made-by-hand'));

    expect(resolveBackup(backupsDir, 'latest')).toBe(twin.dir);
    expect(resolveBackup(backupsDir, '20300131-090100')).toBe(join(backupsDir, '20300131-090100'));
    expect(resolveBackup(backupsDir, twin.dir)).toBe(twin.dir);
    expect(() => resolveBackup(backupsDir, 'no-such-backup')).toThrow(/not found/);

    await expect(pruneBackups(backupsDir, 0)).rejects.toThrow(/1 or more/);
    expect((await pruneBackups(backupsDir, 2)).sort()).toEqual(['20300131-090100', '20300131-090200', '20300131-090300']);
    expect(listBackups(backupsDir).map((b) => b.name)).toEqual(['20300131-090400_2', '20300131-090400']);
    expect(existsSync(join(backupsDir, 'made-by-hand'))).toBe(true); // not ours: never deleted
    expect(await pruneBackups(backupsDir, 2)).toEqual([]);
  });

  it('will not make an empty backup', async () => {
    const dataDir = join(scratch, 'empty', 'data');
    mkdirSync(dataDir, { recursive: true });
    await expect(createBackup({ dataDir, backupsDir: join(scratch, 'empty', 'backups'), migrations: null })).rejects.toThrow(/Nothing to back up/);
  });
});
