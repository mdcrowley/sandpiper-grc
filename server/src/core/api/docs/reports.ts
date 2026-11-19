import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the reports module's hand-written routes (server/src/modules/reports). */

const SPEC = '{ type: string "Record type reported on", columns?: [string], filters?: object, groupBy?: [object], aggregates?: [object], pivot?: boolean, sort?: [object], limit?: integer }';
const GLOBALS = '{ from?: date, to?: date, department?: string, site?: uuid, system?: uuid, owner?: uuid | \'me\' }';
const RESULT = `{ type: string, typeLabel: string, plural: string, route: string, mode: 'rows' | 'groups' | 'total',
  columns: [{ key: string, label: string, type: string, role: 'column' | 'dim' | 'agg', multiple?: boolean "A multi-choice field", values?: [string] "Choices of a dimension column", ... }],
  rows: [{ id?: uuid, v: object "Raw values by column key", d: object "Display labels by column key", c?: object, drill?: string }],
  total: integer, truncated: boolean, pivot?: object, drill: string, drillExact: boolean, globalsApplied: [string],
  restricted: boolean, recordTypes: [string], generatedAt: datetime }`;
const SNAPSHOT = '{ id: uuid, source_type: \'report\' | \'dashboard\' | \'pack\', source_id: uuid, schedule_id: uuid | null, title: string, format: \'html\' | \'csv\' | \'pdf\' | \'xlsx\', for_user_id: uuid, record_types: [string], restricted: boolean, size_bytes: integer, created_at: datetime }';
const HOME = '{ dashboard: { id: uuid, name: string, description: string | null } | null, route: string | null, suggested: { id: uuid, name: string, description: string | null, route: string } | null, readOnly: boolean }';
const RUN_SUMMARY = '{ scheduleId: uuid, delivered: integer, skipped: integer, failed: integer, snapshots: [uuid] }';

const g = {
  'g.from': q('date', 'Dashboard-wide filter: from this date (YYYY-MM-DD).'),
  'g.to': q('date', 'Dashboard-wide filter: up to this date (YYYY-MM-DD).'),
  'g.department': 'Dashboard-wide filter: department name.',
  'g.site': q('uuid', 'Dashboard-wide filter: site.'),
  'g.system': q('uuid', 'Dashboard-wide filter: system.'),
  'g.owner': 'Dashboard-wide filter: owner id, or `me`.',
};

const SHARED = 'The report must be shared with the caller (404 `not_found` otherwise).';
const EXPORT = 'Needs export permission on every record type whose rows leave (403 `forbidden` otherwise). Recorded in the audit trail, with whether restricted records were included. 400 `bad_format` for an unknown format.';
const VIEWER = 'Needs `reports.view` or `dashboards.view`.';

export const DOCS: RouteDoc[] = [
  // ---------- builder support ----------
  route('GET', '/api/reports/catalog', 'Record types and fields the caller may report on', {
    tag: 'Reports', description: VIEWER,
    response: '{ types: [{ type: string, label: string, plural: string, route: string, module: string, description: string, restricted: boolean, titleField: string, refField: string | null, canExport: boolean, fields: [{ path: string, label: string, type: string, list?: string, to?: string, via?: string, custom?: boolean, multiple?: boolean, group: boolean, sum: boolean, column: boolean }], globals: { [kind]: string } }] }',
  }),
  route('GET', '/api/reports/roles', 'Switched-on roles, for choosing who a report is shared with', {
    tag: 'Reports', description: VIEWER, response: '[{ key: string, name: string }]',
  }),
  route('GET', '/api/reports/departments', 'Values offered by the dashboard department filter', {
    tag: 'Reports', description: `${VIEWER} Departments plus department names recorded on records the caller may view.`,
    response: '[{ value: string, label: string }]',
  }),

  // ---------- running ----------
  route('POST', '/api/reports/run', 'Run an unsaved report specification', {
    tag: 'Reports',
    description: `${VIEWER} Figures are worked out with the caller's own permissions. 400 \`bad_report\` for an invalid specification; 403 \`forbidden\` when the caller may not view the record type.`,
    body: `{ spec: ${SPEC}, globals?: ${GLOBALS}, dateField?: string "Field the date filter applies to", limit?: integer }`,
    response: RESULT,
  }),
  route('GET', '/api/reports/:id/run', 'Run a saved report', {
    tag: 'Reports', permission: 'reports.view',
    description: `${SHARED} Figures are worked out with the caller's own permissions. 409 \`unavailable\` when the record type it reports on is not switched on.`,
    query: g,
    response: `{ report: { id: uuid, name: string, description: string | null, chart: object | null }, result: ${RESULT} }`,
  }),

  // ---------- exports ----------
  route('POST', '/api/reports/export', 'Export an unsaved report', {
    tag: 'Reports', permission: 'reports.export',
    description: `${EXPORT} The file type follows \`format\`: CSV, HTML (print-ready document), XLSX or PDF.`,
    body: `{ format: 'csv' | 'html' | 'xlsx' | 'pdf', spec: ${SPEC}, title?: string, chart?: { kind: string, ... } }`,
    file: 'text/csv',
  }),
  route('GET', '/api/reports/:id/export', 'Export a saved report', {
    tag: 'Reports', permission: 'reports.export',
    description: `${SHARED} ${EXPORT} The file type follows \`format\` (CSV by default; also HTML, XLSX or PDF).`,
    query: { format: 'csv (default), html, xlsx or pdf.', ...g },
    file: 'text/csv',
  }),
  route('GET', '/api/dashboards/:id/export', 'Export a dashboard', {
    tag: 'Dashboards', permission: 'dashboards.export',
    description: 'The dashboard must be shared with the caller (404 `not_found` otherwise). Widgets on record types the caller may not export are left out. Recorded in the audit trail. HTML by default; also XLSX or PDF (400 `bad_format` otherwise).',
    query: { format: 'html (default), xlsx or pdf.', ...g },
    file: 'text/html',
  }),
  route('GET', '/api/report-packs/:id/export', 'Export a report pack', {
    tag: 'Report packs', permission: 'reports.export',
    description: 'The pack must be shared with the caller (404 `not_found` otherwise). Sections on record types the caller may not export are left out. Recorded in the audit trail. HTML by default; also XLSX or PDF (400 `bad_format` otherwise).',
    query: { format: 'html (default), xlsx or pdf.' },
    file: 'text/html',
  }),

  // ---------- dashboards ----------
  route('POST', '/api/dashboards/run-widget', 'Work out the figures of one dashboard widget', {
    tag: 'Dashboards', permission: 'dashboards.view',
    description: 'A saved report in the widget runs only when it is shared with the caller. Problems come back as `status` rather than an error; 400 `validation` when no widget is given.',
    body: `{ widget: { id: string, kind: string, title?: string, x: integer, y: integer, w: integer, h: integer, config?: object }, globals?: ${GLOBALS}, month?: string "Calendar widgets: YYYY-MM" }`,
    response: `{ status: 'ok' | 'unavailable' | 'forbidden' | 'error', message?: string, result?: ${RESULT}, chart?: object, report?: { id: uuid, name: string }, value?: number | null, denominator?: number | null, trend?: { current: number, previous: number, days: integer } }`,
  }),
  route('GET', '/api/dashboards/home', 'Your chosen home dashboard', {
    tag: 'Dashboards',
    description: 'Needs only a signed-in person. Never fails for lack of permission: `dashboard` is null when none is chosen, it was removed, it is no longer shared, or the caller lacks `dashboards.view`.',
    response: HOME,
  }),
  route('POST', '/api/dashboards/home', 'Choose or clear your home dashboard', {
    tag: 'Dashboards', permission: 'dashboards.view',
    description: 'A personal view setting, not written to the audit trail. An empty or null `dashboard_id` clears the choice; 404 `not_found` when the dashboard is not shared with the caller.',
    body: '{ dashboard_id: uuid | null }',
    response: HOME,
  }),

  // ---------- packs ----------
  route('GET', '/api/report-packs/:id/preview', 'A report pack with its figures as the caller would see them now', {
    tag: 'Report packs', permission: 'reports.view',
    description: 'The pack must be shared with the caller (404 `not_found` otherwise). A report section not shared with the caller carries a note instead of figures.',
    response: `{ pack: { id: uuid, name: string, cover_title: string | null, cover_subtitle: string | null, description: string | null },
      sections: [{ kind: 'text' | 'report', title: string, body?: string, reportId?: uuid, description?: string | null, note?: string | null, result?: ${RESULT} | null, chart?: object | null }],
      generatedAt: datetime, preparedFor: string }`,
  }),
  route('POST', '/api/report-packs/:id/produce', 'Produce a dated, stored copy of a report pack', {
    tag: 'Report packs', permission: 'reports.export',
    description: 'The pack must be shared with the caller (404 `not_found` otherwise). Stores the document as a snapshot that can be opened again later, and records it in the audit trail.',
    response: SNAPSHOT, status: 201,
  }),
  route('GET', '/api/report-packs/:id/snapshots', 'Stored copies produced from a report pack', {
    tag: 'Report packs', permission: 'reports.view',
    description: 'Only copies the caller may open: their own, or others\' when they may view every record type in it (and hold `security.view` for restricted records).',
    response: `[${SNAPSHOT}]`,
  }),

  // ---------- snapshots ----------
  route('GET', '/api/reports/snapshots', 'Stored documents produced for you', {
    tag: 'Reports',
    description: 'Needs only a signed-in person; each copy is listed only while the caller may still view the report, dashboard or pack it was made from and every saved report in it. The 50 newest.',
    response: `[${SNAPSHOT}]`,
  }),
  route('GET', '/api/reports/snapshots/:id', 'One stored document', {
    tag: 'Reports',
    description: 'Needs view permission on, and sharing of, what it was made from. Someone else\'s copy (other than of a pack) is 404 `not_found`, exactly like one that does not exist.',
    response: `{ id: uuid, source_type: string, source_id: uuid, title: string, format: string, restricted: boolean, created_at: datetime, can_download: boolean, ... }`,
  }),
  route('GET', '/api/reports/snapshots/:id/content', 'The content of a stored document', {
    tag: 'Reports',
    description: 'Access as for the stored document. A spreadsheet or PDF, or `download=1`, is an export and needs `reports.export` (or `dashboards.export` for a dashboard); 403 `forbidden` otherwise. Opening and downloading are recorded in the audit trail. The media type is the stored format (HTML, CSV, XLSX or PDF).',
    query: { download: "'1' to download as an attachment rather than show inline." },
    file: 'text/html',
  }),

  // ---------- schedules ----------
  route('POST', '/api/report-schedules/:id/run-now', 'Deliver a schedule now', {
    tag: 'Schedules', permission: 'reports.edit',
    description: 'Only the owner of the schedule may run it (403 `forbidden` otherwise). Each recipient gets the figures worked out with their own permissions.',
    response: RUN_SUMMARY,
  }),
  route('GET', '/api/report-schedules/:id/deliveries', 'The latest 100 deliveries of a schedule', {
    tag: 'Schedules', permission: 'reports.view',
    response: '[{ id: uuid, status: string, detail: string | null, created_at: datetime, snapshot_id: uuid | null, user_name: string | null }]',
  }),
  route('POST', '/api/report-schedules/run-due', 'Deliver every schedule that is due', {
    tag: 'Schedules', permission: 'admin.administer',
    description: 'The in-process scheduler does this every five minutes; this runs it at once.',
    response: `[${RUN_SUMMARY}]`,
  }),
];
