import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS } from '../../core/features.ts';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';

// The pilot profile loads only what comes from the organization's seed files and profile, and
// built-in reference content (lists, roles, framework outcomes, standard reports and dashboards).
// It never adds invented "[Sample]" records (E18-69): run every module's pilot seed on an empty
// seed folder, with every optional area switched on, and look for samples anywhere.
let t: Awaited<ReturnType<typeof testApp>>;
let dir: string;

beforeAll(async () => {
  t = await testApp();
  dir = mkdtempSync(join(tmpdir(), 'grc-pilot-empty-'));
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
  const on = Object.fromEntries(AREAS.map((a) => [a.key, true]));
  expect((await t.api.patch('/api/admin/features', { features: on })).status).toBe(200);
}, 60_000);
afterAll(async () => {
  await t?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Tables the dev profile fills with invented records; the pilot leaves every one of them empty. */
const SAMPLE_TABLES = [
  'tickets', 'problems', 'knowledge_articles', 'changes', 'change_blackouts', 'projects', 'risks',
  'security_incidents', 'policies', 'policy_exceptions', 'courses', 'training_records', 'exercises',
  'exercise_findings', 'vulnerabilities', 'assets', 'systems', 'sites', 'data_categories', 'vendors',
  'contracts', 'actions', 'obligations',
];

describe('pilot profile with an empty seed folder', () => {
  it('adds no invented records anywhere', async () => {
    const opts = { profile: 'pilot' as const, seedDir: dir, organization: {} };
    for (const m of t.modules) {
      if (m.seed) await m.seed(t.ctx, opts);
    }

    // No "[Sample]" value in any text column of any table.
    const cols = await t.db.query<Row>(
      `select table_name, column_name from information_schema.columns
        where table_schema = current_schema() and data_type in ('text', 'character varying')`);
    const byTable = new Map<string, string[]>();
    for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
    const found: string[] = [];
    for (const [table, columns] of byTable) {
      const where = columns.map((c) => `"${c}" like '[Sample]%'`).join(' or ');
      const n = (await t.db.one<{ n: number }>(`select count(*)::int n from "${table}" where ${where}`))!.n;
      if (n) found.push(`${table}: ${n}`);
    }
    expect(found).toEqual([]);

    // The tables the dev profile fills with invented records are empty.
    const counts: Record<string, number> = {};
    for (const table of SAMPLE_TABLES) counts[table] = (await t.db.one<{ n: number }>(`select count(*)::int n from ${table}`))!.n;
    expect(counts).toEqual(Object.fromEntries(SAMPLE_TABLES.map((x) => [x, 0])));
    // The server records this week's (real, empty) vulnerability figures at start; no invented weeks before it.
    expect((await t.db.one<{ n: number }>(
      `select count(*)::int n from vulnerability_snapshots where week_start < date_trunc('week', current_date)`))!.n).toBe(0);

    // Only the administrator: no sample people or sample roster.
    expect((await t.db.one<{ n: number }>('select count(*)::int n from users'))!.n).toBe(1);
  }, 120_000);
});
