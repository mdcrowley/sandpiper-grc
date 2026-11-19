import { closeSync, createReadStream, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import {
  ARCHIVE_EXT, type ArchiveInfo, type ArchiveKey, ENCRYPTED_EXT, extractEntries, folderEntries, hashArchive, isArchivePath,
  openArchiveFile, readArchiveInfo, readTar, writeArchive,
} from './archive.ts';
import { OpsError } from './errors.ts';
import { EXPORT_FORMAT, verifyExport } from './export.ts';
import { appVersion, copyFiles, describeFiles, eachLimited, listFiles, listFolders, makeFolders, serverPid, sha256File, timestamp } from './files.ts';
import type { FileEntry } from './files.ts';
import { installRestoredKey, secretKeyFileToInclude } from './secret-key.ts';
import { databaseUrl } from '../core/db.ts';

export { OpsError };

// Backup and restore of the data folder (the embedded database in `pg/` and attached
// files in `files/`). A backup is a folder:
//
//   <backups>/<yyyyMMdd-HHmmss>/manifest.json   what is in it, with a SHA-256 per file
//   <backups>/<yyyyMMdd-HHmmss>/data/...        the copy
//
// or, when it is encrypted, one file `<backups>/<yyyyMMdd-HHmmss>.tar.sgrc` holding the same
// manifest.json and data/ (see archive.ts for the format). The server must be stopped while
// either runs: the database files are only consistent on disk after a clean shutdown.
//
// `restore` also takes the single-file archives the server's own scheduled backups write
// (ops/online-backup.ts): they hold an export, which is loaded into a fresh database.

export const BACKUP_FORMAT = 'sandpiper-grc-backup';
export const MANIFEST = 'manifest.json';
/** The first entry of every archive this application writes: what it is (see ArchiveInfo). */
export const ARCHIVE_INFO = 'archive.json';

/** Top-level names in the data folder that are never copied or replaced. */
export const isRuntimeFile = (name: string) =>
  name === 'grc.pid' || name === 'grc.stop' || name.startsWith('server.log') || name.startsWith('backup-status.json');

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  name: string;
  /** Why it was taken: `manual`, `scheduled`, `pre-upgrade`, `pre-restore` (the safety copy) or `online` (taken by the server). */
  label: string;
  appVersion: string;
  createdAt: string;
  /** Migrations applied to the database when it was copied; null when they could not be read. */
  migrations: string[] | null;
  totalBytes: number;
  /** Every folder, including empty ones: the database needs some folders to exist even when empty. */
  folders: string[];
  files: FileEntry[];
}

export interface BackupInfo {
  name: string;
  /** The backup folder, or the archive file. */
  dir: string;
  manifest: BackupManifest;
  /** A single-file archive rather than a folder; its manifest lists no files until it is opened. */
  archive?: boolean;
  encrypted?: boolean;
  /** What the archive holds: `backup` (a copy of the data folder) or `online-backup` (an export taken by the server). */
  kind?: string;
}

export function readManifest(backupDir: string): BackupManifest {
  const file = join(backupDir, MANIFEST);
  if (!existsSync(file)) {
    throw new OpsError(`${backupDir} has no ${MANIFEST}. It is not a backup made by this command (or it was interrupted).`);
  }
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new OpsError(`${file} cannot be read as JSON.`);
  }
  return checkManifest(manifest, file);
}

function checkManifest(manifest: BackupManifest, where: string): BackupManifest {
  if (manifest?.format !== BACKUP_FORMAT || !Array.isArray(manifest.files) || !Array.isArray(manifest.folders)) {
    throw new OpsError(`${where} is not a Sandpiper GRC backup manifest.`);
  }
  if (manifest.formatVersion !== 1) {
    throw new OpsError(`${where} is format version ${manifest.formatVersion}; this version of the application reads version 1.`);
  }
  return manifest;
}

export interface CreateBackupOptions {
  dataDir: string;
  backupsDir: string;
  /** Applied migrations, read by the caller (see ops/migrations.ts); null when unknown. */
  migrations: string[] | null;
  label?: string;
  now?: Date;
  /** Encrypt: write one `<name>.tar.sgrc` file instead of a folder. */
  key?: ArchiveKey | null;
  /** Encrypted backups only: also carry the secret key file (extra/secret.key), which is kept outside the data folder. */
  includeSecretKey?: boolean;
}

/** Backups and restores of the data folder cover the embedded database only. */
export function refuseServerDatabase(what: string): void {
  if (!databaseUrl()) return;
  throw new OpsError(`The database is on a PostgreSQL server (GRC_DATABASE_URL), so ${what} cannot copy it: this command covers the embedded database only. `
    + 'Back the server up with pg_dump and restore it with pg_restore (see docs/operations.md, "Backups with a PostgreSQL server"). '
    + 'The backups the application takes itself (Administration > Backups) and export-all do work in this mode.');
}

function uniqueName(backupsDir: string, base: string): string {
  let name = base;
  const taken = (n: string) => existsSync(join(backupsDir, n)) || existsSync(join(backupsDir, `${n}${ENCRYPTED_EXT}`)) || existsSync(join(backupsDir, `${n}${ARCHIVE_EXT}`));
  for (let n = 2; taken(name); n += 1) name = `${base}_${n}`;
  return name;
}

export async function createBackup(opts: CreateBackupOptions): Promise<BackupInfo> {
  refuseServerDatabase('backup');
  if (opts.includeSecretKey && !opts.key) throw new OpsError('The secret key can only be put in an encrypted backup.');
  const pid = serverPid(opts.dataDir);
  if (pid) throw new OpsError(`The server is running (process ${pid}). Stop it first so the database files are consistent.`);
  const paths = listFiles(opts.dataDir, isRuntimeFile);
  if (paths.length === 0) throw new OpsError(`Nothing to back up: ${opts.dataDir} holds no data.`);

  const now = opts.now ?? new Date();
  const label = opts.label ?? 'manual';
  const name = uniqueName(opts.backupsDir, label === 'pre-restore' ? `${timestamp(now)}-pre-restore` : timestamp(now));

  const files = await describeFiles(opts.dataDir, paths);
  const folders = listFolders(opts.dataDir, isRuntimeFile);
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    formatVersion: 1,
    name,
    label,
    appVersion: appVersion(),
    createdAt: now.toISOString(),
    migrations: opts.migrations,
    totalBytes: files.reduce((sum, f) => sum + f.size, 0),
    folders,
    files,
  };

  if (opts.key) {
    const info: ArchiveInfo = {
      kind: 'backup', name, label, createdAt: manifest.createdAt, appVersion: manifest.appVersion,
      totalBytes: manifest.totalBytes, fileCount: files.length, migrations: manifest.migrations,
    };
    const keyFile = opts.includeSecretKey ? secretKeyFileToInclude(opts.dataDir) : null;
    if (opts.includeSecretKey && !keyFile) throw new OpsError('There is no secret key file to include (the key comes from GRC_SECRET_KEY, or the file does not exist).');
    const dest = join(opts.backupsDir, `${name}${ENCRYPTED_EXT}`);
    await writeArchive(dest, [
      { path: ARCHIVE_INFO, type: 'file', data: Buffer.from(`${JSON.stringify(info, null, 2)}\n`) },
      { path: MANIFEST, type: 'file', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
      { path: 'data', type: 'dir' },
      ...folderEntries(opts.dataDir, folders, paths, 'data'),
      ...(keyFile ? [{ path: 'extra', type: 'dir' as const }, { path: 'extra/secret.key', type: 'file' as const, file: keyFile }] : []),
    ], opts.key, info);
    const problems = await checkArchive(dest, opts.key, manifest);
    if (problems.length) {
      await rm(dest, { force: true });
      throw new OpsError(`The encrypted copy does not match the data folder (${problems[0]}). Nothing was kept; run the backup again.`);
    }
    return { name, dir: dest, manifest, archive: true, encrypted: true, kind: 'backup' };
  }

  // Written under a temporary name and renamed at the end, so a folder with the final
  // name is always a complete backup.
  const partial = join(opts.backupsDir, `${name}.partial`);
  await rm(partial, { recursive: true, force: true });
  await mkdir(join(partial, 'data'), { recursive: true });
  await makeFolders(join(partial, 'data'), folders);
  await copyFiles(opts.dataDir, join(partial, 'data'), paths);
  await writeFile(join(partial, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);

  const problems = await checkFiles(join(partial, 'data'), files, folders);
  if (problems.length) {
    await rm(partial, { recursive: true, force: true });
    throw new OpsError(`The copy does not match the data folder (${problems[0]}). Nothing was kept; run the backup again.`);
  }
  const dir = join(opts.backupsDir, name);
  await rename(partial, dir);
  return { name, dir, manifest };
}

/** Compares a folder with a list of expected files. Returns one line per problem; empty means identical. */
async function checkFiles(dir: string, expected: FileEntry[], folders: string[]): Promise<string[]> {
  const problems: string[] = [];
  for (const folder of folders) {
    if (!existsSync(join(dir, folder))) problems.push(`missing folder: ${folder}`);
  }
  const present = new Set(listFiles(dir));
  await eachLimited(expected, async (file) => {
    if (!present.delete(file.path)) {
      problems.push(`missing: ${file.path}`);
      return;
    }
    const abs = join(dir, file.path);
    if (statSync(abs).size !== file.size) problems.push(`size differs: ${file.path}`);
    else if ((await sha256File(abs)) !== file.sha256) problems.push(`checksum differs: ${file.path}`);
  });
  for (const extra of present) problems.push(`not in the manifest: ${extra}`);
  return problems.sort();
}

/** Checks an archived backup against a manifest by reading it once, writing nothing. */
async function checkArchive(file: string, key: ArchiveKey | null, expected?: BackupManifest): Promise<string[]> {
  const { files, folders } = await hashArchive(openArchiveFile(file, key));
  const inner = files.get(MANIFEST)?.data;
  if (!inner) return ['the archive holds no manifest.json'];
  let manifest: BackupManifest;
  try {
    manifest = checkManifest(JSON.parse(inner.toString('utf8')), `${file} (manifest.json)`);
  } catch (err) {
    return [(err as Error).message];
  }
  const want = expected ?? manifest;
  const problems: string[] = [];
  if (expected && JSON.stringify(manifest.files) !== JSON.stringify(expected.files)) problems.push('the manifest inside the archive differs');
  for (const folder of want.folders) if (!folders.has(`data/${folder}`)) problems.push(`missing folder: ${folder}`);
  const seen = new Set<string>();
  for (const f of want.files) {
    const got = files.get(`data/${f.path}`);
    seen.add(`data/${f.path}`);
    if (!got) problems.push(`missing: ${f.path}`);
    else if (got.size !== f.size) problems.push(`size differs: ${f.path}`);
    else if (got.sha256 !== f.sha256) problems.push(`checksum differs: ${f.path}`);
  }
  for (const path of files.keys()) {
    if (path.startsWith('data/') && !seen.has(path)) problems.push(`not in the manifest: ${path.slice(5)}`);
  }
  return problems.sort();
}

/**
 * Checks every file of a backup against its manifest. Throws if there is no usable manifest.
 * An encrypted archive needs its key; an archived online backup is checked against its export manifest.
 */
export async function verifyBackup(backupDir: string, key: ArchiveKey | null = null): Promise<{ manifest: BackupManifest; problems: string[] }> {
  if (isArchivePath(backupDir) && statSync(backupDir).isFile()) {
    const listed = await describeArchive(backupDir);
    if (listed?.kind === 'online-backup') {
      const work = await extractToWork(backupDir, key, resolve(backupDir, '..'));
      try {
        const { problems } = await verifyExport(work);
        return { manifest: listed.manifest, problems };
      } finally {
        await rm(work, { recursive: true, force: true });
      }
    }
    const { files } = await hashArchive(openArchiveFile(backupDir, key));
    const inner = files.get(MANIFEST)?.data;
    if (!inner) throw new OpsError(`${backupDir} holds no ${MANIFEST}: it is not a backup made by this application.`);
    const manifest = checkManifest(JSON.parse(inner.toString('utf8')), `${backupDir} (manifest.json)`);
    if (manifest.files.length === 0) return { manifest, problems: ['the manifest lists no files'] };
    return { manifest, problems: await checkArchive(backupDir, key) };
  }
  const manifest = readManifest(backupDir);
  if (manifest.files.length === 0) return { manifest, problems: ['the manifest lists no files'] };
  return { manifest, problems: await checkFiles(join(backupDir, 'data'), manifest.files, manifest.folders) };
}

/** What an archive file says about itself (without its key), as a BackupInfo; null when it is not one of ours. */
export async function describeArchive(file: string): Promise<BackupInfo | null> {
  let info: ArchiveInfo | null = null;
  let encrypted = false;
  try {
    const head = await readArchiveInfo(file);
    encrypted = head.encrypted;
    if (head.encrypted) info = head.info;
    else {
      for await (const entry of readTar(createReadStream(file))) {
        if (entry.path === ARCHIVE_INFO && entry.size < 1024 * 1024) {
          const parts: Buffer[] = [];
          for await (const c of entry.body) parts.push(Buffer.from(c));
          info = JSON.parse(Buffer.concat(parts).toString('utf8'));
        }
        break; // the information is always the first entry
      }
    }
  } catch {
    return null;
  }
  if (!info || (info.kind !== 'backup' && info.kind !== 'online-backup') || typeof info.createdAt !== 'string') return null;
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, formatVersion: 1,
    name: String(info.name), label: String(info.label ?? (info.kind === 'online-backup' ? 'online' : 'manual')),
    appVersion: String(info.appVersion), createdAt: info.createdAt,
    migrations: Array.isArray(info.migrations) ? info.migrations as string[] : null,
    totalBytes: Number(info.totalBytes ?? statSync(file).size), folders: [], files: [],
  };
  return { name: manifest.name, dir: file, manifest, archive: true, encrypted, kind: info.kind };
}

/** Complete backups in a folder (folders and archive files), newest first. Anything else is ignored. */
export async function listBackupsAsync(backupsDir: string): Promise<BackupInfo[]> {
  const found = listBackups(backupsDir);
  if (!existsSync(backupsDir)) return found;
  for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
    // Encrypted archives are already listed (their header is read synchronously); add plain ones.
    if (!entry.isFile() || !entry.name.endsWith(ARCHIVE_EXT)) continue;
    const info = await describeArchive(join(backupsDir, entry.name));
    if (info) found.push(info);
  }
  return sortBackups(found);
}

const sortBackups = (list: BackupInfo[]) =>
  list.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || b.name.localeCompare(a.name));

/**
 * Complete backup folders in a folder, newest first, plus encrypted backups (whose header is
 * read synchronously). Folders without a manifest are ignored.
 */
export function listBackups(backupsDir: string): BackupInfo[] {
  if (!existsSync(backupsDir)) return [];
  const found: BackupInfo[] = [];
  for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.endsWith('.partial') || entry.name.startsWith('.')) continue;
    const dir = join(backupsDir, entry.name);
    try {
      found.push({ name: entry.name, dir, manifest: readManifest(dir) });
    } catch {
      // not one of ours (for example a copy made by an older version): leave it alone
    }
  }
  for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(ENCRYPTED_EXT)) continue;
    const info = readEncryptedInfoSync(join(backupsDir, entry.name));
    if (info) found.push(info);
  }
  return sortBackups(found);
}

function readEncryptedInfoSync(file: string): BackupInfo | null {
  let fd: number | null = null;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(12);
    readSync(fd, head, 0, 12, 0);
    if (head.subarray(0, 8).toString('latin1') !== 'SGRCENC1') return null;
    const n = head.readUInt32BE(8);
    if (n > 1024 * 1024) return null;
    const raw = Buffer.alloc(n);
    readSync(fd, raw, 0, n, 12);
    const info = JSON.parse(raw.toString('utf8')).info as ArchiveInfo;
    if (!info || (info.kind !== 'backup' && info.kind !== 'online-backup')) return null;
    return {
      name: String(info.name), dir: file, archive: true, encrypted: true, kind: info.kind,
      manifest: {
        format: BACKUP_FORMAT, formatVersion: 1, name: String(info.name), label: String(info.label ?? 'manual'),
        appVersion: String(info.appVersion), createdAt: String(info.createdAt),
        migrations: Array.isArray(info.migrations) ? info.migrations as string[] : null,
        totalBytes: Number(info.totalBytes ?? 0), folders: [], files: [],
      },
    };
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Deletes all but the newest `keep` backups. Returns the names removed. */
export async function pruneBackups(backupsDir: string, keep: number): Promise<string[]> {
  if (!Number.isInteger(keep) || keep < 1) throw new OpsError('The number of backups to keep must be a whole number, 1 or more.');
  const removed: string[] = [];
  for (const old of listBackups(backupsDir).slice(keep)) {
    await rm(old.dir, { recursive: true, force: true });
    removed.push(old.name);
  }
  return removed;
}

/** Turns what the operator typed (`latest`, a backup name, or a path) into a folder or archive file. */
export function resolveBackup(backupsDir: string, ref: string): string {
  if (ref === 'latest') {
    const newest = listBackups(backupsDir)[0];
    if (!newest) throw new OpsError(`There are no backups in ${backupsDir}.`);
    return newest.dir;
  }
  if (!isAbsolute(ref)) {
    for (const candidate of [ref, `${ref}${ENCRYPTED_EXT}`, `${ref}${ARCHIVE_EXT}`]) {
      if (existsSync(join(backupsDir, candidate))) return join(backupsDir, candidate);
    }
  }
  if (existsSync(ref)) return resolve(ref);
  throw new OpsError(`Backup not found: ${ref} (looked in ${backupsDir}).`);
}

/** Unpacks an archive into a new hidden working folder beside it. The caller removes it. */
async function extractToWork(file: string, key: ArchiveKey | null, workRoot: string): Promise<string> {
  const work = join(workRoot, `.restore-${timestamp()}-${process.pid}`);
  await rm(work, { recursive: true, force: true });
  try {
    await extractEntries(openArchiveFile(file, key), work);
  } catch (err) {
    await rm(work, { recursive: true, force: true });
    throw err;
  }
  return work;
}

export interface RestoreOptions {
  /** A backup folder or an archive file. */
  backupDir: string;
  dataDir: string;
  /** Where the safety copy of the current data goes. */
  backupsDir: string;
  /** Migrations shipped with the code that will run on the restored data. */
  codeMigrations: string[];
  /** Applied migrations of the data about to be replaced (recorded in the safety copy); null when unknown. */
  currentMigrations: string[] | null;
  /** Restore even if the backup was made by newer code than this. */
  force?: boolean;
  now?: Date;
  /** Opens an encrypted archive; also encrypts the safety copy. */
  key?: ArchiveKey | null;
  /**
   * Loads an export (an archived online backup) into the emptied data folder: creates the
   * database and imports the export folder it is given. Supplied by the command line, which
   * can build the application; without it, archived online backups cannot be restored.
   */
  loadExport?: (exportDir: string) => Promise<void>;
}

export interface RestoreResult {
  manifest: BackupManifest;
  /** The safety copy of the data that was replaced; null when there was none to keep. */
  safetyCopy: BackupInfo | null;
  /** Migrations in the code that the restored database has not had; they run at the next start. */
  pendingMigrations: string[];
  /** The backup was an export taken by the running server, loaded into a new database. */
  fromExport?: boolean;
  /** What was done with a secret key carried in the backup; undefined when it held none. */
  keyNote?: string;
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  refuseServerDatabase('restore');
  const pid = serverPid(opts.dataDir);
  if (pid) throw new OpsError(`The server is running (process ${pid}). Stop it before restoring.`);

  if (isArchivePath(opts.backupDir) && existsSync(opts.backupDir) && statSync(opts.backupDir).isFile()) {
    await mkdir(opts.backupsDir, { recursive: true });
    const work = await extractToWork(opts.backupDir, opts.key ?? null, opts.backupsDir);
    try {
      const inner = JSON.parse(readFileSync(join(work, MANIFEST), 'utf8'));
      if (inner?.format === EXPORT_FORMAT) return await restoreExport(work, opts);
      const result = await restoreFolder({ ...opts, backupDir: work });
      if (existsSync(join(work, 'extra', 'secret.key'))) result.keyNote = installRestoredKey(opts.dataDir, join(work, 'extra', 'secret.key'));
      return result;
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  return restoreFolder(opts);
}

async function keepSafetyCopy(opts: RestoreOptions): Promise<BackupInfo | null> {
  if (listFiles(opts.dataDir, isRuntimeFile).length === 0) return null;
  return createBackup({
    dataDir: opts.dataDir, backupsDir: opts.backupsDir, migrations: opts.currentMigrations,
    label: 'pre-restore', now: opts.now, key: opts.key ?? null,
  });
}

async function emptyDataFolder(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  for (const entry of readdirSync(dataDir)) {
    if (!isRuntimeFile(entry)) await rm(join(dataDir, entry), { recursive: true, force: true });
  }
}

async function restoreFolder(opts: RestoreOptions): Promise<RestoreResult> {
  // 1. Prove the backup is whole before touching anything.
  const { manifest, problems } = await verifyBackup(opts.backupDir);
  if (problems.length) {
    const shown = problems.slice(0, 10).map((p) => `  - ${p}`).join('\n');
    const more = problems.length > 10 ? `\n  ... and ${problems.length - 10} more` : '';
    throw new OpsError(`The backup failed verification and was not restored. Current data is untouched.\n${shown}${more}`);
  }

  // 2. There are no downward migrations, so data from newer code cannot run on older code.
  const known = new Set(opts.codeMigrations);
  const unknown = (manifest.migrations ?? []).filter((m) => !known.has(m));
  if (unknown.length && !opts.force) {
    throw new OpsError(
      `The backup was made by a newer version of the application (${manifest.appVersion}): it has migrations this code does not know ` +
        `(${unknown.join(', ')}). Current data is untouched. Upgrade the code first, or repeat with --force.`,
    );
  }

  // 3. Keep what is there now.
  const safetyCopy = await keepSafetyCopy(opts);
  const undo = safetyCopy ? ` The data as it was is in ${safetyCopy.dir}; restore that to go back.` : '';

  // 4. Replace, then check what landed.
  try {
    await emptyDataFolder(opts.dataDir);
    await makeFolders(opts.dataDir, manifest.folders);
    await copyFiles(join(opts.backupDir, 'data'), opts.dataDir, manifest.files.map((f) => f.path));
  } catch (err) {
    throw new OpsError(`The restore failed part-way: ${(err as Error).message}. The data folder is incomplete.${undo}`, 2);
  }
  const after = await checkFiles(opts.dataDir, manifest.files, manifest.folders).then((list) =>
    list.filter((p) => !isRuntimeFile(p.replace(/^not in the manifest: /, ''))),
  );
  if (after.length) throw new OpsError(`The restored files do not match the backup (${after[0]}).${undo}`, 2);

  const applied = new Set(manifest.migrations ?? []);
  return { manifest, safetyCopy, pendingMigrations: manifest.migrations ? opts.codeMigrations.filter((m) => !applied.has(m)) : [] };
}

/** Restores an export taken by the running server: a fresh database, then the export loaded into it. */
async function restoreExport(work: string, opts: RestoreOptions): Promise<RestoreResult> {
  if (!opts.loadExport) throw new OpsError('This backup was taken by the running server and is loaded with the command line: grc.ps1 restore <file>.');
  const { manifest: exp, problems } = await verifyExport(work);
  if (problems.length) {
    throw new OpsError(`The backup failed verification and was not restored. Current data is untouched.\n${problems.slice(0, 10).map((p) => `  - ${p}`).join('\n')}`);
  }
  const known = new Set(opts.codeMigrations);
  const unknown = exp.migrations.filter((m) => !known.has(m));
  if (unknown.length) {
    throw new OpsError(`The backup was made by a newer version of the application (${exp.appVersion}): it has migrations this code does not know (${unknown.join(', ')}). Current data is untouched. Upgrade the code first.`);
  }
  const safetyCopy = await keepSafetyCopy(opts);
  const undo = safetyCopy ? ` The data as it was is in ${safetyCopy.dir}; restore that to go back.` : '';
  let keyNote: string | undefined;
  try {
    await emptyDataFolder(opts.dataDir);
    // The key that protects authenticator keys travels with the backup when it was kept in the data folder.
    // A key carried in the backup goes in place before the new database is opened.
    if (existsSync(join(work, 'extra', 'secret.key'))) keyNote = installRestoredKey(opts.dataDir, join(work, 'extra', 'secret.key'));
    await opts.loadExport(work);
  } catch (err) {
    throw new OpsError(`The restore failed part-way: ${(err as Error).message}. The data folder is incomplete.${undo}`, 2);
  }
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT, formatVersion: 1, name: 'online', label: 'online', appVersion: exp.appVersion,
    createdAt: exp.createdAt, migrations: exp.migrations, totalBytes: 0, folders: [], files: [],
  };
  return { manifest, safetyCopy, pendingMigrations: [], fromExport: true, keyNote };
}
