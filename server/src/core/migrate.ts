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
  /**
   * A migration that runs long is reported every `reportEveryMs` (default GRC_MIGRATION_REPORT_SECONDS,
   * 15 seconds) through this (default: the server log), with what it is doing when the database can
   * say (an index build's phase and progress, or a wait for a lock), and once more when it ends (E40-02).
   */
  onProgress?: (line: string) => void;
  reportEveryMs?: number;
}

function reportEveryMs(opts: MigrateOptions): number {
  if (opts.reportEveryMs !== undefined) return opts.reportEveryMs;
  const n = Number(process.env.GRC_MIGRATION_REPORT_SECONDS ?? 15);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 15_000;
}

/**
 * Reports a migration that is still running (E40-02). On a PostgreSQL server another connection of
 * the pool asks what the migrating connection is doing: an index build's phase and blocks or rows
 * done (pg_stat_progress_create_index), or a wait for a lock that running work holds. The embedded
 * database has one connection, busy with the migration, and runs each statement on this thread, so
 * there a long migration is reported when it ends.
 */
function watchMigration(db: Db, name: string, opts: MigrateOptions) {
  const every = reportEveryMs(opts);
  const say = opts.onProgress ?? ((line: string) => console.log(line));
  const started = Date.now();
  let pid: number | null = null;
  let reported = false;
  let stopped = false;
  const seconds = () => Math.round((Date.now() - started) / 1000);
  const tick = async () => {
    if (stopped) return;
    let detail = '';
    if (pid !== null && db.driver === 'server') {
      try {
        const index = await db.one<{ idx: string | null; tbl: string | null; phase: string; blocks_done: number; blocks_total: number; tuples_done: number; tuples_total: number }>(
          `select index_relid::regclass::text as idx, relid::regclass::text as tbl, phase, blocks_done, blocks_total, tuples_done, tuples_total
           from pg_stat_progress_create_index where pid = $1`, [pid]);
        if (index) {
          const pct = index.blocks_total > 0 ? ` ${Math.floor((100 * index.blocks_done) / index.blocks_total)}% of blocks`
            : index.tuples_total > 0 ? ` ${Math.floor((100 * index.tuples_done) / index.tuples_total)}% of rows` : '';
          detail = `: building index ${index.idx ?? ''} on ${index.tbl ?? ''}, ${index.phase}${pct}`;
        } else {
          const act = await db.one<{ wait_event_type: string | null; wait_event: string | null }>(
            'select wait_event_type, wait_event from pg_stat_activity where pid = $1', [pid]);
          if (act?.wait_event_type === 'Lock') detail = `: waiting for a ${act.wait_event ?? ''} lock held by running work`;
        }
      } catch { /* the report is best effort */ }
    }
    if (stopped) return;
    reported = true;
    say(`[migrations] ${name} still running after ${seconds()} s${detail}`);
  };
  const timer = setInterval(() => { void tick(); }, every);
  timer.unref?.();
  return {
    pid(p: number | null) { pid = p; },
    stop(ran: boolean) {
      stopped = true;
      clearInterval(timer);
      // The embedded database runs a statement on this thread, so no report could be made meanwhile:
      // a long migration is at least reported when it ends.
      if (reported || Date.now() - started >= every) say(`[migrations] ${name} ${ran ? 'applied' : 'ended'} after ${seconds()} s`);
    },
  };
}

/**
 * The checksum recorded for a migration: SHA-256 of its text with line endings made LF and a
 * leading byte-order mark removed, so a checkout with CRLF line endings matches.
 */
export function migrationChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/^﻿/, '').replace(/\r\n/g, '\n')).digest('hex');
}

/**
 * One server process migrates at a time (E40-02): every migration transaction first takes this
 * transaction-scoped advisory lock (per schema), so a second process starting at the same moment waits
 * for the first one's migration, then finds it recorded and moves on. Taken after the statement
 * timeout is lifted, so the wait itself cannot time out.
 */
const MIGRATION_LOCK = `select pg_advisory_xact_lock(hashtext('sandpiper-grc.migrate.' || current_schema()))`;

/**
 * Inside a migration transaction: no statement timeout (E40-02). A request's 120 seconds
 * (GRC_DATABASE_STATEMENT_TIMEOUT) must not stop a table rewrite or an index build on a large
 * installation, which would fail every start in the same place. `SET LOCAL` ends with the transaction.
 */
async function beginMigration(tx: Queryable): Promise<void> {
  await tx.exec('set local statement_timeout = 0');
  await tx.query(MIGRATION_LOCK);
}

/** Applied-migration table, created only when missing (CREATE ... IF NOT EXISTS needs the right to create, which a run-time role lacks). */
async function ensureTable(db: Db): Promise<boolean> {
  const exists = (await db.one<{ t: string | null }>(`select to_regclass('schema_migrations')::text as t`))?.t;
  if (!exists) {
    // Under the migration lock, checked again: another process may have just made it.
    await db.tx(async (tx) => {
      await beginMigration(tx);
      if ((await tx.one<{ t: string | null }>(`select to_regclass('schema_migrations')::text as t`))?.t) return;
      await tx.exec(
        `create table schema_migrations (name text primary key, applied_at timestamptz not null default now(), checksum text)`,
      );
    });
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
      let ran = false;
      const watch = watchMigration(db, name, opts);
      try {
        ran = await db.tx(async (tx) => {
          await beginMigration(tx);
          // Another process may have applied it while this one waited for the lock.
          if (await tx.one('select 1 from schema_migrations where name = $1', [name])) return false;
          if (db.driver === 'server') watch.pid((await tx.one<{ pid: number }>('select pg_backend_pid() as pid'))?.pid ?? null);
          await tx.exec(sql);
          if (checksums) await tx.query('insert into schema_migrations (name, checksum) values ($1, $2)', [name, sum]);
          else await tx.query('insert into schema_migrations (name) values ($1)', [name]);
          return true;
        });
      } catch (err) {
        throw ownerHint(name, err as Error);
      } finally {
        watch.stop(ran);
      }
      if (ran) applied.push(name);
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
