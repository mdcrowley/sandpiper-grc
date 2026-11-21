import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Small file helpers shared by the operations commands. Paths inside manifests always use
// forward slashes, so a backup or export made on one operating system verifies on another.

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '../../..');

/**
 * Modes for what backups, exports and restores create (SP-07): folders only their owner can open,
 * files only their owner can read. Ignored on Windows, where the folder's access list applies.
 */
export const PRIVATE_DIR = 0o700;
export const PRIVATE_FILE = 0o600;

export interface FileEntry {
  /** Path relative to the folder that was listed, with forward slashes. */
  path: string;
  size: number;
  sha256: string;
}

export function appVersion(): string {
  try {
    return String(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version ?? 'unknown');
  } catch {
    return 'unknown';
  }
}

/** Every file under `dir`, relative, forward slashes, sorted. Names in `skip` are left out at the top level only. */
export function listFiles(dir: string, skip: (topLevelName: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (rel === '' && skip(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(abs, entry.name), childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out.sort();
}

/**
 * Every folder under `dir`, relative, forward slashes, sorted. A database data folder
 * contains folders that are empty but must exist, so a copy has to recreate them.
 */
export function listFolders(dir: string, skip: (topLevelName: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isDirectory() || (rel === '' && skip(entry.name))) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      out.push(childRel);
      walk(join(abs, entry.name), childRel);
    }
  };
  if (existsSync(dir)) walk(dir, '');
  return out.sort();
}

export async function makeFolders(dir: string, folders: string[]): Promise<void> {
  for (const folder of folders) await mkdir(join(dir, folder), { recursive: true, mode: PRIVATE_DIR });
}

/** Runs `fn` over the items a few at a time; a folder of many small files is mostly waiting on the disk. */
export async function eachLimited<T>(items: T[], fn: (item: T) => Promise<void>, limit = 16): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function sha256File(file: string): Promise<string> {
  if (statSync(file).size <= 8 * 1024 * 1024) return createHash('sha256').update(await readFile(file)).digest('hex');
  return new Promise((done, fail) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', fail)
      .on('end', () => done(hash.digest('hex')));
  });
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export async function describeFiles(dir: string, paths: string[]): Promise<FileEntry[]> {
  const entries = new Map<string, FileEntry>();
  await eachLimited(paths, async (path) => {
    const abs = join(dir, path);
    entries.set(path, { path, size: statSync(abs).size, sha256: await sha256File(abs) });
  });
  return paths.map((path) => entries.get(path)!);
}

/** Copies the listed relative paths from one folder to another, creating folders as needed. */
export async function copyFiles(from: string, to: string, paths: string[]): Promise<void> {
  for (const folder of new Set(paths.map((path) => dirname(join(to, path))))) await mkdir(folder, { recursive: true, mode: PRIVATE_DIR });
  await eachLimited(paths, (path) => copyFile(join(from, path), join(to, path)));
}

export function folderSize(dir: string): number {
  return listFiles(dir).reduce((sum, path) => sum + statSync(join(dir, path)).size, 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** `yyyyMMdd-HHmmss` in local time: the name of a backup or export folder. */
export function timestamp(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * Is a server using this data folder? True when `grc.pid` names a process that exists.
 * A pid file left behind by a crash (no such process) does not count.
 */
export function serverPid(dataDir: string): number | null {
  if (dataDir === 'memory') return null;
  const pidFile = join(dataDir, 'grc.pid');
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  // Our own process id means the file is left over from an earlier process that had the same id
  // (common in containers, where every one-off command starts with a low id).
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return null;
  try {
    process.kill(pid, 0); // signal 0 tests for existence without sending anything
    return pid;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM' ? pid : null;
  }
}
