import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { Db, Queryable } from '../core/db.ts';
import { type ArchiveInfo, type ArchiveKey, extractEntries, folderEntries, openArchiveFile, writeArchive } from './archive.ts';
import { OpsError } from './errors.ts';
import { appVersion, copyFiles, describeFiles, listFiles, sha256File, sha256Text } from './files.ts';
import type { FileEntry } from './files.ts';
import { appliedMigrations } from './migrations.ts';

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

export const EXPORT_FORMAT = 'sandpiper-grc-export';
const PAGE = 2000;

/** Tables whose rows are left out of an export made without secrets. */
export const SECRET_TABLES = ['sessions', 'one_time_tokens', 'password_history', 'webauthn_credentials', 'webauthn_challenges'];
/** Columns blanked in an export made without secrets: table -> column -> replacement. */
export const SECRET_COLUMNS: Record<string, Record<string, unknown>> = {
  users: { password_hash: null, totp_secret: null, totp_enabled: false, recovery_codes: [] },
};

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
  migrations: string[];
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
  now?: Date;
}

export async function exportAll(db: Queryable, opts: ExportOptions): Promise<ExportManifest> {
  if (existsSync(opts.outDir) && (await readdir(opts.outDir)).length > 0) {
    throw new OpsError(`${opts.outDir} already exists and is not empty. Choose a new folder.`);
  }
  const includeSecrets = opts.includeSecrets ?? true;
  await mkdir(join(opts.outDir, 'tables'), { recursive: true });

  // The catalogue is read once for every table: one query per table is slow on the embedded
  // database and an online backup holds its transaction open while this runs.
  const columnsByTable = new Map<string, string[]>();
  for (const r of await db.query<{ table_name: string; column_name: string }>(
    `select table_name, column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position`,
  )) {
    if (!columnsByTable.has(r.table_name)) columnsByTable.set(r.table_name, []);
    columnsByTable.get(r.table_name)!.push(r.column_name);
  }
  const keysByTable = new Map<string, string[]>();
  for (const r of await db.query<{ table_name: string; attname: string }>(
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

  const tables: ExportedTable[] = [];
  for (const name of await tableNames(db)) {
    const columns = columnsByTable.get(name) ?? [];
    const pk = keysByTable.get(name) ?? [];
    const order = pk.length ? pk.map((c) => `t.${ident(c)}`).join(', ') : 'row_to_json(t)::text';
    const skipRows = !includeSecrets && SECRET_TABLES.includes(name);
    const blank = includeSecrets ? undefined : SECRET_COLUMNS[name];

    const hash = createHash('sha256');
    const chunks: string[] = [];
    let rows = 0;
    for (let offset = 0; !skipRows; offset += PAGE) {
      const page = await db.query<{ j: string }>(
        `select row_to_json(t)::text as j from ${ident(name)} t order by ${order} limit ${PAGE} offset ${offset}`,
      );
      for (const { j } of page) {
        const line = `${blank ? JSON.stringify({ ...JSON.parse(j), ...blank }) : j}\n`;
        hash.update(line, 'utf8');
        chunks.push(line);
      }
      rows += page.length;
      if (page.length < PAGE) break;
    }
    const file = `tables/${name}.jsonl`;
    await writeFile(join(opts.outDir, file), chunks.join(''), 'utf8');
    tables.push({ name, file, rows, columns, sha256: hash.digest('hex'), ...(skipRows || blank ? { redacted: true } : {}) });
  }

  let files: FileEntry[] = [];
  if (opts.filesDir && existsSync(opts.filesDir)) {
    const paths = listFiles(opts.filesDir);
    await copyFiles(opts.filesDir, join(opts.outDir, 'files'), paths);
    files = await describeFiles(join(opts.outDir, 'files'), paths);
  }

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    appVersion: appVersion(),
    createdAt: (opts.now ?? new Date()).toISOString(),
    database: (await db.one<{ v: string }>('select version() as v'))?.v ?? 'unknown',
    secretsIncluded: includeSecrets,
    migrations: await appliedMigrations(db),
    tables,
    files,
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(join(opts.outDir, 'manifest.json'), manifestText, 'utf8');
  const report = [
    `${sha256Text(manifestText)}  manifest.json`,
    ...tables.map((t) => `${t.sha256}  ${t.file}`),
    ...files.map((f) => `${f.sha256}  files/${f.path}`),
  ];
  await writeFile(join(opts.outDir, 'checksums.sha256'), `${report.join('\n')}\n`, 'utf8');
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
export async function exportToArchive(db: Queryable, opts: ExportArchiveOptions): Promise<{ manifest: ExportManifest; bytes: number; info: ArchiveInfo }> {
  if (existsSync(opts.outFile)) throw new OpsError(`${opts.outFile} already exists. Choose a new name.`);
  const work = `${opts.outFile}.work`;
  await rm(work, { recursive: true, force: true });
  try {
    const manifest = await exportAll(db, { outDir: work, filesDir: opts.filesDir, includeSecrets: opts.includeSecrets, now: opts.now });
    for (const [path, file] of Object.entries(opts.extra ?? {})) {
      if (!existsSync(file)) continue;
      await mkdir(join(work, dirname(path)), { recursive: true });
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

/**
 * Loads an export into an installation that has been migrated and started once but has no
 * users. Everything happens in one transaction: either all tables are loaded or none.
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

      const lines = readFileSync(join(opts.inDir, table.file), 'utf8').split('\n').filter((l) => l !== '');
      if (lines.length !== table.rows) throw new OpsError(`${table.file} has ${lines.length} rows; the manifest says ${table.rows}.`);
      for (let i = 0; i < lines.length && cols.length; i += 500) {
        await tx.query(
          `insert into ${ident(table.name)} (${list})${overriding}
           select ${list} from json_populate_recordset(null::${ident(table.name)}, $1::json)`,
          [`[${lines.slice(i, i + 500).join(',')}]`],
        );
      }
      counts.push({ name: table.name, rows: lines.length });

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
