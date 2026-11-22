import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { setImmediate as nextTurn } from 'node:timers/promises';
import type { Db, Queryable } from '../core/db.ts';
import { type ArchiveInfo, type ArchiveKey, extractEntries, folderEntries, openArchiveFile, writeArchive } from './archive.ts';
import { OpsError } from './errors.ts';
import { appVersion, copyFiles, describeFiles, listFiles, PRIVATE_DIR, PRIVATE_FILE, sha256File, sha256Text } from './files.ts';
import type { FileEntry } from './files.ts';
import { applyMigrations, appliedMigrations, migrationsOnDisk } from './migrations.ts';

// A logical export of everything, independent of how the database stores it:
//
//   <export>/manifest.json          version, time, migrations, one entry per table and file
//   <export>/tables/<table>.jsonl   one JSON object per row (JSON Lines), in primary-key order
//   <export>/files/...              attached files
//   <export>/checksums.sha256       `<sha256>  <path>` per file (the format `sha256sum -c` reads)
//
// Rows are produced by the database itself (`row_to_json`) and loaded with
// `json_populate_recordset`, so every column type round-trips exactly (timestamps keep
// their microseconds, numbers their precision) on any PostgreSQL-compatible engine.
//
// Consistency (OP-02): every table is read from ONE snapshot of the database. On a PostgreSQL
// server the export runs in a `repeatable read, read only` transaction, so rows saved while it
// runs are neither seen twice nor missed, and tables agree with each other; each table is read
// through a cursor (no OFFSET paging, which shifts when rows are added). The embedded database
// runs one transaction at a time, so holding one open for the whole export would make every
// request wait (OP-05): there the cursors are declared WITH HOLD in a short transaction, which
// fixes their contents at its commit, and are then read a page at a time outside it, letting
// requests run in between. The held cursors keep whole rows as stored (cheap to copy at the
// commit); each page is turned into JSON by the database as it is read.
//
// Size (OP-03): rows are written to the table file a page at a time as they arrive and hashed on
// the way, and read back line by line on import, so no table is ever held in memory whole (a
// JavaScript string cannot exceed about 512 MB, which a long audit log reaches).

export const EXPORT_FORMAT = 'sandpiper-grc-export';

/** Rows fetched per statement and import batch sizes; tests lower them (OP-03). */
export const exportTuning = { pageRows: 1000, importBatchRows: 500, importBatchChars: 8 * 1024 * 1024 };
/** The most characters of one table held in memory at once by the last export and import (OP-03 test). */
export const exportStats = { peakHeldChars: 0, peakImportBatchChars: 0 };

/**
 * Tables whose rows are left out of an export made without secrets (E22-44): sessions, sign-in links,
 * passkeys, single sign-on flows and their sessions, and short-lived assistant sign-in codes and
 * tokens. Nothing else refers to their rows. A table not present in an installation is skipped.
 */
export const SECRET_TABLES = [
  'sessions', 'one_time_tokens', 'password_history', 'webauthn_credentials', 'webauthn_challenges',
  'identity_flows', 'identity_sessions', 'identity_logout_tokens',
  'mcp_oauth_codes', 'mcp_oauth_tokens', 'mobile_codes', 'mobile_tokens',
];

/** A token hash replaced by a value no token can hash to (still unique, so the row loads). */
const unusable = (row: Record<string, unknown>) => `redacted:${String(row.id ?? '')}`;

/**
 * Columns blanked in an export made without secrets: table -> column -> replacement, or a function of
 * the row for a column that must stay unique (E22-44). Used where other rows refer to the table's rows
 * (API tokens by the call log and audit events, links by vendor assessments), so the rows are kept and
 * only the secret goes. An imported row then holds no working token.
 */
export const SECRET_COLUMNS: Record<string, Record<string, unknown>> = {
  users: { password_hash: null, totp_secret: null, totp_enabled: false, recovery_codes: [] },
  api_tokens: { token_hash: unusable },
  mcp_oauth_clients: { secret_hash: null },
  mobile_devices: { installation_hash: unusable },
  vendor_assessment_links: { token_hash: unusable },
  scim_tokens: { token_hash: unusable },
  calendar_feeds: { token_hash: unusable },
  // The work-tracker bridge (feeds module): its address and both secrets are sealed; a copy without secrets
  // keeps the connector switched off and empty, to be entered again.
  ticket_connectors: { url_sealed: '', secret_sealed: '', inbound_secret_sealed: '', active: false },
};

/**
 * Columns named like secrets (`*_hash`, `token*`) that are not: which token was used or what it is
 * called, never the token. export-secrets.test.ts fails on any other column named like that which is
 * neither here, nor blanked, nor in a table left out.
 */
export const NOT_SECRET_COLUMNS = [
  'audit_events.token_id', 'audit_events.token_name', 'mcp_calls.token_id', 'mcp_calls.token_name', 'mcp_token_tools.token_id',
];

/** A row with the secret columns of its table replaced. */
function blankRow(row: Record<string, unknown>, blank: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const [col, v] of Object.entries(blank)) {
    if (col in out) out[col] = typeof v === 'function' ? (v as (r: Record<string, unknown>) => unknown)(row) : v;
  }
  return out;
}

export interface ExportedTable {
  name: string;
  file: string;
  rows: number;
  columns: string[];
  sha256: string;
  /** True when rows or values were left out because the export was made without secrets. */
  redacted?: boolean;
}

export interface ExportManifest {
  format: typeof EXPORT_FORMAT;
  formatVersion: 1;
  appVersion: string;
  createdAt: string;
  database: string;
  secretsIncluded: boolean;
  /** The migrations the database had: a restore builds exactly this schema, loads the rows, then runs the newer ones (OP-04). */
  migrations: string[];
  /**
   * Fingerprint of the secret key the stored secrets (authenticator keys, webhook and provider
   * secrets) were encrypted with; restore refuses without that key (DOC-01). Missing in exports
   * made by earlier versions; null when unknown.
   */
  secretKeyFingerprint?: string | null;
  tables: ExportedTable[];
  files: FileEntry[];
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

interface ColumnInfo {
  column_name: string;
  is_generated: string;
  is_identity: string;
  identity_generation: string | null;
  column_default: string | null;
}

async function tableNames(db: Queryable): Promise<string[]> {
  const rows = await db.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  return rows.map((r) => r.table_name);
}

function columnsOf(db: Queryable, table: string): Promise<ColumnInfo[]> {
  return db.query<ColumnInfo>(
    `select column_name, is_generated, is_identity, identity_generation, column_default
       from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
    [table],
  );
}

export interface ExportOptions {
  outDir: string;
  /** The application's files folder (`<data>/files`); null or missing means there are none. */
  filesDir?: string | null;
  /** False leaves out password hashes, second-factor secrets, sessions and one-time links. */
  includeSecrets?: boolean;
  /** Fingerprint of the secret key in use (ops/secret-key.ts `currentKeyFingerprint`), recorded in the manifest. */
  keyFingerprint?: string | null;
  now?: Date;
}

/** What one snapshot holds: the catalog as it was, and a cursor per table to read the rows from. */
interface Snapshot {
  database: string;
  migrations: string[];
  /** True when the cursors return whole rows (column `r`) to be turned into JSON as they are read; false: JSON (column `j`). */
  rows: boolean;
  tables: { name: string; columns: string[]; cursor: string | null; redacted: boolean }[];
}

let exportSerial = 0;

/** Reads the catalog and declares one cursor per table, all in the transaction `tx`. */
async function openSnapshot(tx: Queryable, includeSecrets: boolean, hold: boolean): Promise<Snapshot> {
  // The catalog is read once for every table: one query per table is slow on the embedded database.
  const columnsByTable = new Map<string, string[]>();
  for (const r of await tx.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
  )) {
    if (!columnsByTable.has(r.table_name)) columnsByTable.set(r.table_name, []);
    columnsByTable.get(r.table_name)!.push(r.column_name);
  }
  const keysByTable = new Map<string, string[]>();
  for (const r of await tx.query<{ table_name: string; attname: string }>(
    `select c.relname as table_name, a.attname
       from pg_index i
       join pg_class c on c.oid = i.indrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
      where n.nspname = 'public' and i.indisprimary
      order by c.relname, a.attnum`,
  )) {
    if (!keysByTable.has(r.table_name)) keysByTable.set(r.table_name, []);
    keysByTable.get(r.table_name)!.push(r.attname);
  }

  const serial = ++exportSerial;
  const tables: Snapshot['tables'] = [];
  for (const [i, name] of (await tableNames(tx)).entries()) {
    const pk = keysByTable.get(name) ?? [];
    const order = pk.length ? pk.map((c) => `t.${ident(c)}`).join(', ') : 'row_to_json(t)::text';
    const skipRows = !includeSecrets && SECRET_TABLES.includes(name);
    const redacted = skipRows || Boolean(!includeSecrets && SECRET_COLUMNS[name]);
    let cursor: string | null = null;
    if (!skipRows) {
      cursor = `grc_export_${serial}_${i}`;
      // Held cursors keep the whole row as it is stored, which their commit copies quickly; the
      // conversion to JSON is done a page at a time afterward (drainSnapshot), outside the transaction.
      const what = hold ? 't as r' : 'row_to_json(t)::text as j';
      await tx.exec(`declare ${cursor} no scroll cursor${hold ? ' with hold' : ''} for select ${what} from ${ident(name)} t order by ${order}`);
    }
    tables.push({ name, columns: columnsByTable.get(name) ?? [], cursor, redacted });
  }
  return {
    database: (await tx.one<{ v: string }>('select version() as v'))?.v ?? 'unknown',
    migrations: await appliedMigrations(tx),
    rows: hold,
    tables,
  };
}

/**
 * Writes every table of a snapshot to its file, a page at a time, closing each cursor when done.
 * `yieldBetween` lets other work run between pages (the embedded database, outside the transaction).
 */
async function drainSnapshot(q: Queryable, snap: Snapshot, outDir: string, includeSecrets: boolean, yieldBetween: boolean): Promise<ExportedTable[]> {
  const out: ExportedTable[] = [];
  const page = Math.max(1, exportTuning.pageRows);
  for (const t of snap.tables) {
    const blank = includeSecrets ? undefined : SECRET_COLUMNS[t.name];
    const file = `tables/${t.name}.jsonl`;
    const hash = createHash('sha256');
    let rows = 0;
    const fh = await open(join(outDir, file), 'wx', PRIVATE_FILE);
    try {
      while (t.cursor) {
        let got = await q.query<{ j: string }>(`fetch forward ${page} from ${t.cursor}`);
        const fetched = got.length;
        if (snap.rows && got.length) {
          // Each row comes as its text form, which casts back to the row exactly; the database writes the JSON.
          got = await q.query<{ j: string }>(
            `select row_to_json(u.r::${ident(t.name)})::text as j from unnest($1::text[]) with ordinality as u(r, n) order by u.n`,
            [got.map((g) => (g as unknown as { r: string }).r)],
          );
        }
        if (got.length) {
          const text = got.map(({ j }) => `${blank ? JSON.stringify(blankRow(JSON.parse(j), blank)) : j}\n`).join('');
          exportStats.peakHeldChars = Math.max(exportStats.peakHeldChars, text.length);
          hash.update(text, 'utf8');
          await fh.write(text, null, 'utf8');
          rows += got.length;
        }
        if (fetched < page) break;
        if (yieldBetween) await nextTurn();
      }
    } finally {
      await fh.close();
    }
    if (t.cursor) {
      await q.exec(`close ${t.cursor}`);
      t.cursor = null;
    }
    out.push({ name: t.name, file, rows, columns: t.columns, sha256: hash.digest('hex'), ...(t.redacted ? { redacted: true } : {}) });
  }
  return out;
}

/** Copies the attached files present now; a file purged since the snapshot is skipped (its record was removed long before). */
async function copyPresentFiles(filesDir: string, outDir: string): Promise<FileEntry[]> {
  const target = join(outDir, 'files');
  const copied: string[] = [];
  for (const path of listFiles(filesDir)) {
    try {
      await copyFiles(filesDir, target, [path]);
      copied.push(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return describeFiles(target, copied);
}

/**
 * Exports every table from one consistent snapshot (see the top of this file), then the
 * attached files. `db` is the whole handle, not a transaction: the export makes its own.
 */
export async function exportAll(db: Db, opts: ExportOptions): Promise<ExportManifest> {
  if (existsSync(opts.outDir) && (await readdir(opts.outDir)).length > 0) {
    throw new OpsError(`${opts.outDir} already exists and is not empty. Choose a new folder.`);
  }
  const includeSecrets = opts.includeSecrets ?? true;
  await mkdir(join(opts.outDir, 'tables'), { recursive: true, mode: PRIVATE_DIR });
  exportStats.peakHeldChars = 0;

  let snap: Snapshot;
  let tables: ExportedTable[];
  if (db.driver === 'server') {
    ({ snap, tables } = await db.tx(async (tx) => {
      await tx.exec('set transaction isolation level repeatable read, read only');
      const s = await openSnapshot(tx, includeSecrets, false);
      return { snap: s, tables: await drainSnapshot(tx, s, opts.outDir, includeSecrets, false) };
    }));
  } else {
    // Requests wait only while this short transaction runs and its commit fills the cursors.
    snap = await db.tx((tx) => openSnapshot(tx, includeSecrets, true));
    try {
      tables = await drainSnapshot(db, snap, opts.outDir, includeSecrets, true);
    } finally {
      for (const t of snap.tables) if (t.cursor) await db.exec(`close ${t.cursor}`).catch(() => undefined);
    }
  }

  // Files are only added or, long after their record was removed, purged: they are copied after
  // the snapshot so the database is not held while they are read.
  const files = opts.filesDir && existsSync(opts.filesDir) ? await copyPresentFiles(opts.filesDir, opts.outDir) : [];

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    appVersion: appVersion(),
    createdAt: (opts.now ?? new Date()).toISOString(),
    database: snap.database,
    secretsIncluded: includeSecrets,
    migrations: snap.migrations,
    secretKeyFingerprint: opts.keyFingerprint ?? null,
    tables,
    files,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(opts.outDir, 'manifest.json'), manifestText, { encoding: 'utf8', mode: PRIVATE_FILE });
  const report = [
    `${sha256Text(manifestText)}  manifest.json`,
    ...tables.map((t) => `${t.sha256}  ${t.file}`),
    ...files.map((f) => `${f.sha256}  files/${f.path}`),
  ];
  await writeFile(join(opts.outDir, 'checksums.sha256'), `${report.join('\n')}\n`, { encoding: 'utf8', mode: PRIVATE_FILE });
  return manifest;
}

export interface ExportArchiveOptions extends Omit<ExportOptions, 'outDir'> {
  /** The archive to write: `.tar`, or `.tar.sgrc` when a key is given. */
  outFile: string;
  key: ArchiveKey | null;
  /** What the archive says about itself (see archive.ts); `kind` defaults to `export`. */
  info?: Partial<ArchiveInfo>;
  /** Extra files to carry, path in the archive -> file on disk (for example extra/secret.key). */
  extra?: Record<string, string>;
}

/**
 * An export written as one archive file. The tables and files are exported to a working folder
 * beside the archive, packed (and encrypted when a key is given), checked and the folder removed.
 */
export async function exportToArchive(db: Db, opts: ExportArchiveOptions): Promise<{ manifest: ExportManifest; bytes: number; info: ArchiveInfo }> {
  if (existsSync(opts.outFile)) throw new OpsError(`${opts.outFile} already exists. Choose a new name.`);
  const work = `${opts.outFile}.work`;
  await rm(work, { recursive: true, force: true });
  try {
    const manifest = await exportAll(db, { outDir: work, filesDir: opts.filesDir, includeSecrets: opts.includeSecrets, keyFingerprint: opts.keyFingerprint, now: opts.now });
    for (const [path, file] of Object.entries(opts.extra ?? {})) {
      if (!existsSync(file)) continue;
      await mkdir(join(work, dirname(path)), { recursive: true, mode: PRIVATE_DIR });
      await copyFile(file, join(work, path));
    }
    const info: ArchiveInfo = {
      kind: 'export', name: basename(opts.outFile), createdAt: manifest.createdAt, appVersion: manifest.appVersion,
      totalBytes: listFiles(work).reduce((sum, p) => sum + statSync(join(work, p)).size, 0),
      secretsIncluded: manifest.secretsIncluded, migrations: manifest.migrations, ...opts.info,
    } as ArchiveInfo;
    const paths = listFiles(work);
    const bytes = await writeArchive(opts.outFile, [
      { path: 'archive.json', type: 'file', data: Buffer.from(`${JSON.stringify(info, null, 2)}\n`) },
      ...folderEntries(work, [], paths),
    ], opts.key, info);
    return { manifest, bytes, info };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Unpacks an export archive into a new folder beside it, for importAll. The caller removes the folder. */
export async function unpackExport(file: string, key: ArchiveKey | null): Promise<string> {
  const work = `${file}.unpacked-${process.pid}`;
  await rm(work, { recursive: true, force: true });
  try {
    await extractEntries(openArchiveFile(file, key), work);
    readExportManifest(work);
  } catch (err) {
    await rm(work, { recursive: true, force: true });
    throw err;
  }
  return work;
}

export function readExportManifest(dir: string): ExportManifest {
  const file = join(dir, 'manifest.json');
  if (!existsSync(file)) throw new OpsError(`${dir} has no manifest.json. It is not an export made by export-all.`);
  let manifest: ExportManifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    throw new OpsError(`${file} cannot be read as JSON.`);
  }
  if (manifest.format !== EXPORT_FORMAT || !Array.isArray(manifest.tables)) throw new OpsError(`${file} is not a Sandpiper GRC export manifest.`);
  if (manifest.formatVersion !== 1) {
    throw new OpsError(`${file} is format version ${manifest.formatVersion}; this version of the application reads version 1.`);
  }
  return manifest;
}

/** Checks every table file and attached file against the manifest. Empty result means intact. */
export async function verifyExport(dir: string): Promise<{ manifest: ExportManifest; problems: string[] }> {
  const manifest = readExportManifest(dir);
  const problems: string[] = [];
  const expected = [
    ...manifest.tables.map((t) => ({ path: t.file, sha256: t.sha256 })),
    ...manifest.files.map((f) => ({ path: `files/${f.path}`, sha256: f.sha256 })),
  ];
  for (const item of expected) {
    const abs = join(dir, item.path);
    if (!existsSync(abs)) problems.push(`missing: ${item.path}`);
    else if ((await sha256File(abs)) !== item.sha256) problems.push(`checksum differs: ${item.path}`);
  }
  return { manifest, problems };
}

export interface ImportOptions {
  inDir: string;
  /** Where attached files go (`<data>/files`); null skips them (in-memory database). */
  filesDir?: string | null;
}

export interface ImportResult {
  manifest: ExportManifest;
  tables: { name: string; rows: number }[];
  files: number;
  /** Things the operator should know: columns that no longer exist, redacted secrets. */
  notes: string[];
}

/** The lines of a table file, a batch at a time, without reading the file whole (OP-03). */
async function* lineBatches(file: string): AsyncGenerator<string[]> {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let batch: string[] = [];
  let chars = 0;
  for await (const line of lines) {
    if (line === '') continue;
    batch.push(line);
    chars += line.length;
    if (batch.length >= exportTuning.importBatchRows || chars >= exportTuning.importBatchChars) {
      exportStats.peakImportBatchChars = Math.max(exportStats.peakImportBatchChars, chars);
      yield batch;
      batch = [];
      chars = 0;
    }
  }
  if (batch.length) {
    exportStats.peakImportBatchChars = Math.max(exportStats.peakImportBatchChars, chars);
    yield batch;
  }
}

/**
 * Loads an export into an installation that has been migrated but has no users. Everything
 * happens in one transaction: either all tables are loaded or none. Prefer `importStaged`,
 * which also builds the schema the export was made with and runs the newer migrations after.
 *
 * Audit events are carried over as they are (same number, time, actor and content) by
 * plain inserts, which the append-only trigger allows; nothing is updated or deleted row
 * by row. Events the empty target wrote while creating its defaults are cleared first,
 * the number sequence continues after the highest imported event, and the import itself
 * is recorded as one new event at the end.
 */
export async function importAll(db: Db, opts: ImportOptions): Promise<ImportResult> {
  const { manifest, problems } = await verifyExport(opts.inDir);
  if (problems.length) {
    throw new OpsError(`The export failed verification and was not imported:\n${problems.slice(0, 10).map((p) => `  - ${p}`).join('\n')}`);
  }

  const users = await db.one<{ n: number }>('select count(*)::int as n from users');
  if ((users?.n ?? 0) > 0) {
    throw new OpsError('The target database already has users. import-all only loads into an empty installation (migrated, no setup wizard completed).');
  }
  const applied = new Set(await appliedMigrations(db));
  const unknown = manifest.migrations.filter((m) => !applied.has(m));
  if (unknown.length) {
    throw new OpsError(
      `The export has migrations this installation does not (${unknown.join(', ')}). Import into the same version of the application, or a newer one, with the same modules.`,
    );
  }

  const notes: string[] = [];
  const present = new Set(await tableNames(db));
  const wanted = manifest.tables.filter((t) => t.name !== 'schema_migrations');
  const missing = wanted.filter((t) => !present.has(t.name) && t.rows > 0).map((t) => t.name);
  if (missing.length) throw new OpsError(`These exported tables do not exist in this installation: ${missing.join(', ')}. Nothing was imported.`);
  const load = wanted.filter((t) => present.has(t.name));

  // Parents before children, so foreign keys hold even where triggers cannot be switched off.
  const fks = await db.query<{ child: string; parent: string }>(
    `select c.relname as child, p.relname as parent
       from pg_constraint k
       join pg_class c on c.oid = k.conrelid
       join pg_class p on p.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public'`,
  );
  const ordered: ExportedTable[] = [];
  const placed = new Set<string>();
  let remaining = [...load];
  while (remaining.length) {
    const ready = remaining.filter((t) =>
      fks.every((fk) => fk.child !== t.name || fk.parent === t.name || placed.has(fk.parent) || !load.some((l) => l.name === fk.parent)),
    );
    const next = ready.length ? ready : remaining; // a cycle: rely on switched-off triggers below
    for (const t of next) {
      ordered.push(t);
      placed.add(t.name);
    }
    remaining = remaining.filter((t) => !placed.has(t.name));
  }

  const counts: { name: string; rows: number }[] = [];
  exportStats.peakImportBatchChars = 0;
  await db.tx(async (tx) => {
    // Lets rows that refer to each other load in any order. Needs a privileged database
    // role; where it is refused, the parent-first order above is what protects us.
    await tx.exec('savepoint ops_import');
    try {
      await tx.exec(`set local session_replication_role = 'replica'`);
    } catch {
      await tx.exec('rollback to savepoint ops_import');
    }

    if (ordered.length) await tx.exec(`truncate table ${ordered.map((t) => ident(t.name)).join(', ')} restart identity cascade`);

    for (const table of ordered) {
      const info = await columnsOf(tx, table.name);
      const insertable = new Set(info.filter((c) => c.is_generated !== 'ALWAYS').map((c) => c.column_name));
      const cols = table.columns.filter((c) => insertable.has(c));
      const dropped = table.columns.filter((c) => !info.some((i) => i.column_name === c));
      if (dropped.length && table.rows > 0) notes.push(`${table.name}: column(s) ${dropped.join(', ')} no longer exist and were not loaded.`);
      const overriding = info.some((c) => c.identity_generation === 'ALWAYS' && cols.includes(c.column_name)) ? ' overriding system value' : '';
      const list = cols.map(ident).join(', ');

      let count = 0;
      for await (const batch of lineBatches(join(opts.inDir, table.file))) {
        count += batch.length;
        if (!cols.length) continue;
        await tx.query(
          `insert into ${ident(table.name)} (${list})${overriding}
           select ${list} from json_populate_recordset(null::${ident(table.name)}, $1::json)`,
          [`[${batch.join(',')}]`],
        );
      }
      if (count !== table.rows) throw new OpsError(`${table.file} has ${count} rows; the manifest says ${table.rows}.`);
      counts.push({ name: table.name, rows: count });

      // Number sequences carry on after the highest imported value.
      for (const c of info) {
        if (!cols.includes(c.column_name)) continue;
        if (c.is_identity !== 'YES' && !(c.column_default ?? '').startsWith('nextval(')) continue;
        await tx.query(
          `select setval(pg_get_serial_sequence($1, $2), coalesce(max(${ident(c.column_name)}), 1), max(${ident(c.column_name)}) is not null)
             from ${ident(table.name)}`,
          [`public.${ident(table.name)}`, c.column_name],
        );
      }
    }

    const total = counts.reduce((sum, c) => sum + c.rows, 0);
    await tx.query(
      `insert into audit_events (actor_name, action, record_type, summary, after)
       values ('System', 'import', 'database', $1, $2::jsonb)`,
      [
        `Imported ${total} rows in ${counts.length} tables from an export made ${manifest.createdAt} by version ${manifest.appVersion}`,
        JSON.stringify({ exportedAt: manifest.createdAt, exportedBy: manifest.appVersion, secretsIncluded: manifest.secretsIncluded, tables: counts }),
      ],
    );
  });

  let files = 0;
  if (manifest.files.length) {
    if (opts.filesDir) {
      const paths = manifest.files.map((f) => f.path);
      await copyFiles(join(opts.inDir, 'files'), opts.filesDir, paths);
      files = paths.length;
    } else {
      notes.push(`${manifest.files.length} attached file(s) were not copied: no files folder was given.`);
    }
  }
  if (!manifest.secretsIncluded) {
    notes.push('The export was made without secrets: the imported accounts have no passwords, so nobody can sign in. Use a full export to move a working installation.');
  }
  return { manifest, tables: counts, files, notes };
}

export interface StagedImportOptions extends ImportOptions {
  /** The source folder whose migrations are applied (default: this copy of the code; tests give their own). */
  srcDir?: string;
}

export interface StagedImportResult extends ImportResult {
  /** Migrations newer than the export, applied after its rows were loaded. */
  laterMigrations: string[];
}

const scopeOf = (migration: string) => migration.slice(0, migration.indexOf('/'));

/**
 * Loads an export the way an upgrade would have treated the data (OP-04): the schema is built
 * with exactly the migrations the export had, the rows are loaded into it, and only then are the
 * newer migrations applied, so a migration that changes data (fills a new column from an old
 * one, renames a key) runs on the restored rows as well.
 *
 * Into a database that already has migrations newer than the export, for parts of the
 * application the export holds, it refuses: loading old rows into a newer schema would skip
 * those migrations. Start again from an empty database.
 */
export async function importStaged(db: Db, opts: StagedImportOptions): Promise<StagedImportResult> {
  const manifest = readExportManifest(opts.inDir);
  const code = new Set(migrationsOnDisk(opts.srcDir));
  const unknown = manifest.migrations.filter((m) => !code.has(m));
  if (unknown.length) {
    throw new OpsError(
      `The export was made by a newer version of the application (${manifest.appVersion}): it has migrations this code does not know (${unknown.join(', ')}). Upgrade the code first.`,
    );
  }
  const had = new Set(manifest.migrations);
  const applied = await appliedMigrations(db);
  if (applied.length === 0) {
    // A new database: the schema as the export knew it. (An export with no migration list gets them all.)
    await applyMigrations(db, had.size ? (name) => had.has(name) : undefined, opts.srcDir);
  } else {
    const scopes = new Set(manifest.migrations.map(scopeOf));
    const newer = applied.filter((m) => !had.has(m) && scopes.has(scopeOf(m)));
    if (newer.length) {
      throw new OpsError(
        `The export was made by an older version (${manifest.appVersion}), and this database already has ${newer.length} newer migration(s) `
          + `(${newer.slice(0, 5).join(', ')}${newer.length > 5 ? ', ...' : ''}). Loading old rows into the newer schema would skip any change those migrations make to existing data. `
          + 'Import into a new, empty database instead (an empty data folder, or a new database on the PostgreSQL server): import-all then builds the schema the export was made with, loads it and applies the newer migrations.',
      );
    }
  }
  const result = await importAll(db, opts);
  const laterMigrations = await applyMigrations(db, undefined, opts.srcDir);
  return { ...result, laterMigrations };
}
