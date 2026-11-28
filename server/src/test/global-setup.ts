// Vitest global setup (vitest.config.ts): makes the migrated template database every in-memory test
// database starts from (core/db-template.ts), once per test run and only when no current one is
// kept. Folder: GRC_TEST_DB_TEMPLATE_DIR, default node_modules/.cache/grc-test-db (git-ignored).
// GRC_TEST_NO_TEMPLATE=1 turns it off (every test database is migrated from empty, as before).
// A run on a PostgreSQL server (GRC_TEST_DATABASE_URL) does not use it.
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeEmbeddedTemplate } from '../core/db.ts';
import { TEMPLATE_DIR_ENV, templateFile, templateKey } from '../core/db-template.ts';
import { migrate } from '../core/migrate.ts';
import { migrationSources } from '../ops/migrations.ts';

export default async function setup() {
  if (process.env.GRC_TEST_DATABASE_URL?.trim() || process.env.GRC_TEST_NO_TEMPLATE) {
    delete process.env[TEMPLATE_DIR_ENV];
    return;
  }
  const dir = resolve(process.env[TEMPLATE_DIR_ENV]?.trim() || join(import.meta.dirname, '../../../node_modules/.cache/grc-test-db'));
  const sources = migrationSources();
  const key = templateKey(sources);
  const file = templateFile(dir, key);
  if (!existsSync(file)) {
    const started = performance.now();
    mkdirSync(dir, { recursive: true });
    const bytes = await makeEmbeddedTemplate(async (db) => { await migrate(db, sources, { onChanged: () => {} }); });
    // Written whole, then renamed: a test run started at the same moment never reads half a file.
    const part = `${file}.${process.pid}.part`;
    writeFileSync(part, bytes);
    renameSync(part, file);
    // Older templates (another day or other migrations) are removed.
    for (const f of readdirSync(dir)) {
      if (f !== `${key}.tar` && !f.endsWith('.part')) rmSync(join(dir, f), { force: true });
    }
    console.log(`[tests] made the migrated template database in ${Math.round(performance.now() - started)} ms: ${file}`);
  }
  // Test processes start after this and inherit it.
  process.env[TEMPLATE_DIR_ENV] = dir;
}
