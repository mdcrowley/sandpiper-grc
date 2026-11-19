import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import type { Db } from '../core/db.ts';
import { testApp } from '../test/helpers.ts';
import { exportAll, importAll, verifyExport } from './export.ts';

const scratch = mkdtempSync(join(tmpdir(), 'grc-ops-export-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// A table with the awkward cases: a self-reference, a generated column, big and exact
// numbers, an array, nested JSON, microsecond times and text that needs escaping.
const PROBE = `
  create table ops_probe (
    id bigserial primary key,
    parent_id bigint references ops_probe(id),
    amount numeric(24,6),
    big bigint,
    tags text[],
    payload jsonb,
    day date,
    at timestamptz,
    note text,
    doubled numeric generated always as (amount * 2) stored
  );
  create table ops_probe_children (
    probe_id bigint not null references ops_probe(id),
    label text not null
  );`;

async function fill(db: Db) {
  await db.exec(PROBE);
  // The child row points at a parent with a higher id, so row order alone cannot satisfy the key.
  await db.exec(`
    insert into ops_probe (id, parent_id, amount, big, tags, payload, day, at, note) values
      (1, null, 1234567890123456.654321, 9007199254740993, '{a,"b c"}', '{"k": [1, {"deep": null}]}', '2030-02-28', '2030-02-28 23:59:59.123456+00', E'line one\\nline "two" \\\\ é ✓'),
      (3, null, 0.000001, -1, '{}', '[]', null, null, '');
    insert into ops_probe (id, parent_id, note) values (2, 3, null);
    select setval('ops_probe_id_seq', 3);
    insert into ops_probe_children (probe_id, label) values (3, 'second'), (1, 'first');
    insert into departments (name) values ('Finance'), ('Operations');
  `);
}

const lines = (dir: string, table: string) => readFileSync(join(dir, 'tables', `${table}.jsonl`), 'utf8').split('\n').filter(Boolean);

describe('export-all and import-all', () => {
  it('round-trips every table, the audit log and the files into an empty database', async () => {
    const source = await testApp(); // has an administrator, a session and audit events
    await fill(source.db);
    const filesDir = join(scratch, 'source-files');
    mkdirSync(join(filesDir, 'ab'), { recursive: true });
    writeFileSync(join(filesDir, 'ab', 'evidence.bin'), Buffer.from([0, 1, 2, 250, 255]));

    const first = join(scratch, 'export-1');
    const manifest = await exportAll(source.db, { outDir: first, filesDir });
    expect(manifest.secretsIncluded).toBe(true);
    expect(manifest.migrations).toContain('core/001_core.sql');
    expect(manifest.tables.find((t) => t.name === 'users')?.rows).toBe(1);
    expect(manifest.tables.find((t) => t.name === 'audit_events')!.rows).toBeGreaterThan(0);
    expect(manifest.files).toEqual([expect.objectContaining({ path: 'ab/evidence.bin', size: 5 })]);
    expect((await verifyExport(first)).problems).toEqual([]);
    // The checksum report covers the manifest, every table and every file.
    const report = readFileSync(join(first, 'checksums.sha256'), 'utf8').trim().split('\n');
    expect(report).toHaveLength(1 + manifest.tables.length + 1);
    expect(report.every((l) => /^[0-9a-f]{64} {2}\S/.test(l))).toBe(true);
    // Exact values survive as text, not as JavaScript numbers.
    expect(lines(first, 'ops_probe')[0]).toContain('1234567890123456.654321');
    expect(lines(first, 'ops_probe')[0]).toContain('9007199254740993');

    const target = await buildApp({ dataDir: 'memory', serveWeb: false });
    await target.db.exec(PROBE);
    const targetFiles = join(scratch, 'target-files');
    const result = await importAll(target.db, { inDir: first, filesDir: targetFiles });
    expect(result.notes).toEqual([]);
    expect(result.files).toBe(1);
    expect(readFileSync(join(targetFiles, 'ab', 'evidence.bin'))).toEqual(Buffer.from([0, 1, 2, 250, 255]));

    // Export the target and compare it with the source, table by table.
    const second = join(scratch, 'export-2');
    const after = await exportAll(target.db, { outDir: second, filesDir: targetFiles });
    for (const table of manifest.tables) {
      if (table.name === 'audit_events' || table.name === 'schema_migrations') continue;
      const copy = after.tables.find((t) => t.name === table.name)!;
      expect({ name: copy.name, rows: copy.rows, sha256: copy.sha256 }).toEqual({ name: table.name, rows: table.rows, sha256: table.sha256 });
    }
    expect(after.files).toEqual(manifest.files);

    // Audit events: every original event is there unchanged, followed by one for the import.
    const before = lines(first, 'audit_events');
    const now = lines(second, 'audit_events');
    expect(now.slice(0, before.length)).toEqual(before);
    expect(now).toHaveLength(before.length + 1);
    const last = JSON.parse(now[now.length - 1]);
    expect(last.action).toBe('import');
    expect(last.actor_name).toBe('System');
    expect(last.id).toBe(JSON.parse(before[before.length - 1]).id + 1);

    // The log is still append-only, and numbering carries on after the imported rows.
    await expect(target.db.query(`update audit_events set summary = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(target.db.query(`delete from audit_events`)).rejects.toThrow(/append-only/);
    const next = await target.db.one<{ id: number }>(`insert into ops_probe (note) values ('new') returning id`);
    expect(next!.id).toBe(4);

    // The imported administrator can sign in with the same password.
    const login = await target.app.inject({
      method: 'POST', url: '/api/auth/login', headers: { 'x-grc-csrf': '1' },
      payload: { username: 'admin', password: 'a long test passphrase 1' },
    });
    expect(login.statusCode).toBe(200);

    await source.close();
    await target.close();
  });

  it('refuses a changed export, and a target that is already in use', async () => {
    const source = await testApp();
    const dir = join(scratch, 'export-tampered');
    await exportAll(source.db, { outDir: dir });
    await expect(exportAll(source.db, { outDir: dir })).rejects.toThrow(/not empty/);

    // A target with users is not empty.
    await expect(importAll(source.db, { inDir: dir })).rejects.toThrow(/already has users/);

    const target = await buildApp({ dataDir: 'memory', serveWeb: false });
    appendFileSync(join(dir, 'tables', 'users.jsonl'), '{"id":"00000000-0000-0000-0000-000000000000"}\n');
    await expect(importAll(target.db, { inDir: dir })).rejects.toThrow(/failed verification[\s\S]*checksum differs: tables\/users.jsonl/);
    expect((await target.db.one<{ n: number }>('select count(*)::int as n from users'))!.n).toBe(0);
    await expect(importAll(target.db, { inDir: join(scratch, 'nowhere') })).rejects.toThrow(/no manifest.json/);

    await source.close();
    await target.close();
  });

  it('loads nothing when one table fails, and refuses an export from newer code', async () => {
    const source = await testApp();
    await source.db.exec(`create table ops_extra (id int primary key, label text not null); insert into ops_extra values (1, 'x')`);
    const dir = join(scratch, 'export-extra');
    await exportAll(source.db, { outDir: dir });

    const target = await buildApp({ dataDir: 'memory', serveWeb: false });
    await expect(importAll(target.db, { inDir: dir })).rejects.toThrow(/do not exist in this installation: ops_extra/);

    // Same table, but the target insists on something the export cannot satisfy: all or nothing.
    await target.db.exec(`create table ops_extra (id int primary key, label text not null check (label <> 'x'))`);
    await expect(importAll(target.db, { inDir: dir })).rejects.toThrow();
    expect((await target.db.one<{ n: number }>('select count(*)::int as n from users'))!.n).toBe(0);
    expect((await target.db.one<{ n: number }>('select count(*)::int as n from roles'))!.n).toBeGreaterThan(0); // defaults untouched

    await source.db.query(`insert into schema_migrations (name) values ('core/999_future.sql')`);
    const newer = join(scratch, 'export-newer');
    await exportAll(source.db, { outDir: newer });
    await expect(importAll(target.db, { inDir: newer })).rejects.toThrow(/migrations this installation does not[\s\S]*core\/999_future.sql/);

    await source.close();
    await target.close();
  });

  it('can leave secrets out', async () => {
    const source = await testApp();
    await source.db.query(`update users set totp_secret = 'SECRETSECRET', totp_enabled = true, recovery_codes = '["abc"]'`);
    const dir = join(scratch, 'export-no-secrets');
    const manifest = await exportAll(source.db, { outDir: dir, includeSecrets: false });
    expect(manifest.secretsIncluded).toBe(false);

    const user = JSON.parse(lines(dir, 'users')[0]);
    expect(user).toMatchObject({ username: 'admin', password_hash: null, totp_secret: null, totp_enabled: false, recovery_codes: [] });
    for (const table of ['sessions', 'one_time_tokens', 'password_history']) {
      expect(manifest.tables.find((t) => t.name === table)).toMatchObject({ rows: 0, redacted: true });
      expect(lines(dir, table)).toEqual([]);
    }
    const everything = readFileSync(join(dir, 'tables', 'users.jsonl'), 'utf8');
    expect(everything).not.toContain('SECRETSECRET');
    expect(everything).not.toContain('argon2');
    expect(existsSync(join(dir, 'files'))).toBe(false);

    const target = await buildApp({ dataDir: 'memory', serveWeb: false });
    const result = await importAll(target.db, { inDir: dir });
    expect(result.notes.join(' ')).toMatch(/without secrets/);
    await source.close();
    await target.close();
  });
});
