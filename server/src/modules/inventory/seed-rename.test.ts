import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AREAS, featureState } from '../../core/features.ts';
import type { Row } from '../../core/module.ts';
import { testApp } from '../../test/helpers.ts';
import { CONDITION_RENAMES } from '../condition/seed.ts';
import { CONTINUITY_RENAMES } from '../continuity/seed.ts';
import { FEEDS_RENAMES } from '../feeds/seed.ts';
import { FUNDING_RENAMES } from '../funding/seed.ts';
import { HOLDS_RENAMES } from '../holds/seed.ts';
import { OT_RENAMES } from '../ot/seed.ts';
import { RECORDS_RENAMES } from '../records/seed.ts';
import { TAGS_RENAMES } from '../tags/counts-seed.ts';
import { VENDOR_RENAMES } from '../vendors/seed-lifecycle.ts';
import { renamePairs, type SampleRename } from './seed-rename.ts';

// Sample data is marked one way, "[Sample] X" (E18-65): a fresh dev seed has no "X (sample)" names, and
// a database loaded by an earlier version gets its "X (sample)" records renamed by the next seed, with
// no second copy.
let t: Awaited<ReturnType<typeof testApp>>;
const dev = { profile: 'dev' as const, seedDir: 'none', organization: {} };
const ALL: SampleRename[] = [
  ...CONDITION_RENAMES, ...CONTINUITY_RENAMES, ...FEEDS_RENAMES, ...FUNDING_RENAMES, ...HOLDS_RENAMES,
  ...OT_RENAMES, ...RECORDS_RENAMES, ...TAGS_RENAMES, ...VENDOR_RENAMES,
];

beforeAll(async () => {
  t = await testApp();
  const admin = (await t.db.one<{ id: string }>(`select id from users where username = 'admin'`))!.id;
  await t.db.query('update sessions set confirmed_at = now() where user_id = $1', [admin]);
  const on = Object.fromEntries(AREAS.map((a) => [a.key, true]));
  expect((await t.api.patch('/api/admin/features', { features: on })).status).toBe(200);
}, 60_000);
afterAll(async () => { await t?.close(); });

/** The dev seed as the command line runs it: every module in order, switched-off areas skipped. */
async function seedAll() {
  const features = await featureState(t.db);
  for (const m of t.modules) {
    if (!m.seed) continue;
    const area = AREAS.find((a) => a.key === m.key || a.modules.includes(m.key));
    if (area && !features.on[area.key]) continue;
    await m.seed(t.ctx, dev);
  }
}

const tableOf = (r: SampleRename) => r.table ?? t.ctx.resources.get(r.type!)!.table;

/** Text values anywhere in the database that end in "(sample)" or "(sample).". */
async function oldMarks(): Promise<string[]> {
  const cols = await t.db.query<Row>(
    `select table_name, column_name from information_schema.columns
      where table_schema = current_schema() and data_type in ('text', 'character varying')`);
  const found: string[] = [];
  for (const c of cols) {
    const rows = await t.db.query<Row>(
      `select "${c.column_name}" as v from "${c.table_name}" where "${c.column_name}" like '%(sample)' or "${c.column_name}" like '%(sample).' limit 3`);
    for (const r of rows) found.push(`${c.table_name}.${c.column_name}: ${r.v}`);
  }
  return found;
}

async function tableCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of new Set(ALL.map(tableOf))) {
    out[table] = (await t.db.one<{ n: number }>(`select count(*)::int n from ${table}`))!.n;
  }
  return out;
}

/** How many rows hold each new name, per rename. */
async function newNameCounts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const r of ALL) {
    const table = tableOf(r);
    for (const [, to] of renamePairs(r)) {
      out[`${table}.${r.column ?? 'name'}=${to}`] = (await t.db.one<{ n: number }>(`select count(*)::int n from ${table} where ${r.column ?? 'name'} = $1`, [to]))!.n;
    }
  }
  return out;
}

describe('sample data marked one way', () => {
  it('a fresh dev seed names its samples "[Sample] X", once each', async () => {
    await seedAll();
    await seedAll(); // modules seed in name order: the second run links what the first could not
    expect(await oldMarks()).toEqual([]);
    const counts = await newNameCounts();
    for (const r of ALL) {
      if (r.every) continue;
      for (const [, to] of renamePairs(r)) expect(counts[`${tableOf(r)}.${r.column ?? 'name'}=${to}`], to).toBeLessThanOrEqual(1);
    }
    const one = (key: string) => expect(counts[key], key).toBe(1);
    one('sites.name=[Sample] Harbor Station');
    one('asset_classes.name=[Sample] 40-foot bus');
    one('ot_zones.name=[Sample] Train control zone');
    one('systems.name=[Sample] Signaling supervisory system');
    one('business_processes.name=[Sample] Fare collection');
    one('continuity_plans.title=[Sample] IT disaster recovery plan');
    one('funding_awards.title=[Sample] Operating assistance');
    one('subrecipients.name=[Sample] County paratransit partner');
    one('legal_holds.matter=[Sample] Platform incident claim');
    one('records_requests.subject=[Sample] Delete my customer account');
    one('privacy_assessments.title=[Sample] Onboard and station video');
    one('tag_formats.name=[Sample] Equipment tags');
    one('ticket_connectors.name=[Sample] Work tracker');
    one('vendor_issues.title=[Sample] Assurance report sent late');
    one('contracts.title=[Sample] Redbrick legacy backup service');
    expect(counts['users.display_name=[Sample] Jordan Mbatha']).toBe(1);
  }, 600_000);

  it('renames the "X (sample)" records of an earlier version, with no duplicates', async () => {
    const before = await tableCounts();
    const names = await newNameCounts();
    // Put the database back as an earlier version left it.
    let reverted = 0;
    for (const r of ALL) {
      for (const [from, to] of renamePairs(r)) {
        reverted += (await t.db.query(`update ${tableOf(r)} set ${r.column ?? 'name'} = $2 where ${r.column ?? 'name'} = $1 returning 1`, [to, from])).length;
      }
    }
    expect(reverted).toBeGreaterThan(80);
    expect((await oldMarks()).length).toBeGreaterThan(0);

    await seedAll();
    expect(await oldMarks()).toEqual([]);
    expect(await tableCounts()).toEqual(before);
    expect(await newNameCounts()).toEqual(names);
    // Renamed through the record type, so the change is in the record's history.
    const harbor = (await t.db.one<{ id: string }>(`select id from sites where name = '[Sample] Harbor Station'`))!.id;
    const events = await t.db.query<Row>(`select after from audit_events where record_type = 'site' and record_id = $1 order by id`, [harbor]);
    expect(events.some((e) => JSON.stringify(e.after ?? {}).includes('[Sample] Harbor Station'))).toBe(true);
  }, 600_000);
});
