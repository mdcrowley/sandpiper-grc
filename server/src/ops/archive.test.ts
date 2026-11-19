import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../core/db.ts';
import { migrate } from '../core/migrate.ts';
import {
  type ArchiveKey, decryptToTar, extractEntries, hashArchive, loadArchiveKey, openArchiveFile, readArchiveInfo, readTar, writeArchive,
} from './archive.ts';
import { createBackup, listBackups, listBackupsAsync, resolveBackup, restoreBackup, verifyBackup } from './backup.ts';
import { exportToArchive, unpackExport, verifyExport } from './export.ts';
import { repoRoot, sha256File } from './files.ts';
import { writeBackupStatus } from './online-backup.ts';
import { secretKeyNote } from './secret-key.ts';
import { formatStatus, getStatus } from './status.ts';
import { createReadStream } from 'node:fs';

const scratch = mkdtempSync(join(tmpdir(), 'grc-ops-archive-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const keyA: ArchiveKey = { kind: 'key', key: randomBytes(32) };
const keyB: ArchiveKey = { kind: 'key', key: randomBytes(32) };
const pass: ArchiveKey = { kind: 'passphrase', passphrase: 'correct horse battery staple' };
const info = { kind: 'backup' as const, name: 'test', createdAt: '2030-01-01T00:00:00.000Z', appVersion: '0.0.0' };

async function contents(file: string, key: ArchiveKey | null) {
  const out: Record<string, string> = {};
  for await (const e of openArchiveFile(file, key)) {
    const parts: Buffer[] = [];
    for await (const c of e.body) parts.push(Buffer.from(c));
    out[e.type === 'dir' ? `${e.path}/` : e.path] = Buffer.concat(parts).toString('latin1');
  }
  return out;
}

describe('archives', () => {
  const big = randomBytes(200_000); // several encryption chunks, not a multiple of the block size
  const longName = `deep/${'a'.repeat(60)}/${'b'.repeat(60)}/${'c'.repeat(90)}.txt`;
  const src = join(scratch, 'src.bin');
  writeFileSync(src, big);
  const entries = [
    { path: 'folder', type: 'dir' as const },
    { path: 'folder/empty.txt', type: 'file' as const, data: Buffer.alloc(0) },
    { path: 'folder/big.bin', type: 'file' as const, file: src },
    { path: longName, type: 'file' as const, data: Buffer.from('long name') },
  ];

  it('writes a standard tar file and reads it back', async () => {
    const file = join(scratch, 'plain.tar');
    await writeArchive(file, entries, null, info);
    expect(statSync(file).size % 512).toBe(0);
    const raw = readFileSync(file);
    expect(raw.subarray(257, 262).toString('latin1')).toBe('ustar'); // the ustar magic of the first header
    const got = await contents(file, null);
    expect(Object.keys(got)).toEqual(['folder/', 'folder/empty.txt', 'folder/big.bin', longName]);
    expect(Buffer.from(got['folder/big.bin'], 'latin1').equals(big)).toBe(true);
    expect(got[longName]).toBe('long name');
    expect((await readArchiveInfo(file)).encrypted).toBe(false);
  });

  it('encrypts with a key file or a passphrase, and only the right one opens it', async () => {
    for (const key of [keyA, pass]) {
      const file = join(scratch, `enc-${key.kind}.tar.sgrc`);
      await writeArchive(file, entries, key, { ...info, note: 'readable' });
      const raw = readFileSync(file);
      expect(raw.subarray(0, 8).toString('latin1')).toBe('SGRCENC1');
      expect(raw.includes(Buffer.from('long name'))).toBe(false);
      expect((await readArchiveInfo(file)).info).toMatchObject({ name: 'test', note: 'readable' });
      const got = await contents(file, key);
      expect(Buffer.from(got['folder/big.bin'], 'latin1').equals(big)).toBe(true);
      // The plain tar inside is what `decrypt` writes.
      const tar = join(scratch, `dec-${key.kind}.tar`);
      await decryptToTar(file, tar, key);
      const plain: string[] = [];
      for await (const e of readTar(createReadStream(tar))) plain.push(e.path);
      expect(plain).toContain(longName);
    }
    const withKey = join(scratch, 'enc-key.tar.sgrc');
    await expect(contents(withKey, keyB)).rejects.toThrow(/passphrase or key is wrong/);
    await expect(contents(withKey, pass)).rejects.toThrow(/key file, not a passphrase/);
    await expect(contents(withKey, null)).rejects.toThrow(/encrypted/);
  });

  it('refuses an altered, cut-off or re-labelled encrypted archive', async () => {
    const file = join(scratch, 'enc-key.tar.sgrc');
    const raw = readFileSync(file);
    const altered = Buffer.from(raw);
    altered[raw.length - 40] ^= 1;
    writeFileSync(join(scratch, 'altered.sgrc'), altered);
    await expect(contents(join(scratch, 'altered.sgrc'), keyA)).rejects.toThrow(/altered|damaged/);

    // Cut at a chunk boundary: every remaining chunk is genuine, but the last one is missing.
    const firstLen = raw.readUInt32BE(12 + raw.readUInt32BE(8));
    const cut = 12 + raw.readUInt32BE(8) + 4 + firstLen + 16;
    writeFileSync(join(scratch, 'cut.sgrc'), raw.subarray(0, cut));
    await expect(contents(join(scratch, 'cut.sgrc'), keyA)).rejects.toThrow(/altered|incomplete/);

    const relabelled = Buffer.from(raw.toString('latin1').replace('"name":"test"', '"name":"tost"'), 'latin1');
    writeFileSync(join(scratch, 'relabel.sgrc'), relabelled);
    await expect(contents(join(scratch, 'relabel.sgrc'), keyA)).rejects.toThrow(/wrong, or the file has been altered/);
  });

  it('refuses entries that would leave the destination folder', async () => {
    const file = join(scratch, 'evil.tar');
    await writeArchive(file, [{ path: '../escape.txt', type: 'file', data: Buffer.from('x') }], null, info);
    await expect(extractEntries(openArchiveFile(file, null), join(scratch, 'evil-out'))).rejects.toThrow(/unsafe path/);
    expect(existsSync(join(scratch, 'escape.txt'))).toBe(false);
  });

  it('takes the key from outside the data folder only', () => {
    const dataDir = join(scratch, 'keys', 'data');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'inside.key'), randomBytes(32).toString('hex'));
    writeFileSync(join(scratch, 'keys', 'outside.key'), randomBytes(32).toString('hex'));
    writeFileSync(join(scratch, 'keys', 'short.txt'), 'too short');
    expect(() => loadArchiveKey({ keyFile: join(dataDir, 'inside.key'), dataDir, env: {} })).toThrow(/outside the data folder/);
    expect(loadArchiveKey({ keyFile: join(scratch, 'keys', 'outside.key'), dataDir, env: {} })?.kind).toBe('key');
    expect(() => loadArchiveKey({ passphraseFile: join(scratch, 'keys', 'short.txt'), dataDir, env: {} })).toThrow(/at least 12/);
    expect(loadArchiveKey({ dataDir, env: { GRC_BACKUP_PASSPHRASE: 'a long enough passphrase' } })?.kind).toBe('passphrase');
    expect(loadArchiveKey({ dataDir, env: {} })).toBeNull();
  });
});

describe('encrypted backups', () => {
  function fakeData(name: string) {
    const dataDir = join(scratch, name, 'data');
    const backupsDir = join(scratch, name, 'backups');
    mkdirSync(join(dataDir, 'pg', 'base', 'empty'), { recursive: true });
    mkdirSync(join(dataDir, 'files', 'ab'), { recursive: true });
    writeFileSync(join(dataDir, 'pg', 'PG_VERSION'), '17\n');
    writeFileSync(join(dataDir, 'files', 'ab', 'evidence.txt'), 'original attachment');
    writeFileSync(join(dataDir, 'server.log'), 'log line');
    return { dataDir, backupsDir };
  }

  it('backs up to one encrypted file, lists, verifies and restores it', async () => {
    const { dataDir, backupsDir } = fakeData('enc');
    const backup = await createBackup({ dataDir, backupsDir, migrations: ['core/001_core.sql'], key: keyA, now: new Date(2030, 0, 1, 9, 0, 0) });
    expect(backup.dir.endsWith('20300101-090000.tar.sgrc')).toBe(true);
    expect(existsSync(join(backupsDir, '20300101-090000'))).toBe(false); // no plain copy left behind
    expect(readFileSync(backup.dir).includes(Buffer.from('original attachment'))).toBe(false);

    const listed = listBackups(backupsDir);
    expect(listed[0]).toMatchObject({ name: '20300101-090000', encrypted: true });
    expect(listed[0].manifest.migrations).toEqual(['core/001_core.sql']);
    expect((await listBackupsAsync(backupsDir))[0].name).toBe('20300101-090000');
    expect(resolveBackup(backupsDir, '20300101-090000')).toBe(backup.dir);

    expect((await verifyBackup(backup.dir, keyA)).problems).toEqual([]);
    await expect(verifyBackup(backup.dir, keyB)).rejects.toThrow(/wrong/);

    writeFileSync(join(dataDir, 'files', 'ab', 'evidence.txt'), 'changed later');
    const result = await restoreBackup({
      backupDir: backup.dir, dataDir, backupsDir, codeMigrations: ['core/001_core.sql'], currentMigrations: null, key: keyA,
      now: new Date(2030, 0, 1, 9, 5, 0),
    });
    expect(readFileSync(join(dataDir, 'files', 'ab', 'evidence.txt'), 'utf8')).toBe('original attachment');
    expect(existsSync(join(dataDir, 'pg', 'base', 'empty'))).toBe(true);
    expect(result.safetyCopy?.encrypted).toBe(true); // the safety copy is protected the same way
    expect(listBackups(backupsDir).map((b) => b.name)).toEqual(['20300101-090500-pre-restore', '20300101-090000']);
    expect(existsSync(join(dataDir, 'server.log'))).toBe(true);
  });
});

describe('the secret key and backups', () => {
  it('leaves the key out unless asked, carries it only encrypted, and puts it back on restore', async () => {
    const root = join(scratch, 'withkey');
    const dataDir = join(root, 'data');
    const backupsDir = join(root, 'backups');
    mkdirSync(join(dataDir, 'pg'), { recursive: true });
    writeFileSync(join(dataDir, 'pg', 'PG_VERSION'), '17\n');
    const keyText = randomBytes(32).toString('hex');
    const keyFile = join(root, 'grc.secret.key');
    writeFileSync(keyFile, keyText);
    const saved = process.env.GRC_SECRET_KEY_FILE;
    process.env.GRC_SECRET_KEY_FILE = keyFile;
    try {
      expect(secretKeyNote(dataDir)).toMatch(/is not in backups/);
      await expect(createBackup({ dataDir, backupsDir, migrations: null, includeSecretKey: true })).rejects.toThrow(/only be put in an encrypted backup/);
      const b = await createBackup({ dataDir, backupsDir, migrations: null, key: keyA, includeSecretKey: true, now: new Date(2030, 1, 1) });
      expect((await hashArchive(openArchiveFile(b.dir, keyA))).files.has('extra/secret.key')).toBe(true);
      expect((await verifyBackup(b.dir, keyA)).problems).toEqual([]);

      // Restored where a different key is in use: the backup's key becomes a retired key.
      writeFileSync(keyFile, randomBytes(32).toString('hex'));
      const r = await restoreBackup({ backupDir: b.dir, dataDir, backupsDir, codeMigrations: [], currentMigrations: null, key: keyA });
      expect(r.keyNote).toMatch(/added to .*\.previous/);
      expect(readFileSync(`${keyFile}.previous`, 'utf8').trim()).toBe(keyText);
      // Restored where there is no key yet: it is put in place.
      rmSync(keyFile);
      rmSync(`${keyFile}.previous`);
      const again = await restoreBackup({ backupDir: b.dir, dataDir, backupsDir, codeMigrations: [], currentMigrations: null, key: keyA });
      expect(again.keyNote).toMatch(/was put in/);
      expect(readFileSync(keyFile, 'utf8').trim()).toBe(keyText);
    } finally {
      if (saved === undefined) delete process.env.GRC_SECRET_KEY_FILE; else process.env.GRC_SECRET_KEY_FILE = saved;
    }
  });

  it('refuses to copy a database that lives on a PostgreSQL server', async () => {
    const saved = process.env.GRC_DATABASE_URL;
    process.env.GRC_DATABASE_URL = 'postgres://grc:secret@db.example.invalid/grc';
    try {
      await expect(createBackup({ dataDir: join(scratch, 'enc', 'data'), backupsDir: join(scratch, 'x'), migrations: null })).rejects.toThrow(/pg_dump/);
      await expect(restoreBackup({ backupDir: join(scratch, 'x'), dataDir: join(scratch, 'enc', 'data'), backupsDir: join(scratch, 'x'), codeMigrations: [], currentMigrations: null })).rejects.toThrow(/PostgreSQL server/);
    } finally {
      if (saved === undefined) delete process.env.GRC_DATABASE_URL; else process.env.GRC_DATABASE_URL = saved;
    }
  });
});

describe('status of the server\'s own backups', () => {
  it('shows the schedule, the last good backup, and a failure plainly', async () => {
    const dataDir = join(scratch, 'status', 'data');
    mkdirSync(dataDir, { recursive: true });
    const now = new Date('2030-01-03T12:00:00Z');
    await writeBackupStatus(dataDir, {
      updatedAt: now.toISOString(), enabled: true, schedule: 'daily at 02:00 (UTC), keeping 14', destination: '\\\\fileserver\\grc', encrypted: true,
      lastRun: { at: '2030-01-03T02:00:00.000Z', ok: false, name: null, message: 'The backup could not be written to \\\\fileserver\\grc: EACCES' },
      lastSuccess: { at: '2030-01-01T02:00:00.000Z', name: 'sandpiper-backup-20300101-020000.tar.sgrc', bytes: 1234 },
    });
    const status = await getStatus({ dataDir, backupsDir: join(scratch, 'status', 'backups'), port: 1, now });
    expect(status.serverBackups?.lastSuccess?.name).toBe('sandpiper-backup-20300101-020000.tar.sgrc');
    const text = formatStatus({ ...status, running: true }, now);
    expect(text).toMatch(/Server backups: daily at 02:00 \(UTC\), keeping 14 to \\\\fileserver\\grc, encrypted; last good sandpiper-backup-20300101-020000\.tar\.sgrc, 2 days ago - OVERDUE; LAST RUN FAILED/);
    expect(formatStatus({ ...status, serverBackups: null })).toMatch(/Server backups: not set up/);
  });
});

describe('encrypted exports', () => {
  it('exports to one encrypted file that unpacks to a verified export', async () => {
    const db = await openDb('memory');
    await migrate(db, [{ scope: 'core', dir: join(repoRoot, 'server/src/core/migrations') }]);
    await db.query(`insert into departments (name) values ('Fleet engineering')`);
    const filesDir = join(scratch, 'exp-files');
    mkdirSync(join(filesDir, 'aa'), { recursive: true });
    writeFileSync(join(filesDir, 'aa', 'f.txt'), 'attached');
    const outFile = join(scratch, 'out', 'export.tar.sgrc');
    const { manifest, info: written } = await exportToArchive(db, { outFile, key: pass, filesDir });
    await db.close();
    expect(manifest.files).toHaveLength(1);
    expect(written.kind).toBe('export');
    expect(existsSync(`${outFile}.work`)).toBe(false);
    expect(readFileSync(outFile).includes(Buffer.from('Fleet engineering'))).toBe(false);

    const dir = await unpackExport(outFile, pass);
    try {
      expect((await verifyExport(dir)).problems).toEqual([]);
      expect(readFileSync(join(dir, 'tables', 'departments.jsonl'), 'utf8')).toContain('Fleet engineering');
      expect(await sha256File(join(dir, 'files', 'aa', 'f.txt'))).toBe(manifest.files[0].sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const hashed = await hashArchive(openArchiveFile(outFile, pass));
    expect(hashed.files.has('archive.json')).toBe(true);
  });
});
