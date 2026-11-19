import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the frameworks module's hand-written routes (server/src/modules/frameworks). */

const FW = '{ id: uuid, key: string, name: string, version: string | null, description: string | null }';
const STATUSES = '[{ value: string, label: string, color: string, weight: number "0 to 1" }]';
const TARGET = '{ status: string, weight: number, score: integer }';
const TALLY = '{ total: integer, counts: { [status]: integer }, score: integer "Weighted score out of 100", atTarget: integer, atTargetPct: integer }';
const BOTH = `all: ${TALLY}, priority: ${TALLY}`;
const STATUS_ROW = '{ outcome_id: uuid, code: string, title: string | null, function_code: string | null, category_code: string | null, priority: boolean, status: string }';
const EVIDENCE = '{ id: uuid, outcome_id: uuid, title: string, description: string | null, location: string | null, collected_on: date | null, expires_on: date | null, created_at?: datetime, ... }';
const MAPPING = '{ id: uuid, outcome_id: uuid, framework_name: string, reference: string, created_at?: datetime }';
const REFERENCE = `{ key: string, name: string, version?: string, description?: string,
  functions: [{ code: string, name: string, description?: string, color?: string,
    categories?: [{ code: string, name: string, description?: string, outcomes?: [{ code: string, text: string }] }] }] }`;
const OUTCOME_FOUND = 'The outcome must be visible to the caller (404 `not_found` otherwise).';

export const DOCS: RouteDoc[] = [
  // ---------- structure ----------
  route('GET', '/api/frameworks/:id/structure', 'Functions and categories of a framework', {
    tag: 'Frameworks', permission: 'frameworks.view',
    response: `{ framework: ${FW}, functions: [{ code: string, name: string, description: string | null, color: string, sort: integer, categories: [{ code: string, name: string, description: string | null, sort: integer }] }] }`,
  }),
  route('POST', '/api/frameworks/:id/structure', 'Add or update functions and categories', {
    tag: 'Frameworks', permission: 'frameworks.edit',
    description: 'Never removes anything (outcomes may still point at it). 400 `validation` with field errors when a function or category lacks a code or name, or a color is not one of the allowed names. Recorded in the audit trail.',
    body: '{ functions: [{ code: string, name: string, description?: string, color?: string, sort?: integer, categories?: [{ code: string, name: string, description?: string, sort?: integer }] }] }',
    response: '{ ok: boolean, functions: integer, categories: integer }',
  }),
  route('DELETE', '/api/frameworks/:id/categories/:code', 'Remove a category from a framework', {
    tag: 'Frameworks', permission: 'frameworks.edit',
    description: '409 `in_use` while outcomes still sit in the category. Recorded in the audit trail.',
    response: '{ ok: boolean }',
  }),
  route('DELETE', '/api/frameworks/:id/functions/:code', 'Remove a function from a framework', {
    tag: 'Frameworks', permission: 'frameworks.edit',
    description: '409 `in_use` while it still has categories or outcomes. Recorded in the audit trail.',
    response: '{ ok: boolean }',
  }),

  // ---------- board and progress ----------
  route('GET', '/api/frameworks/:id/board', 'A framework\'s outcomes by function and category, with scores', {
    tag: 'Frameworks', permission: 'frameworks.view',
    response: `{ framework: ${FW}, statuses: ${STATUSES}, phases: [{ value: string, label: string, color: string }], target: ${TARGET},
      summary: { ${BOTH} },
      functions: [{ code: string, name: string, color: string, description: string | null, ${BOTH},
        categories: [{ code: string, name: string, description: string | null,
          outcomes: [{ id: uuid, code: string, title: string | null, status: string, priority: boolean, phase: string | null, owner_id: uuid | null, owner_name: string | null, review_on: date | null, ... }] }] }] }`,
  }),
  route('GET', '/api/frameworks/:id/progress', 'Scores at each assessment snapshot and now', {
    tag: 'Frameworks', permission: 'frameworks.view',
    description: 'The last entry of `series` is the live position (`current: true`, `id: null`).',
    response: `{ framework: ${FW}, statuses: ${STATUSES}, target: ${TARGET}, series: [{ id: uuid | null, name: string, date: date, current: boolean, ${BOTH} }] }`,
  }),

  // ---------- reference files ----------
  route('POST', '/api/frameworks/import', 'Load a framework from a reference file', {
    tag: 'Frameworks', permission: 'frameworks.view',
    description: 'The body is the reference file itself, or `{ file, dryRun: true }` to check it without saving. A new key also needs `frameworks.create`; reloading an existing key needs `frameworks.edit` (403 `forbidden` otherwise). Reloading updates names and wording and adds what is new; it never removes an outcome or changes a status. 400 `validation` with `problems` listing what is wrong. Answers 201 when a framework is created, else 200.',
    body: `${REFERENCE} | { file: ${REFERENCE}, dryRun?: boolean }`,
    response: '{ framework_id: uuid | null, key: string, name: string, created: boolean, dry_run: boolean, functions: integer, categories: integer, outcomes: { total: integer, added: integer, updated: integer, unchanged: integer }, not_in_file: [string] }',
  }),
  route('GET', '/api/frameworks/:id/reference', 'A framework as a reference file', {
    tag: 'Frameworks', permission: 'frameworks.view',
    description: 'The same shape `POST /api/frameworks/import` accepts.',
    response: REFERENCE,
  }),

  // ---------- coverage ----------
  route('GET', '/api/frameworks/:id/coverage', 'How the outcomes cover other frameworks they are mapped to', {
    tag: 'Frameworks', permission: 'frameworks.view',
    description: 'Without `name`: every other framework mapped to, with totals. With `name`: also that framework\'s requirements, each with the outcomes that satisfy it. Only outcomes visible to the caller count.',
    query: { name: 'Name of the other framework to show requirement by requirement.' },
    response: `{ framework: ${FW}, statuses: ${STATUSES}, target: ${TARGET},
      names: [{ name: string, outcomes: integer, at_target: integer, requirements: integer }],
      name?: string,
      requirements?: [{ reference: string, at_target: integer, outcomes: [{ id: uuid, code: string, title: string | null, status: string, priority: boolean, function_code: string | null, at_target: boolean, note: string | null }] }] }`,
  }),

  // ---------- reminders ----------
  route('POST', '/api/frameworks/review-reminders/run', 'Send outcome review-date reminders now', {
    tag: 'Frameworks', permission: 'admin.administer',
    description: 'Runs hourly in the background as well. `available` is false when notifications are not part of this installation.',
    response: '{ available: boolean, soon: integer, due: integer, notified: integer }',
  }),

  // ---------- assessments ----------
  route('POST', '/api/assessments', 'Take an assessment snapshot of a framework', {
    tag: 'Assessment snapshots', permission: 'frameworks.create',
    description: 'Captures the status of every outcome of the framework now. `framework_id` may be left out when there is only one framework; `date` defaults to today and cannot be in the future or before 2000-01-01 (400 `validation`).',
    body: '{ name: string, framework_id?: uuid, date?: date, taken_on?: date, notes?: string }',
    response: `{ id: uuid, name: string, framework_id: uuid, taken_on: date, notes: string | null, ${BOTH}, ... }`,
    status: 201,
  }),
  route('GET', '/api/assessments/compare', 'Compare two assessment snapshots, or one with now', {
    tag: 'Assessment snapshots', permission: 'frameworks.view',
    description: '400 `validation` when the two snapshots are of different frameworks; 404 `not_found` for an unknown snapshot.',
    query: { from: q('uuid', 'The earlier snapshot.'), to: 'The later snapshot id, or `now` (the default) for the live statuses.' },
    response: `{ from: { id: uuid, name: string, date: date }, to: { id: uuid | null, name: string, date: date },
      statuses: ${STATUSES}, target: ${TARGET},
      overall: { from: { ${BOTH} }, to: { ${BOTH} } },
      functions: [{ code: string, name: string, color: string, from: ${TALLY}, to: ${TALLY} }],
      changed: [{ outcome_id: uuid, code: string, title: string | null, function_code: string | null, priority: boolean, from: string | null, to: string | null, direction: 'added' | 'removed' | 'improved' | 'declined' | 'changed' }] }`,
  }),
  route('GET', '/api/assessments/:id', 'One assessment snapshot with its scores and captured statuses', {
    tag: 'Assessment snapshots', permission: 'frameworks.view',
    response: `{ id: uuid, framework_id: uuid, framework_name: string, name: string, taken_on: date, notes: string | null, created_at: datetime, created_by: uuid | null,
      previous: { id: uuid, name: string, taken_on: date } | null,
      categories: [{ code: string, name: string, function_code: string }],
      statuses: ${STATUSES}, target: ${TARGET}, ${BOTH},
      functions: [{ code: string, name: string, color: string, total: integer, counts: { [status]: integer }, score: integer, atTarget: integer, atTargetPct: integer }],
      outcomes: [${STATUS_ROW}] }`,
  }),

  // ---------- outcome context, timeline, evidence and mappings ----------
  route('GET', '/api/framework-outcomes/:id/context', 'The framework, function and category an outcome sits in', {
    tag: 'Framework outcomes', permission: 'frameworks.view', description: OUTCOME_FOUND,
    response: '{ framework: { id: uuid, key: string, name: string, version: string | null }, function: { code: string, name: string, description: string | null, color: string } | null, category: { code: string, name: string, description: string | null } | null }',
  }),
  route('GET', '/api/framework-outcomes/:id/timeline', 'An outcome\'s status changes and snapshot statuses over time', {
    tag: 'Framework outcomes', permission: 'frameworks.view', description: `${OUTCOME_FOUND} Status changes come from the audit trail.`,
    response: "{ status: string, review_on: date | null, events: [{ kind: 'created' | 'change' | 'snapshot', at: datetime | date, by: string | null, from: string | null, to: string | null, snapshot_id: uuid | null, name: string | null }] }",
  }),
  route('GET', '/api/framework-outcomes/:id/evidence', 'Evidence recorded for an outcome', {
    tag: 'Framework outcomes', permission: 'frameworks.view', description: OUTCOME_FOUND,
    response: `[{ id: uuid, outcome_id: uuid, title: string, description: string | null, location: string | null, collected_on: date | null, expires_on: date | null, created_at: datetime, created_by_name: string | null, state: 'current' | 'expiring' | 'expired' "Expiring: within 30 days" }]`,
  }),
  route('POST', '/api/framework-outcomes/:id/evidence', 'Add evidence to an outcome', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} 400 \`validation\` when the title is missing, a date is not YYYY-MM-DD, or expiry is before collection. Recorded in the audit trail.`,
    body: '{ title: string, description?: string, location?: string, collected_on?: date, expires_on?: date }',
    response: EVIDENCE, status: 201,
  }),
  route('PATCH', '/api/framework-outcomes/:id/evidence/:evidenceId', 'Change an evidence entry', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} Only the members given change; an empty value clears it. Validation as when adding. Recorded in the audit trail when something changed.`,
    body: '{ title?: string, description?: string | null, location?: string | null, collected_on?: date | null, expires_on?: date | null }',
    response: EVIDENCE,
  }),
  route('DELETE', '/api/framework-outcomes/:id/evidence/:evidenceId', 'Remove an evidence entry', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} Recorded in the audit trail.`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/framework-outcomes/:id/mappings', 'Other frameworks\' requirements an outcome satisfies', {
    tag: 'Framework outcomes', permission: 'frameworks.view', description: OUTCOME_FOUND,
    response: `[${MAPPING}]`,
  }),
  route('POST', '/api/framework-outcomes/:id/mappings', 'Map an outcome to another framework\'s requirement', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} Keeps the outcome's "also satisfies" text in step. 400 \`validation\` for a duplicate or an invalid name or reference. Recorded in the audit trail.`,
    body: '{ framework_name: string, reference: string }',
    response: MAPPING, status: 201,
  }),
  route('PATCH', '/api/framework-outcomes/:id/mappings/:mappingId', 'Change a mapping', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} Keeps the outcome's "also satisfies" text in step. 400 \`validation\` for a duplicate or an invalid name or reference. Recorded in the audit trail.`,
    body: '{ framework_name?: string, reference?: string }',
    response: MAPPING,
  }),
  route('DELETE', '/api/framework-outcomes/:id/mappings/:mappingId', 'Remove a mapping', {
    tag: 'Framework outcomes', permission: 'frameworks.edit',
    description: `${OUTCOME_FOUND} Keeps the outcome's "also satisfies" text in step. Recorded in the audit trail.`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/framework-mappings/names', 'Other framework names already used in mappings', {
    tag: 'Framework mappings', permission: 'frameworks.view',
    description: 'The 100 most used, most used first, for the "also satisfies" picker.',
    response: '[string]',
  }),
];
