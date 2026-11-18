import type { ModuleContext, Row } from '../../core/module.ts';
import { upsertByName } from './seed.ts';

/** Invented data only: the `dev` estate and the "[Sample]" assets added in every profile. */

function dayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DEV_SITES: Row[] = [
  { name: 'Example Head Office', address: '1 Example Street', function: 'Administration and customer service', power_protection: 'Generator and battery backup', physical_security: 'Badge access, cameras', network_links: 'Two fibre links' },
  { name: 'Example Warehouse', address: '20 Sample Road', function: 'Storage and distribution', power_protection: 'Battery backup only', physical_security: 'Fenced yard, gate code' },
  { name: 'Example Branch Office', address: '300 Demo Avenue', function: 'Public counter', third_parties: 'Retail tenant', network_links: 'One fibre link, cellular backup' },
];

const DEV_CATEGORIES: Row[] = [
  { name: 'Staff payroll details', contains: 'Pay, bank and tax details', custodian: 'Finance manager', retention_period: '7 years', sensitivity_level: 'restricted' },
  { name: 'Customer account details', contains: 'Names, contact details and order history', custodian: 'Customer service manager', retention_period: '3 years', sensitivity_level: 'confidential' },
  { name: 'Security camera footage', contains: 'Recordings from building cameras', custodian: 'Facilities manager', retention_period: '30 days', sensitivity_level: 'confidential' },
  { name: 'Published service information', contains: 'Opening hours, prices and notices', custodian: 'Communications manager', retention_period: 'Until replaced', sensitivity_level: 'public' },
];

const DEV_SYSTEMS: Row[] = [
  { name: 'Example Operations System', system_group: 'Operations', vendor_name: 'Northfold Software', function: 'Day-to-day service delivery', users: 'Operations staff', hosting_type: 'vendor_hosted', criticality_tier: 'tier_1', rto_hours: 4, rpo_hours: 1, mfa_status: 'enforced', manual_fallback: 'Phone and paper job sheets' },
  { name: 'Example Scheduling System', system_group: 'Operations', vendor_name: 'Northfold Software', function: 'Rotas and work schedules', users: 'Planners', hosting_type: 'on_premises', criticality_tier: 'tier_2', rto_hours: 24, rpo_hours: 24, mfa_status: 'none' },
  { name: 'Example Public Website', system_group: 'Public', vendor_name: 'Bluebird Web', function: 'Public information and notices', users: 'Public', hosting_type: 'cloud', hosting_provider: 'Example Cloud', criticality_tier: 'tier_3', mfa_status: 'not_applicable' },
  { name: 'Example Payments System', system_group: 'Customer', vendor_name: 'Copperline Payments', function: 'Card payments and reconciliation', users: 'Finance, front desk', hosting_type: 'hybrid', criticality_tier: 'tier_2', rto_hours: 48, mfa_status: 'optional' },
  { name: 'Example Customer Portal', system_group: 'Customer', vendor_name: 'Copperline Payments', function: 'Online accounts and orders', users: 'Public', hosting_type: 'vendor_hosted', criticality_tier: 'tier_3', mfa_status: 'optional' },
  { name: 'Example Finance System', system_group: 'Finance and HR', vendor_name: 'Ledgerworks', function: 'General ledger, purchasing and payroll', users: 'Finance', hosting_type: 'vendor_hosted', criticality_tier: 'tier_1', rto_hours: 24, rpo_hours: 4, mfa_status: 'none' },
  { name: 'Example Timekeeping System', system_group: 'Finance and HR', vendor_name: 'Ledgerworks', function: 'Clocking and leave', users: 'All staff', hosting_type: 'on_premises', criticality_tier: 'tier_3', mfa_status: 'unknown' },
  { name: 'Example Facilities System', system_group: 'Facilities', vendor_name: 'Wrenchbook', function: 'Work orders and parts', users: 'Facilities', hosting_type: 'cloud', criticality_tier: 'tier_2', rto_hours: 24, rpo_hours: 24, mfa_status: 'enforced' },
  { name: 'Example Security Cameras', system_group: 'Facilities', vendor_name: 'Lanternview Cameras', function: 'Building camera recording', users: 'Facilities', hosting_type: 'on_premises', criticality_tier: 'tier_3', mfa_status: 'none' },
  { name: 'Example Directory', system_group: 'Infrastructure', vendor_name: 'Not known', function: 'Sign-in and email', users: 'All staff', hosting_type: 'cloud', criticality_tier: 'tier_1', rto_hours: 8, rpo_hours: 1, mfa_status: 'enforced' },
];

// [from, to, direction, method]
const DEV_INTEGRATIONS: [string, string, string, string][] = [
  ['Example Scheduling System', 'Example Operations System', 'one_way', 'file_transfer'],
  ['Example Operations System', 'Example Public Website', 'one_way', 'data_feed'],
  ['Example Operations System', 'Example Facilities System', 'one_way', 'api'],
  ['Example Payments System', 'Example Finance System', 'one_way', 'file_transfer'],
  ['Example Customer Portal', 'Example Payments System', 'two_way', 'api'],
  ['Example Timekeeping System', 'Example Finance System', 'one_way', 'database'],
  ['Example Directory', 'Example Finance System', 'one_way', 'single_sign_on'],
  ['Example Directory', 'Example Operations System', 'one_way', 'single_sign_on'],
];
const DEV_DATA: [string, string][] = [
  ['Example Finance System', 'Staff payroll details'],
  ['Example Timekeeping System', 'Staff payroll details'],
  ['Example Customer Portal', 'Customer account details'],
  ['Example Security Cameras', 'Security camera footage'],
  ['Example Public Website', 'Published service information'],
  ['Example Scheduling System', 'Published service information'],
];
const DEV_SERVES: [string, string][] = [
  ['Example Operations System', 'Example Head Office'],
  ['Example Operations System', 'Example Warehouse'],
  ['Example Finance System', 'Example Head Office'],
  ['Example Facilities System', 'Example Warehouse'],
  ['Example Public Website', 'Example Branch Office'],
  ['Example Payments System', 'Example Branch Office'],
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
    { name: '[Sample] Warehouse firewall', asset_type: 'network_device', make: 'Borealis', model: 'F60', serial: 'SAMPLE-NW-007', status: 'in_use', department: 'IT', cost: 2100, funding_source: 'capital', purchase_date: dayOffset(-500), support_end: dayOffset(590), site: 'Example Warehouse' },
    { name: '[Sample] Branch router 1', asset_type: 'network_device', make: 'Roadlink', model: 'M5', serial: 'SAMPLE-RT-008', status: 'in_use', department: 'Operations', location: 'Comms cabinet', cost: 890, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1500), system: 'Example Operations System' },
    { name: '[Sample] Branch router 2', asset_type: 'network_device', make: 'Roadlink', model: 'M5', serial: 'SAMPLE-RT-009', status: 'retired', department: 'Operations', location: 'Stores', cost: 890, funding_source: 'grant', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1500) },
    { name: '[Sample] Payments server', asset_type: 'server', make: 'Coinway', model: 'FX', serial: 'SAMPLE-SV-010', status: 'in_use', department: 'Finance', location: 'Server room', cost: 14500, funding_source: 'mixed', funder_interest: true, funder_interest_pct: 80, purchase_date: dayOffset(-1800), site: 'Example Branch Office', system: 'Example Payments System' },
    { name: '[Sample] Counter tablet', asset_type: 'mobile_device', make: 'Coinway', model: 'V2', serial: 'SAMPLE-MD-011', status: 'in_repair', department: 'Finance', location: 'Workshop bench', cost: 1900, funding_source: 'operating', purchase_date: dayOffset(-1100), site: 'Example Branch Office', system: 'Example Customer Portal' },
    { name: '[Sample] Camera recorder', asset_type: 'other', make: 'Clearsight', model: 'DVR8', serial: 'SAMPLE-CM-012', status: 'in_use', department: 'Facilities', location: 'Server room', cost: 3200, funding_source: 'operating', purchase_date: dayOffset(-1300), system: 'Example Security Cameras' },
    { name: '[Sample] Supervisor phone', asset_type: 'mobile_device', make: 'Talkwave', model: 'P7', serial: 'SAMPLE-MD-013', status: 'in_use', assigned_to_name: 'Sample Supervisor', department: 'Operations', cost: 2400, funding_source: 'grant', purchase_date: dayOffset(-700) },
    { name: '[Sample] Office printer', asset_type: 'printer', make: 'Inkline', model: 'C3', serial: 'SAMPLE-PR-014', status: 'ordered', department: 'Administration', cost: 650, funding_source: 'operating', site: 'Example Branch Office' },
    { name: '[Sample] Old workstation', asset_type: 'workstation', make: 'Acme', model: 'Desk 300', serial: 'SAMPLE-WS-015', status: 'disposed', department: 'IT', cost: 900, funding_source: 'operating', purchase_date: dayOffset(-3200), disposal_method: 'Recycled, drive destroyed', disposed_on: dayOffset(-35), ...approval },
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
