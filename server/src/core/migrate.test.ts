import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { grantRuntimeRole } from '../ops/db-roles.ts';
import { migrationFiles } from '../ops/migrations.ts';
import { openDb, type Db, type Queryable } from './db.ts';
import { changedMigrations, migrate, migrationChecksum } from './migrate.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-migrate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function folder(name: string, files: Record<string, string>) {
  const dir = join(scratch, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, sql] of Object.entries(files)) writeFileSync(join(dir, f), sql);
  return dir;
}

describe('migration checksums (E16-20)', () => {
  it('ignores line endings and a byte-order mark', () => {
    expect(migrationChecksum('create table a (id int);\r\n')).toBe(migrationChecksum('﻿create table a (id int);\n'));
    expect(migrationChecksum('create table a (id int);')).not.toBe(migrationChecksum('create table b (id int);'));
  });

  it('records a checksum when applied and reports an applied migration edited afterwards', async () => {
    const db = await openDb('memory');
    try {
      const dir = folder('edited', { '001_a.sql': 'create table mig_a (id int);', '002_b.sql': 'create table mig_b (id int);' });
      const warned: string[][] = [];
      expect(await migrate(db, [{ scope: 'test', dir }], { onChanged: (c) => warned.push(c) })).toEqual(['test/001_a.sql', 'test/002_b.sql']);
      const rows = await db.query<{ name: string; checksum: string }>(`select name, checksum from schema_migrations order by name`);
      expect(rows.map((r) => r.checksum)).toEqual([migrationChecksum('create table mig_a (id int);'), migrationChecksum('create table mig_b (id int);')]);
      expect(warned).toEqual([]);

      // Edited after it was applied: not run again, reported.
      writeFileSync(join(dir, '001_a.sql'), 'create table mig_a (id int, extra text);');
      expect(await migrate(db, [{ scope: 'test', dir }], { onChanged: (c) => warned.push(c) })).toEqual([]);
      expect(warned).toEqual([['test/001_a.sql']]);
      expect(await changedMigrations(db, [{ name: 'test/001_a.sql', path: join(dir, '001_a.sql') }, { name: 'test/002_b.sql', path: join(dir, '002_b.sql') }]))
        .toEqual(['test/001_a.sql']);
    } finally {
      await db.close();
    }
  });

  it('adds the checksum column to an older table and fills in what is missing', async () => {
    const db = await openDb('memory');
    try {
      const dir = folder('older', { '001_a.sql': 'create table mig_old (id int);' });
      await db.exec(`create table schema_migrations (name text primary key, applied_at timestamptz not null default now());
        create table mig_old (id int); insert into schema_migrations (name) values ('old/001_a.sql');`);
      expect(await migrate(db, [{ scope: 'old', dir }])).toEqual([]);
      expect((await db.one(`select checksum from schema_migrations where name = 'old/001_a.sql'`))?.checksum).toBe(migrationChecksum('create table mig_old (id int);'));
    } finally {
      await db.close();
    }
  });

  it('every migration shipped has a readable file', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(10);
    expect(new Set(files.map((f) => f.name)).size).toBe(files.length);
  });
});

/** The transaction as a Db, so migrate() runs on the one connection that has the role set. */
const asDb = (tx: Queryable, dataDir: string): Db => ({ ...tx, query: tx.query, one: tx.one, exec: tx.exec, tx: (fn) => fn(tx), close: async () => {}, dataDir });

describe('least-privilege run-time role (E16-31)', () => {
  it('may read and write rows but not change the schema, its triggers or the audit log', async () => {
    const db = await openDb('memory');
    const role = `grc_rt_${randomBytes(4).toString('hex')}`;
    const core = [{ scope: 'core', dir: join(import.meta.dirname, 'migrations') }];
    try {
      await migrate(db, core);
      await db.exec(`create role ${role} nologin`);
      const granted = await grantRuntimeRole(db, role);
      expect(granted.tables).toBeGreaterThan(5);

      const results: Record<string, string> = {};
      await db.tx(async (tx) => {
        await tx.exec(`set local role ${role}`);
        expect((await tx.one('select current_user as u'))?.u).toBe(role);
        const attempt = async (name: string, sql: string) => {
          await tx.exec('savepoint s');
          try {
            await tx.exec(sql);
            results[name] = 'allowed';
            await tx.exec('release savepoint s');
          } catch (err) {
            results[name] = `refused: ${(err as Error).message}`;
            await tx.exec('rollback to savepoint s');
          }
        };
        // Nothing pending: start-up works without the right to create anything.
        expect(await migrate(asDb(tx, 'memory'), core)).toEqual([]);
        await attempt('insert row', `insert into departments (name) values ('Fare systems')`);
        await attempt('insert audit', `insert into audit_events (action, record_type, summary) values ('test', 'test', 'role check')`);
        await attempt('update audit', `update audit_events set summary = 'changed'`);
        await attempt('delete audit', `delete from audit_events`);
        await attempt('drop trigger', `drop trigger audit_events_no_change on audit_events`);
        await attempt('alter table', `alter table departments add column extra text`);
        await attempt('create table', `create table rogue (id int)`);
        await attempt('record migration', `insert into schema_migrations (name) values ('fake/001.sql')`);
        // A pending migration says what to do instead of failing obscurely.
        const pending = folder('pending', { '001_new.sql': 'create table mig_new (id int);' });
        await tx.exec('savepoint p');
        await expect(migrate(asDb(tx, 'memory'), [{ scope: 'pending', dir: pending }])).rejects.toThrow(/GRC_DATABASE_MIGRATE_URL/);
        await tx.exec('rollback to savepoint p');
      });
      expect(results['insert row']).toBe('allowed');
      expect(results['insert audit']).toBe('allowed');
      for (const k of ['update audit', 'delete audit', 'drop trigger', 'alter table', 'create table', 'record migration']) {
        expect(results[k], k).toMatch(/^refused: (permission denied|must be owner)/);
      }
    } finally {
      await db.exec(`drop owned by ${role}; drop role ${role}`).catch(() => {});
      await db.close();
    }
  });
});

describe('one migration at a time, without the statement timeout (E40-02)', () => {
  it('applies a migration once when two runs on one database overlap: the second finds it done', async () => {
    const db = await openDb('memory');
    try {
      const dir = folder('overlap', { '001_a.sql': 'create table mig_overlap_a (id int);', '002_b.sql': 'create table mig_overlap_b (id int);' });
      const [first, second] = await Promise.all([migrate(db, [{ scope: 'overlap', dir }]), migrate(db, [{ scope: 'overlap', dir }])]);
      expect([...first, ...second].sort()).toEqual(['overlap/001_a.sql', 'overlap/002_b.sql']);
      expect(await db.query(`select name from schema_migrations where name like 'overlap/%'`)).toHaveLength(2);
    } finally {
      await db.close();
    }
  });

  it('takes the migration lock and lifts the statement timeout inside each migration only', async () => {
    const db = await openDb('memory');
    try {
      const seen: string[] = [];
      const dir = folder('inside', { '001_probe.sql': `create table mig_probe as select current_setting('statement_timeout') as timeout,
        (select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid())::int as advisory;` });
      expect(await migrate(db, [{ scope: 'inside', dir }], { onProgress: (l) => seen.push(l) })).toEqual(['inside/001_probe.sql']);
      expect(await db.one('select timeout, advisory from mig_probe')).toEqual({ timeout: '0', advisory: 1 });
      expect(seen).toEqual([]); // quick: nothing to report
    } finally {
      await db.close();
    }
  });

  it('reports a migration that runs long, while it runs and when it ends', async () => {
    const db = await openDb('memory');
    try {
      const lines: string[] = [];
      const dir = folder('long', { '001_long.sql': 'create table mig_long as select g as n from generate_series(1, 1) g; select pg_sleep(0.6);' });
      expect(await migrate(db, [{ scope: 'long', dir }], { reportEveryMs: 100, onProgress: (l) => lines.push(l) })).toEqual(['long/001_long.sql']);
      // A PostgreSQL server reports while it runs; the embedded database (on this thread) when it ends.
      if (process.env.GRC_TEST_DATABASE_URL) expect(lines[0]).toMatch(/^\[migrations\] long\/001_long\.sql still running after \d+ s/);
      expect(lines.at(-1)).toMatch(/^\[migrations\] long\/001_long\.sql applied after \d+ s$/);
    } finally {
      await db.close();
    }
  });
});
