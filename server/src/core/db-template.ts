import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationChecksum, type MigrationSource } from './migrate.ts';

// Test databases from a template (wave 27). Every test application used to start from an empty
// in-memory database and run every migration (about 180 files, a second or more each time, in
// every test file). The test run's global setup (server/src/test/global-setup.ts) now migrates one
// database, keeps it as a PGlite data folder in a tar file, and every in-memory test database
// starts from a copy. The file is named after everything that shapes it, so a changed, added or
// removed migration, another module list (GRC_MODULES) or another PGlite version makes a new one.
// Production never sets GRC_TEST_DB_TEMPLATE_DIR, so none of this runs outside tests.

const here = dirname(fileURLToPath(import.meta.url));

/** The folder holding the template files; set by the test run's global setup. */
export const TEMPLATE_DIR_ENV = 'GRC_TEST_DB_TEMPLATE_DIR';

function pgliteVersion(): string {
  try {
    const pkg = resolve(here, '../../../node_modules/@electric-sql/pglite/package.json');
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }).version ?? '';
  } catch {
    return '';
  }
}

/**
 * The name of the template for these migration folders: a hash of every migration's name and
 * checksum (in the order they are applied), the PGlite version and the day (UTC), so rows a
 * migration stamps with now() are never older than today.
 */
export function templateKey(sources: MigrationSource[], day = new Date().toISOString().slice(0, 10)): string {
  const h = createHash('sha256');
  h.update(`pglite ${pgliteVersion()}\n`);
  for (const { scope, dir } of sources) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      h.update(`${scope}/${file} ${migrationChecksum(readFileSync(join(dir, file), 'utf8'))}\n`);
    }
  }
  return `${day}-${h.digest('hex').slice(0, 20)}`;
}

export function templateFile(dir: string, key: string): string {
  return join(dir, `${key}.tar`);
}

// One read per test process and template.
const loaded = new Map<string, Uint8Array | null>();

/**
 * The template for these migration folders, when the test run made one; otherwise undefined
 * and the database starts empty (and is migrated as before).
 */
export function testTemplate(sources: MigrationSource[]): Uint8Array | undefined {
  const dir = process.env[TEMPLATE_DIR_ENV]?.trim();
  if (!dir) return undefined;
  const file = templateFile(dir, templateKey(sources));
  if (!loaded.has(file)) loaded.set(file, existsSync(file) ? new Uint8Array(readFileSync(file)) : null);
  return loaded.get(file) ?? undefined;
}
