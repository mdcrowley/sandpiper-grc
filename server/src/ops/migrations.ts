import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { databaseUrl, openDb } from '../core/db.ts';
import type { Queryable } from '../core/db.ts';
import { changedMigrations } from '../core/migrate.ts';
import { repoRoot } from './files.ts';

// What the code on disk expects of the database, and what a database has had applied.
// The discovery rule mirrors buildApp() in app.ts: core first, then each module folder
// in alphabetical order, honoring GRC_MODULES.

/** The migrations shipped with this copy of the code: the name recorded in schema_migrations and the file. */
export function migrationFiles(srcDir: string = join(repoRoot, 'server/src')): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  const add = (scope: string, dir: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) out.push({ name: `${scope}/${file}`, path: join(dir, file) });
  };
  add('core', join(srcDir, 'core/migrations'));
  // Core services that keep their own tables (for example core/jobs, core/mail) apply
  // core/<service>/migrations under the scope "core.<service>" when they start.
  const coreDir = join(srcDir, 'core');
  if (existsSync(coreDir)) {
    for (const d of readdirSync(coreDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== 'migrations').map((e) => e.name).sort()) {
      add(`core.${d}`, join(coreDir, d, 'migrations'));
    }
  }
  const modulesDir = join(srcDir, 'modules');
  if (existsSync(modulesDir)) {
    const keys = readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(modulesDir, d.name, 'index.ts')))
      .map((d) => d.name)
      .filter((k) => !process.env.GRC_MODULES || process.env.GRC_MODULES.split(',').includes(k))
      .sort();
    for (const key of keys) add(key, join(modulesDir, key, 'migrations'));
  }
  return out;
}

/** Names of the migrations shipped with this copy of the code, as recorded in schema_migrations. */
export function migrationsOnDisk(srcDir?: string): string[] {
  return migrationFiles(srcDir).map((f) => f.name);
}

/** Migrations recorded in a database, oldest first. Empty when the table does not exist yet. */
export async function appliedMigrations(db: Queryable): Promise<string[]> {
  const table = await db.one(`select to_regclass('schema_migrations')::text as t`);
  if (!table?.t) return [];
  return (await db.query<{ name: string }>('select name from schema_migrations order by applied_at, name')).map((r) => r.name);
}

export interface AppliedState {
  applied: string[];
  /** Applied migrations whose file differs from the checksum recorded when they were applied (E16-20). */
  changed: string[];
}

/**
 * Reads the applied migrations (and which of them were edited afterwards) from a data folder
 * without starting the application. Null when there is no database there, or it cannot be
 * opened (the reason is passed to `onError`). The server must be stopped: the embedded database
 * allows one process at a time.
 */
export async function readMigrationState(dataDir: string, onError?: (message: string) => void): Promise<AppliedState | null> {
  if (!databaseUrl() && dataDir !== 'memory' && !existsSync(join(dataDir, 'pg'))) return null;
  try {
    const db = await openDb(dataDir);
    try {
      const applied = await appliedMigrations(db);
      return { applied, changed: applied.length ? await changedMigrations(db, migrationFiles()) : [] };
    } finally {
      await db.close();
    }
  } catch (err) {
    onError?.((err as Error).message);
    return null;
  }
}

/** The applied migrations of a data folder (see `readMigrationState`). */
export async function readAppliedMigrations(dataDir: string, onError?: (message: string) => void): Promise<string[] | null> {
  return (await readMigrationState(dataDir, onError))?.applied ?? null;
}
