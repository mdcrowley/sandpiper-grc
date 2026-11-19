import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { appVersion, copyFiles, describeFiles, eachLimited, listFiles, listFolders, makeFolders, serverPid, sha256File, timestamp } from './files.ts';
import type { FileEntry } from './files.ts';

// Backup and restore of the data folder (the embedded database in `pg/` and attached
// files in `files/`). A backup is a folder:
//
//   <backups>/<yyyyMMdd-HHmmss>/manifest.json   what is in it, with a SHA-256 per file
//   <backups>/<yyyyMMdd-HHmmss>/data/...        the copy
//
// The server must be stopped while either runs: the database files are only consistent
// on disk after a clean shutdown.

export const BACKUP_FORMAT = 'sandpiper-grc-backup';
export const MANIFEST = 'manifest.json';

/** Top-level names in the data folder that are never copied or replaced. */
const isRuntimeFile = (name: string) => name === 'grc.pid' || name === 'grc.stop' || name.startsWith('server.log');

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: 1;
  name: string;
  /** Why it was taken: `manual`, `scheduled`, `pre-upgrade` or `pre-restore` (the safety copy). */
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
  dir: string;
  manifest: BackupManifest;
}

/**
 * A refusal or failure to report to the operator as a plain message. `exitCode` 1 means
 * nothing was changed; 2 means the data folder was being replaced when it failed.
 */
export class OpsError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
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
  if (manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.files) || !Array.isArray(manifest.folders)) {
    throw new OpsError(`${file} is not a Sandpiper GRC backup manifest.`);
  }
  if (manifest.formatVersion !== 1) {
    throw new OpsError(`${file} is format version ${manifest.formatVersion}; this version of the application reads version 1.`);
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
}

export async function createBackup(opts: CreateBackupOptions): Promise<BackupInfo> {
  const pid = serverPid(opts.dataDir);
  if (pid) throw new OpsError(`The server is running (process ${pid}). Stop it first so the database files are consistent.`);
  const paths = listFiles(opts.dataDir, isRuntimeFile);
  if (paths.length === 0) throw new OpsError(`Nothing to back up: ${opts.dataDir} holds no data.`);

  const now = opts.now ?? new Date();
  const label = opts.label ?? 'manual';
  let name = label === 'pre-restore' ? `${timestamp(now)}-pre-restore` : timestamp(now);
  for (let n = 2; existsSync(join(opts.backupsDir, name)); n += 1) name = `${name.replace(/_\d+$/, '')}_${n}`;

  // Written under a temporary name and renamed at the end, so a folder with the final
  // name is always a complete backup.
  const partial = join(opts.backupsDir, `${name}.partial`);
  await rm(partial, { recursive: true, force: true });
  await mkdir(join(partial, 'data'), { recursive: true });

  const files = await describeFiles(opts.dataDir, paths);
  const folders = listFolders(opts.dataDir, isRuntimeFile);
  await makeFolders(join(partial, 'data'), folders);
  await copyFiles(opts.dataDir, join(partial, 'data'), paths);
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

/** Checks every file of a backup against its manifest. Throws if there is no usable manifest. */
export async function verifyBackup(backupDir: string): Promise<{ manifest: BackupManifest; problems: string[] }> {
  const manifest = readManifest(backupDir);
  if (manifest.files.length === 0) return { manifest, problems: ['the manifest lists no files'] };
  return { manifest, problems: await checkFiles(join(backupDir, 'data'), manifest.files, manifest.folders) };
}

/** Complete backups in a folder, newest first. Folders without a manifest are ignored. */
export function listBackups(backupsDir: string): BackupInfo[] {
  if (!existsSync(backupsDir)) return [];
  const found: BackupInfo[] = [];
  for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.endsWith('.partial')) continue;
    const dir = join(backupsDir, entry.name);
    try {
      found.push({ name: entry.name, dir, manifest: readManifest(dir) });
    } catch {
      // not one of ours (for example a copy made by an older version): leave it alone
    }
  }
  return found.sort((a, b) => b.manifest.createdAt.localeCompare(a.manifest.createdAt) || b.name.localeCompare(a.name));
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

/** Turns what the operator typed (`latest`, a backup name, or a path) into a folder. */
export function resolveBackup(backupsDir: string, ref: string): string {
  if (ref === 'latest') {
    const newest = listBackups(backupsDir)[0];
    if (!newest) throw new OpsError(`There are no backups in ${backupsDir}.`);
    return newest.dir;
  }
  const named = join(backupsDir, ref);
  if (!isAbsolute(ref) && existsSync(named)) return named;
  if (existsSync(ref)) return resolve(ref);
  throw new OpsError(`Backup not found: ${ref} (looked in ${backupsDir}).`);
}

export interface RestoreOptions {
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
}

export interface RestoreResult {
  manifest: BackupManifest;
  /** The safety copy of the data that was replaced; null when there was none to keep. */
  safetyCopy: BackupInfo | null;
  /** Migrations in the code that the restored database has not had; they run at the next start. */
  pendingMigrations: string[];
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const pid = serverPid(opts.dataDir);
  if (pid) throw new OpsError(`The server is running (process ${pid}). Stop it before restoring.`);

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
  let safetyCopy: BackupInfo | null = null;
  if (listFiles(opts.dataDir, isRuntimeFile).length > 0) {
    safetyCopy = await createBackup({
      dataDir: opts.dataDir,
      backupsDir: opts.backupsDir,
      migrations: opts.currentMigrations,
      label: 'pre-restore',
      now: opts.now,
    });
  }
  const undo = safetyCopy ? ` The data as it was is in ${safetyCopy.dir}; restore that to go back.` : '';

  // 4. Replace, then check what landed.
  try {
    await mkdir(opts.dataDir, { recursive: true });
    for (const entry of readdirSync(opts.dataDir)) {
      if (!isRuntimeFile(entry)) await rm(join(opts.dataDir, entry), { recursive: true, force: true });
    }
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
