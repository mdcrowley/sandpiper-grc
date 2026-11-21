import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../core/db.ts';
import { exportAll, importAll, importStaged } from './export.ts';
import { applyMigrations, appliedMigrations } from './migrations.ts';

// OP-04: a backup taken by the server (an export) from an older version used to be loaded into a
// database built with every migration of the current code, so a migration that changes existing
// data never ran on the restored rows. These tests use a code tree of their own with a fake data
// migration: version 1 stores a kind in lower case; version 2 adds a label filled from it.

const scratch = mkdtempSync(join(tmpdir(), 'grc-ops-staged-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const BASE = `
  create table users (id uuid primary key default gen_random_uuid(), username text);
  create table audit_events (id bigserial primary key, at timestamptz not null default now(), actor_name text, action text, record_type text, summary text, after jsonb);
  create table things (id int primary key, kind text not null);`;
// The data migration: what an upgrade does to rows that already exist.
const DATA = `
  alter table things add column label text;
  update things set label = upper(kind);
  alter table things alter column label set not null;`;

function codeTree(name: string, withData: boolean): string {
  const src = join(scratch, name);
  mkdirSync(join(src, 'core', 'migrations'), { recursive: true });
  writeFileSync(join(src, 'core', 'migrations', '001_base.sql'), BASE);
  if (withData) writeFileSync(join(src, 'core', 'migrations', '002_label.sql'), DATA);
  return src;
}

async function oldExport(name: string): Promise<string> {
  const v1 = codeTree(`${name}-v1`, false);
  const source = await openDb('memory');
  await applyMigrations(source, undefined, v1);
  await source.exec(`insert into things (id, kind) values (1, 'bus'), (2, 'tram')`);
  const dir = join(scratch, `${name}-export`);
  const manifest = await exportAll(source, { outDir: dir });
  await source.close();
  expect(manifest.migrations).toEqual(['core/001_base.sql']);
  return dir;
}

describe('restoring an export from an older version (OP-04)', () => {
  it('builds the export\'s own schema, loads it, then runs the newer migrations on the loaded rows', async () => {
    const dir = await oldExport('staged');
    const v2 = codeTree('staged-v2', true);
    const target = await openDb('memory');
    try {
      const result = await importStaged(target, { inDir: dir, srcDir: v2 });
      expect(result.laterMigrations).toEqual(['core/002_label.sql']);
      expect(await target.query('select id, kind, label from things order by id')).toEqual([
        { id: 1, kind: 'bus', label: 'BUS' },
        { id: 2, kind: 'tram', label: 'TRAM' },
      ]);
      expect(await appliedMigrations(target)).toEqual(['core/001_base.sql', 'core/002_label.sql']);
    } finally {
      await target.close();
    }
  });

  it('what used to happen: loaded straight into the newer schema, the data migration is skipped', async () => {
    const dir = await oldExport('direct');
    const v2 = codeTree('direct-v2', true);
    const target = await openDb('memory');
    try {
      await applyMigrations(target, undefined, v2); // the old restore: every migration first
      await target.exec('alter table things alter column label drop not null'); // or the load fails outright
      await importAll(target, { inDir: dir });
      expect((await target.query('select label from things order by id')).map((r) => r.label)).toEqual([null, null]);
    } finally {
      await target.close();
    }
  });

  it('refuses a database that already has newer migrations, and says to start from an empty one', async () => {
    const dir = await oldExport('refuse');
    const v2 = codeTree('refuse-v2', true);
    const target = await openDb('memory');
    try {
      await applyMigrations(target, undefined, v2);
      await expect(importStaged(target, { inDir: dir, srcDir: v2 })).rejects.toThrow(/older version[\s\S]*core\/002_label.sql[\s\S]*new, empty database/);
      expect(await target.query('select * from things')).toEqual([]);
    } finally {
      await target.close();
    }
  });

  it('refuses an export from newer code before changing anything', async () => {
    const dir = await oldExport('newer');
    const older = join(scratch, 'empty-code');
    mkdirSync(join(older, 'core', 'migrations'), { recursive: true });
    const target = await openDb('memory');
    try {
      await expect(importStaged(target, { inDir: dir, srcDir: older })).rejects.toThrow(/newer version[\s\S]*core\/001_base.sql/);
      expect(await appliedMigrations(target)).toEqual([]);
    } finally {
      await target.close();
    }
  });
});
