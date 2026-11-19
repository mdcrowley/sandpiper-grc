import type { RouteDoc } from '../../module.ts';
import { route } from './helpers.ts';

/** Descriptions of the vulnerabilities module's hand-written routes (server/src/modules/vulnerabilities). */

const SEC = 'Also needs `security.view`: findings are security records.';
const T = 'Vulnerabilities';

const MAPPING = `{ host_name?: string, host_ip?: string, port?: string, protocol?: string, service?: string,
  plugin_id?: string "Finding identifier", title?: string, severity?: string, cvss?: string, cves?: string,
  known_exploited?: string, first_seen?: string, last_seen?: string, description?: string, solution?: string }`;

const POLICY = `days: { [severity]: integer | null } "Days a finding may stay open, from first seen; null means no fix-by date",
  knownExploitedSeverity: string "Known-exploited findings get at most this severity's period; empty for none",
  criticalityPercent: { [criticality]: integer } "Share of the period (1 to 99) for a finding on a system of that criticality"`;

const PRESET = '{ id: uuid, name: string, source: string | null, delimiter: string, mapping: { [field]: string }, updated_at: datetime }';

const BATCH = `{ id: uuid, source: string, file_name: string | null, preset_name: string | null, close_missing: boolean, mapping: { [field]: string },
  total_rows: integer, created_count: integer, updated_count: integer, unchanged_count: integer, reopened_count: integer,
  closed_count: integer, duplicate_count: integer, error_count: integer, unmatched_hosts: [string],
  imported_by: uuid | null, imported_by_name: string | null, imported_at: datetime }`;

export const DOCS: RouteDoc[] = [
  route('POST', '/api/vulnerabilities/import', 'Import scanner or assessment findings from CSV text, with a dry run', {
    tag: T, permission: 'vulnerabilities.create',
    description: `Also needs \`vulnerabilities.edit\` and \`security.view\`. Dry run by default: nothing is written until \`dryRun: false\`. At most 5 MB (413 \`too_large\`) and 10000 rows. `
      + 'The mapping must give a host (host_name or host_ip), a way to tell findings apart (plugin_id, cves or title) and a severity (severity or cvss). '
      + 'A row is the same finding as a recorded one when host, port with protocol and finding identifier match; it is then updated, or reopened when it was marked fixed; otherwise created. '
      + 'Severity accepts the list\'s values and labels, common words and 0 to 4; without it, it is taken from the CVSS score. Hosts are linked to assets by name, tag, serial or IP address. '
      + '`closeMissing` marks fixed the open findings from an earlier import of the same source that this file no longer reports. '
      + 'A real run records an import batch, notifies the owner given new findings, and is audited. 400 `malformed` or `mapping` for an unreadable file or bad mapping.',
    body: `{ csv: string "CSV text with a header row of unique column names",
      mapping: ${MAPPING} "Field key to CSV column header",
      source: string "Scanner or assessment the findings came from (at most 120 characters); also scopes closeMissing",
      fileName?: string, presetName?: string,
      delimiter?: string "One character; detected from the header when left out",
      dayFirst?: boolean "Read 03/04/2030 as 3 April; default true",
      dryRun?: boolean "Default true",
      closeMissing?: boolean "Default false",
      ownerId?: uuid "Active user given the findings this import adds" }`,
    response: `{ dryRun: boolean, source: string, closeMissing: boolean, delimiter: string, total: integer,
      created: integer, updated: integer, unchanged: integer, reopened: integer, duplicates: integer, errors: integer,
      missing: integer "Findings of this source not in the file", closed: integer, unmatchedHosts: [string], assigned: integer,
      batchId: uuid | null "Set on a real run",
      rows: [{ line: integer, action: 'create' | 'update' | 'unchanged' | 'reopen' | 'duplicate' | 'error', id: uuid | null, ref: string | null,
        host: string | null, port: string | null, title: string | null, severity: string | null, finding: string | null,
        errors: { [field]: string }, changes: [string], duplicateOf: integer | null }] "Problems first, at most 300",
      rowsShown: integer,
      missingFindings: [{ id: uuid, ref: string, title: string, host: string | null, severity: string }] }`,
  }),
  route('GET', '/api/vulnerabilities/import/fields', 'Fields a CSV column can be mapped to, and the import limits', {
    tag: T, permission: 'vulnerabilities.view', description: SEC,
    response: '{ fields: [{ key: string, label: string }], maxBytes: integer, maxRows: integer }',
  }),
  route('GET', '/api/vulnerabilities/import/presets', 'Saved column mappings', {
    tag: T, permission: 'vulnerabilities.view', description: SEC, response: `[${PRESET}]`,
  }),
  route('POST', '/api/vulnerabilities/import/presets', 'Save a column mapping under a name (replaces one of the same name)', {
    tag: T, permission: 'vulnerabilities.create',
    description: `${SEC} Answers 201 for a new name and 200 when an existing one is replaced. Audited.`,
    status: 201,
    body: `{ name: string "At most 80 characters", mapping: ${MAPPING}, delimiter?: string "Default comma", source?: string }`,
    response: PRESET,
  }),
  route('DELETE', '/api/vulnerabilities/import/presets/:id', 'Delete a saved column mapping', {
    tag: T, permission: 'vulnerabilities.create', description: `${SEC} Audited.`, response: '{ ok: boolean }',
  }),
  route('GET', '/api/vulnerabilities/imports', 'Import history, newest first (at most 200)', {
    tag: T, permission: 'vulnerabilities.view', description: SEC, response: `[${BATCH}]`,
  }),
  route('GET', '/api/vulnerabilities/imports/:id', 'One import', {
    tag: T, permission: 'vulnerabilities.view', description: SEC, response: BATCH,
  }),
  route('GET', '/api/vulnerabilities/policy', 'The severity policy that sets fix-by dates', {
    tag: T, permission: 'vulnerabilities.view',
    description: `${SEC} \`criticalityTiers\` is empty when systems are not available.`,
    response: `{ ${POLICY}, criticalityTiers: [{ value: string, label: string, color: string }] }`,
  }),
  route('POST', '/api/vulnerabilities/policy', 'Change the severity policy', {
    tag: T, permission: 'vulnerabilities.administer',
    description: `${SEC} Recalculates the fix-by date of every open finding without an override; audited. Leaving out \`criticalityPercent\` keeps the saved shares.`,
    body: `{ days: { [severity]: integer | null } "1 to 3650, or null for no fix-by date",
      knownExploitedSeverity?: string, criticalityPercent?: { [criticality]: integer | null } "1 to 100; 100 or null means the whole period" }`,
    response: `{ ${POLICY}, criticalityTiers: [object], recalculated: integer "Open findings whose date moved" }`,
  }),
  route('GET', '/api/vulnerabilities/summary', 'Dashboard figures for open findings', {
    tag: T, permission: 'vulnerabilities.view',
    description: `${SEC} Counts only findings the caller may see; the weekly trend holds totals only.`,
    response: `{ today: date, severities: [{ value: string, label: string, color: string }],
      totals: { open: integer, overdue: integer, knownExploitedOpen: integer, unassignedOpen: integer, fixedThisMonth: integer },
      openBySeverity: [{ severity: string, count: integer }], overdueBySeverity: [{ severity: string, count: integer }],
      ageBuckets: [{ key: string, label: string, min: integer, max: integer | null, bySeverity: { [severity]: integer }, total: integer }],
      mttr: [{ severity: string, days: number | null "Mean days to fix", fixed: integer }],
      topHosts: [{ host: string, host_key: string, total: integer, bySeverity: { [severity]: integer } }],
      overdueByOwner: [{ owner_id: uuid | null, owner: string, count: integer }],
      systemOwnerReport: boolean,
      trend: [{ week_start: date, bySeverity: { [severity]: integer }, total: integer, overdue: integer }] }`,
  }),
  route('GET', '/api/vulnerabilities/overdue-report', 'Open findings past their fix-by date, grouped by owner', {
    tag: T, permission: 'vulnerabilities.view',
    description: `${SEC} Grouping by system owner (technical owner, else business owner) needs \`systems.view\`; otherwise \`available\` is false.`,
    query: { group: '`owner` (default, the finding\'s owner) or `system_owner`.' },
    response: `{ group: 'owner' | 'system_owner', available: boolean, total: integer,
      groups: [{ key: string, kind: 'person' | 'unassigned' | 'no_system' | 'no_owner', ownerId: uuid | null, name: string, total: integer,
        bySeverity: { [severity]: integer }, oldestDue: date | null, systemIds: [uuid] }] }`,
  }),
];
