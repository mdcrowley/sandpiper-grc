import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { issueToken, tokenHash } from '../core/tokens.ts';
import { testApp } from '../test/helpers.ts';
import { exportAll, importAll, NOT_SECRET_COLUMNS, SECRET_COLUMNS, SECRET_TABLES } from './export.ts';

// E22-44: an export made without secrets (`export-all -NoSecrets`) holds no token, session or
// sign-in secret: those tables are left out, or the secret column is blanked where other rows refer
// to the table's rows. A new table with a column named like a secret fails the first test until it
// is listed.

const scratch = mkdtempSync(join(tmpdir(), 'grc-export-secrets-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const lines = (dir: string, table: string) => readFileSync(join(dir, 'tables', `${table}.jsonl`), 'utf8').split('\n').filter(Boolean);

describe('exports without secrets (E22-44)', () => {
  it('knows every column named like a secret (`*_hash`, `token*`) in every loaded table', async () => {
    const t = await testApp();
    try {
      const cols = await t.db.query<{ t: string; c: string }>(
        `select table_name as t, column_name as c from information_schema.columns
         where table_schema = 'public' and (column_name like '%\\_hash' or column_name like 'token%')
         order by 1, 2`);
      expect(cols.length).toBeGreaterThan(3);
      const unknown = cols.filter(({ t: table, c }) =>
        !SECRET_TABLES.includes(table) && !(SECRET_COLUMNS[table] && c in SECRET_COLUMNS[table]) && !NOT_SECRET_COLUMNS.includes(`${table}.${c}`));
      expect(unknown.map((r) => `${r.t}.${r.c}`), 'Add each to SECRET_TABLES, SECRET_COLUMNS or NOT_SECRET_COLUMNS in ops/export.ts').toEqual([]);
    } finally {
      await t.close();
    }
  });

  it('leaves out token and session tables and blanks token hashes, and the export still imports', async () => {
    const source = await testApp();
    const admin = (await source.db.one<{ id: string }>(`select id from users where username = 'admin'`))!;
    const issued = await issueToken(source.db, { userId: admin.id, name: 'Export probe', scopes: ['tickets.view'], expires: new Date(Date.now() + 86_400_000) });
    const dir = join(scratch, 'no-secrets');
    const manifest = await exportAll(source.db, { outDir: dir, includeSecrets: false });

    for (const table of SECRET_TABLES) {
      const entry = manifest.tables.find((x) => x.name === table);
      if (!entry) continue; // that module is not loaded here
      expect(entry, table).toMatchObject({ rows: 0, redacted: true });
    }
    const token = JSON.parse(lines(dir, 'api_tokens')[0]);
    expect(token.name).toBe('Export probe');
    expect(token.token_hash).toBe(`redacted:${token.id}`);
    expect(manifest.tables.find((x) => x.name === 'api_tokens')?.redacted).toBe(true);
    const everything = manifest.tables.map((x) => readFileSync(join(dir, x.file), 'utf8')).join('\n');
    expect(everything).not.toContain(tokenHash(issued.token));

    // The rows load into an empty database, and the token does not work there.
    const target = await buildApp({ dataDir: 'memory', serveWeb: false });
    await importAll(target.db, { inDir: dir });
    expect(await target.db.one('select 1 from api_tokens where token_hash = $1', [tokenHash(issued.token)])).toBeUndefined();
    expect((await target.db.one<{ c: number }>('select count(*)::int c from api_tokens'))!.c).toBe(1);
    await source.close();
    await target.close();
  });
});
