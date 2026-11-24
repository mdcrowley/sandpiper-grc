import type { ModuleContext, Row, SeedOptions } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { renameSamples, type SampleRename } from '../inventory/seed-rename.ts';
import { seedDevEstate } from '../inventory/seed-sample.ts';

/**
 * Invented OT samples (dev profile only, E33-06): five zones (two below target, one restricted), six
 * conduits (two with remote access), four OT systems and two OT assets. Every name starts with "[Sample]".
 * Idempotent: records are found by name, and links point only at records that exist.
 */

const ZONES: Row[] = [
  { name: '[Sample] Train control zone', site: 'Example Operations Control Center', criticality: 'tier_1', target_level: 'level_3', achieved_level: 'level_2', assessed: -60, restricted: true,
    description: 'Signaling supervision and the train control servers in the control center equipment room.' },
  { name: '[Sample] Traction power supervisory zone', site: 'Example Rail Yard', criticality: 'tier_1', target_level: 'level_3', achieved_level: 'level_3', assessed: -120,
    description: 'Supervision of the traction power substations and their field controllers.' },
  { name: '[Sample] Station systems zone', site: 'Example Central Interchange', criticality: 'tier_2', target_level: 'level_2', achieved_level: 'level_2', assessed: -200,
    description: 'Public address, passenger information and the radio core at stations.' },
  { name: '[Sample] Fare collection back office zone', site: 'Example Head Office', criticality: 'tier_2', target_level: 'level_2', achieved_level: null,
    description: 'The fare back office servers and the links to fare equipment. Not assessed yet.' },
  { name: '[Sample] Maintenance shop network zone', site: 'Example Depot North', criticality: 'tier_3', target_level: 'level_1', achieved_level: 'level_2', assessed: -30,
    description: 'Engineering laptops and diagnostic tools used in the maintenance shop.' },
];

const SYSTEMS: Row[] = [
  { name: '[Sample] Signaling supervisory system', zone: '[Sample] Train control zone', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Shows train positions and signal states to controllers and records events.', hosting_type: 'on_premises', rto_hours: 1, control_level: 'level_2', safety_related: true,
    vendor_remote_access: 'supervised', remote_access_path: 'Vendor session opened by the control center on request, recorded', patchability: 'vendor_approved', field_location: 'Control center equipment room' },
  { name: '[Sample] Traction power supervisory system', zone: '[Sample] Traction power supervisory zone', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Supervises the traction power substations: breakers, alarms and load.', hosting_type: 'on_premises', rto_hours: 2, control_level: 'level_2', safety_related: true,
    vendor_remote_access: 'always_connected', remote_access_path: 'Vendor support link through a dedicated router', patchability: 'outage_only', field_location: 'Rail yard substation building' },
  { name: '[Sample] Fare collection back office', zone: '[Sample] Fare collection back office zone', system_group: 'Passengers and fares', criticality_tier: 'tier_2',
    function: 'Collects transactions from fare equipment and sends fare tables and lists back to it.', hosting_type: 'on_premises', rto_hours: 8, control_level: 'level_3', safety_related: false,
    vendor_remote_access: 'managed_gateway', remote_access_path: 'Managed remote access gateway with second factor', patchability: 'routine', field_location: 'Head office server room' },
  { name: '[Sample] Radio core', zone: '[Sample] Station systems zone', system_group: 'Service operations', criticality_tier: 'tier_1',
    function: 'Radio switching core for voice and data between control, vehicles and stations.', hosting_type: 'on_premises', rto_hours: 1, control_level: 'level_3', safety_related: true,
    vendor_remote_access: 'none', patchability: 'cannot_patch', field_location: 'Interchange communications room' },
];

const ASSETS: Row[] = [
  { name: '[Sample] Substation field controller', zone: '[Sample] Traction power supervisory zone', site: 'Example Rail Yard', asset_type: 'other', status: 'in_use',
    make: 'Example Controls', model: 'FC-10', serial: 'SAMPLE-OT-001', control_level: 'level_1', safety_related: true, firmware_version: '4.2.1', system: '[Sample] Traction power supervisory system' },
  { name: '[Sample] Station public address controller', zone: '[Sample] Station systems zone', site: 'Example Central Interchange', asset_type: 'other', status: 'in_use',
    make: 'Example Controls', model: 'PA-2', serial: 'SAMPLE-OT-002', control_level: 'level_1', safety_related: false, firmware_version: '2.0.7' },
];

const CONDUITS: [string, string, string, Row][] = [
  ['[Sample] Train control to station systems', '[Sample] Train control zone', '[Sample] Station systems zone',
    { protocols: 'Signaling data over a private network', protections: 'Firewall between the zones; only the train position feed is allowed out', target_level: 'level_3', achieved_level: 'level_2' }],
  ['[Sample] Traction power to train control', '[Sample] Traction power supervisory zone', '[Sample] Train control zone',
    { protocols: 'Supervisory telemetry', protections: 'One-way data diode for alarms toward train control', target_level: 'level_3', achieved_level: 'level_3' }],
  ['[Sample] Fare back office to station systems', '[Sample] Fare collection back office zone', '[Sample] Station systems zone',
    { protocols: 'Encrypted file transfer to fare equipment', protections: 'Firewall; transfers start from the back office only', target_level: 'level_2', achieved_level: 'level_2' }],
  ['[Sample] Maintenance shop to traction power', '[Sample] Maintenance shop network zone', '[Sample] Traction power supervisory zone',
    { protocols: 'Engineering tools', protections: 'Jump host with recorded sessions; vendor support link through it', remote_access: true, target_level: 'level_3', achieved_level: 'level_2' }],
  ['[Sample] Station systems to maintenance shop', '[Sample] Station systems zone', '[Sample] Maintenance shop network zone',
    { protocols: 'Device management', protections: 'Firewall; management traffic only', target_level: 'level_2', achieved_level: 'level_2' }],
  ['[Sample] Fare back office to maintenance shop', '[Sample] Fare collection back office zone', '[Sample] Maintenance shop network zone',
    { protocols: 'Remote support', protections: 'Managed remote access gateway with second factor', remote_access: true, target_level: 'level_2' }],
];

/** Names of an earlier version ("X (sample)"), renamed in place (E18-65). */
export const OT_RENAMES: SampleRename[] = [
  { type: 'ot_zone', names: ZONES.map((z) => z.name) },
  { type: 'system', names: SYSTEMS.map((x) => x.name) },
  { type: 'asset', names: ASSETS.map((a) => a.name) },
  { type: 'ot_conduit', names: CONDUITS.map(([name]) => name) },
];

export async function seedOt(ctx: ModuleContext, opts: SeedOptions): Promise<string> {
  if (opts.profile !== 'dev') return 'skipped: OT samples are for the dev profile only';
  if (!ctx.resources.get('system') || !ctx.resources.get('ot_zone')) return 'skipped: the inventory or OT module is not loaded';
  await renameSamples(ctx, OT_RENAMES);
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
      zone_id: zones.get('[Sample] Train control zone') ?? null,
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
