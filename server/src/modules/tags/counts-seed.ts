import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { sequenceValue, valueKey } from '../../../../shared/tag-format.ts';
import { COUNT_TYPE } from './counts.ts';

// Sample data of the Asset tags area (E37-10; dev profile only, invented values): a format and a bought
// range of equipment tags, tag values from it on the sample vehicles, sites and the equipment at one
// depot, one finished inventory count (with missing and unexpected records) and one open count, and a
// few logged lookups for "Last seen". Safe to run again: it stops when the sample range exists.
// Owned by TAGS-COUNTS; called from the module's `seed` (index.ts).

const NOTE = '[Sample] Bought equipment tags';
const FIRST = 100000;
const LAST = 100999;
const PREFIX = 'TA-';
const DIGITS = 6;
const tagOf = (n: number) => sequenceValue(n, { prefix: PREFIX, digits: DIGITS });

/** Gives a record a tag value: through its field (the tags module keeps assignments in step), then makes sure the assignment exists. */
async function giveTag(ctx: ModuleContext, type: string, field: string, id: string, value: string): Promise<boolean> {
  const key = valueKey(value);
  if (await ctx.db.one(`select 1 from tag_assignments where value_key = $1 and status = 'active'`, [key])) return false;
  try {
    await ctx.resources.update(type, id, { [field]: value });
  } catch {
    return false; // a value or record the tags module refuses: leave it out of the samples
  }
  if (!(await ctx.db.one(`select 1 from tag_assignments where value_key = $1 and status = 'active'`, [key]))) {
    await ctx.db.tx(async (tx) => {
      const next = await tx.one<{ id: string }>(
        `insert into tag_assignments (value, value_key, record_type, record_id, status, is_primary, source, assigned_at)
         values ($1, $2, $3, $4, 'active', true, 'system', now() - interval '90 days') on conflict do nothing returning id`, [value, key, type, id]);
      if (!next) return;
      await tx.query(
        `update tag_assignments set status = 'replaced', is_primary = false, ended_at = now() - interval '90 days', replaced_by = $3
          where record_type = $1 and record_id = $2 and status = 'active' and id <> $3`, [type, id, next.id]);
    });
  }
  return true;
}

export async function seedTagSamples(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'skipped: samples are for the dev profile only';
  if (!ctx.resources.get(COUNT_TYPE) || !ctx.resources.get('site') || !ctx.resources.get('asset')) return 'skipped: the Asset tags area or the inventory is not available';
  if (await ctx.db.one('select 1 from tag_ranges where note = $1 and deleted_at is null', [NOTE])) return 'samples already loaded';
  // Modules seed in name order: fleet and inventory have run, but load their samples if they did not (idempotent).
  if (ctx.resources.get('vehicle')) {
    await (await import('../fleet/seed.ts')).seedFleet(ctx, opts);
  } else if (!(await ctx.db.one(`select 1 from sites where name = 'Example Depot North' and deleted_at is null`))) {
    const inv = await import('../inventory/seed-sample.ts');
    await inv.seedDevEstate(ctx);
    await inv.seedSampleAssets(ctx, { link: true });
  }
  const admin = (await ctx.db.one<{ id: string }>(`select id from users where status = 'active' order by created_at limit 1`))?.id ?? null;

  // A format and the bought range.
  const format = await ctx.db.one<{ id: string }>(
    `insert into tag_formats (name, characters, prefix, length_min, length_max, check_character, carrier, record_types, notes)
     values ('Equipment tags (sample)', 'digits', $1, $2, $2, 'none', 'any', '[]'::jsonb, 'Invented sample: printed digits with a Code 128 barcode.') returning id`,
    [PREFIX, DIGITS]);
  await ctx.db.query(
    `insert into tag_ranges (format_id, kind, prefix, digits, first_number, last_number, first_key, last_key, source, supplier_note, note, received_on, created_by)
     values ($1, 'sequence', $2, $3, $4, $5, $6, $7, 'bought', 'Box of 1,000 polyester tags from an invented supplier', $8, current_date - 60, $9)`,
    [format!.id, PREFIX, DIGITS, FIRST, LAST, valueKey(tagOf(FIRST)), valueKey(tagOf(LAST)), NOTE, admin]);

  // Tag values: every sample vehicle, every site, and the first 40 assets at Example Depot North.
  let n = FIRST;
  let tagged = 0;
  const give = async (type: string, field: string, id: string) => {
    if (n > LAST) return;
    if (await giveTag(ctx, type, field, id, tagOf(n))) tagged++;
    n++;
  };
  if (ctx.resources.get('vehicle')) {
    for (const v of await ctx.db.query<Row>(`select id from vehicles where deleted_at is null and tag_number is null order by fleet_number`)) await give('vehicle', 'tag_number', v.id);
  }
  for (const s of await ctx.db.query<Row>(`select id from sites where deleted_at is null and tag_number is null order by name`)) await give('site', 'tag_number', s.id);
  const north = await ctx.db.one<{ id: string }>(`select id from sites where name = 'Example Depot North' and deleted_at is null`);
  const central = await ctx.db.one<{ id: string }>(`select id from sites where name = 'Example Central Interchange' and deleted_at is null`);
  const south = await ctx.db.one<{ id: string }>(`select id from sites where name = 'Example Depot South' and deleted_at is null`);
  if (north) {
    for (const a of await ctx.db.query<Row>(`select id from assets where deleted_at is null and site_id = $1 and coalesce(status, '') <> 'disposed' order by name limit 40`, [north.id])) {
      await give('asset', 'tag', a.id);
    }
  }

  // A finished count at the north depot, three weeks ago: all but three records found, one unexpected.
  let counts = 0;
  if (north) {
    const done = await ctx.resources.create(COUNT_TYPE, { title: '[Sample] Yearly count, Example Depot North', site_id: north.id, notes: 'Invented sample count.' });
    const items = await ctx.db.query<Row>(`select id, record_type, record_id from inventory_count_items where count_id = $1 order by record_type, record_id`, [done.id]);
    const missing = new Set(items.filter((i) => i.record_type === 'asset').slice(-3).map((i) => i.id));
    for (const [k, i] of items.entries()) {
      if (missing.has(i.id)) continue;
      await ctx.db.query(
        `update inventory_count_items set state = 'found', found_at = now() - interval '21 days' + make_interval(mins => $2::int), found_by = $3, found_source = 'handheld' where id = $1`,
        [i.id, k, admin]);
      await ctx.db.query(
        `insert into tag_verifications (record_type, record_id, verified_at, site_id, count_id, verified_by) values ($1, $2, now() - interval '21 days' + make_interval(mins => $3::int), $4, $5, $6)
         on conflict (record_type, record_id) do nothing`, [i.record_type, i.record_id, k, north.id, done.id, admin]);
    }
    const stray = south ? await ctx.db.one<{ id: string }>(`select id from assets where site_id = $1 and deleted_at is null and coalesce(status, '') <> 'disposed' order by name limit 1`, [south.id]) : undefined;
    if (stray) {
      await ctx.db.query(
        `insert into inventory_count_items (count_id, record_type, record_id, expected, state, found_at, found_by, found_source) values ($1, 'asset', $2, false, 'found', now() - interval '21 days', $3, 'typed')
         on conflict do nothing`, [done.id, stray.id, admin]);
    }
    await ctx.db.query(`update inventory_count_items set state = 'missing' where count_id = $1 and expected and state = 'pending'`, [done.id]);
    const t = await ctx.db.one<Row>(
      `select count(*) filter (where expected)::int as expected, count(*) filter (where expected and state = 'found')::int as found,
              count(*) filter (where not expected)::int as unexpected, count(*) filter (where expected and state = 'missing')::int as missing
         from inventory_count_items where count_id = $1`, [done.id]);
    await ctx.db.query(
      `update inventory_counts set status = 'finished', started_at = now() - interval '21 days', started_by = $2, finished_at = now() - interval '20 days',
              finished_by = $2, summary = $3 where id = $1`, [done.id, admin, JSON.stringify({ expected: t!.expected, found: t!.found, unexpected: t!.unexpected, missing: t!.missing })]);
    counts++;
  }

  // An open count at the central interchange, started today, with one record found so far.
  if (central) {
    const open = await ctx.resources.create(COUNT_TYPE, { title: '[Sample] Spot check, Example Central Interchange', site_id: central.id, record_types: ['asset'] });
    const first = await ctx.db.one<Row>(`select id, record_type, record_id from inventory_count_items where count_id = $1 order by record_id limit 1`, [open.id]);
    if (first) {
      await ctx.db.query(`update inventory_count_items set state = 'found', found_at = now(), found_by = $2, found_source = 'typed' where id = $1`, [first.id, admin]);
      await ctx.db.query(
        `insert into tag_verifications (record_type, record_id, verified_at, site_id, count_id, verified_by) values ($1, $2, now(), $3, $4, $5)
         on conflict (record_type, record_id) do update set verified_at = excluded.verified_at, site_id = excluded.site_id, count_id = excluded.count_id`,
        [first.record_type, first.record_id, central.id, open.id, admin]);
    }
    await ctx.db.query(`update inventory_counts set started_by = $2 where id = $1`, [open.id, admin]);
    counts++;
  }

  // A few lookups, so "Last seen" shows on some records.
  const seen = await ctx.db.query<Row>(
    `select value_key, record_type, record_id from tag_assignments where status = 'active' and value_key like 'TA1%' order by value_key limit 5`);
  for (const [k, s] of seen.entries()) {
    await ctx.db.query(
      `insert into tag_lookups (value_key, person_id, at, source, outcome, record_type, record_id) values ($1, $2, now() - make_interval(days => $3::int), $4, 'current', $5, $6)`,
      [s.value_key, admin, k + 1, k % 2 ? 'web' : 'app_code', s.record_type, s.record_id]);
  }
  return `tag format 1, bought range ${tagOf(FIRST)} to ${tagOf(LAST)}, tag values ${tagged}, inventory counts ${counts}`;
}
