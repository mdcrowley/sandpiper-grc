import type { ModuleContext, Row } from '../../core/module.ts';
import { dayInZone } from '../../core/timezone.ts';
import { upsertByName } from './seed.ts';

/** Invented data only: the `dev` estate and the "[Sample]" assets added in every profile. */

/** A date `days` from today, in the organisation's time zone. */
const dayOffset = (days: number): string => dayInZone(days);

// An invented bus and light-rail operator. Every name, place and vendor is made up.
const DEV_SITES: Row[] = [
  { name: 'Example Head Office', address: '1 Example Street', function: 'Administration, finance and customer service', power_protection: 'Generator and battery backup', physical_security: 'Badge access, cameras', network_links: 'Two fibre links' },
  { name: 'Example Operations Control Centre', address: '5 Example Street', function: 'Service control, radio dispatch and incident handling around the clock', power_protection: 'Generator, battery backup and a second supply', physical_security: 'Badge access, staffed at all times', network_links: 'Two fibre links on separate routes, radio backhaul' },
  { name: 'Example Depot North', address: '20 Sample Road', function: 'Bus garage: vehicle parking, fuelling, cleaning and maintenance', power_protection: 'Battery backup for the network room', physical_security: 'Fenced yard, gate barrier, cameras', network_links: 'One fibre link, cellular backup; yard wireless for vehicle uploads', third_parties: 'Fuel delivery contractor' },
  { name: 'Example Depot South', address: '80 Sample Road', function: 'Bus garage and stores warehouse', power_protection: 'Battery backup only', physical_security: 'Fenced yard, gate code', network_links: 'One fibre link; yard wireless for vehicle uploads' },
  { name: 'Example Rail Yard', address: '2 Demo Lane', function: 'Light-rail vehicle stabling and maintenance', power_protection: 'Generator', physical_security: 'Fenced, patrolled at night', network_links: 'Fibre link, trackside radio' },
  { name: 'Example Central Interchange', address: '300 Demo Avenue', function: 'Passenger interchange with a travel centre and ticket office', third_parties: 'Retail tenants, cleaning contractor', network_links: 'One fibre link, cellular backup' },
];

const DEV_CATEGORIES: Row[] = [
  { name: 'Staff payroll details', contains: 'Pay, bank and tax details', custodian: 'Finance manager', retention_period: '7 years', sensitivity_level: 'restricted' },
  { name: 'Customer account details', contains: 'Names, contact details and travel card registrations', custodian: 'Customer service manager', retention_period: '3 years', sensitivity_level: 'confidential' },
  { name: 'Fare card transactions', contains: 'Taps, top-ups and journeys by card number', custodian: 'Revenue manager', retention_period: '2 years', sensitivity_level: 'confidential' },
  { name: 'Vehicle location history', contains: 'Where each vehicle was, and when, from the location units', custodian: 'Head of operations', retention_period: '13 months', sensitivity_level: 'internal' },
  { name: 'Onboard and station video', contains: 'Recordings from vehicle and station cameras', custodian: 'Security manager', retention_period: '31 days unless kept for an incident', sensitivity_level: 'confidential' },
  { name: 'Driver and operator records', contains: 'Licences, training, duty hours and medical fitness', custodian: 'HR manager', retention_period: '6 years after leaving', sensitivity_level: 'restricted' },
  { name: 'Safety incident reports', contains: 'Collisions, passenger injuries and near misses', custodian: 'Safety manager', retention_period: '10 years', sensitivity_level: 'confidential' },
  { name: 'Published service information', contains: 'Timetables, routes, fares and disruption notices', custodian: 'Communications manager', retention_period: 'Until replaced', sensitivity_level: 'public' },
];

const DEV_SYSTEMS: Row[] = [
  // Service operations
  { name: 'Example CAD/AVL System', system_group: 'Service operations', vendor_name: 'Northfold Transit Software', function: 'Computer-aided dispatch and automatic vehicle location for the bus fleet', users: 'Controllers, dispatchers', hosting_type: 'on_premises', criticality_tier: 'tier_1', rto_hours: 2, rpo_hours: 0.25, mfa_status: 'enforced', manual_fallback: 'Radio voice dispatch and paper running boards' },
  { name: 'Example Scheduling System', system_group: 'Service operations', vendor_name: 'Northfold Transit Software', function: 'Timetables, vehicle blocks and runcutting', users: 'Planners', hosting_type: 'on_premises', criticality_tier: 'tier_2', rto_hours: 24, rpo_hours: 24, mfa_status: 'none' },
  { name: 'Example Crew Rostering System', system_group: 'Service operations', vendor_name: 'Northfold Transit Software', function: 'Duty rosters, sign-on and spare cover for drivers', users: 'Depot supervisors, drivers', hosting_type: 'vendor_hosted', criticality_tier: 'tier_2', rto_hours: 12, rpo_hours: 4, mfa_status: 'optional' },
  { name: 'Example Operations System', system_group: 'Service operations', vendor_name: 'Northfold Transit Software', function: 'Service control log, disruption handling and daily service reports', users: 'Controllers', hosting_type: 'vendor_hosted', criticality_tier: 'tier_1', rto_hours: 4, rpo_hours: 1, mfa_status: 'enforced', manual_fallback: 'Paper control log' },
  { name: 'Example Radio Dispatch System', system_group: 'Service operations', vendor_name: 'Talkwave Communications', function: 'Voice and data radio between control, vehicles and depots', users: 'Controllers, drivers', hosting_type: 'on_premises', criticality_tier: 'tier_1', rto_hours: 1, mfa_status: 'not_applicable', manual_fallback: 'Mobile phones to depot supervisors' },
  { name: 'Example Rail Signalling Interface', system_group: 'Service operations', vendor_name: 'Trackmark Systems', function: 'Light-rail train positions shown to control', users: 'Controllers', hosting_type: 'on_premises', criticality_tier: 'tier_1', rto_hours: 2, mfa_status: 'not_applicable' },
  // Passengers and fares
  { name: 'Example Fare Collection System', system_group: 'Passengers and fares', vendor_name: 'Copperline Fare Systems', function: 'Fare rules, card accounts and back office for fareboxes and validators', users: 'Revenue team', hosting_type: 'vendor_hosted', criticality_tier: 'tier_1', rto_hours: 8, rpo_hours: 1, mfa_status: 'enforced' },
  { name: 'Example Onboard Fare Equipment', system_group: 'Passengers and fares', vendor_name: 'Copperline Fare Systems', function: 'Fareboxes and card validators on each vehicle', users: 'Drivers, passengers', hosting_type: 'on_vehicle', criticality_tier: 'tier_2', rto_hours: 24, mfa_status: 'not_applicable', manual_fallback: 'Paper tickets and cash fares' },
  { name: 'Example Payments System', system_group: 'Passengers and fares', vendor_name: 'Copperline Fare Systems', function: 'Card payments and settlement', users: 'Revenue team, travel centre', hosting_type: 'hybrid', criticality_tier: 'tier_2', rto_hours: 48, mfa_status: 'optional' },
  { name: 'Example Customer Portal', system_group: 'Passengers and fares', vendor_name: 'Copperline Fare Systems', function: 'Online travel card accounts and top-ups', users: 'Public', hosting_type: 'vendor_hosted', criticality_tier: 'tier_3', mfa_status: 'optional' },
  { name: 'Example Real-Time Information System', system_group: 'Passengers and fares', vendor_name: 'Bluebird Passenger Info', function: 'Predicted arrival times for stops, displays and the website', users: 'Public', hosting_type: 'cloud', hosting_provider: 'Example Cloud', criticality_tier: 'tier_2', rto_hours: 4, mfa_status: 'enforced' },
  { name: 'Example Onboard Information Displays', system_group: 'Passengers and fares', vendor_name: 'Bluebird Passenger Info', function: 'Next-stop announcements and screens inside vehicles', users: 'Passengers', hosting_type: 'on_vehicle', criticality_tier: 'tier_3', mfa_status: 'not_applicable' },
  { name: 'Example Public Website', system_group: 'Passengers and fares', vendor_name: 'Bluebird Web', function: 'Journey planner, timetables and disruption notices', users: 'Public', hosting_type: 'cloud', hosting_provider: 'Example Cloud', criticality_tier: 'tier_3', mfa_status: 'not_applicable' },
  // Fleet and assets
  { name: 'Example Fleet Maintenance System', system_group: 'Fleet and assets', vendor_name: 'Wrenchbook', function: 'Vehicle work orders, inspections, parts and defects', users: 'Engineers, stores', hosting_type: 'cloud', criticality_tier: 'tier_2', rto_hours: 24, rpo_hours: 24, mfa_status: 'enforced' },
  { name: 'Example Fuel Management System', system_group: 'Fleet and assets', vendor_name: 'Wrenchbook', function: 'Fuel and charging records by vehicle', users: 'Depot staff', hosting_type: 'on_premises', criticality_tier: 'tier_3', mfa_status: 'none' },
  { name: 'Example Onboard Video System', system_group: 'Fleet and assets', vendor_name: 'Lanternview Cameras', function: 'Vehicle cameras and the depot download service', users: 'Security team', hosting_type: 'on_vehicle', criticality_tier: 'tier_2', rto_hours: 48, mfa_status: 'none' },
  { name: 'Example Station Cameras', system_group: 'Fleet and assets', vendor_name: 'Lanternview Cameras', function: 'Interchange and depot camera recording', users: 'Security team', hosting_type: 'on_premises', criticality_tier: 'tier_3', mfa_status: 'none' },
  // Corporate
  { name: 'Example Finance System', system_group: 'Corporate', vendor_name: 'Ledgerworks', function: 'General ledger, purchasing and payroll', users: 'Finance', hosting_type: 'vendor_hosted', criticality_tier: 'tier_1', rto_hours: 24, rpo_hours: 4, mfa_status: 'none' },
  { name: 'Example Timekeeping System', system_group: 'Corporate', vendor_name: 'Ledgerworks', function: 'Clocking, leave and overtime', users: 'All staff', hosting_type: 'on_premises', criticality_tier: 'tier_3', mfa_status: 'unknown' },
  { name: 'Example HR System', system_group: 'Corporate', vendor_name: 'Ledgerworks', function: 'Staff records, licences and training', users: 'HR, depot managers', hosting_type: 'vendor_hosted', criticality_tier: 'tier_2', rto_hours: 48, mfa_status: 'optional' },
  { name: 'Example Safety Reporting System', system_group: 'Corporate', vendor_name: 'Fieldnote Safety', function: 'Incident, accident and near-miss reports', users: 'All staff', hosting_type: 'cloud', criticality_tier: 'tier_2', mfa_status: 'enforced' },
  // Infrastructure
  { name: 'Example Directory', system_group: 'Infrastructure', vendor_name: 'Not known', function: 'Sign-in and email', users: 'All staff', hosting_type: 'cloud', criticality_tier: 'tier_1', rto_hours: 8, rpo_hours: 1, mfa_status: 'enforced' },
  { name: 'Example Depot Wireless', system_group: 'Infrastructure', vendor_name: 'Roadlink Networks', function: 'Yard wireless that uploads data from vehicles when they return', users: 'Systems on vehicles', hosting_type: 'on_premises', criticality_tier: 'tier_2', mfa_status: 'not_applicable' },
  { name: 'Example Backup Service', system_group: 'Infrastructure', vendor_name: 'Example Cloud', function: 'Nightly copies of on-premises servers', users: 'IT', hosting_type: 'cloud', criticality_tier: 'tier_2', mfa_status: 'enforced' },
];

// [from, to, direction, method]
const DEV_INTEGRATIONS: [string, string, string, string][] = [
  ['Example Scheduling System', 'Example CAD/AVL System', 'one_way', 'file_transfer'],
  ['Example Scheduling System', 'Example Crew Rostering System', 'one_way', 'file_transfer'],
  ['Example Scheduling System', 'Example Real-Time Information System', 'one_way', 'data_feed'],
  ['Example Scheduling System', 'Example Public Website', 'one_way', 'data_feed'],
  ['Example CAD/AVL System', 'Example Real-Time Information System', 'one_way', 'data_feed'],
  ['Example CAD/AVL System', 'Example Operations System', 'one_way', 'api'],
  ['Example CAD/AVL System', 'Example Onboard Information Displays', 'one_way', 'data_feed'],
  ['Example Radio Dispatch System', 'Example CAD/AVL System', 'two_way', 'api'],
  ['Example Rail Signalling Interface', 'Example Operations System', 'one_way', 'data_feed'],
  ['Example Real-Time Information System', 'Example Public Website', 'one_way', 'api'],
  ['Example Onboard Fare Equipment', 'Example Fare Collection System', 'one_way', 'file_transfer'],
  ['Example Fare Collection System', 'Example Payments System', 'two_way', 'api'],
  ['Example Customer Portal', 'Example Fare Collection System', 'two_way', 'api'],
  ['Example Payments System', 'Example Finance System', 'one_way', 'file_transfer'],
  ['Example Crew Rostering System', 'Example Timekeeping System', 'one_way', 'file_transfer'],
  ['Example Timekeeping System', 'Example Finance System', 'one_way', 'database'],
  ['Example HR System', 'Example Crew Rostering System', 'one_way', 'api'],
  ['Example HR System', 'Example Finance System', 'one_way', 'file_transfer'],
  ['Example Fuel Management System', 'Example Fleet Maintenance System', 'one_way', 'file_transfer'],
  ['Example Operations System', 'Example Fleet Maintenance System', 'one_way', 'api'],
  ['Example Fleet Maintenance System', 'Example Finance System', 'one_way', 'file_transfer'],
  ['Example Depot Wireless', 'Example Onboard Video System', 'one_way', 'other'],
  ['Example Depot Wireless', 'Example Onboard Fare Equipment', 'one_way', 'other'],
  ['Example Operations System', 'Example Safety Reporting System', 'one_way', 'manual'],
  ['Example Directory', 'Example Finance System', 'one_way', 'single_sign_on'],
  ['Example Directory', 'Example Operations System', 'one_way', 'single_sign_on'],
  ['Example Directory', 'Example HR System', 'one_way', 'single_sign_on'],
  ['Example Directory', 'Example Fleet Maintenance System', 'one_way', 'single_sign_on'],
];
const DEV_DATA: [string, string][] = [
  ['Example Finance System', 'Staff payroll details'],
  ['Example Timekeeping System', 'Staff payroll details'],
  ['Example HR System', 'Driver and operator records'],
  ['Example Crew Rostering System', 'Driver and operator records'],
  ['Example Customer Portal', 'Customer account details'],
  ['Example Fare Collection System', 'Customer account details'],
  ['Example Fare Collection System', 'Fare card transactions'],
  ['Example Onboard Fare Equipment', 'Fare card transactions'],
  ['Example CAD/AVL System', 'Vehicle location history'],
  ['Example Onboard Video System', 'Onboard and station video'],
  ['Example Station Cameras', 'Onboard and station video'],
  ['Example Safety Reporting System', 'Safety incident reports'],
  ['Example Public Website', 'Published service information'],
  ['Example Scheduling System', 'Published service information'],
  ['Example Real-Time Information System', 'Published service information'],
];
const DEV_SERVES: [string, string][] = [
  ['Example CAD/AVL System', 'Example Operations Control Centre'],
  ['Example Radio Dispatch System', 'Example Operations Control Centre'],
  ['Example Operations System', 'Example Operations Control Centre'],
  ['Example Rail Signalling Interface', 'Example Operations Control Centre'],
  ['Example Crew Rostering System', 'Example Depot North'],
  ['Example Crew Rostering System', 'Example Depot South'],
  ['Example Fleet Maintenance System', 'Example Depot North'],
  ['Example Fleet Maintenance System', 'Example Depot South'],
  ['Example Fleet Maintenance System', 'Example Rail Yard'],
  ['Example Fuel Management System', 'Example Depot North'],
  ['Example Depot Wireless', 'Example Depot North'],
  ['Example Depot Wireless', 'Example Depot South'],
  ['Example Finance System', 'Example Head Office'],
  ['Example Payments System', 'Example Central Interchange'],
  ['Example Station Cameras', 'Example Central Interchange'],
  ['Example Real-Time Information System', 'Example Central Interchange'],
];

export async function seedDevEstate(ctx: ModuleContext): Promise<string> {
  const ids = new Map<string, string>();
  for (const s of DEV_SITES) ids.set(s.name, (await upsertByName(ctx, 'site', 'sites', s)).row.id);
  for (const c of DEV_CATEGORIES) ids.set(c.name, (await upsertByName(ctx, 'data_category', 'data_categories', c)).row.id);
  for (const s of DEV_SYSTEMS) ids.set(s.name, (await upsertByName(ctx, 'system', 'systems', s)).row.id);

  for (const [from, to, direction, method] of DEV_INTEGRATIONS) {
    const params = [ids.get(from), ids.get(to), direction, method];
    const there = await ctx.db.one('select 1 from system_integrations where from_system_id = $1 and to_system_id = $2', params.slice(0, 2));
    if (!there) await ctx.db.query('insert into system_integrations (from_system_id, to_system_id, direction, method) values ($1,$2,$3,$4)', params);
  }
  for (const [system, category] of DEV_DATA) {
    await ctx.db.query('insert into system_data_categories (system_id, data_category_id) values ($1,$2) on conflict do nothing', [ids.get(system), ids.get(category)]);
  }
  for (const [system, site] of DEV_SERVES) {
    await ctx.db.query('insert into system_sites (system_id, site_id) values ($1,$2) on conflict do nothing', [ids.get(system), ids.get(site)]);
  }
  return `systems ${DEV_SYSTEMS.length}, sites ${DEV_SITES.length}, data categories ${DEV_CATEGORIES.length} (generated), integrations ${DEV_INTEGRATIONS.length}`;
}

/** About 15 invented assets. `link` ties them to the generated sites and systems (dev profile only). */
export async function seedSampleAssets(ctx: ModuleContext, opts: { link: boolean }): Promise<string> {
  const approval = { disposal_approved_by: 'Sample Approver', disposal_approved_on: dayOffset(-40) };
  const samples: (Row & { site?: string; system?: string })[] = [
    { name: '[Sample] Front desk workstation 1', asset_type: 'workstation', make: 'Acme', model: 'Desk 700', serial: 'SAMPLE-WS-001', status: 'in_use', assigned_to_name: 'Sample Receptionist', department: 'Operations', cost: 1150, funding_source: 'operating', purchase_date: dayOffset(-900), warranty_end: dayOffset(45), support_end: dayOffset(700), os: 'Windows', os_version: '11', site: 'Example Head Office', system: 'Example Operations System' },
    { name: '[Sample] Front desk workstation 2', asset_type: 'workstation', make: 'Acme', model: 'Desk 700', serial: 'SAMPLE-WS-002', status: 'in_use', assigned_to_name: 'Sample Receptionist', department: 'Operations', cost: 1150, funding_source: 'operating', purchase_date: dayOffset(-900), warranty_end: dayOffset(75), support_end: dayOffset(700), os: 'Windows', os_version: '11', site: 'Example Head Office', system: 'Example Operations System' },
    { name: '[Sample] Finance laptop', asset_type: 'workstation', make: 'Acme', model: 'Book 14', serial: 'SAMPLE-LT-003', status: 'in_use', assigned_to_name: 'Sample Accountant', department: 'Finance', cost: 1400, funding_source: 'operating', purchase_date: dayOffset(-400), warranty_end: dayOffset(680), os: 'Windows', os_version: '11', site: 'Example Head Office' },
    { name: '[Sample] Spare laptop', asset_type: 'workstation', make: 'Acme', model: 'Book 14', serial: 'SAMPLE-LT-004', status: 'in_stock', cost: 1400, funding_source: 'operating', purchase_date: dayOffset(-200), warranty_end: dayOffset(880), site: 'Example Head Office' },
    { name: '[Sample] File server', asset_type: 'server', make: 'Borealis', model: 'R450', serial: 'SAMPLE-SV-005', status: 'in_use', department: 'IT', cost: 9800, funding_source: 'capital', purchase_date: dayOffset(-2600), support_end: dayOffset(-210), os: 'Windows Server', os_version: '2016', site: 'Example Head Office', system: 'Example Scheduling System' },
    { name: '[Sample] Core switch', asset_type: 'network_device', make: 'Borealis', model: 'S48', serial: 'SAMPLE-NW-006', status: 'in_use', department: 'IT', cost: 6200, funding_source: 'capital', purchase_date: dayOffset(-2900), support_end: dayOffset(-30), site: 'Example Head Office' },
    { name: '[Sample] Warehouse firewall', asset_type: 'network_device', make: 'Borealis', model: 'F60', serial: 'SAMPLE-NW-007', status: 'in_use', department: 'IT', cost: 2100, funding_source: 'capital', purchase_date: dayOffset(-500), support_end: dayOffset(590), site: 'Example Depot South' },
    { name: '[Sample] Branch router 1', asset_type: 'network_device', make: 'Roadlink', model: 'M5', serial: 'SAMPLE-RT-008', status: 'in_use', department: 'Operations', location: 'Comms cabinet', cost: 890, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1500), system: 'Example Operations System' },
    { name: '[Sample] Branch router 2', asset_type: 'network_device', make: 'Roadlink', model: 'M5', serial: 'SAMPLE-RT-009', status: 'retired', department: 'Operations', location: 'Stores', cost: 890, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1500) },
    { name: '[Sample] Payments server', asset_type: 'server', make: 'Coinway', model: 'FX', serial: 'SAMPLE-SV-010', status: 'in_use', department: 'Finance', location: 'Server room', cost: 14500, funding_source: 'mixed', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1800), site: 'Example Central Interchange', system: 'Example Payments System' },
    { name: '[Sample] Counter tablet', asset_type: 'mobile_device', make: 'Coinway', model: 'V2', serial: 'SAMPLE-MD-011', status: 'in_repair', department: 'Finance', location: 'Workshop bench', cost: 1900, funding_source: 'operating', purchase_date: dayOffset(-1100), site: 'Example Central Interchange', system: 'Example Customer Portal' },
    { name: '[Sample] Camera recorder', asset_type: 'other', make: 'Clearsight', model: 'DVR8', serial: 'SAMPLE-CM-012', status: 'in_use', department: 'Facilities', location: 'Server room', cost: 3200, funding_source: 'operating', purchase_date: dayOffset(-1300), system: 'Example Station Cameras' },
    { name: '[Sample] Supervisor phone', asset_type: 'mobile_device', make: 'Talkwave', model: 'P7', serial: 'SAMPLE-MD-013', status: 'in_use', assigned_to_name: 'Sample Supervisor', department: 'Operations', cost: 2400, funding_source: 'grant', purchase_date: dayOffset(-700) },
    { name: '[Sample] Office printer', asset_type: 'printer', make: 'Inkline', model: 'C3', serial: 'SAMPLE-PR-014', status: 'ordered', department: 'Administration', cost: 650, funding_source: 'operating', site: 'Example Central Interchange' },
    { name: '[Sample] Old workstation', asset_type: 'workstation', make: 'Acme', model: 'Desk 300', serial: 'SAMPLE-WS-015', status: 'disposed', department: 'IT', cost: 900, funding_source: 'operating', purchase_date: dayOffset(-3200), disposal_method: 'Recycled, drive destroyed', disposed_on: dayOffset(-35), ...approval },
    // Equipment on vehicles. Vehicle equipment is often part-funded by an outside funder.
    { name: '[Sample] Bus 1204 onboard computer', asset_type: 'onboard_computer', make: 'Wayline', model: 'OBC-5', serial: 'SAMPLE-OB-016', status: 'in_use', department: 'Operations', location: 'Bus 1204', cost: 4200, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1200), warranty_end: dayOffset(20), support_end: dayOffset(900), site: 'Example Depot North', system: 'Example CAD/AVL System' },
    { name: '[Sample] Bus 1204 CAD/AVL unit', asset_type: 'cad_avl_unit', make: 'Wayline', model: 'LOC-3', serial: 'SAMPLE-AV-017', status: 'in_use', department: 'Operations', location: 'Bus 1204', cost: 1800, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1200), warranty_end: dayOffset(20), support_end: dayOffset(900), site: 'Example Depot North', system: 'Example CAD/AVL System' },
    { name: '[Sample] Bus 1204 farebox', asset_type: 'farebox', make: 'Coinway', model: 'FB-9', serial: 'SAMPLE-FB-018', status: 'in_use', department: 'Revenue', location: 'Bus 1204', cost: 6500, funding_source: 'mixed', funder_interest: true, funder_interest_pct: 50, purchase_date: dayOffset(-2100), warranty_end: dayOffset(-1000), support_end: dayOffset(60), site: 'Example Depot North', system: 'Example Onboard Fare Equipment' },
    { name: '[Sample] Bus 1204 card validator', asset_type: 'validator', make: 'Coinway', model: 'V-Tap', serial: 'SAMPLE-VL-019', status: 'in_use', department: 'Revenue', location: 'Bus 1204', cost: 950, funding_source: 'mixed', funder_interest: true, funder_interest_pct: 50, purchase_date: dayOffset(-700), warranty_end: dayOffset(400), site: 'Example Depot North', system: 'Example Onboard Fare Equipment' },
    { name: '[Sample] Bus 1204 on-vehicle router', asset_type: 'vehicle_router', make: 'Roadlink', model: 'MX2', serial: 'SAMPLE-VR-020', status: 'in_use', department: 'IT', location: 'Bus 1204', cost: 1100, funding_source: 'capital', purchase_date: dayOffset(-900), support_end: dayOffset(-15), site: 'Example Depot North', system: 'Example Depot Wireless' },
    { name: '[Sample] Bus 1204 camera recorder', asset_type: 'camera', make: 'Clearsight', model: 'MVR4', serial: 'SAMPLE-VC-021', status: 'in_use', department: 'Security', location: 'Bus 1204', cost: 2300, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1000), warranty_end: dayOffset(85), site: 'Example Depot North', system: 'Example Onboard Video System' },
    { name: '[Sample] Bus 1204 radio', asset_type: 'radio', make: 'Talkwave', model: 'MR-40', serial: 'SAMPLE-RD-022', status: 'in_use', department: 'Operations', location: 'Bus 1204', cost: 1600, funding_source: 'capital', purchase_date: dayOffset(-1600), support_end: dayOffset(300), site: 'Example Depot North', system: 'Example Radio Dispatch System' },
    { name: '[Sample] Tram 07 passenger information display', asset_type: 'passenger_info_display', make: 'Signway', model: 'PID-24', serial: 'SAMPLE-PD-023', status: 'in_repair', department: 'Operations', location: 'Workshop bench', cost: 2700, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-800), warranty_end: dayOffset(200), site: 'Example Rail Yard', system: 'Example Onboard Information Displays' },
  ];

  const idOf = async (table: string, name: string | undefined): Promise<string | null> => {
    if (!opts.link || !name) return null;
    return (await ctx.db.one<{ id: string }>(`select id from ${table} where lower(name) = lower($1) and deleted_at is null`, [name]))?.id ?? null;
  };
  let created = 0;
  for (const { site, system, ...asset } of samples) {
    const fillOnly: Row = { site_id: await idOf('sites', site), system_id: await idOf('systems', system) };
    // Status and dates are only set on first load, so later edits to a sample survive a re-run.
    const { name, serial, asset_type, make, model, ...rest } = asset;
    const result = await upsertByName(ctx, 'asset', 'assets', { name, serial, asset_type, make, model }, { ...rest, ...fillOnly });
    if (result.created) created++;
  }
  return `sample assets ${samples.length} (${created} new)`;
}
