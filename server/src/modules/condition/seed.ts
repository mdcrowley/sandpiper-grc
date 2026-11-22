import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { upsertByName } from '../inventory/seed.ts';
import { seedDevEstate, seedSampleAssets } from '../inventory/seed-sample.ts';
import { followTargets, recompute, TARGETS, type TargetType } from './service.ts';

/**
 * Dev profile only: nine invented asset classes, the sample estate's stations, depots, track
 * segments and substations given a kind, a year built and a class, every sample vehicle and the
 * fareboxes put in a class, a condition assessment for each, targets for this year and last year,
 * and three replacement projects. Everything new is labeled "(sample)". Safe to run again: classes
 * and sites are matched by name, and a record that already has an assessment gets no other.
 */

const day = (offset: number) => dayInZone(offset);

const CLASSES: Row[] = [
  { name: '40-foot bus (sample)', category: 'rolling_stock', applies_to: 'vehicle', useful_life_years: 12, useful_life_miles: 500000, matches: { vehicle_mode: ['bus', 'trolleybus'] }, past: 10, now: 8 },
  { name: 'Cutaway (sample)', category: 'rolling_stock', applies_to: 'vehicle', useful_life_years: 7, useful_life_miles: 200000, matches: { vehicle_mode: ['paratransit'] }, past: 15, now: 15 },
  { name: 'Light rail vehicle (sample)', category: 'rolling_stock', applies_to: 'vehicle', useful_life_years: 25, matches: { vehicle_mode: ['light_rail'] }, past: 5, now: 5 },
  { name: 'Heavy rail car (sample)', category: 'rolling_stock', applies_to: 'vehicle', useful_life_years: 35, matches: { vehicle_mode: ['heavy_rail'] }, past: 5, now: 5 },
  { name: 'Passenger station (sample)', category: 'facilities', applies_to: 'site', useful_life_years: 50, matches: { site_kind: ['passenger_station'] }, past: 25, now: 20 },
  { name: 'Maintenance facility (sample)', category: 'facilities', applies_to: 'site', useful_life_years: 40, matches: { site_kind: ['depot', 'maintenance_facility'] }, past: 30, now: 30 },
  { name: 'Track segment (sample)', category: 'infrastructure', applies_to: 'site', useful_life_years: 30, matches: { site_kind: ['track_segment', 'guideway_section'] }, past: 20, now: 15 },
  { name: 'Traction power substation (sample)', category: 'infrastructure', applies_to: 'site', useful_life_years: 35, matches: { site_kind: ['traction_power_substation'] }, past: 20, now: 20 },
  { name: 'Farebox (sample)', category: 'equipment', applies_to: 'asset', useful_life_years: 10, matches: { asset_type: ['farebox'] }, past: 10, now: 10 },
];

/** The sample estate's sites, and new ones: kind, year built and class. */
const SITES: { name: string; site_kind: string; built_year: number; cls?: string; address?: string; function?: string }[] = [
  { name: 'Example Depot North', site_kind: 'depot', built_year: 1979, cls: 'Maintenance facility (sample)' },
  { name: 'Example Depot South', site_kind: 'depot', built_year: 1996, cls: 'Maintenance facility (sample)' },
  { name: 'Example Rail Yard', site_kind: 'maintenance_facility', built_year: 2009, cls: 'Maintenance facility (sample)' },
  { name: 'Example Central Interchange', site_kind: 'passenger_station', built_year: 1969, cls: 'Passenger station (sample)' },
  { name: 'Example Head Office', site_kind: 'office', built_year: 1988 },
  { name: 'Example Operations Control Center', site_kind: 'office', built_year: 2014 },
  { name: 'Harbor Station (sample)', site_kind: 'passenger_station', built_year: 1986, cls: 'Passenger station (sample)', address: 'Harbor Road', function: 'Light-rail stop with two side platforms and a bus bay' },
  { name: 'Northgate Station (sample)', site_kind: 'passenger_station', built_year: 2011, cls: 'Passenger station (sample)', address: 'Northgate Avenue', function: 'Light-rail terminus with a park-and-ride lot' },
  { name: 'Track segment A1: Interchange to Harbor (sample)', site_kind: 'track_segment', built_year: 1991, cls: 'Track segment (sample)', function: 'Double track, street running, 2.1 miles' },
  { name: 'Track segment A2: Harbor to Northgate (sample)', site_kind: 'track_segment', built_year: 2010, cls: 'Track segment (sample)', function: 'Double track, reserved right of way, 3.4 miles' },
  { name: 'Track segment B1: Interchange to Eastfield (sample)', site_kind: 'track_segment', built_year: 1993, cls: 'Track segment (sample)', function: 'Single track with passing loops, 1.8 miles' },
  { name: 'Substation TPS-1 (sample)', site_kind: 'traction_power_substation', built_year: 1989, cls: 'Traction power substation (sample)', function: 'Feeds line A from the interchange to Harbor' },
  { name: 'Substation TPS-2 (sample)', site_kind: 'traction_power_substation', built_year: 2012, cls: 'Traction power substation (sample)', function: 'Feeds line A north of Harbor' },
];

const PROJECTS: { name: string; description: string; target: { table: string; type: TargetType; name: string } }[] = [
  { name: 'Depot North rebuild (sample)', description: 'Replace the bus garage at Depot North, which is past its useful life.', target: { table: 'sites', type: 'site', name: 'Example Depot North' } },
  { name: 'Central Interchange renewal (sample)', description: 'Renew the interchange concourse, platforms and canopies.', target: { table: 'sites', type: 'site', name: 'Example Central Interchange' } },
  { name: 'Track A1 renewal (sample)', description: 'Replace rail, ties and fastenings on track segment A1.', target: { table: 'sites', type: 'site', name: 'Track segment A1: Interchange to Harbor (sample)' } },
];

const METHODS = ['visual', 'inspection_report', 'measured', 'desktop_review'];
const NOTES: Record<string, string> = {
  '5': 'As new; no defects found (sample).',
  '4': 'Minor wear only (sample).',
  '3': 'Wear in line with age; plan the next overhaul (sample).',
  '2': 'Defects that need attention within the year (sample).',
  '1': 'Serious defects; replacement or major rehabilitation needed (sample).',
};

/** A rating that falls with age, with some spread: 5 when new, 1 to 2 when long past its life. */
function ratingFor(ageShare: number, i: number): string {
  const base = ageShare < 0.25 ? 5 : ageShare < 0.5 ? 4 : ageShare < 0.8 ? 3 : ageShare < 1.1 ? 2 : 1;
  const wobble = i % 5 === 0 ? -1 : i % 7 === 0 ? 1 : 0;
  return String(Math.min(5, Math.max(1, base + wobble)));
}

export async function seedCondition(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'skipped: samples are for the dev profile only';
  if (!ctx.resources.get('asset_class') || !ctx.resources.get('site') || !ctx.resources.get('asset')) return 'skipped: the inventory or condition part is not available';
  followTargets(ctx); // the CLI may seed before the server's start-up hooks have run
  // Modules seed in name order, so inventory and fleet have not run yet: load their samples first (idempotent).
  if (ctx.resources.get('vehicle')) {
    const fleet = await import('../fleet/seed.ts');
    await fleet.seedFleet(ctx, opts);
  } else if (!(await ctx.db.one(`select 1 from sites where name = 'Example Depot North' and deleted_at is null`))) {
    await seedDevEstate(ctx);
    await seedSampleAssets(ctx, { link: true });
  }

  const classId = new Map<string, string>();
  let classes = 0;
  for (const { past, now, ...c } of CLASSES) {
    const { row, created } = await upsertByName(ctx, 'asset_class', 'asset_classes', { name: c.name }, { ...c, assessment_every_months: c.applies_to === 'vehicle' ? 12 : 24, description: `Invented benchmark for the sample data (sample).` });
    classId.set(c.name, row.id);
    if (created) classes += 1;
    const year = Number(day(0).slice(0, 4));
    for (const [y, pct, status] of [[year - 1, past, 'approved'], [year, now, c.applies_to === 'site' ? 'draft' : 'approved']] as const) {
      await ctx.db.query(
        `insert into condition_targets (class_id, year, target_pct, status, approved_on, approved_by_name, decision_ref)
         values ($1, $2, $3, $4, $5, $6, $7) on conflict (class_id, year) do nothing`,
        [row.id, y, pct, status, status === 'approved' ? `${y - 1}-12-15` : null, status === 'approved' ? 'Sample Board Chair' : null,
          status === 'approved' ? `Capital program decision ${y}-01 (sample)` : null]);
    }
  }

  // Sites: kind, year built and class (filled only where empty, so an edited site keeps its values).
  for (const s of SITES) {
    const { name, cls, ...rest } = s;
    await upsertByName(ctx, 'site', 'sites', { name }, { ...rest, asset_class_id: cls ? classId.get(cls) : null });
  }

  // Vehicles by mode, and the fareboxes (filled only where empty).
  const odometer = (n: number) => (n <= 1205 ? 505000 + n * 10 : n <= 1216 ? 330000 + (n % 9) * 6000 : 120000 + (n % 11) * 5000);
  if (ctx.resources.get('vehicle')) {
    for (const v of await ctx.db.query<Row>(`select id, fleet_number, mode, asset_class_id, odometer_miles from vehicles where deleted_at is null and fleet_number ~ '^(1[0-9]{3}|T0[0-9])$'`)) {
      const cls = v.mode === 'bus' ? classId.get('40-foot bus (sample)') : v.mode === 'light_rail' ? classId.get('Light rail vehicle (sample)') : undefined;
      const patch: Row = {};
      if (!v.asset_class_id && cls) patch.asset_class_id = cls;
      if (v.odometer_miles === null && v.mode === 'bus') patch.odometer_miles = odometer(Number(v.fleet_number));
      if (v.odometer_miles === null && v.mode === 'light_rail') patch.odometer_miles = 610000 + Number(String(v.fleet_number).slice(1)) * 4000;
      if (Object.keys(patch).length) await ctx.resources.update('vehicle', v.id, patch);
    }
  }
  const farebox = classId.get('Farebox (sample)');
  for (const a of await ctx.db.query<Row>(`select id, name, asset_class_id, in_service_date from assets where deleted_at is null and asset_type = 'farebox' and name like '[Sample]%'`)) {
    const patch: Row = {};
    if (!a.asset_class_id && farebox) patch.asset_class_id = farebox;
    // Some fareboxes were moved over from older buses: they have been in service longer.
    const n = Number(/Bus (\d+)/.exec(String(a.name))?.[1] ?? 0);
    if (!a.in_service_date && n >= 1201 && n <= 1206) patch.in_service_date = day(-3900 + n % 7 * 20);
    if (Object.keys(patch).length) await ctx.resources.update('asset', a.id, patch);
  }

  // Replacement projects, when the projects part is there.
  let projects = 0;
  if (ctx.resources.get('project')) {
    for (const p of PROJECTS) {
      const { row, created } = await upsertByName(ctx, 'project', 'projects', { name: p.name }, { description: p.description });
      if (created) projects += 1;
      const target = await ctx.db.one<Row>(`select id, replacement_project_id from ${p.target.table} where lower(name) = lower($1) and deleted_at is null`, [p.target.name]);
      if (target && !target.replacement_project_id) await ctx.resources.update(p.target.type, target.id, { replacement_project_id: row.id });
    }
  }

  // An assessment for each classed record that has none yet.
  await recompute(ctx);
  let assessments = 0;
  let i = 0;
  for (const type of ['vehicle', 'site', 'asset'] as TargetType[]) {
    if (!ctx.resources.get(type)) continue;
    const info = TARGETS[type];
    const rows = await ctx.db.query<Row>(
      `select t.id, ${info.base} as base, t.useful_life_end::text as useful_life_end from ${info.table} t
       where t.deleted_at is null and t.asset_class_id is not null
         and not exists (select 1 from condition_assessments c where c.target_type = $1 and c.target_id = t.id and c.deleted_at is null)
       order by ${info.label}`, [type]);
    for (const r of rows) {
      i += 1;
      const today = day(0);
      const life = r.base && r.useful_life_end ? Date.parse(r.useful_life_end) - Date.parse(r.base) : null;
      const share = life && life > 0 ? (Date.parse(today) - Date.parse(r.base)) / life : 0.5;
      const rating = ratingFor(share, i);
      // Most within the last year; every ninth one older, so some are due again soon or overdue.
      const ago = i % 9 === 0 ? 700 + (i % 4) * 30 : 20 + ((i * 37) % 330);
      await ctx.resources.create('condition_assessment', {
        target_type: type, target_id: r.id, assessed_on: day(-ago), rating, method: METHODS[i % METHODS.length],
        assessor_name: i % 2 ? 'Sample Asset Inspector' : 'Sample Facilities Engineer', notes: NOTES[rating],
      });
      assessments += 1;
    }
  }
  return `asset classes ${CLASSES.length} (${classes} new), condition assessments ${assessments} new, replacement projects ${projects} new`;
}
