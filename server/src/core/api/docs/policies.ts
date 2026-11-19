import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the policies module's hand-written routes (server/src/modules/policies). */

const P = 'Policies';
const ONE_POLICY = '404 `not_found` when the policy does not exist or the caller may not see it.';
const ONE_VERSION = `${ONE_POLICY} 404 \`not_found\` for an unknown version.`;
const SIGNED_IN = 'Needs only a signed-in person: the people asked to acknowledge a policy often cannot open the policy library.';

const VERSION_STATUS = "'draft' | 'in_review' | 'approved' | 'published' | 'superseded'";
const VERSION = `{ id: uuid, policy_id: uuid, version: integer, status: ${VERSION_STATUS}, change_summary: string | null,
  approved_by_name: string | null, approved_on: date | null, effective_on: date | null, published_at: datetime | null,
  created_at: datetime, updated_at: datetime, author_name: string | null, created_by: uuid | null,
  body: string "Markdown", body_html: string "Rendered, safe HTML" }`;

const ACK_STATE = "'outstanding' | 'overdue' | 'acknowledged' | 'superseded'";
const MY_ACK = `{ id: uuid, policy_id: uuid, policy_ref: string | null, policy_title: string, policy_summary: string | null,
  version: integer, effective_on: date | null, requested_at: datetime, due_on: date, acknowledged_at: datetime | null,
  state: ${ACK_STATE}, days_left: integer }`;
const COUNTS = '{ total: integer, acknowledged: integer, outstanding: integer, overdue: integer, acknowledged_pct: number, outstanding_pct: number, overdue_pct: number }';

export const DOCS: RouteDoc[] = [
  // ---- settings and helpers
  route('GET', '/api/policies/settings', 'Policy settings', {
    tag: P, permission: 'policies.view', response: '{ reminder_interval_days: integer }',
  }),
  route('PUT', '/api/policies/settings', 'Change policy settings', {
    tag: P, permission: 'policies.administer',
    description: 'Days between reminders to people who are overdue acknowledging, 1 to 90 (400 `validation` otherwise). Audited by the settings service.',
    body: '{ reminder_interval_days: integer }', response: '{ reminder_interval_days: integer }',
  }),
  route('POST', '/api/policies/preview', 'Render policy text to HTML', {
    tag: P, permission: 'policies.view', description: 'Nothing is saved. The text is cut at 200,000 characters.',
    body: '{ body: string "Markdown" }', response: '{ html: string }',
  }),
  route('GET', '/api/policies/audience-options', 'Roles and departments a policy audience can name', {
    tag: P, permission: 'policies.view',
    response: '{ roles: [{ key: string, name: string, enabled: boolean }], departments: [{ id: uuid, name: string }] }',
  }),
  route('GET', '/api/policies/:id/audience', 'How many people would be asked to acknowledge if a version were published now', {
    tag: P, permission: 'policies.view', description: ONE_POLICY,
    response: '{ count: integer, ack_days: integer }',
  }),

  // ---- versions and life cycle
  route('GET', '/api/policies/:id/versions', 'Versions of a policy, newest first', {
    tag: P, permission: 'policies.view',
    description: `${ONE_POLICY} Callers without \`policies.edit\` or \`policies.approve\` see only published and superseded versions.`,
    response: `[${VERSION}]`,
  }),
  route('POST', '/api/policies/:id/versions', 'Start a new draft version', {
    tag: P, permission: 'policies.edit', status: 201,
    description: `${ONE_POLICY} 409 \`retired\` for a retired policy; 409 \`version_open\` while another version is not yet published. Audited.`,
    body: '{ body: string "Markdown, up to 200,000 characters", change_summary?: string | null }',
    response: VERSION,
  }),
  route('PATCH', '/api/policies/:id/versions/:vid', 'Edit a draft version', {
    tag: P, permission: 'policies.edit',
    description: `${ONE_VERSION} 409 \`not_draft\` unless the version is a draft. Audited.`,
    body: '{ body?: string "Markdown", change_summary?: string | null }',
    response: VERSION,
  }),
  route('DELETE', '/api/policies/:id/versions/:vid', 'Discard a version that has not been approved', {
    tag: P, permission: 'policies.edit',
    description: `${ONE_VERSION} 409 \`not_draft\` unless the version is a draft or in review. The text is kept in the audit event.`,
    response: '{ ok: boolean, status: string "The policy\'s status afterwards" }',
  }),
  route('POST', '/api/policies/:id/versions/:vid/submit', 'Send a draft version for review', {
    tag: P, permission: 'policies.edit',
    description: `${ONE_VERSION} 409 \`not_draft\` unless the version is a draft. Audited.`,
    response: VERSION,
  }),
  route('POST', '/api/policies/:id/versions/:vid/approve', 'Approve a version', {
    tag: P, permission: 'policies.approve',
    description: `${ONE_VERSION} The author cannot approve their own version (403 \`own_version\`). 409 \`retired\` for a retired policy; 409 \`not_open\` when already approved. Audited.`,
    body: '{ approved_on?: date "Default today", effective_on?: date | null, approved_by_name?: string "Default the policy\'s approver, else the caller" }',
    response: VERSION,
  }),
  route('POST', '/api/policies/:id/versions/:vid/publish', 'Publish an approved version and ask its audience to acknowledge it', {
    tag: P, permission: 'policies.approve',
    description: `${ONE_VERSION} The previous published version is superseded and its outstanding acknowledgements closed; each person in the audience is asked to acknowledge by the due date and notified. 409 \`retired\`, \`already_published\` or \`not_approved\`. Audited.`,
    body: '{ effective_on?: date | null "Default the approved effective date, else today" }',
    response: `{ version: ${VERSION}, requested: integer "People asked to acknowledge", due_on: date, status: string "The policy's status afterwards" }`,
  }),
  route('POST', '/api/policies/:id/retire', 'Retire a policy', {
    tag: P, permission: 'policies.approve',
    description: `${ONE_POLICY} Closes outstanding acknowledgement requests. 409 \`retired\` when already retired. Audited.`,
    response: "{ ok: boolean, status: 'retired', closed: integer \"Acknowledgement requests closed\" }",
  }),

  // ---- framework outcomes
  route('GET', '/api/policies/:id/outcomes', 'Framework outcomes a policy supports', {
    tag: P, permission: 'policies.view',
    description: `${ONE_POLICY} \`available\` is false (and the list empty) when framework outcomes are not loaded or the caller may not view them.`,
    response: `{ available: boolean, route: string | null, rows: [{ link_id: uuid, id: uuid, code: string | null, title: string,
      status: string | null, status_list: string | null, linked_at: datetime }] }`,
  }),
  route('POST', '/api/policies/:id/outcomes', 'Map a policy to a framework outcome', {
    tag: P, permission: 'policies.edit', status: 201,
    description: `${ONE_POLICY} Answers 201 when the mapping is made and 200 when it already existed. 409 \`unavailable\` when framework outcomes are not available to the caller. Audited.`,
    body: '{ outcome_id: uuid }', response: '{ ok: boolean, added: boolean }',
  }),
  route('DELETE', '/api/policies/:id/outcomes/:outcomeId', 'Remove the mapping of a policy to a framework outcome', {
    tag: P, permission: 'policies.edit',
    description: `${ONE_POLICY} 404 \`not_found\` when the outcome is not mapped. Audited.`,
    response: '{ ok: boolean }',
  }),

  // ---- acknowledgements
  route('GET', '/api/policies/acknowledgements/mine', 'Your acknowledgement requests', {
    tag: P, description: `${SIGNED_IN} Closed requests you never acknowledged are left out.`,
    response: `{ today: date, awaiting: [${MY_ACK}] "Outstanding and overdue, soonest due first", acknowledged: [${MY_ACK}] "Newest first" }`,
  }),
  route('GET', '/api/policies/acknowledgements/:ackId', 'One of your acknowledgement requests, with the text to acknowledge', {
    tag: P, description: `${SIGNED_IN} Only the caller's own requests; 404 \`not_found\` otherwise. The text is exactly the version named in the request.`,
    response: `{ id: uuid, policy_id: uuid, policy_ref: string | null, policy_title: string, policy_summary: string | null,
      version: integer, effective_on: date | null, requested_at: datetime, due_on: date, acknowledged_at: datetime | null,
      state: ${ACK_STATE}, days_left: integer, change_summary: string | null, body_html: string }`,
  }),
  route('POST', '/api/policies/acknowledgements/:ackId/acknowledge', 'Acknowledge a policy version', {
    tag: P, description: `${SIGNED_IN} Only the caller's own requests (404 \`not_found\` otherwise). Repeating it changes nothing. 409 \`superseded\` when the version was replaced or the policy retired. Audited.`,
    response: MY_ACK,
  }),
  route('GET', '/api/policies/:id/acknowledgements', 'Who has and has not acknowledged a version of a policy', {
    tag: P, permission: 'policies.view',
    description: `${ONE_POLICY} Without \`version\`, the version published now (null when there is none). \`format=csv\` downloads the rows as CSV instead, needs \`policies.export\` as well (403 \`forbidden\` otherwise) and is audited.`,
    query: {
      version: q('integer', 'Version number (published or superseded).'),
      format: q("'csv'", 'Download as CSV.'),
    },
    response: `{ today: date, version: { id: uuid, version: integer, status: string, published_at: datetime | null } | null,
      counts: ${COUNTS},
      rows: [{ id: uuid, user_id: uuid, user_name: string, email: string | null, user_status: string, department: string | null,
        requested_at: datetime, due_on: date, acknowledged_at: datetime | null, reminded_at: datetime | null, reminder_count: integer,
        superseded_at: datetime | null, state: ${ACK_STATE}, days_overdue: integer }],
      departments: [{ department: string | null, total: integer, acknowledged: integer, outstanding: integer, overdue: integer,
        acknowledged_pct: number, outstanding_pct: number, overdue_pct: number }] }`,
  }),

  // ---- exceptions
  route('GET', '/api/exceptions/expiring', 'Approved exceptions running out soon, and those past their date', {
    tag: 'Exceptions', permission: 'exceptions.view',
    description: 'The policy reference and title are null for callers without `policies.view`.',
    query: { days: q('integer', 'Days ahead to look, up to 3650 (default 30).') },
    response: `{ today: date, days: integer, rows: [{ id: uuid, ref: string, title: string, status: 'approved' | 'expired', status_label: string,
      status_color: string, policy_id: uuid | null, policy_ref: string | null, policy_title: string | null, approver_name: string | null,
      approved_on: date | null, expires_on: date, requested_by_name: string | null, days_left: integer, expired: boolean }] }`,
  }),
];
