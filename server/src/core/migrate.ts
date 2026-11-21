import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db, Queryable } from './db.ts';

export interface MigrationSource {
  /** Prefix recorded in schema_migrations, e.g. "core" or a module key. */
  scope: string;
  dir: string;
}

export interface MigrateOptions {
  /**
   * Called with the applied migrations whose file no longer matches the checksum recorded when
   * it was applied (E16-20). Default: one warning on the console (the server log).
   */
  onChanged?: (changed: string[]) => void;
  /** Applies only the migrations this accepts (by recorded name); the rest are left for a later run (restore of an older export, OP-04). */
  only?: (name: string) => boolean;
}

/**
 * The checksum recorded for a migration: SHA-256 of its text with line endings made LF and a
 * leading byte-order mark removed, so a checkout with CRLF line endings matches.
 */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/^﻿/, '').replace(/\r\n/g, '\n')).digest('hex');
}

/** Applied-migration table, created only when missing (CREATE ... IF NOT EXISTS needs the right to create, which a run-time role lacks). */
async function ensureTable(db: Queryable): Promise<boolean> {
  const exists = (await db.one<{ t: string | null }>(`select to_regclass('schema_migrations')::text as t`))?.t;
  if (!exists) {
    await db.exec(
      `create table schema_migrations (name text primary key, applied_at timestamptz not null default now(), checksum text)`,
    );
    return true;
  }
  const hasChecksum = await db.one(
    `select 1 from information_schema.columns where table_name = 'schema_migrations' and column_name = 'checksum' and table_schema = current_schema()`,
  );
  if (hasChecksum) return true;
  try {
    await db.exec(`alter table schema_migrations add column if not exists checksum text`);
    return true;
  } catch {
    // A run-time role that does not own the table: checksums start once the owner runs `migrate`.
    return false;
  }
}

function ownerHint(name: string, err: Error): Error {
  const denied = /permission denied|must be owner/i.test(err.message);
  return new Error(
    `Migration ${name} failed: ${err.message}` +
      (denied
        ? '. The database account the server uses may not change the schema: run the migrations as the owner role ' +
          '(set GRC_DATABASE_MIGRATE_URL, or run `migrate` with the owner account; see docs/installation.md, "A least-privilege database role").'
        : ''),
  );
}

/**
 * Applies the migrations in each source folder that the database has not had yet, each in its
 * own transaction, in file-name order. Records a checksum of each one; an applied migration
 * whose file has changed since is reported through `opts.onChanged` (it is not run again).
 * Returns the names applied.
 */
export async function migrate(db: Db, sources: MigrationSource[], opts: MigrateOptions = {}): Promise<string[]> {
  let checksums: boolean;
  try {
    checksums = await ensureTable(db);
  } catch (err) {
    throw ownerHint('table schema_migrations', err as Error);
  }
  const recorded = new Map(
    (await db.query<{ name: string; checksum?: string | null }>(`select name${checksums ? ', checksum' : ''} from schema_migrations`))
      .map((r) => [r.name, r.checksum ?? null]),
  );
  const applied: string[] = [];
  const changed: string[] = [];
  const backfill: [string, string][] = [];
  for (const { scope, dir } of sources) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const name = `${scope}/${file}`;
      const sql = readFileSync(join(dir, file), 'utf8');
      const sum = migrationChecksum(sql);
      if (recorded.has(name)) {
        const was = recorded.get(name);
        if (was && was !== sum) changed.push(name);
        else if (!was && checksums) backfill.push([name, sum]); // applied before checksums were kept
        continue;
      }
      if (opts.only && !opts.only(name)) continue;
      try {
        await db.tx(async (tx) => {
          await tx.exec(sql);
          if (checksums) await tx.query('insert into schema_migrations (name, checksum) values ($1, $2)', [name, sum]);
          else await tx.query('insert into schema_migrations (name) values ($1)', [name]);
        });
      } catch (err) {
        throw ownerHint(name, err as Error);
      }
      applied.push(name);
    }
  }
  for (const [name, sum] of backfill) {
    try {
      await db.query('update schema_migrations set checksum = $2 where name = $1 and checksum is null', [name, sum]);
    } catch {
      break; // no right to update: recorded the next time the owner migrates
    }
  }
  if (changed.length) {
    (opts.onChanged ?? ((names) => console.warn(
      `[migrations] ${names.length} applied migration file(s) changed since they were applied: ${names.join(', ')}. ` +
        'A released migration must never be edited; put the change in a new migration (docs/development.md, "Migrations").',
    )))(changed);
  }
  return applied;
}

/** Applied migrations whose recorded checksum differs from the file now on disk (`files`: name to path). */
export async function changedMigrations(db: Queryable, files: { name: string; path: string }[]): Promise<string[]> {
  const col = await db.one(
    `select 1 from information_schema.columns where table_name = 'schema_migrations' and column_name = 'checksum' and table_schema = current_schema()`,
  );
  if (!col) return [];
  const recorded = new Map((await db.query<{ name: string; checksum: string | null }>('select name, checksum from schema_migrations')).map((r) => [r.name, r.checksum]));
  return files
    .filter((f) => {
      const was = recorded.get(f.name);
      if (!was || !existsSync(f.path)) return false;
      return was !== migrationChecksum(readFileSync(f.path, 'utf8'));
    })
    .map((f) => f.name);
}
