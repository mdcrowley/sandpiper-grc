import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the vendors module's hand-written routes (server/src/modules/vendors). */

const VENDOR = 'Needs view on the vendor (404 `not_found` otherwise).';
const CONTRACT = 'Needs view on the contract (404 `not_found` otherwise).';
const ASSESSMENT = 'Needs view on the assessment\'s vendor (404 `not_found` otherwise).';

const CONTACT = `{ id: uuid, vendor_id: uuid, name: string, role: string | null, email: string | null, phone: string | null,
  is_incident_contact: boolean, updated_at: datetime }`;
const TERMS = '{ present: integer, partial: integer, absent: integer, not_assessed: integer }';
const CLAUSE = `{ clause_key: string, label: string, description: string | null, status: 'present' | 'partial' | 'absent' | null,
  clause_text: string | null, note: string | null, updated_at: datetime | null }`;
const REMINDER = `{ threshold_days: integer, due_on: date, fired_at: datetime | null, superseded: boolean,
  state: 'scheduled' | 'due' | 'fired' | 'superseded' }`;
const SETTINGS = `{ contract_days: [integer] "Days before the notice date", evidence_days: [integer] "Days before evidence expires",
  can_edit: boolean, delivered: boolean "Whether notifications are available to send them" }`;
const QUESTION = '{ key: string, section: string | null, text: string, guidance: string | null, weight: integer }';
const ASSESSMENT_BASE = `id: uuid, vendor_id: uuid, status: 'draft' | 'completed', assessed_on: date | null,
  score: integer | null "0 to 100", version: integer, set_title: string, answered: integer, total: integer, gaps: integer,
  notes: string | null, evidence_item_id: uuid | null, created_at: datetime, completed_at: datetime | null, completed_by_name: string | null`;
const ASSESSMENT_FULL = `{ ${ASSESSMENT_BASE}, questions: [${QUESTION}],
  answers: { [key]: { answer?: 'yes' | 'partial' | 'no' | 'na' | null, note?: string | null, action_id?: uuid | null } },
  gap_list: [{ key: string, section: string | null, text: string, weight: integer, answer: 'no' | 'partial', note: string | null, action_id: uuid | null }] }`;

export const DOCS: RouteDoc[] = [
  // ---- vendors ----
  route('GET', '/api/vendors/overview', 'Contracts, next notice date and security-terms coverage per vendor, for the vendor list', {
    tag: 'Vendors', permission: 'vendors.view',
    description: '`vendors` is empty without `contracts.view`.',
    response: `{ today: date, vendors: { [vendorId]: { contracts: integer, notice_date: date | null, terms: ${TERMS} } } }`,
  }),
  route('GET', '/api/vendors/terms-matrix', 'Security terms of every vendor\'s contracts, clause by clause', {
    tag: 'Vendors', permission: 'vendors.view',
    description: 'Also needs `contracts.view` (403 otherwise). A cell shows the worst status across the vendor\'s contracts that have not ended.',
    query: { criticality: 'Comma-separated vendor_criticality values.' },
    response: `{ clauses: [{ key: string, label: string, description: string | null }],
      vendors: [{ id: uuid, ref: string, name: string, criticality: string | null, criticality_label: string | null, criticality_color: string, contracts: integer,
        cells: { [clauseKey]: { status: 'present' | 'partial' | 'absent' | null,
          items: [{ contract_id: uuid, contract_ref: string, contract_title: string, status: string | null, clause_text: string | null, note: string | null }] } } }] }`,
  }),
  route('GET', '/api/vendors/evidence-expiring', 'Vendor evidence expired or expiring soon', {
    tag: 'Vendors', permission: 'vendors.view',
    query: { days: q('integer', 'Days ahead, 0 to 3650 (default 90). Already expired items are always included.') },
    response: `{ today: date, days: integer,
      rows: [{ id: uuid, title: string, type: string, type_label: string, type_color: string, vendor_id: uuid, vendor_name: string, contract_id: uuid | null,
        received_on: date | null, expires_on: date, note: string | null, days_left: integer, expired: boolean }] }`,
  }),
  route('GET', '/api/vendors/:id/summary', 'Headline facts about one vendor', {
    tag: 'Vendors', permission: 'vendors.view',
    description: `${VENDOR} Contract figures and terms are zero without \`contracts.view\`; \`systems\` is null without view on systems.`,
    response: `{ today: date, sees_contracts: boolean, contracts: integer, contracts_open: integer, contracts_undated: integer,
      next_notice_date: date | null,
      next_notice_contract: { id: uuid, ref: string, title: string, renewal_mechanism: string | null, end_date: date | null } | null,
      notice_dates_passed: integer, terms: ${TERMS},
      incident_contacts: [{ name: string, role: string | null, email: string | null, phone: string | null }],
      evidence: integer, evidence_current: integer, evidence_expired: integer, evidence_expiring: integer "Within 90 days",
      evidence_latest_received: date | null,
      assessment: { id: uuid | null, score: integer | null, assessed_on: date | null, gaps: integer, draft_id: uuid | null },
      systems: integer | null }`,
  }),
  route('GET', '/api/vendors/:id/contacts', 'Contacts at one vendor, incident contacts first', {
    tag: 'Vendors', permission: 'vendors.view', description: VENDOR, response: `[${CONTACT}]`,
  }),
  route('POST', '/api/vendors/:id/contacts', 'Add a contact to a vendor', {
    tag: 'Vendors', permission: 'vendors.edit', status: 201, description: `${VENDOR} Audited on the vendor.`,
    body: '{ name: string, role?: string, email?: email, phone?: string, is_incident_contact?: boolean }',
    response: CONTACT,
  }),
  route('PATCH', '/api/vendors/:id/contacts/:contactId', 'Change a vendor contact', {
    tag: 'Vendors', permission: 'vendors.edit', description: `${VENDOR} Audited on the vendor when something changes.`,
    body: '{ name?: string, role?: string | null, email?: email | null, phone?: string | null, is_incident_contact?: boolean }',
    response: CONTACT,
  }),
  route('DELETE', '/api/vendors/:id/contacts/:contactId', 'Remove a vendor contact', {
    tag: 'Vendors', permission: 'vendors.edit', description: `${VENDOR} Audited on the vendor.`,
    response: '{ ok: boolean }',
  }),

  // ---- assessment questions and assessments ----
  route('GET', '/api/vendors/question-sets', 'The active assessment questions and earlier versions', {
    tag: 'Vendors', permission: 'vendors.view',
    response: `{ active: { id: uuid, version: integer, title: string, active: boolean, created_at: datetime, questions: [${QUESTION}] } | null,
      versions: [{ id: uuid, version: integer, title: string, active: boolean, created_at: datetime, questions: integer }] }`,
  }),
  route('POST', '/api/vendors/question-sets', 'Save the assessment questions as a new active version', {
    tag: 'Vendors', permission: 'vendors.administer', status: 201,
    description: 'Earlier versions are kept; assessments already started keep their own version. Audited.',
    body: `{ title?: string "At most 120 characters",
      questions: [{ key?: string "a-z, 0-9 and _; made up when missing or repeated", section?: string, text: string, guidance?: string, weight?: integer "1 to 5, default 1" }] "1 to 60 questions" }`,
    response: `{ id: uuid, version: integer, title: string, active: boolean, created_at: datetime, questions: [${QUESTION}] }`,
  }),
  route('GET', '/api/vendors/:id/assessments', 'Assessments of one vendor, draft first', {
    tag: 'Vendors', permission: 'vendors.view', description: VENDOR,
    response: `{ rows: [{ ${ASSESSMENT_BASE} }], can_raise_actions: boolean }`,
  }),
  route('POST', '/api/vendors/:id/assessments', 'Start an assessment of a vendor (or carry on with its draft)', {
    tag: 'Vendors', permission: 'vendors.edit', status: 201,
    description: `${VENDOR} Uses the active questions. When a draft exists it is returned (200) instead. 409 \`no_questions\` when no questions are set up. Audited.`,
    response: ASSESSMENT_FULL,
  }),
  route('GET', '/api/vendor-assessments/:aid', 'One vendor assessment with its questions, answers and gaps', {
    tag: 'Vendor assessments', permission: 'vendors.view', description: ASSESSMENT, response: ASSESSMENT_FULL,
  }),
  route('PATCH', '/api/vendor-assessments/:aid', 'Save answers or notes on a draft assessment', {
    tag: 'Vendor assessments', permission: 'vendors.edit',
    description: `${ASSESSMENT} Only the questions sent are written. 409 \`completed\` for a completed assessment. Audited.`,
    body: `{ answers?: { [questionKey]: { answer?: 'yes' | 'partial' | 'no' | 'na' | null, note?: string | null } }, notes?: string | null }`,
    response: ASSESSMENT_FULL,
  }),
  route('DELETE', '/api/vendor-assessments/:aid', 'Discard a draft assessment', {
    tag: 'Vendor assessments', permission: 'vendors.edit',
    description: `${ASSESSMENT} 409 \`completed\`: a completed assessment is kept as history. Audited.`,
    response: '{ ok: boolean }',
  }),
  route('POST', '/api/vendor-assessments/:aid/complete', 'Complete and score an assessment', {
    tag: 'Vendor assessments', permission: 'vendors.edit',
    description: `${ASSESSMENT} Every question needs an answer (400 \`incomplete\`). \`save_evidence\` also adds an evidence item and needs \`vendors.create\`. 409 \`completed\` when already completed. Audited.`,
    body: '{ assessed_on?: date "Default today; not in the future", save_evidence?: boolean, evidence_expires_on?: date }',
    response: ASSESSMENT_FULL,
  }),
  route('POST', '/api/vendor-assessments/:aid/gaps/:key/action', 'Raise an action for a gap in a completed assessment', {
    tag: 'Vendor assessments', permission: 'vendors.edit', status: 201,
    description: `${ASSESSMENT} Also needs \`actions.create\`. 409 \`no_actions\` when the action tracker is off, \`draft\` before completion, \`exists\` when the gap already has an action; 404 when the question is not a gap. Audited.`,
    body: '{ owner_id?: uuid, due_on?: date }',
    response: '{ id: uuid, ref: string | null, title: string }',
  }),

  // ---- contracts ----
  route('GET', '/api/contracts/:id/clauses', 'Security-terms checklist of one contract', {
    tag: 'Contracts', permission: 'contracts.view', description: CONTRACT, response: `[${CLAUSE}]`,
  }),
  route('PUT', '/api/contracts/:id/clauses/:key', 'Record one security term of a contract', {
    tag: 'Contracts', permission: 'contracts.edit',
    description: `${CONTRACT} Only the members sent are changed. 404 \`unknown_clause\` for a key not in the contract_clause list. Audited.`,
    body: `{ status?: 'present' | 'partial' | 'absent' | null, clause_text?: string | null, note?: string | null }`,
    response: CLAUSE,
  }),
  route('PATCH', '/api/contracts/:id/clauses/:key', 'Record one security term of a contract', {
    tag: 'Contracts', permission: 'contracts.edit',
    description: `${CONTRACT} Same as PUT. Only the members sent are changed. 404 \`unknown_clause\` for a key not in the contract_clause list. Audited.`,
    body: `{ status?: 'present' | 'partial' | 'absent' | null, clause_text?: string | null, note?: string | null }`,
    response: CLAUSE,
  }),
  route('POST', '/api/contracts/:id/clauses/bulk', 'Set one status on many security terms of a contract', {
    tag: 'Contracts', permission: 'contracts.edit',
    description: `${CONTRACT} Each change is audited.`,
    body: `{ status: 'present' | 'partial' | 'absent', scope?: 'all' "Default: only terms not yet assessed" }`,
    response: `{ changed: integer, clauses: [${CLAUSE}] }`,
  }),
  route('GET', '/api/contracts/:id/reminders', 'Notice-date reminders of one contract', {
    tag: 'Contracts', permission: 'contracts.view',
    description: `${CONTRACT} Empty when the contract has no notice date or has ended.`,
    response: `{ today: date, thresholds: [integer], closed: boolean, reminders: [${REMINDER}] }`,
  }),
  route('GET', '/api/contracts/renewals', 'Renewal calendar: open contracts by notice date', {
    tag: 'Contracts', permission: 'contracts.view',
    description: '`vendor_name` is null without `vendors.view`.',
    response: `{ today: date, thresholds: [integer],
      contracts: [{ id: uuid, ref: string, title: string, vendor_id: uuid, vendor_name: string | null, status: string | null, status_label: string | null, status_color: string,
        renewal_mechanism: string | null, renewal_label: string | null, start_date: date | null, end_date: date | null, notice_days: integer | null, notice_date: date,
        total_value: number | null, owner_id: uuid | null, owner_name: string | null, term_and_renewal: string | null,
        days_to_notice: integer, window: string "passed, a reminder threshold, or later", reminders: [${REMINDER}] }],
      undated: [{ id: uuid, ref: string, title: string, vendor_name: string | null, ... }] "Open contracts with no notice date",
      can_administer: boolean }`,
  }),
  route('GET', '/api/contracts/missing-dates', 'Open contracts missing an end date or notice period', {
    tag: 'Contracts', permission: 'contracts.view',
    description: 'A contract that runs until ended needs no end date. `vendor_name` is null without `vendors.view`.',
    response: `{ today: date,
      rows: [{ id: uuid, ref: string, title: string, vendor_id: uuid, vendor_name: string | null, status: string | null, renewal_mechanism: string | null, renewal_label: string | null,
        start_date: date | null, end_date: date | null, notice_days: integer | null, notice_date: date | null, term: string | null,
        owner_id: uuid | null, owner_name: string | null, term_and_renewal: string | null, date_and_resolution: string | null, document_on_file: string | null,
        missing: ['end_date' | 'notice_days'] }] }`,
  }),
  route('GET', '/api/contracts/reminder-settings', 'When renewal and evidence reminders go out', {
    tag: 'Contracts', permission: 'contracts.view', response: SETTINGS,
  }),
  route('PUT', '/api/contracts/reminder-settings', 'Change when renewal and evidence reminders go out', {
    tag: 'Contracts', permission: 'contracts.administer',
    description: 'Each list holds 1 to 12 distinct whole numbers from 1 to 3650; a list left out is kept. A change is audited.',
    body: '{ contract_days?: [integer], evidence_days?: [integer] }',
    response: SETTINGS,
  }),
  route('PATCH', '/api/contracts/reminder-settings', 'Change when renewal and evidence reminders go out', {
    tag: 'Contracts', permission: 'contracts.administer',
    description: 'Same as PUT. Each list holds 1 to 12 distinct whole numbers from 1 to 3650; a list left out is kept. A change is audited.',
    body: '{ contract_days?: [integer], evidence_days?: [integer] }',
    response: SETTINGS,
  }),
];
