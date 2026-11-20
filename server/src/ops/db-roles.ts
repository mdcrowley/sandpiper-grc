import { databaseUrl, envOrFile, type Queryable } from '../core/db.ts';
import { appliedMigrations, readAppliedMigrations } from './migrations.ts';
import { OpsError } from './errors.ts';

// A least-privilege database role for the application (E16-31), PostgreSQL server mode only.
//
// Two accounts:
// - the owner (GRC_DATABASE_MIGRATE_URL, with GRC_DATABASE_MIGRATE_PASSWORD(_FILE)) owns the
//   tables, runs the migrations and builds the search triggers;
// - the run-time role (GRC_DATABASE_URL, the account the server uses) may read and write rows
//   and nothing else: it cannot create, alter or drop tables or triggers, so it cannot remove
//   the audit log's append-only trigger, and it may not update or delete audit events at all.
//
// After each migration run as the owner, the run-time role is granted what it needs on every
// table and sequence in the schema. See docs/installation.md, "A least-privilege database role".
//
// Schema changes at run time (E16-37). Two things used to change the schema while the server ran:
// a new custom field added the `custom` column to its record table, and a changed search
// definition rebuilt that type's search trigger. The run-time role now never attempts either:
// - the owner's run gives every record table the `custom` column up front (`addCustomColumns`),
//   so custom fields need no schema change when they are defined;
// - a search trigger whose definition changed (a text custom field added, an upgrade) is recorded
//   in `schema_requests` and rebuilt by the owner's next run, from the application's own
//   definitions; meanwhile the type keeps its earlier trigger, so search keeps working.
// Chosen over a SECURITY DEFINER function, which would give the run-time role a standing way to
// change the schema and would need the trigger text passed to it (core/search.ts builds it).

const DB_VARS = ['GRC_DATABASE_URL', 'GRC_DATABASE_URL_FILE', 'GRC_DATABASE_PASSWORD', 'GRC_DATABASE_PASSWORD_FILE'] as const;

/** The owner's connection string, or undefined when migrations run as the server's own account. */
export function migrateUrl(): string | undefined {
  return envOrFile('GRC_DATABASE_MIGRATE_URL');
}

const userOf = (url: string | undefined): string | undefined => {
  if (!url) return undefined;
  try {
    return decodeURIComponent(new URL(url).username) || undefined;
  } catch {
    return undefined;
  }
};

/** The role the server runs as: GRC_DATABASE_APP_ROLE, or the user name in GRC_DATABASE_URL. */
export function runtimeRole(): string | undefined {
  return process.env.GRC_DATABASE_APP_ROLE?.trim() || userOf(databaseUrl());
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Grants `role` the run-time privileges on everything in the current schema: rows of every table
 * (but no update or delete on the audit log, and only reading the migration list) and the
 * sequences. It owns nothing, so it cannot change the schema or its triggers. Run as the owner.
 */
export async function grantRuntimeRole(db: Queryable, role: string): Promise<{ schema: string; tables: number }> {
  if (!(await db.one('select 1 from pg_roles where rolname = $1', [role]))) {
    throw new OpsError(`The database role "${role}" does not exist. Create it first (docs/installation.md, "A least-privilege database role").`);
  }
  const owner = (await db.one<{ u: string }>('select current_user as u'))!.u;
  if (owner === role) throw new OpsError(`The run-time role "${role}" is the owner itself; give the server its own account.`);
  const schema = (await db.one<{ s: string }>('select current_schema() as s'))!.s;
  const r = ident(role);
  const s = ident(schema);
  await db.exec(`
    grant usage on schema ${s} to ${r};
    revoke create on schema ${s} from ${r};
    grant select, insert, update, delete on all tables in schema ${s} to ${r};
    grant usage, select, update on all sequences in schema ${s} to ${r};
  `);
  const has = async (table: string) => !!(await db.one(`select to_regclass($1)::text as t`, [`${schema}.${table}`]))?.t;
  if (await has('audit_events')) await db.exec(`revoke update, delete, truncate on ${s}.audit_events from ${r}`);
  if (await has('schema_migrations')) await db.exec(`revoke insert, update, delete, truncate on ${s}.schema_migrations from ${r}`);
  const tables = (await db.one<{ n: number }>(
    `select count(*)::int as n from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE'`, [schema],
  ))!.n;
  return { schema, tables };
}

/** Runs `fn` with the database settings pointing at the owner account, then puts them back. */
export async function asOwner<T>(fn: () => Promise<T>): Promise<T> {
  const url = migrateUrl();
  if (!url) return fn();
  const password = envOrFile('GRC_DATABASE_MIGRATE_PASSWORD');
  const saved = DB_VARS.map((k) => [k, process.env[k]] as const);
  for (const k of DB_VARS) delete process.env[k];
  process.env.GRC_DATABASE_URL = url;
  if (password) process.env.GRC_DATABASE_PASSWORD = password;
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/**
 * Gives every record table the `custom` column for custom fields (E16-37), so that defining a custom
 * field never needs a schema change from the run-time role. Views are skipped (they cannot hold
 * custom values). Run as the owner. Returns the tables changed.
 */
export async function addCustomColumns(db: Queryable, tables: string[]): Promise<string[]> {
  const names = [...new Set(tables)].filter((t) => /^[a-z_][a-z0-9_]*$/.test(t));
  if (!names.length) return [];
  const missing = await db.query<{ t: string }>(
    `select c.relname::text as t from pg_class c
     where c.relnamespace = to_regnamespace(current_schema()) and c.relkind in ('r', 'p') and c.relname = any($1::text[])
       and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'custom' and not a.attisdropped)
     order by 1`, [names]);
  for (const { t } of missing) await db.exec(`alter table ${ident(t)} add column if not exists custom jsonb not null default '{}'`);
  if (await db.one(`select to_regclass('schema_requests')::text as t`).then((r) => r?.t)) {
    await db.query(`delete from schema_requests where kind = 'custom_column'`);
  }
  return missing.map((m) => m.t);
}

/** Schema changes the server recorded because it could not make them (E16-37). */
export async function pendingSchemaRequests(db: Queryable): Promise<{ kind: string; target: string; detail: string | null }[]> {
  if (!(await db.one(`select to_regclass('schema_requests')::text as t`))?.t) return [];
  return db.query('select kind, target, detail from schema_requests order by requested_at, kind, target');
}

/** What the application gives `migrateAsOwner`: its database and, when built, its record types. */
export interface OwnerBuild {
  db: Queryable;
  close: () => Promise<void>;
  core?: { resources?: { registry: { all(): { table: string }[] } } };
}

export interface OwnerMigration {
  applied: string[];
  /** Record tables given the custom-field column (E16-37). */
  customColumns: string[];
  /** Schema changes still waiting after the run (normally none). */
  pending: string[];
  /** The role granted run-time privileges, or null when none was named. */
  granted: string | null;
  tables: number;
}

/**
 * When GRC_DATABASE_MIGRATE_URL is set: builds the application once as the owner (migrations,
 * search triggers), grants the run-time role, and closes. Returns null when it is not set.
 */
export async function migrateAsOwner(
  dataDir: string,
  build: (dataDir: string) => Promise<OwnerBuild>,
): Promise<OwnerMigration | null> {
  if (!migrateUrl()) return null;
  if (!databaseUrl()) throw new OpsError('GRC_DATABASE_MIGRATE_URL is for a PostgreSQL server: set GRC_DATABASE_URL (the run-time account) too.');
  const role = runtimeRole();
  return asOwner(async () => {
    const before = new Set((await readAppliedMigrations(dataDir)) ?? []);
    const { db, close, core } = await build(dataDir);
    try {
      const applied = (await appliedMigrations(db)).filter((n) => !before.has(n));
      // Building the application as the owner already rebuilt every search trigger whose
      // definition changed (and cleared those requests); give every record table its custom column.
      const customColumns = await addCustomColumns(db, (core?.resources?.registry.all() ?? []).map((d) => d.table));
      const pending = (await pendingSchemaRequests(db)).map((r) => r.detail ?? `${r.kind} ${r.target}`);
      let granted: string | null = null;
      let tables = 0;
      if (role) {
        tables = (await grantRuntimeRole(db, role)).tables;
        granted = role;
      }
      return { applied, customColumns, pending, granted, tables };
    } finally {
      await close();
    }
  });
}
