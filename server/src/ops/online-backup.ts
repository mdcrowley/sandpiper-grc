import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import type { Db } from '../core/db.ts';
import { ARCHIVE_EXT, type ArchiveInfo, type ArchiveKey, ENCRYPTED_EXT, folderEntries, hashArchive, openArchiveStream, writeArchive } from './archive.ts';
import { OpsError } from './errors.ts';
import { exportAll, type ExportManifest } from './export.ts';
import { listFiles, PRIVATE_DIR, timestamp } from './files.ts';
import { currentKeyFingerprint } from './secret-key.ts';

// Backups taken by the running server (E16-08, E16-17). The embedded database cannot be
// copied file by file while it is open, so the server takes a logical backup instead: an
// export of every table (ops/export.ts) read from one snapshot of the database, so it is consistent,
// plus the attached files kept on the local disk, and the secret key file when an
// administrator asks for it (encrypted archives only). That is packed into one archive
// (encrypted when a key is configured), written to a second location, read back from there
// and checked, and old archives there are pruned. It works the same on a PostgreSQL server.
//
// Restore with `grc.ps1 restore <archive>` (or `cli.ts restore`), which loads it into a new
// embedded database (on a PostgreSQL server: `import-all <archive>` into an empty database).
// Files kept in an object store are not copied: protect them with the store's own versioning.

export const ONLINE_PREFIX = 'sandpiper-backup-';
const NAME_RE = /^sandpiper-backup-\d{8}-\d{6}(_\d+)?\.tar(\.sgrc)?$/;
export const STATUS_FILE = 'backup-status.json';

/** A place backups are written to: a folder (local, or a network share path) or an object store. */
export interface Destination {
  /** Shown to administrators and in `grc.ps1 status`. */
  describe(): string;
  put(name: string, file: string): Promise<void>;
  get(name: string): Promise<Readable>;
  list(): Promise<{ name: string; size: number }[]>;
  delete(name: string): Promise<void>;
}

/** A folder destination. A network share works when the server's account can write to it. */
export function folderDestination(path: string): Destination {
  const dir = resolve(path);
  return {
    describe: () => dir,
    async put(name, file) {
      await mkdir(dir, { recursive: true, mode: PRIVATE_DIR });
      const partial = join(dir, `${name}.partial`);
      await rm(partial, { force: true });
      try {
        await copyFile(file, partial);
        await rename(partial, join(dir, name));
      } catch (err) {
        await rm(partial, { force: true });
        throw err;
      }
    },
    async get(name) {
      return createReadStream(join(dir, name));
    },
    async list() {
      if (!existsSync(dir)) return [];
      return (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile())
        .map((e) => ({ name: e.name, size: statSync(join(dir, e.name)).size }));
    },
    async delete(name) {
      await rm(join(dir, name), { force: true });
    },
  };
}

export interface OnlineBackupOptions {
  db: Db;
  /** The data folder: attached files on disk are in <dataDir>/files; secret.key may be there. */
  dataDir: string;
  /** A local folder for the archive while it is made (removed afterwards). */
  workDir: string;
  destination: Destination;
  key: ArchiveKey | null;
  /** How many archives to keep at the destination (the newest). */
  keep: number;
  /** Also carry this secret key file (encrypted backups only), as extra/secret.key. */
  secretKeyFile?: string | null;
  now?: Date;
  /** How far it has got (E40-11), for the page that follows a "Back up now". Not awaited. */
  onProgress?: (p: { stage: 'export' | 'files' | 'archive' | 'upload' | 'check' | 'prune'; done?: number; total?: number; rows?: number }) => void;
}

export interface OnlineBackupResult {
  name: string;
  bytes: number;
  encrypted: boolean;
  verified: true;
  pruned: string[];
  manifest: ExportManifest;
}

/** Checks the hashed entries of an archived export against the manifest inside it. */
function checkExportEntries(hashed: Awaited<ReturnType<typeof hashArchive>>): { manifest: ExportManifest; problems: string[] } {
  const raw = hashed.files.get('manifest.json')?.data;
  if (!raw) throw new OpsError('The archive holds no manifest.json.');
  const manifest = JSON.parse(raw.toString('utf8')) as ExportManifest;
  const problems: string[] = [];
  const want = [
    ...manifest.tables.map((t) => ({ path: t.file, sha256: t.sha256 })),
    ...manifest.files.map((f) => ({ path: `files/${f.path}`, sha256: f.sha256 })),
  ];
  for (const item of want) {
    const got = hashed.files.get(item.path);
    if (!got) problems.push(`missing: ${item.path}`);
    else if (got.sha256 !== item.sha256) problems.push(`checksum differs: ${item.path}`);
  }
  return { manifest, problems };
}

/** Takes one backup while the server runs. Throws OpsError with a plain message on failure. */
/** An archive name without its extension: `sandpiper-backup-20261119-061701_2`. */
export const archiveStem = (name: string): string => name.replace(/\.tar(\.sgrc)?$/, '');

/** Orders archive names oldest first by time, then by same-second sequence (none = 1). */
export function byAge(a: string, b: string): number {
  const key = (n: string) => {
    const m = /^sandpiper-backup-(\d{8}-\d{6})(?:_(\d+))?/.exec(n);
    return m ? [m[1], Number(m[2] ?? 1)] as const : [n, 0] as const;
  };
  const [ta, sa] = key(a);
  const [tb, sb] = key(b);
  return ta < tb ? -1 : ta > tb ? 1 : sa - sb;
}

/**
 * The name for a new archive whose stem would be `base` (`sandpiper-backup-YYYYMMDD-HHMMSS`):
 * numbered after the highest sequence already used that second, whatever the extension.
 */
export function nextArchiveName(existing: string[], base: string, ext: string): string {
  let highest = 0;
  for (const n of existing) {
    const stem = archiveStem(n);
    if (stem === base) highest = Math.max(highest, 1);
    else if (stem.startsWith(`${base}_`)) highest = Math.max(highest, Number(stem.slice(base.length + 1)) || 0);
  }
  return `${highest === 0 ? base : `${base}_${highest + 1}`}${ext}`;
}

export async function runOnlineBackup(opts: OnlineBackupOptions): Promise<OnlineBackupResult> {
  if (!Number.isInteger(opts.keep) || opts.keep < 1) throw new OpsError('The number of backups to keep must be 1 or more.');
  const now = opts.now ?? new Date();
  const ext = opts.key ? ENCRYPTED_EXT : ARCHIVE_EXT;
  // Names are unique by time and sequence, whatever the extension: an encrypted and a plain archive
  // taken in the same second must not share a stem, or pruning could not tell which is newer.
  // Number after the highest sequence already used this second, never into a gap left by pruning:
  // a reused lower number would make the new archive look older than the ones it follows.
  const existing = (await opts.destination.list().catch(() => [])).map((o) => o.name);
  const name = nextArchiveName(existing, `${ONLINE_PREFIX}${timestamp(now)}`, ext);

  await mkdir(opts.workDir, { recursive: true, mode: PRIVATE_DIR });
  const work = join(opts.workDir, `${name}.work`);
  const local = join(opts.workDir, name);
  await rm(work, { recursive: true, force: true });
  await rm(local, { force: true });
  const filesDir = opts.dataDir === 'memory' ? null : join(opts.dataDir, 'files');
  try {
    // 1. A consistent export: every table is read from one snapshot (see export.ts).
    const progress = (p: Parameters<NonNullable<OnlineBackupOptions['onProgress']>>[0]) => { try { opts.onProgress?.(p); } catch { /* progress only */ } };
    progress({ stage: 'export', done: 0 });
    const manifest = await exportAll(opts.db, {
      outDir: work, filesDir, includeSecrets: true, keyFingerprint: currentKeyFingerprint(opts.dataDir), now,
      onTable: (done, total, rows) => progress({ stage: 'export', done, total, rows }),
    });
    progress({ stage: 'archive' });
    // The secret key is kept outside the data folder; it travels only when asked, and only encrypted.
    if (opts.secretKeyFile) {
      if (!opts.key) throw new OpsError('The secret key can only be put in an encrypted backup.');
      await mkdir(join(work, 'extra'), { recursive: true, mode: PRIVATE_DIR });
      await copyFile(opts.secretKeyFile, join(work, 'extra', 'secret.key'));
    }

    // 2. One archive, encrypted when there is a key.
    const paths = listFiles(work);
    const info: ArchiveInfo = {
      kind: 'online-backup', name: name.replace(/\.tar(\.sgrc)?$/, ''), label: 'online', createdAt: manifest.createdAt,
      appVersion: manifest.appVersion, migrations: manifest.migrations,
      totalBytes: paths.reduce((sum, p) => sum + statSync(join(work, p)).size, 0),
      rows: manifest.tables.reduce((sum, t) => sum + t.rows, 0), files: manifest.files.length,
    };
    const bytes = await writeArchive(local, [
      { path: 'archive.json', type: 'file', data: Buffer.from(`${JSON.stringify(info, null, 2)}\n`) },
      ...folderEntries(work, [], paths),
    ], opts.key, info);
    await rm(work, { recursive: true, force: true });

    // 3. To the second location, then read back from there and check every entry.
    progress({ stage: 'upload' });
    try {
      await opts.destination.put(name, local);
    } catch (err) {
      throw new OpsError(`The backup could not be written to ${opts.destination.describe()}: ${(err as Error).message}`);
    }
    let check: { problems: string[] };
    progress({ stage: 'check' });
    try {
      check = checkExportEntries(await hashArchive(openArchiveStream(await opts.destination.get(name), opts.key)));
    } catch (err) {
      throw new OpsError(`The copy at ${opts.destination.describe()} could not be read back: ${(err as Error).message}`);
    }
    if (check.problems.length) {
      await opts.destination.delete(name).catch(() => undefined);
      throw new OpsError(`The copy at ${opts.destination.describe()} does not match (${check.problems[0]}); it was deleted.`);
    }

    // 4. Keep the newest `keep` archives there.
    progress({ stage: 'prune' });
    const ours = (await opts.destination.list()).filter((o) => NAME_RE.test(o.name)).map((o) => o.name).sort(byAge).reverse();
    const pruned: string[] = [];
    for (const old of ours.slice(opts.keep)) {
      await opts.destination.delete(old);
      pruned.push(old);
    }
    return { name, bytes, encrypted: Boolean(opts.key), verified: true, pruned, manifest };
  } finally {
    await rm(work, { recursive: true, force: true });
    await rm(local, { force: true });
  }
}

// ---------------------------------------------------------------- status for `grc.ps1 status`

export interface BackupStatusFile {
  updatedAt: string;
  enabled: boolean;
  schedule: string | null;
  destination: string | null;
  encrypted: boolean;
  lastRun: { at: string; ok: boolean; name: string | null; message: string | null } | null;
  lastSuccess: { at: string; name: string; bytes: number } | null;
}

/** The server writes this beside the database so `grc.ps1 status` can report it while the database is open. */
export async function writeBackupStatus(dataDir: string, status: BackupStatusFile): Promise<void> {
  if (dataDir === 'memory') return;
  const file = join(dataDir, STATUS_FILE);
  const partial = `${file}.partial`;
  await writeFile(partial, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await rename(partial, file);
}

export function readBackupStatus(dataDir: string): BackupStatusFile | null {
  try {
    return JSON.parse(readFileSync(join(dataDir, STATUS_FILE), 'utf8')) as BackupStatusFile;
  } catch {
    return null;
  }
}

/** Streams a Readable into a file (used to download an archive from an object store). */
export async function saveStream(source: Readable, file: string): Promise<void> {
  await pipeline(source, createWriteStream(file, { flags: 'wx' }));
}
