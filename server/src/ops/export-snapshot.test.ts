import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { type Db, openDb } from '../core/db.ts';
import { exportAll, exportStats, exportTuning, importAll } from './export.ts';

// How an export reads the database: one consistent snapshot even while people keep saving
// (OP-02), a page at a time so no table is held in memory whole (OP-03), and, on the embedded
// database, without making every request wait for the whole export (OP-05). Run it against a
// PostgreSQL server with GRC_TEST_DATABASE_URL (or through the wire protocol with
// GRC_TEST_DATABASE=pg) to exercise the server driver's repeatable-read snapshot.

const scratch = mkdtempSync(join(tmpdir(), 'grc-ops-snapshot-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
const tuning = { ...exportTuning };
afterEach(() => Object.assign(exportTuning, tuning));

const SCHEMA = `
  create table users (id uuid primary key default gen_random_uuid(), username text);
  create table audit_events (id bigserial primary key, at timestamptz not null default now(), actor_name text, action text, record_type text, summary text, after jsonb);
  -- Random keys, as records have: rows saved during the export land anywhere in key order.
  create table snap_parent (id uuid primary key default gen_random_uuid(), n int not null, note text);
  create table snap_child (id uuid primary key default gen_random_uuid(), parent_id uuid not null, n int not null);`;

async function seeded(rows: number): Promise<Db> {
  const db = await openDb('memory');
  await db.exec(SCHEMA);
  await db.exec(`
    insert into snap_parent (n, note) select g, repeat('x', 200) from generate_series(1, ${rows}) g;
    insert into snap_child (parent_id, n) select id, n from snap_parent;`);
  return db;
}

const lines = (dir: string, table: string) => readFileSync(join(dir, 'tables', `${table}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('export snapshot', () => {
  it('stays consistent while rows are saved during the export (OP-02)', async () => {
    exportTuning.pageRows = 50; // many statements, so writers get in between them
    const db = await seeded(1500);
    let stop = false;
    let written = 0;
    // Each write adds a parent and its child together; a consistent export has every child's parent.
    const writer = async () => {
      while (!stop) {
        await db.tx(async (tx) => {
          const [p] = await tx.query<{ id: string }>(`insert into snap_parent (n, note) values (-1, 'during') returning id`);
          await tx.query('insert into snap_child (parent_id, n) values ($1, -1)', [p.id]);
        });
        written += 1;
        await new Promise((r) => setTimeout(r, 1));
      }
    };
    const writers = [writer(), writer(), writer(), writer()];
    const dir = join(scratch, 'during');
    let manifest;
    try {
      await new Promise((r) => setTimeout(r, 20));
      manifest = await exportAll(db, { outDir: dir });
    } finally {
      stop = true;
      await Promise.all(writers);
    }
    expect(written).toBeGreaterThan(0);
    const parents = lines(dir, 'snap_parent');
    const children = lines(dir, 'snap_child');
    const ids = new Set(parents.map((p) => p.id));
    expect(ids.size).toBe(parents.length); // no row twice
    expect(new Set(children.map((c) => c.id)).size).toBe(children.length);
    expect(children.length).toBe(parents.length); // the two tables agree
    expect(children.every((c) => ids.has(c.parent_id))).toBe(true);
    expect(manifest.tables.find((t) => t.name === 'snap_parent')?.rows).toBe(parents.length);

    // And it loads: the restore that failed on a duplicate key in the review.
    const target = await openDb('memory');
    try {
      await target.exec(SCHEMA);
      await importAll(target, { inDir: dir });
      expect((await target.one<{ n: number }>('select count(*)::int as n from snap_child'))?.n).toBe(children.length);
    } finally {
      await target.close();
      await db.close();
    }
  }, 60_000);

  it('writes and reads each table a page at a time, never whole (OP-03)', async () => {
    exportTuning.pageRows = 100;
    exportTuning.importBatchRows = 100;
    const db = await seeded(3000);
    const dir = join(scratch, 'paged');
    try {
      await exportAll(db, { outDir: dir });
    } finally {
      await db.close();
    }
    const size = statSync(join(dir, 'tables', 'snap_parent.jsonl')).size;
    expect(size).toBeGreaterThan(600_000);
    // At most one page of rows was ever held: a twentieth of the table here.
    expect(exportStats.peakHeldChars).toBeGreaterThan(0);
    expect(exportStats.peakHeldChars).toBeLessThan(size / 20);

    const target = await openDb('memory');
    try {
      await target.exec(SCHEMA);
      const result = await importAll(target, { inDir: dir });
      expect(result.tables.find((t) => t.name === 'snap_parent')?.rows).toBe(3000);
      expect(exportStats.peakImportBatchChars).toBeGreaterThan(0);
      expect(exportStats.peakImportBatchChars).toBeLessThan(size / 20);
    } finally {
      await target.close();
    }
  }, 60_000);

  it('lets other work reach the embedded database while it exports (OP-05)', async () => {
    const db = await seeded(3000);
    if (db.driver !== 'embedded') {
      await db.close();
      return; // a server serves other connections anyway
    }
    exportTuning.pageRows = 50;
    let finished = false;
    let answeredDuring = 0;
    const exporting = exportAll(db, { outDir: join(scratch, 'busy') }).finally(() => { finished = true; });
    while (!finished) {
      await db.query('select count(*) from snap_parent');
      await new Promise((r) => setImmediate(r)); // as requests do: each arrives from the event loop
      if (!finished) answeredDuring += 1;
    }
    await exporting;
    await db.close();
    // Before, the whole export was one transaction: nothing was answered until it ended.
    expect(answeredDuring).toBeGreaterThan(30);
  }, 60_000);
});
