import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';

/**
 * Invented OT samples (dev profile only, E33-06): five zones (two below target, one restricted), six
 * conduits (two with remote access), four OT systems and two OT assets. Every name ends in "(sample)".
 * Idempotent: records are found by name, and links point only at records that exist.
 */

const ZONES: Row[] = [
  { name: 'Train control zone (sample)', site: 'Example Operations Control Center', criticality: 'tier_1', target_level: 'level_3', achieved_level: 'level_2', assessed: -60, restricted: true,
    description: 'Signaling supervision and the train control servers in the control center equipment room.' },
  { name: 'Traction power supervisory zone (sample)', site: 'Example Rail Yard', criticality: 'tier_1', target_level: 'level_3', achieved_level: 'level_3', assessed: -120,
    description: 'Supervision of the traction power substations and their field controllers.' },
  { name: 'Station systems zone (sample)', site: 'Example Central Interchange', criticality: 'tier_2', target_level: 'level_2', achieved_level: 'level_2', assessed: -200,
    description: 'Public address, passenger information and the radio core at stations.' },
  { name: 'Fare collection back office zone (sample)', site: 'Example Head Office', criticality: 'tier_2', target_level: 'level_2', achieved_level: null,
    description: 'The fare back office servers and the links to fare equipment. Not assessed yet.' },
  { name: 'Maintenance shop network zone (sample)', site: 'Example Depot North', criticality: 'tier_3', target_level: 'level_1', achieved_level: 'level_2', assessed: -30,
    description: 'Engineering laptops and diagnostic tools used in the maintenance shop.' },
];

const SYSTEMS: Row[] = [
  { name: 'Signaling supervisory system (sample)', zone: 'Train control zone (sample)', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Shows train positions and signal states to controllers and records events.', hosting_type: 'on_premises', rto_hours: 1, control_level: 'level_2', safety_related: true,
    vendor_remote_access: 'supervised', remote_access_path: 'Vendor session opened by the control center on request, recorded', patchability: 'vendor_approved', field_location: 'Control center equipment room' },
  { name: 'Traction power supervisory system (sample)', zone: 'Traction power supervisory zone (sample)', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Supervises the traction power substations: breakers, alarms and load.', hosting_type: 'on_premises', rto_hours: 2, control_level: 'level_2', safety_related: true,
    vendor_remote_access: 'always_connected', remote_access_path: 'Vendor support link through a dedicated router', patchability: 'outage_only', field_location: 'Rail yard substation building' },
  { name: 'Fare collection back office (sample)', zone: 'Fare collection back office zone (sample)', system_group: 'Passengers and fares', criticality_tier: 'tier_2',
    function: 'Collects transactions from fare equipment and sends fare tables and lists back to it.', hosting_type: 'on_premises', rto_hours: 8, control_level: 'level_3', safety_related: false,
    vendor_remote_access: 'managed_gateway', remote_access_path: 'Managed remote access gateway with second factor', patchability: 'routine', field_location: 'Head office server room' },
  { name: 'Radio core (sample)', zone: 'Station systems zone (sample)', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Radio switching core for voice and data between control, vehicles and stations.', hosting_type: 'on_premises', rto_hours: 1, control_level: 'level_3', safety_related: true,
    vendor_remote_access: 'none', patchability: 'cannot_patch', field_location: 'Interchange communications room' },
];

const ASSETS: Row[] = [
  { name: 'Substation field controller (sample)', zone: 'Traction power supervisory zone (sample)', site: 'Example Rail Yard', asset_type: 'other', status: 'in_use',
    make: 'Example Controls', model: 'FC-10', serial: 'SAMPLE-OT-001', control_level: 'level_1', safety_related: true, firmware_version: '4.2.1', system: 'Traction power supervisory system (sample)' },
  { name: 'Station public address controller (sample)', zone: 'Station systems zone (sample)', site: 'Example Central Interchange', asset_type: 'other', status: 'in_use',
    make: 'Example Controls', model: 'PA-2', serial: 'SAMPLE-OT-002', control_level: 'level_1', safety_related: false, firmware_version: '2.0.7' },
];

const CONDUITS: [string, string, string, Row][] = [
  ['Train control to station systems (sample)', 'Train control zone (sample)', 'Station systems zone (sample)',
    { protocols: 'Signaling data over a private network', protections: 'Firewall between the zones; only the train position feed is allowed out', target_level: 'level_3', achieved_level: 'level_2' }],
  ['Traction power to train control (sample)', 'Traction power supervisory zone (sample)', 'Train control zone (sample)',
    { protocols: 'Supervisory telemetry', protections: 'One-way data diode for alarms toward train control', target_level: 'level_3', achieved_level: 'level_3' }],
  ['Fare back office to station systems (sample)', 'Fare collection back office zone (sample)', 'Station systems zone (sample)',
    { protocols: 'Encrypted file transfer to fare equipment', protections: 'Firewall; transfers start from the back office only', target_level: 'level_2', achieved_level: 'level_2' }],
  ['Maintenance shop to traction power (sample)', 'Maintenance shop network zone (sample)', 'Traction power supervisory zone (sample)',
    { protocols: 'Engineering tools', protections: 'Jump host with recorded sessions; vendor support link through it', remote_access: true, target_level: 'level_3', achieved_level: 'level_2' }],
  ['Station systems to maintenance shop (sample)', 'Station systems zone (sample)', 'Maintenance shop network zone (sample)',
    { protocols: 'Device management', protections: 'Firewall; management traffic only', target_level: 'level_2', achieved_level: 'level_2' }],
  ['Fare back office to maintenance shop (sample)', 'Fare collection back office zone (sample)', 'Maintenance shop network zone (sample)',
    { protocols: 'Remote support', protections: 'Managed remote access gateway with second factor', remote_access: true, target_level: 'level_2' }],
];

export async function seedOt(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'skipped: OT samples are for the dev profile only';
  if (!ctx.resources.get('system') || !ctx.resources.get('ot_zone')) return 'skipped: the inventory or OT module is not loaded';
  if (!(await ctx.db.one(`select 1 from sites where name = 'Example Head Office' and deleted_at is null`))) await seedDevEstate(ctx);

  const idOf = async (table: string, name: string) =>
    (await ctx.db.one<{ id: string }>(`select id from ${table} where lower(name) = lower($1) and deleted_at is null`, [name]))?.id ?? null;
  let made = 0;

  const zones = new Map<string, string>();
  for (const { name, site, assessed, ...z } of ZONES) {
    let id = await idOf('ot_zones', name);
    if (!id) {
      id = (await ctx.resources.create('ot_zone', {
        ...z, name, site_id: await idOf('sites', site),
        level_assessed_on: z.achieved_level ? dayInZone(Number(assessed ?? 0)) : null,
      })).id;
      made++;
    }
    zones.set(name, id!);
  }

  for (const { zone, ...s } of SYSTEMS) {
    if (await idOf('systems', s.name)) continue;
    await ctx.resources.create('system', { ...s, ot_system: true, status: 'in_use', zone_id: zones.get(zone) ?? null });
    made++;
  }
  // The generated estate's signaling interface is OT too.
  const signaling = await ctx.db.one<Row>(`select id, ot_system from systems where name = 'Example Rail Signaling Interface' and deleted_at is null`);
  if (signaling && !signaling.ot_system) {
    await ctx.resources.update('system', signaling.id, {
      ot_system: true, control_level: 'level_2', safety_related: true, vendor_remote_access: 'not_known', patchability: 'not_known',
      zone_id: zones.get('Train control zone (sample)') ?? null,
    });
  }

  if (ctx.resources.get('asset')) {
    for (const { zone, site, system, ...a } of ASSETS) {
      if (await idOf('assets', a.name)) continue;
      await ctx.resources.create('asset', {
        ...a, ot_asset: true, zone_id: zones.get(zone) ?? null, site_id: await idOf('sites', site),
        system_id: system ? await idOf('systems', system) : null,
      });
      made++;
    }
  }

  for (const [name, from, to, c] of CONDUITS) {
    if (await idOf('ot_conduits', name)) continue;
    await ctx.resources.create('ot_conduit', { ...c, name, from_zone_id: zones.get(from), to_zone_id: zones.get(to) });
    made++;
  }
  return `zones ${ZONES.length}, conduits ${CONDUITS.length}, OT systems ${SYSTEMS.length}, OT assets ${ASSETS.length} (${made} new)`;
}
