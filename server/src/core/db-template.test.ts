// ci: every module (tools/ci/plan.mjs runs this for a change to any server module)
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.ts';
import { migrationSources } from '../ops/migrations.ts';
import type { Db } from './db.ts';
import { templateKey, testTemplate } from './db-template.ts';

// Test databases start from a migrated template (wave 27, core/db-template.ts). These prove that
// running every migration on an empty database still works, and gives the same database.

/** Everything the migrations shape: columns, constraints, indexes, triggers, functions, views, and how many rows each table has. */
async function shape(db: Db) {
  const q = async (sql: string) => (await db.query<{ s: string }>(sql)).map((r) => r.s);
  const ns = `(select oid from pg_namespace where nspname = current_schema())`;
  const tables = await q(`select relname as s from pg_class where relnamespace = ${ns} and relkind in ('r', 'p') order by 1`);
  const counts = (await db.query<{ t: string; n: number }>(tables.map((t) => `select '${t}' as t, count(*)::int as n from "${t}"`).join(' union all ')))
    .map((r) => `${r.t} ${r.n}`).sort();
  return {
    columns: await q(`select c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || ' ' || a.attnotnull || ' ' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') as s
      from pg_attribute a join pg_class c on c.oid = a.attrelid left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where c.relnamespace = ${ns} and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped order by 1`),
    constraints: await q(`select conrelid::regclass::text || ' ' || pg_get_constraintdef(oid) as s from pg_constraint where connamespace = ${ns} order by 1`),
    indexes: await q(`select indexdef as s from pg_indexes where schemaname = current_schema() order by 1`),
    triggers: await q(`select tgrelid::regclass::text || ' ' || pg_get_triggerdef(oid) as s from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = ${ns}) order by 1`),
    functions: await q(`select proname || ' ' || md5(prosrc) as s from pg_proc where pronamespace = ${ns} order by 1`),
    views: await q(`select viewname || ' ' || md5(definition) as s from pg_views where schemaname = current_schema() order by 1`),
    migrations: await q(`select name as s from schema_migrations order by 1`),
    counts,
  };
}

describe('test databases from a migrated template (wave 27)', () => {
  it('the test run made a template for the default modules, named after the migrations and the day', () => {
    const key = templateKey(migrationSources());
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}-[0-9a-f]{20}$/);
    expect(templateKey(migrationSources(), '2000-01-01')).not.toBe(templateKey(migrationSources(), '2000-01-02'));
    // Not made on a PostgreSQL server run, nor when switched off.
    if (!process.env.GRC_TEST_DATABASE_URL && !process.env.GRC_TEST_NO_TEMPLATE) expect(testTemplate(migrationSources())).toBeInstanceOf(Uint8Array);
  });

  it('migrating an empty database still works and gives the same database as the template', async () => {
    const fresh = await buildApp({ dataDir: 'memory', serveWeb: false, freshDatabase: true });
    const copied = await buildApp({ dataDir: 'memory', serveWeb: false });
    try {
      const [a, b] = [await shape(fresh.db), await shape(copied.db)];
      expect(a.migrations.length).toBeGreaterThan(100);
      expect(b).toEqual(a);
    } finally {
      await fresh.close();
      await copied.close();
    }
  });
});
