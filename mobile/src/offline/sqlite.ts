// Where offline work is kept on the phone (wave 14, E38-10): one SQLite database (expo-sqlite) and a
// folder of files (photos), both in the app's private documents folder. That folder is the app's own
// protected storage: on Android the app's internal storage under file-based encryption (and
// `allowBackup: false`, so it is never copied into a backup), on iPhone the app's sandbox under Data
// Protection. Nothing is written to shared storage, and neither folder goes into a backup (Android's
// manifest rules; on iPhone both are marked excluded, backup.ts). Signing out (or being signed out)
// deletes both, and the app's cache folder (pictures the camera and the image tools left there, and
// downloaded images of records).
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import type { MobilePackage } from '../../../shared/mobile-api.ts';
import { excludeFromBackup } from './backup';
import type { OutboxItem, OutboxStore, PackageStore } from './types';

export const DB_NAME = 'offline.db';
const SCHEMA = `
create table if not exists outbox (
  id text primary key, seq integer not null, kind text not null, grp text not null, label text not null,
  payload text not null, file text, depends_on text, state text not null, attempts integer not null,
  error text, result text, created_at text not null, updated_at text not null
);
create table if not exists kv (key text primary key, value text not null);
`;

let opening: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  opening ??= SQLite.openDatabaseAsync(DB_NAME).then(async (d) => {
    await d.execAsync(SCHEMA);
    keepOutOfBackups();
    return d;
  }).catch((e) => { opening = null; throw e; });
  return opening;
}

const filesDir = () => new Directory(Paths.document, 'offline');
/** expo-sqlite's folder (its default database directory). */
const databaseDir = () => new Directory(Paths.document, 'SQLite');

/** Marks the database's folder and the files folder excluded from backups (iPhone; Android's rules are in the manifest). */
export function keepOutOfBackups(): void {
  try {
    const files = filesDir();
    if (!files.exists) files.create({ intermediates: true, idempotent: true });
    excludeFromBackup(databaseDir().uri);
    excludeFromBackup(files.uri);
  } catch {
    // The folders are made again, and marked, the next time the database is opened.
  }
}

interface Row {
  id: string; seq: number; kind: string; grp: string; label: string; payload: string; file: string | null; depends_on: string | null;
  state: string; attempts: number; error: string | null; result: string | null; created_at: string; updated_at: string;
}

const parse = <T>(s: string | null): T | null => {
  if (!s) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
};

export const sqliteOutbox: OutboxStore = {
  async all() {
    const rows = await (await db()).getAllAsync<Row>('select * from outbox order by seq');
    return rows.map((r): OutboxItem => ({
      id: r.id, seq: r.seq, kind: r.kind, group: r.grp, label: r.label, payload: parse(r.payload) ?? {}, file: r.file, dependsOn: r.depends_on,
      state: r.state as OutboxItem['state'], attempts: r.attempts, error: parse(r.error), result: parse(r.result), createdAt: r.created_at, updatedAt: r.updated_at,
    }));
  },
  async put(items) {
    const d = await db();
    await d.withExclusiveTransactionAsync(async (tx) => {
      for (const i of items) {
        await tx.runAsync(
          `insert or replace into outbox (id, seq, kind, grp, label, payload, file, depends_on, state, attempts, error, result, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [i.id, i.seq, i.kind, i.group, i.label, JSON.stringify(i.payload), i.file, i.dependsOn, i.state, i.attempts,
            i.error ? JSON.stringify(i.error) : null, i.result ? JSON.stringify(i.result) : null, i.createdAt, i.updatedAt]);
      }
    });
  },
  async remove(ids) {
    if (!ids.length) return;
    const d = await db();
    for (const id of ids) await d.runAsync('delete from outbox where id = ?', [id]);
  },
  async keepFile(group, uri, name) {
    const dir = new Directory(filesDir(), group);
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, name);
    if (target.exists) target.delete();
    await new File(uri).copy(target);
    return target.uri;
  },
  async dropFile(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
  async wipe() {
    await wipeOfflineStorage();
  },
};

export const sqlitePackage: PackageStore = {
  async get() {
    const row = await (await db()).getFirstAsync<{ value: string }>('select value from kv where key = ?', ['package']);
    return parse<MobilePackage>(row?.value ?? null);
  },
  async set(p) {
    await (await db()).runAsync('insert or replace into kv (key, value) values (?, ?)', ['package', JSON.stringify(p)]);
  },
  async clear() {
    await (await db()).runAsync('delete from kv where key = ?', ['package']);
  },
};

/** Deletes the database file and every kept file. */
export async function wipeOfflineStorage(): Promise<void> {
  const open = opening;
  opening = null;
  if (open) {
    try { await (await open).closeAsync(); } catch { /* already closed */ }
  }
  try { await SQLite.deleteDatabaseAsync(DB_NAME); } catch { /* never created */ }
  const dir = filesDir();
  if (dir.exists) dir.delete();
  clearCache();
}

/**
 * Empties the app's cache folder: copies the camera and the image tools made of photos, and images of
 * records downloaded for display. Everything there may be deleted at any time (the system does too).
 */
export function clearCache(): void {
  let entries: (Directory | File)[] = [];
  try { entries = Paths.cache.list(); } catch { return; }
  for (const e of entries) {
    try { e.delete(); } catch { /* in use or already gone: the system clears it later */ }
  }
}

// ---------- drafts of field work (wave 15, E38-11 and E38-12) ----------
// Work in progress that is not ready to send yet (an inspection half answered, the inventory counts
// joined on this phone): rows of the same `kv` table under `draft:` keys, and photos in
// `offline/drafts/<folder>`. Deleted with everything else on sign-out.

export interface DraftStore {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  /** Keys starting with `prefix`. */
  keys(prefix: string): Promise<string[]>;
  /** Copies a file (a photo just taken) into the draft's protected folder; answers the copy's uri. */
  keepFile(folder: string, uri: string, name: string): Promise<string>;
  dropFile(uri: string): Promise<void>;
  /** Removes a draft's folder of files. */
  dropFolder(folder: string): Promise<void>;
  /** Writes bytes (a drawn signature) as a file in the draft's folder; answers its uri. */
  writeFile(folder: string, name: string, bytes: Uint8Array): Promise<string>;
}

const draftDir = (folder: string) => new Directory(filesDir(), 'drafts', folder.replace(/[^A-Za-z0-9_-]/g, '_'));
const ensureDir = (dir: Directory) => { if (!dir.exists) dir.create({ intermediates: true, idempotent: true }); return dir; };

export const sqliteDrafts: DraftStore = {
  async get<T>(key: string) {
    const row = await (await db()).getFirstAsync<{ value: string }>('select value from kv where key = ?', [`draft:${key}`]);
    return parse<T>(row?.value ?? null);
  },
  async set(key, value) {
    await (await db()).runAsync('insert or replace into kv (key, value) values (?, ?)', [`draft:${key}`, JSON.stringify(value)]);
  },
  async remove(key) {
    await (await db()).runAsync('delete from kv where key = ?', [`draft:${key}`]);
  },
  async keys(prefix) {
    const rows = await (await db()).getAllAsync<{ key: string }>('select key from kv where key like ?', [`draft:${prefix.replace(/[%_]/g, '')}%`]);
    return rows.map((r) => r.key.slice('draft:'.length));
  },
  async keepFile(folder, uri, name) {
    const target = new File(ensureDir(draftDir(folder)), name);
    if (target.exists) target.delete();
    await new File(uri).copy(target);
    return target.uri;
  },
  async dropFile(uri) {
    const f = new File(uri);
    if (f.exists) f.delete();
  },
  async dropFolder(folder) {
    const dir = draftDir(folder);
    if (dir.exists) dir.delete();
  },
  async writeFile(folder, name, bytes) {
    const target = new File(ensureDir(draftDir(folder)), name);
    if (target.exists) target.delete();
    target.create();
    await target.write(bytes);
    return target.uri;
  },
};
