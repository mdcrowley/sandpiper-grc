import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the inventory module's hand-written routes (server/src/modules/inventory). */

const ASSET = 'Needs view on the asset (404 `not_found` otherwise).';
const SYSTEM = 'Needs view on the system (404 `not_found` otherwise).';

/** One asset as the import and ingest read it: every writable asset field, all optional. */
const ASSET_INPUT = `{
  tag?: string "Asset tag; matched without regard to letter case",
  name?: string "Required for a new asset",
  asset_type?: string "Value or label of the asset_type list",
  status?: string "Value or label of the asset_status list",
  make?: string, model?: string,
  serial?: string "Serial number; matched without regard to letter case",
  owner_id?: string "User id, username, email or display name",
  user_id?: string "User id, username, email or display name",
  assigned_to_name?: string,
  department?: string "A name from the department list",
  site_id?: string "Site id or site name",
  location?: string,
  purchase_date?: string "YYYY-MM-DD, YYYY/MM/DD or month/day/year",
  cost?: number | string "Amount in the organization's currency; its code or symbol and thousands commas are allowed",
  funding_source?: string "Value or label of the funding_source list",
  funder_interest?: boolean | string "true/false, yes/no, y/n or 1/0",
  funder_interest_pct?: number | string "0 to 100",
  warranty_end?: string "Date", support_end?: string "Date",
  os?: string, os_version?: string, ip_address?: string, mac_address?: string,
  vendor_id?: uuid, contract_id?: uuid,
  system_id?: string "System id, name or reference",
  disposal_approved_by?: string, disposal_approved_on?: string "Date",
  disposal_approval_ref?: string, disposal_method?: string, disposed_on?: string "Date",
  notes?: string
}`;

const ASSIGNMENT = `{ id: uuid, asset_id: uuid, user_id: uuid | null, assignee_name: string | null, department: string | null,
  site_id: uuid | null, location: string | null, due_back_on: date | null, notes: string | null,
  checked_out_at: datetime, checked_out_by: uuid, checked_in_at: datetime | null, checked_in_by: uuid | null, check_in_notes: string | null, ... }`;

const DISPOSAL_REQUEST = `{ id: uuid, asset_id: uuid, status: 'pending' | 'approved' | 'refused' | 'withdrawn', reason: string,
  disposal_method: string | null, approval_ref: string | null, requested_by: uuid, requested_at: datetime,
  decided_by: uuid | null, decided_at: datetime | null, decision_comment: string | null, ... }`;

const REPORT_INFO = `key: string, title: string, description: string,
  columns: [{ key: string, label: string, type?: 'text' | 'date' | 'number' | 'currency' }],
  recordType: 'asset' | 'system' | 'site' | null, group: 'Assets' | 'Systems', kind: 'issues' | 'summary',
  list: string | null "Path of the same rows as a filtered list page, when there is one"`;

export const DOCS: RouteDoc[] = [
  // ---- asset lifecycle ----
  route('GET', '/api/assets/:id/assignments', 'Check-out history of one asset, newest first', {
    tag: 'Assets', permission: 'assets.view',
    description: `${ASSET} \`site_name\` is null unless the caller holds \`sites.view\`.`,
    response: `[{ id: uuid, user_id: uuid | null, user_name: string | null, assignee_name: string | null, assignee: string,
      site_id: uuid | null, site_name: string | null, location: string | null, due_back_on: date | null,
      checked_out_at: datetime, checked_out_by_name: string | null, checked_in_at: datetime | null, checked_in_by_name: string | null,
      open: boolean, ... }]`,
  }),
  route('POST', '/api/assets/:id/check-out', 'Check an asset out to a person', {
    tag: 'Assets', permission: 'assets.edit', status: 201,
    description: `${ASSET} Sets the asset to in use and records an assignment (audited). 409 \`not_available\` for a retired or disposed asset, 409 \`already_checked_out\` while an assignment is open. A site is only accepted from a caller with \`sites.view\`.`,
    body: `{ user_id?: uuid "A user; or give assignee_name", assignee_name?: string "Name of someone without an account",
      due_back_on?: date, department?: string, site_id?: uuid, location?: string, notes?: string }`,
    response: ASSIGNMENT,
  }),
  route('POST', '/api/assets/:id/check-in', 'Check an asset back in', {
    tag: 'Assets', permission: 'assets.edit',
    description: `${ASSET} Closes the open assignment, clears the user and sets the status (audited). 409 \`not_checked_out\` when nothing is open; \`disposed\` is refused (use the disposal step).`,
    body: `{ status?: string "Value of the asset_status list; default in_stock", notes?: string }`,
    response: ASSIGNMENT,
  }),
  route('POST', '/api/assets/:id/dispose', 'Record the disposal approval and mark the asset disposed', {
    tag: 'Assets', permission: 'assets.edit',
    description: `${ASSET} Needs a recorded approval: 400 \`disposal_approval_required\` without who and when, 409 \`funder_interest_block\` when an outside funder keeps an interest (while the funder-interest option is on, Administration > Features) and no approval reference is given, 409 \`approval_required\` when routed approval is switched on and no request was approved, 409 \`already_disposed\`. A blocked attempt is audited. An approval decided in the application cannot be overwritten; an open assignment and a waiting request are closed.`,
    body: `{ disposal_approved_by?: string, disposal_approved_on?: date, disposal_approval_ref?: string, disposal_method?: string, disposed_on?: date "Default today" }`,
    response: '@asset',
  }),
  route('GET', '/api/assets/disposal-requests', 'Disposal requests across assets, newest first (at most 200)', {
    tag: 'Assets', permission: 'assets.view',
    description: 'Only requests on assets the caller may view.',
    query: { status: 'pending (default), approved, refused, withdrawn or `all`.' },
    response: `[{ id: uuid, asset_id: uuid, asset_tag: string | null, asset_name: string, asset_status: string | null, funder_interest: boolean,
      status: string, reason: string, requested_by_name: string | null, requested_at: datetime, decided_by_name: string | null,
      own: boolean "The caller made the request", ... }]`,
  }),
  route('GET', '/api/assets/:id/disposal-requests', 'Disposal requests of one asset, newest first', {
    tag: 'Assets', permission: 'assets.view', description: ASSET,
    response: `[{ id: uuid, status: string, reason: string, requested_by_name: string | null, decided_by_name: string | null, own: boolean, ... }]`,
  }),
  route('POST', '/api/assets/:id/disposal-requests', 'Ask for approval to dispose of an asset', {
    tag: 'Assets', permission: 'assets.edit', status: 201,
    description: `${ASSET} Marks the asset as awaiting approval, audits, and notifies everyone else holding \`assets.approve\`. 409 \`already_disposed\` or \`already_requested\` (one pending request at a time).`,
    body: `{ reason: string, disposal_method?: string, disposal_approval_ref?: string }`,
    response: `{ id: uuid, asset_id: uuid, status: 'pending', reason: string, approvers: integer "People who may decide", notified: integer, ... }`,
  }),
  route('POST', '/api/assets/:id/disposal-requests/:rid/decision', 'Approve or refuse a disposal request', {
    tag: 'Assets', permission: 'assets.approve',
    description: `${ASSET} The person who asked cannot decide (403 \`self_approval\`). An approval writes the approver's name and today's date onto the asset. Audited; the requester is notified. 409 \`already_decided\` when the request is no longer pending.`,
    body: `{ decision: 'approve' | 'refuse', comment?: string "Required to refuse" }`,
    response: DISPOSAL_REQUEST,
  }),
  route('POST', '/api/assets/:id/disposal-requests/:rid/withdraw', 'Withdraw a pending disposal request', {
    tag: 'Assets', permission: 'assets.edit',
    description: `${ASSET} 409 \`already_decided\` when the request is no longer pending. Audited.`,
    response: DISPOSAL_REQUEST,
  }),

  // ---- asset import and ingest ----
  route('POST', '/api/assets/import', 'Import assets from CSV text, with a dry run', {
    tag: 'Assets', permission: 'assets.create',
    description: 'Dry run by default: nothing is written until `dryRun: false`. At most 5000 rows. Rows with errors are never written. A duplicate is a row whose tag or serial matches an existing asset or an earlier row; `onDuplicate: "update"` needs `assets.edit`. 400 `mapping` for a bad column mapping. A real run is audited.',
    body: `{ csv: string "CSV text with a header row",
      mapping: { [field]: string } "Asset field key to CSV column header; name must be mapped",
      dryRun?: boolean "Default true", delimiter?: string "One character; default comma",
      onDuplicate?: 'skip' | 'update' "Default skip" }`,
    response: `{ dryRun: boolean, total: integer, valid: integer, errors: integer, duplicates: integer, created: integer, updated: integer, skipped: integer,
      wouldCreate?: integer, wouldUpdate?: integer,
      rows: [{ line: integer, action: 'create' | 'update' | 'skip' | 'error', data: object, errors: { [field]: string },
        duplicate: { by: 'tag' | 'serial', of: 'file' | 'existing', line?: integer, id?: uuid, value: string } | null, id?: uuid, tag?: string }] }`,
  }),
  route('POST', '/api/assets/ingest', 'Push assets from an endpoint-management or discovery tool', {
    tag: 'Assets', permission: 'assets.create',
    description: 'Also needs `assets.edit`. Send up to 5000 assets as a JSON array, or as `{ assets: [...] }`. Each is matched to an existing asset by serial number, then by tag (letter case ignored), and updated; otherwise created (a new asset needs `name`). List values may be given by value or label, sites and systems by name, users by username, email or display name. Only the fields sent are changed. An item with problems is rejected and reported; the others are still written. One audit event per call.',
    body: `[${ASSET_INPUT}] | { assets: [${ASSET_INPUT}] }`,
    response: `{ received: integer, created: integer, updated: integer, unchanged: integer,
      errors: [{ index: integer "Position in the array, from 0", serial?: string | null, tag?: string | null, errors: { [field]: string } }] }`,
  }),

  // ---- inventory settings, departments, reminders, reports ----
  route('GET', '/api/inventory/departments', 'The organization\'s departments, for the asset department choice', {
    tag: 'Inventory', permission: 'assets.view', response: '[{ name: string }]',
  }),
  route('GET', '/api/inventory/settings', 'Inventory settings', {
    tag: 'Inventory', permission: 'assets.view',
    response: `{ disposalRoutedOnly: boolean "Only an approved disposal request counts as an approval" }`,
  }),
  route('PATCH', '/api/inventory/settings', 'Change inventory settings', {
    tag: 'Inventory', permission: 'admin.administer', description: 'A change is audited.',
    body: '{ disposalRoutedOnly: boolean }', response: '{ disposalRoutedOnly: boolean }',
  }),
  route('POST', '/api/inventory/reminders/run', 'Send warranty, support, loan and system end-of-support reminders now', {
    tag: 'Inventory', permission: 'admin.administer',
    description: 'They also run on a timer several times a day. Each reminder goes out once per step. Nothing is sent when notifications are not available.',
    response: '{ available: boolean, warranty: integer, support: integer, loans: integer, systems: integer }',
  }),
  route('GET', '/api/inventory/reports', 'Canned inventory reports the caller may see, each with its row count', {
    tag: 'Inventory',
    description: 'Needs only a signed-in person; each report is listed only when the caller holds all its permissions (for example `assets.view`, `systems.view`, `data.view`).',
    response: `[{ ${REPORT_INFO}, total: integer }]`,
  }),
  route('GET', '/api/inventory/reports/:key', 'Run one inventory report', {
    tag: 'Inventory',
    description: 'Needs the report\'s permissions (403 otherwise). `format=csv` downloads the rows as CSV, needs `assets.export` or `systems.export` (by the report) and is audited. Keys: assets-past-support, warranty-expiring, assets-by-site, assets-by-department, unassigned-assets, systems-without-owner, systems-without-recovery-targets, sensitive-data-without-mfa.',
    query: {
      format: '`csv` downloads instead of JSON.',
      days: q('integer', 'warranty-expiring only: days ahead, 1 to 730 (default 90).'),
    },
    response: `{ ${REPORT_INFO}, rows: [{ route?: string | null, ... }], total: integer, generatedAt: datetime }`,
  }),

  // ---- systems: relationships ----
  route('GET', '/api/systems/graph', 'Relationship map of systems and the records around them (sites, data categories, assets and more)', {
    tag: 'Systems', permission: 'systems.view',
    description: 'Sites, data categories and assets appear only for callers holding `sites.view`, `data.view` and `assets.view`; vendor names and links need `vendors.view`. Services (routes and lines that depend on a system) need `fleet.view` and the fleet module; vehicle groups (one per depot and mode) need `fleet.view` and `assets.view`. 404 when `focus` is not a system.',
    query: {
      focus: 'A system id: only that system\'s neighbourhood.',
      depth: q('integer', 'Hops from the focus, 1 to 4 (default 1).'),
    },
    response: `{ focus?: uuid,
      nodes: [{ id: string, type: 'system' | 'vendor' | 'site' | 'asset' | 'data_category' | 'service' | 'vehicle', label: string, group: string, route: string | null, ref?: string | null, attrs?: object }],
      edges: [{ from: string, to: string, kind: string, label: string, direction?: string }] }`,
  }),
  route('GET', '/api/systems/:id/impact', 'What is affected if this system fails', {
    tag: 'Systems', permission: 'systems.view',
    description: `${SYSTEM} Systems downstream through integrations, then the sites, data categories, assets, vehicles and services of all of them. Each part needs its own view permission and is empty otherwise.`,
    response: `{ system: { id: uuid, ref: string, label: string },
      downstream: [{ id: uuid, ref: string, label: string, group: string | null, route: string, depth: integer, via: { id: uuid, label: string }, method: string | null, criticality_tier: string | null, criticality_label: string | null }],
      sites: [{ id: uuid, label: string, route: string, via: { id: uuid, label: string, direct: boolean } }],
      data_categories: [{ id: uuid, label: string, route: string, via: object, sensitivity_level: string | null, sensitivity_label: string | null }],
      assets: [{ id: uuid, ref: string | null, label: string, route: string, via: object }],
      vehicles: [object], services: [object],
      counts: { systems: integer, sites: integer, data_categories: integer, assets: integer, vehicles: integer, services: integer } }`,
  }),
  route('GET', '/api/systems/:id/integrations', 'Integrations of one system, both directions', {
    tag: 'Systems', permission: 'systems.view', description: SYSTEM,
    response: `[{ id: uuid, from_system_id: uuid, to_system_id: uuid, direction: 'one_way' | 'two_way', method: string | null, notes: string | null,
      other_system_id: uuid, other_name: string, other_ref: string, flow: 'in' | 'out' | 'both' "As seen from this system", method_label: string | null, ... }]`,
  }),
  route('POST', '/api/systems/:id/integrations', 'Record an integration with another system', {
    tag: 'Systems', permission: 'systems.edit', status: 201,
    description: `${SYSTEM} Audited on both systems. 409 \`duplicate\` when the same link and method is already recorded.`,
    body: `{ to_system_id: uuid "The other system",
      direction?: 'one_way' | 'inbound' | 'two_way' "one_way (default): this system sends; inbound: the other sends to this one",
      method?: string "Value of the integration_method list", notes?: string }`,
    response: '{ id: uuid, other_system_id: uuid, flow: string, ... }',
  }),
  route('DELETE', '/api/systems/:id/integrations/:integrationId', 'Remove an integration', {
    tag: 'Systems', permission: 'systems.edit', description: `${SYSTEM} Audited on both systems.`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/systems/:id/data-categories', 'Data categories held in one system', {
    tag: 'Systems', permission: 'systems.view', description: `${SYSTEM} Also needs \`data.view\` (403 otherwise).`,
    response: `[{ id: uuid, name: string, sensitivity_level: string | null, sensitivity_label: string | null, sensitivity_color: string,
      custodian: string | null, retention_period: string | null, linked_at: datetime }]`,
  }),
  route('POST', '/api/systems/:id/data-categories', 'Record that a system holds a data category', {
    tag: 'Systems', permission: 'systems.edit', status: 201,
    description: `${SYSTEM} Also needs \`data.view\`. Audited on both records. 409 \`duplicate\` when already recorded.`,
    body: '{ data_category_id: uuid }',
    response: '{ system_id: uuid, data_category_id: uuid, name: string }',
  }),
  route('DELETE', '/api/systems/:id/data-categories/:categoryId', 'Remove a data category from a system', {
    tag: 'Systems', permission: 'systems.edit', description: `${SYSTEM} Audited on both records.`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/systems/:id/sites', 'Sites a system serves', {
    tag: 'Systems', permission: 'systems.view', description: `${SYSTEM} Also needs \`sites.view\` (403 otherwise).`,
    response: '[{ id: uuid, name: string, address: string | null, function: string | null }]',
  }),
  route('POST', '/api/systems/:id/sites', 'Record that a system serves a site', {
    tag: 'Systems', permission: 'systems.edit', status: 201,
    description: `${SYSTEM} Also needs \`sites.view\`. Audited. 409 \`duplicate\` when already recorded.`,
    body: '{ site_id: uuid }',
    response: '{ system_id: uuid, site_id: uuid, name: string }',
  }),
  route('DELETE', '/api/systems/:id/sites/:siteId', 'Remove a site from a system', {
    tag: 'Systems', permission: 'systems.edit', description: `${SYSTEM} Audited.`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/sites/:id/systems', 'Systems that serve one site', {
    tag: 'Sites', permission: 'sites.view',
    description: 'Needs view on the site. Empty without `systems.view`.',
    response: '[{ id: uuid, ref: string, name: string, system_group: string | null, vendor_name: string | null, criticality_tier: string | null }]',
  }),
  route('GET', '/api/data-categories/:id/systems', 'Systems that hold one data category', {
    tag: 'Data categories', permission: 'data.view',
    description: 'Needs view on the data category. Empty without `systems.view`.',
    response: `[{ id: uuid, ref: string, name: string, system_group: string | null, vendor_name: string | null,
      mfa_status: string | null, mfa_label: string | null, hosting_type: string | null }]`,
  }),
];
