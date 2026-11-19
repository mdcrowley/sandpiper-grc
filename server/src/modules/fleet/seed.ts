import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { upsertByName } from '../inventory/seed.ts';
import { seedDevEstate, seedSampleAssets } from '../inventory/seed-sample.ts';

/**
 * Dev profile only: an invented mixed fleet (40 buses at two depots, 8 light-rail vehicles at
 * the rail yard), the equipment on each vehicle drawn from the inventory's sample systems, a
 * dozen services and the systems they depend on. A few gaps are left on purpose so the
 * coverage view has something to show. Safe to run again: everything is matched by name.
 */

const dayOffset = (days: number) => dayInZone(days);

/** Asset name suffix, system and cost for each kind of on-vehicle equipment. */
const KIT: Record<string, { name: string; system: string; make: string; model: string; cost: number; funding: string }> = {
  onboard_computer: { name: 'onboard computer', system: 'Example CAD/AVL System', make: 'Wayline', model: 'OBC-5', cost: 4200, funding: 'grant' },
  cad_avl_unit: { name: 'CAD/AVL unit', system: 'Example CAD/AVL System', make: 'Wayline', model: 'LOC-3', cost: 1800, funding: 'grant' },
  farebox: { name: 'farebox', system: 'Example Onboard Fare Equipment', make: 'Coinway', model: 'FB-9', cost: 6500, funding: 'mixed' },
  validator: { name: 'card validator', system: 'Example Onboard Fare Equipment', make: 'Coinway', model: 'V-Tap', cost: 950, funding: 'mixed' },
  vehicle_router: { name: 'on-vehicle router', system: 'Example Depot Wireless', make: 'Roadlink', model: 'MX2', cost: 1100, funding: 'capital' },
  camera: { name: 'camera recorder', system: 'Example Onboard Video System', make: 'Clearsight', model: 'MVR4', cost: 2300, funding: 'grant' },
  radio: { name: 'radio', system: 'Example Radio Dispatch System', make: 'Talkwave', model: 'MR-40', cost: 1600, funding: 'capital' },
  passenger_info_display: { name: 'passenger information display', system: 'Example Onboard Information Displays', make: 'Signway', model: 'PID-24', cost: 2700, funding: 'grant' },
};
const BUS_KIT = ['onboard_computer', 'cad_avl_unit', 'farebox', 'validator', 'vehicle_router', 'camera', 'radio'];
const TRAM_KIT = ['cad_avl_unit', 'validator', 'camera', 'radio', 'passenger_info_display'];

/** Deliberate gaps: equipment never fitted, or fitted but in repair. */
const MISSING: Record<string, string[]> = { 1215: ['vehicle_router'], 1233: ['vehicle_router'], 1222: ['camera'], 1238: ['camera', 'validator'], T03: ['camera'] };
const IN_REPAIR: Record<string, string[]> = { 1209: ['camera'], 1227: ['validator'], 1236: ['cad_avl_unit'] };

const SERVICES: (Row & { depot: string; systems: [string, string][] })[] = [];
const BUS_DEPS: [string, string][] = [
  ['Example CAD/AVL System', 'cad_avl'], ['Example Onboard Fare Equipment', 'fare_collection'], ['Example Fare Collection System', 'fare_collection'],
  ['Example Real-Time Information System', 'passenger_information'], ['Example Scheduling System', 'scheduling'], ['Example Radio Dispatch System', 'radio'],
];
const RAIL_DEPS: [string, string][] = [
  ['Example Rail Signalling Interface', 'other'], ['Example Onboard Information Displays', 'passenger_information'],
  ['Example Real-Time Information System', 'passenger_information'], ['Example Fare Collection System', 'fare_collection'],
  ['Example Scheduling System', 'scheduling'], ['Example Radio Dispatch System', 'radio'],
];
for (const [route_code, name, depot, service_type, description] of [
  ['1', 'Harbour - Northgate', 'Example Depot North', 'fixed_route', 'Frequent cross-town route every 10 minutes in the day.'],
  ['2', 'Riverside Loop', 'Example Depot North', 'fixed_route', 'Circular route in both directions.'],
  ['4', 'College - Hospital', 'Example Depot North', 'fixed_route', 'Links the college campus with the hospital.'],
  ['7', 'Eastfield - City Center', 'Example Depot South', 'fixed_route', 'Radial route from the eastern estates.'],
  ['12', 'Airport Link', 'Example Depot South', 'fixed_route', 'Limited stops between the interchange and the airport.'],
  ['15', 'Westmoor - Central Interchange', 'Example Depot South', 'fixed_route', 'Radial route from the western suburbs.'],
  ['30', 'Night Bus', 'Example Depot North', 'fixed_route', 'Overnight service on the busiest corridors.'],
  ['X1', 'Northgate Express', 'Example Depot North', 'express', 'Peak-hour express with few stops.'],
  ['X5', 'Southbank Express', 'Example Depot South', 'express', 'Peak-hour express with few stops.'],
] as const) {
  SERVICES.push({ route_code, name, mode: 'bus', service_type, depot, description, systems: BUS_DEPS });
}
SERVICES.push({
  route_code: 'DR', name: 'Dial-a-Ride', mode: 'paratransit', service_type: 'demand_responsive', depot: 'Example Depot South',
  description: 'Booked door-to-door trips for people who cannot use the fixed routes.',
  systems: [['Example CAD/AVL System', 'cad_avl'], ['Example Scheduling System', 'scheduling'], ['Example Radio Dispatch System', 'radio']],
});
SERVICES.push({ route_code: 'LR-A', name: 'Light Rail Line A', mode: 'light_rail', service_type: 'rail_line', depot: 'Example Rail Yard', description: 'Interchange to the northern terminus.', systems: RAIL_DEPS });
SERVICES.push({ route_code: 'LR-B', name: 'Light Rail Line B', mode: 'light_rail', service_type: 'rail_line', depot: 'Example Rail Yard', description: 'Interchange to the harbour.', systems: RAIL_DEPS });

function vehicles(): (Row & { depot: string; label: string; kit: string[] })[] {
  const out: (Row & { depot: string; label: string; kit: string[] })[] = [];
  for (let n = 1201; n <= 1240; n++) {
    const older = n <= 1216;
    const status = n === 1236 ? 'out_of_service' : [1209, 1227].includes(n) ? 'in_maintenance' : [1219, 1240].includes(n) ? 'spare' : 'in_service';
    out.push({
      fleet_number: String(n), mode: 'bus', status, make: 'Example Coachworks', model: older ? 'Citystrider 12' : 'Citystrider 12E',
      model_year: older ? 2016 + (n % 3) : 2021 + (n % 3), registration: `EX${n}`, capacity: older ? 78 : 82,
      in_service_date: dayOffset(older ? -2600 + (n % 7) * 30 : -1300 + (n % 7) * 30),
      funding_source: older ? 'capital' : 'grant', funder_interest: !older, funder_interest_pct: older ? null : 80,
      depot: n <= 1220 ? 'Example Depot North' : 'Example Depot South', label: `Bus ${n}`, kit: BUS_KIT,
    });
  }
  for (let n = 1; n <= 8; n++) {
    const code = `T0${n}`;
    out.push({
      fleet_number: code, mode: 'light_rail', status: n === 7 ? 'in_maintenance' : 'in_service', make: 'Example Railcar Works', model: 'LRV-30',
      model_year: 2014, registration: `LRV-${n}`, capacity: 210, in_service_date: dayOffset(-3900), funding_source: 'grant',
      funder_interest: true, funder_interest_pct: 80, depot: 'Example Rail Yard', label: `Tram 0${n}`, kit: TRAM_KIT,
    });
  }
  return out;
}

export async function seedFleet(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'nothing to load (sample fleet is dev profile only)';
  if (!ctx.resources.get('asset') || !ctx.resources.get('site')) return 'skipped: the inventory module is not loaded';
  // Modules seed in name order, so inventory has not run yet: load its sample estate first (idempotent).
  if (!(await ctx.db.one(`select 1 from sites where name = 'Example Depot North' and deleted_at is null`))) {
    await seedDevEstate(ctx);
    await seedSampleAssets(ctx, { link: true });
  }
  const idOf = async (table: string, name: string) =>
    (await ctx.db.one<{ id: string }>(`select id from ${table} where lower(name) = lower($1) and deleted_at is null`, [name]))?.id ?? null;

  let made = 0;
  let fitted = 0;
  for (const { depot, label, kit, ...v } of vehicles()) {
    const depotId = await idOf('sites', depot);
    const found = await ctx.db.one<Row>('select * from vehicles where lower(fleet_number) = lower($1) and deleted_at is null', [v.fleet_number]);
    const vehicle = found ?? await ctx.resources.create('vehicle', { ...v, depot_id: depotId });
    if (!found) made++;
    for (const type of kit) {
      if ((MISSING[v.fleet_number] ?? []).includes(type)) continue;
      const k = KIT[type];
      const broken = (IN_REPAIR[v.fleet_number] ?? []).includes(type);
      const { row: asset } = await upsertByName(ctx, 'asset', 'assets',
        { name: `[Sample] ${label} ${k.name}`, asset_type: type, make: k.make, model: k.model },
        {
          serial: `SAMPLE-FL-${v.fleet_number}-${type.slice(0, 3).toUpperCase()}`, status: broken ? 'in_repair' : 'in_use',
          department: type === 'camera' ? 'Security' : ['farebox', 'validator'].includes(type) ? 'Revenue' : 'Operations',
          location: label, cost: k.cost, funding_source: k.funding, funder_interest: k.funding !== 'capital', funder_interest_pct: k.funding === 'grant' ? 80 : k.funding === 'mixed' ? 50 : null,
          purchase_date: v.in_service_date, site_id: depotId, system_id: await idOf('systems', k.system),
        });
      const installed = await ctx.db.one('select 1 from vehicle_equipment where asset_id = $1', [asset.id]);
      if (!installed) {
        await ctx.db.query('insert into vehicle_equipment (vehicle_id, asset_id, installed_on, install_notes) values ($1,$2,$3,$4)',
          [vehicle.id, asset.id, v.in_service_date, 'Fitted when the vehicle entered service (sample).']);
        fitted++;
      }
    }
  }
  // One piece of history: bus 1203's first router was replaced.
  const old = await upsertByName(ctx, 'asset', 'assets', { name: '[Sample] Bus 1203 first on-vehicle router', asset_type: 'vehicle_router', make: 'Roadlink', model: 'MX1' },
    { serial: 'SAMPLE-FL-1203-OLD', status: 'retired', department: 'IT', cost: 900, funding_source: 'capital', system_id: await idOf('systems', KIT.vehicle_router.system) });
  const bus1203 = await ctx.db.one<Row>(`select id from vehicles where fleet_number = '1203' and deleted_at is null`);
  if (bus1203 && !(await ctx.db.one('select 1 from vehicle_equipment where asset_id = $1', [old.row.id]))) {
    await ctx.db.query(
      `insert into vehicle_equipment (vehicle_id, asset_id, installed_on, install_notes, removed_on, removal_reason, removed_at)
       values ($1,$2,$3,$4,$5,$6, now())`,
      [bus1203.id, old.row.id, dayOffset(-2500), 'Fitted when the vehicle entered service (sample).', dayOffset(-400), 'Replaced with a newer model (sample).']);
  }

  let services = 0;
  for (const { depot, systems, ...s } of SERVICES) {
    const found = await ctx.db.one<Row>('select * from services where lower(route_code) = lower($1) and deleted_at is null', [s.route_code]);
    const service = found ?? await ctx.resources.create('service', { ...s, depot_id: await idOf('sites', depot) });
    if (!found) services++;
    for (const [system, dependency] of systems) {
      const systemId = await idOf('systems', system);
      if (systemId) {
        await ctx.db.query('insert into service_systems (service_id, system_id, dependency) values ($1,$2,$3) on conflict do nothing', [service.id, systemId, dependency]);
      }
    }
  }
  return `vehicles ${vehicles().length} (${made} new), equipment installations ${fitted} new, services ${SERVICES.length} (${services} new)`;
}
