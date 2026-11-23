// Where offline work is kept on the phone (wave 14, E38-10): one SQLite database (expo-sqlite) and a
// folder of files (photos), both in the app's private documents folder. That folder is the app's own
// protected storage: on Android the app's internal storage under file-based encryption (and
// `allowBackup: false`, so it is never copied into a backup), on iPhone the app's sandbox under Data
// Protection. Nothing is written to shared storage. Signing out (or being signed out) deletes both.
import * as SQLite from 'expo-sqlite';
import { Directory, File, Paths } from 'expo-file-system';
import type { MobilePackage } from '../../../shared/mobile-api.ts';
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
    return d;
  }).catch((e) => { opening = null; throw e; });
  return opening;
}

const filesDir = () => new Directory(Paths.document, 'offline');

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
}
