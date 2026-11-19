import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the secincidents module's hand-written routes (server/src/modules/secincidents). */

const T = 'Security incidents';
const RULES = 'Security notification rules';
const TEMPLATES = 'Security checklist templates';
const CONTACTS = 'Security incident contacts';

/** Every route of this module is restricted: security.view is needed as well as the action permission. */
const R = 'Restricted: needs `security.view` as well as the permission shown (403 `forbidden` otherwise).';
const VIEW = 'security.view';
const EDIT = 'security.edit';
const ADMIN = 'security.administer';
const ON_INCIDENT = `${R} The incident must be visible to the caller (404 \`not_found\` otherwise).`;
const VALIDATION = '400 `validation` with the fields at fault.';

const CLOCK = `{ task_id: uuid, ref: string, incident_id: uuid, rule_id: uuid | null, party: string, title: string, required: boolean,
  deadline_hours: number | null, guidance: string | null, due_at: datetime | null, amber_at: datetime | null,
  status: string, state: 'green' | 'amber' | 'red' | 'met' | 'not_required', seconds_remaining: integer | null,
  overdue: boolean, late: boolean, notified_who: string | null, notified_how: string | null, notified_at: datetime | null,
  reference_received: string | null, completed_at: datetime | null, completed_by: uuid | null, completed_by_name: string | null }`;

const LOG_ENTRY = '{ id: uuid, incident_id: uuid, at: datetime, author_id: uuid | null, author_name: string, entry: string, kind: string, created_at: datetime }';
const ROLE = '{ id: uuid, incident_id: uuid, role: string, person_name: string | null, contact: string | null, sort: number | null, ... }';
const EVIDENCE = '{ id: uuid, incident_id: uuid, item: string, where_held: string | null, collected_by: string | null, collected_at: datetime | null, hash_ref: string | null, ... }';
const CHECK_ITEM = `{ id: uuid, incident_id: uuid, template_id: uuid | null, scenario: string | null, phase: string, step: string, sort: number,
  done: boolean, done_by: uuid | null, done_by_name: string | null, done_at: datetime | null, ... }`;
const RULE = `{ id: uuid, trigger_attribute: string, party: string, deadline_hours: number | null, required: boolean, guidance: string | null,
  active: boolean, sort: number | null, ... }`;
const TEMPLATE = '{ id: uuid, scenario: string, phase: string, step: string, sort: number | null, active: boolean, ... }';
const CONTACT = '{ id: uuid, role: string, person_name: string | null, contact: string | null, notes: string | null, sort: number | null, ... }';
const LIST_VALUE = '{ id: uuid, value: string, label: string, color: string, sort: integer, active: boolean, hint?: string, stage?: string }';
const STAGED = '{ value: string, label: string, color: string, sort: integer, stage: string }';
const QUESTION = `{ key: string, kind: 'flag' | 'data_kind', value: string, question: string, hint: string, trigger: string, trigger_label: string }`;
const PREVIEW_RULE = '{ rule_id: uuid, party: string, trigger_attribute: string, deadline_hours: number | null, required: boolean, guidance: string | null, due_at: datetime | null }';

const LISTS = 'The list `:name` is `kinds` (kinds of data, each a yes/no question and a rule trigger; extra member `hint`) or `statuses` (the incident lifecycle; extra member `stage`: reported, declared, contained or closed). 404 `not_found` for any other name.';
const RESYNC = 'Open incidents pick up the change straight away: their notification tasks are brought in line with the rules.';

/** The four routes of a configuration table (list, add, change, remove), all audited. */
function config(path: string, tag: string, noun: string, body: string, row: string, extra: { query?: Record<string, string>; note?: string } = {}): RouteDoc[] {
  const note = extra.note ? ` ${extra.note}` : '';
  return [
    route('GET', path, `List ${noun}s`, { tag, permission: VIEW, description: R, ...(extra.query ? { query: extra.query } : {}), response: `[${row}]` }),
    route('POST', path, `Add a ${noun}`, { tag, permission: ADMIN, description: `${R} Audited. ${VALIDATION}${note}`, body, response: row, status: 201 }),
    route('PATCH', `${path}/:id`, `Change a ${noun}`, {
      tag, permission: ADMIN, description: `${R} Only members sent are changed; audited. ${VALIDATION}${note}`,
      body: body.replace(/(\w+): /g, '$1?: '), response: row,
    }),
    route('DELETE', `${path}/:id`, `Remove a ${noun}`, { tag, permission: ADMIN, description: `${R} Audited.${note}`, response: '{ ok: boolean }' }),
  ];
}

/** The four routes of a table held on one incident (list, add, change, remove), all audited. */
function child(seg: string, noun: string, body: string, row: string): RouteDoc[] {
  const base = `/api/security-incidents/:id/${seg}`;
  return [
    route('GET', base, `${noun}s of one incident`, { tag: T, permission: VIEW, description: ON_INCIDENT, response: `[${row}]` }),
    route('POST', base, `Add a ${noun.toLowerCase()} to an incident`, { tag: T, permission: EDIT, description: `${ON_INCIDENT} Audited. ${VALIDATION}`, body, response: row, status: 201 }),
    route('PATCH', `${base}/:childId`, `Change a ${noun.toLowerCase()} of an incident`, {
      tag: T, permission: EDIT, description: `${ON_INCIDENT} Only members sent are changed; audited.`,
      body: body.replace(/(\w+): /g, '$1?: '), response: row,
    }),
    route('DELETE', `${base}/:childId`, `Remove a ${noun.toLowerCase()} from an incident`, { tag: T, permission: EDIT, description: `${ON_INCIDENT} Audited.`, response: '{ ok: boolean }' }),
  ];
}

export const DOCS: RouteDoc[] = [
  // ---------- regulatory clocks ----------
  route('GET', '/api/security-incidents/clocks', 'Notification clocks across every incident, most urgent first', {
    tag: T, permission: VIEW, description: `${R} The summary always counts every clock, open incidents and reviews due, whatever the status filter.`,
    query: { status: q('string', 'pending (default), done, not_required or all.') },
    response: `{ now: datetime, amber_fraction: number,
      summary: { red: integer, amber: integer, green: integer, open: integer, done: integer, not_required: integer, open_incidents: integer, reviews_due: integer },
      clocks: [{ ..., incident: { id: uuid, ref: string, title: string, severity: string | null, status: string } }] }`,
  }),
  route('POST', '/api/security-incidents/clocks/sweep', 'Raise any amber or red clock alert that is due now', {
    tag: T, permission: ADMIN,
    description: `${R} The server also does this by itself every minute. Each alert is raised once per task, written to the incident log, audited and sent to the people who can see the incident.`,
    response: '{ amber: integer, red: integer }',
  }),
  route('GET', '/api/security-incidents/:id/clocks', 'Notification clocks of one incident', {
    tag: T, permission: VIEW, description: ON_INCIDENT,
    response: `{ now: datetime, amber_fraction: number,
      incident: { id: uuid, ref: string, title: string, discovered_at: datetime | null, declared_at: datetime | null }, clocks: [${CLOCK}] }`,
  }),
  route('POST', '/api/security-incidents/notification-preview', 'Which notifications a set of answers would require', {
    tag: T, permission: VIEW,
    description: `${R} Saves nothing; used by the declare flow. \`not_configured\` lists rules that would apply but are switched off or have no deadline yet. 400 \`validation\` when \`discovered_at\` is not a date and time.`,
    body: '{ is_cyber_incident?: boolean, personal_info_involved?: boolean, data_kinds?: [string], discovered_at?: datetime "Default now." }',
    response: `{ discovered_at: datetime, notifications: [${PREVIEW_RULE}], not_configured: [${PREVIEW_RULE}] }`,
  }),

  // ---------- lifecycle, questions, kit ----------
  route('GET', '/api/security-incidents/lifecycle', 'The incident lifecycle: stages, statuses, review statuses and checklist phases', {
    tag: T, permission: VIEW, description: R,
    response: `{ stages: [{ value: string, label: string }], statuses: [${STAGED}], review_statuses: [${STAGED}],
      phases: [{ value: string, label: string }], time_zone: string }`,
  }),
  route('GET', '/api/security-incidents/questions', 'The yes/no questions of the declare flow and the triggers a rule may use', {
    tag: T, permission: VIEW, description: R,
    response: `{ questions: [${QUESTION}], triggers: [{ value: string, label: string }] }`,
  }),
  route('GET', '/api/security-incidents/kit', 'The offline incident kit: rules, questions, contacts, checklists and severities', {
    tag: T, permission: VIEW, description: `${R} Opening the kit is audited.`,
    response: `{ generated_at: datetime, generated_by: string,
      rules: [{ id: uuid, trigger_attribute: string, trigger_label: string, party: string, deadline_hours: number | null, required: boolean, guidance: string | null, active: boolean }],
      questions: [${QUESTION}], contacts: [{ id: uuid, role: string, person_name: string | null, contact: string | null, notes: string | null }],
      checklists: [{ scenario: string, label: string, containment: [string], recovery: [string] }],
      severities: [{ value: string, label: string, ... }] }`,
  }),

  // ---------- report and log ----------
  route('GET', '/api/security-incidents/:id/report', 'The incident report: timeline, decisions, notifications, checklist, roles, evidence and review', {
    tag: T, permission: VIEW,
    description: `${ON_INCIDENT} Opening the report is audited. \`actions\` is null unless the action tracker is switched on and the caller has \`actions.view\`.`,
    response: `{ generated_at: datetime, generated_by: string,
      incident: { id: uuid, ref: string, title: string, status_label: string | null, stage: string | null, answers: [{ question: string, yes: boolean }], ... },
      timeline: [{ id: uuid, at: datetime, author_name: string, entry: string, kind: string, kind_label: string }],
      decisions: [{ id: uuid, at: datetime, author_name: string, entry: string, kind: string }],
      notifications: [${CLOCK}],
      checklist: [{ phase: string, label: string, items: [{ phase: string, step: string, done: boolean, done_by_name: string | null, done_at: datetime | null, scenario: string | null }] }],
      roles: [{ role: string, person_name: string | null, contact: string | null }],
      evidence: [{ item: string, where_held: string | null, collected_by: string | null, collected_at: datetime | null, hash_ref: string | null }],
      review: { status: string, status_label: string | null, stage: string, due_on: date | null, completed_at: datetime | null, ... },
      actions: [{ ref: string, title: string, status: string, status_label: string, due_on: date | null, completed_on: date | null, owner: string | null }] | null }`,
  }),
  route('GET', '/api/security-incidents/:id/log', 'The incident log, newest first', {
    tag: T, permission: VIEW, description: `${ON_INCIDENT} The log is append-only.`, response: `[${LOG_ENTRY}]`,
  }),
  route('POST', '/api/security-incidents/:id/log', 'Add an entry to the incident log', {
    tag: T, permission: EDIT,
    description: `${ON_INCIDENT} Entries cannot be changed or removed afterwards. Audited. ${VALIDATION} The time cannot be in the future.`,
    body: '{ entry: string, kind?: string "A value of the incident_log_kind list; default note.", at?: datetime "When it happened; default now." }',
    response: LOG_ENTRY, status: 201,
  }),

  // ---------- roles, evidence, checklist on an incident ----------
  ...child('roles', 'Incident role', '{ role: string, person_name?: string | null, contact?: string | null, sort?: number | null }', ROLE),
  ...child('evidence', 'Evidence item', '{ item: string, where_held?: string | null, collected_by?: string | null, collected_at?: datetime | null, hash_ref?: string | null }', EVIDENCE),
  route('GET', '/api/security-incidents/:id/checklist', 'Checklist steps of one incident', {
    tag: T, permission: VIEW, description: ON_INCIDENT, response: `[${CHECK_ITEM}]`,
  }),
  route('POST', '/api/security-incidents/:id/checklist', 'Add a checklist step to an incident', {
    tag: T, permission: EDIT, description: `${ON_INCIDENT} The step goes last in its phase. Audited. ${VALIDATION}`,
    body: '{ phase: string "A value of the incident_checklist_phase list.", step: string }', response: CHECK_ITEM, status: 201,
  }),
  route('PATCH', '/api/security-incidents/:id/checklist/:itemId', 'Tick or untick a checklist step', {
    tag: T, permission: EDIT, description: `${ON_INCIDENT} Records who ticked it and when. Audited.`,
    body: '{ done: boolean }', response: CHECK_ITEM,
  }),

  // ---------- configurable lists ----------
  route('GET', '/api/security-incidents/lists/:name', 'Values of a configurable incident list, retired ones included', {
    tag: T, permission: VIEW, description: `${R} ${LISTS}`, response: `[${LIST_VALUE}]`,
  }),
  route('POST', '/api/security-incidents/lists/:name', 'Add a value to a configurable incident list', {
    tag: T, permission: ADMIN,
    description: `${R} ${LISTS} The value is made from the name unless given. Audited. ${VALIDATION}`,
    body: `{ label: string, value?: string, color?: 'gray' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'purple', sort?: integer,
      hint?: string "Kinds only.", stage?: 'reported' | 'declared' | 'contained' | 'closed' "Statuses only; required for them." }`,
    response: LIST_VALUE, status: 201,
  }),
  route('PATCH', '/api/security-incidents/lists/:name/:id', 'Change or retire a value of a configurable incident list', {
    tag: T, permission: ADMIN,
    description: `${R} ${LISTS} Audited. 409 \`in_use\` when retiring a value still in use; 409 \`lifecycle\` when the lifecycle would lose its last reported, declared or closed status.`,
    body: `{ label?: string, color?: 'gray' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'purple', sort?: integer, active?: boolean,
      hint?: string, stage?: 'reported' | 'declared' | 'contained' | 'closed' }`,
    response: LIST_VALUE,
  }),
  route('DELETE', '/api/security-incidents/lists/:name/:id', 'Retire a value of a configurable incident list', {
    tag: T, permission: ADMIN,
    description: `${R} ${LISTS} The value is kept, switched off. Audited. 409 \`in_use\` or \`lifecycle\` as for a change.`,
    response: '{ ok: boolean }',
  }),

  // ---------- configuration tables ----------
  ...config('/api/security-notification-rules', RULES, 'notification rule',
    `{ trigger_attribute: string "any, a flag or kind:<value>; see GET /api/security-incidents/questions.", party: string, deadline_hours?: number | null "Hours from discovery, 0 to one year.",
      required?: boolean, guidance?: string | null, active?: boolean "Default on.", sort?: number | null }`,
    RULE, { note: `An active rule needs a deadline. ${RESYNC}` }),
  ...config('/api/security-checklist-templates', TEMPLATES, 'checklist template step',
    '{ scenario: string "A value of the security_incident_scenario list.", phase: string "A value of the incident_checklist_phase list.", step: string, sort?: number | null, active?: boolean }',
    TEMPLATE, { query: { scenario: 'Only the steps of this scenario.' } }),
  ...config('/api/security-incident-contacts', CONTACTS, 'standing incident contact',
    '{ role: string, person_name?: string | null, contact?: string | null, notes?: string | null, sort?: number | null }',
    CONTACT),
];
