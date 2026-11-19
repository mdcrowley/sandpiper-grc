import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

const T = 'Tickets';
const SL = 'Service levels';
const VIEW = 'tickets.view';
const ADMIN = 'tickets.administer';
const SEEN = 'The ticket must be visible to the caller (404 otherwise).';
const CLOCK = "{ state: 'none' | 'running' | 'paused' | 'met' | 'breached', due_at: datetime | null, projected_due_at: datetime | null, met_at: datetime | null, breached: boolean, remaining_minutes: integer | null \"Working minutes left; negative when overdue\" }";
const RULE = '{ id: uuid, name: string, condition: string, wait_minutes: integer, to_user_id: uuid | null, to_user_name: string | null, to_group: string | null, enabled: boolean, fired: integer }';
const RULE_BODY = "{ name: string, condition: 'unassigned' | 'no_response' | 'untouched', wait_minutes: integer, to_user_id?: uuid | null, to_group?: string | null, enabled?: boolean }";
const MATRIX = '{ default: string "Priority used when no cell matches", cells: { [impact]: { [urgency]: string } } }';
const HOURS = '{ [day]: [string] | null }';
const CALENDAR = `{ id: uuid, key: string, name: string, timezone: string, always_open: boolean, hours: ${HOURS}, holidays: [{ id: uuid, day: date, name: string }] }`;
const HOLIDAY = '{ id: uuid, calendar_id: uuid, day: date, name: string }';
const POLICY = '{ id: uuid, priority: string, respond_minutes: integer, resolve_minutes: integer, calendar_id: uuid, ... }';
const SETTINGS = '{ warning_pct: integer, groups: [{ value: string, label: string, members: [{ id: uuid, label: string }] }], notifications: boolean }';
const GROUPED = '[{ value: string | null, label: string, color: string, count: integer, breached: integer }]';
const VALIDATION = 'Invalid input answers 400 `validation` with the fields at fault.';

/** Descriptions of the tickets module's hand-written routes (server/src/modules/tickets). */
export const DOCS: RouteDoc[] = [
  // ---------- one ticket ----------
  route('POST', '/api/tickets/:id/approval', 'Approve or reject a ticket that needs approval', {
    tag: T, permission: 'tickets.approve',
    description: `${SEEN} A rejection needs a note. 409 \`no_approval\` when the ticket does not need approval. Audited; the owners and the person who logged the ticket are notified.`,
    body: "{ decision: 'approved' | 'rejected', note?: string }",
    response: '@ticket',
  }),
  route('GET', '/api/tickets/:id/escalations', 'Escalations recorded against one ticket, newest first', {
    tag: T, permission: VIEW, description: SEEN,
    response: '[{ id: uuid, rule_name: string, escalated_to: string, at: datetime }]',
  }),
  route('GET', '/api/tickets/:id/sla', 'Service-level clocks of one ticket', {
    tag: T, permission: VIEW, description: SEEN,
    response: `{ now: datetime, priority: string | null, status: string, status_category: string | null, paused: boolean, paused_at: datetime | null, paused_minutes: integer,
      policy: { respond_minutes: integer, resolve_minutes: integer, calendar: { id: uuid, key: string, name: string, timezone: string } } | null,
      response: ${CLOCK}, resolve: ${CLOCK}, breach_reason: string | null }`,
  }),

  // ---------- desk-wide views ----------
  route('GET', '/api/tickets/metrics', 'Service desk figures for tickets opened in a date range', {
    tag: T, permission: VIEW,
    description: 'All tickets when no range is given. Backlog and vendor-held counts describe the desk as it stands now and ignore the range. Runs the service-level sweep first. A bad date answers 400 `validation`.',
    query: { from: q('string', 'Start: a date (whole local day) or a date and time.'), to: q('string', 'End: a date (whole local day) or a date and time.') },
    response: `{ range: { from: datetime | null, to: datetime | null }, as_of: datetime, total: integer, open: integer, resolved: integer,
      volume_by_day: [{ day: date, opened: integer, resolved: integer }],
      by_category: ${GROUPED}, by_department: ${GROUPED}, by_priority: ${GROUPED}, by_status: ${GROUPED}, by_type: ${GROUPED},
      backlog: { total: integer, buckets: [{ key: string, label: string, count: integer, opened_after: datetime | null, opened_before: datetime }] },
      first_response: { average_minutes: number | null, count: integer }, resolution: { average_minutes: number | null, count: integer },
      sla: { response: { measured: integer, breached: integer, compliance_pct: number | null }, resolve: { measured: integer, breached: integer, compliance_pct: number | null }, compliance_pct: number | null, breaches: integer },
      satisfaction: { average: number | null, count: integer },
      vendor: { held: integer, tickets: integer, average_response_minutes: number | null, responses: integer } }`,
  }),
  route('GET', '/api/tickets/queue-counts', 'How many tickets sit behind each queue preset', {
    tag: T, permission: VIEW, description: 'Counts cover only the open tickets the caller may see; `mine` is those assigned to the caller.',
    response: '{ open: integer, mine: integer, unassigned: integer, at_risk: integer, breaching: integer, with_vendor: integer, awaiting_approval: integer, major: integer }',
  }),
  route('GET', '/api/tickets/suggest', 'Likely duplicate tickets and helpful articles for a title', {
    tag: T, permission: VIEW,
    description: 'Matches on up to six significant words of the title. Tickets are open or resolved in the last seven days and visible to the caller (at most 5); published articles (at most 4) appear only with `knowledge.view`, and agent-only articles only for IT agents.',
    query: { title: 'The title being written.', exclude: q('uuid', 'A ticket to leave out (the one being edited).') },
    response: `{ words: [string], tickets: [{ id: uuid, ref: string, title: string, status: string, priority: string | null, requester_name: string | null, opened_at: datetime, resolved_at: datetime | null, score: integer }],
      articles: [{ id: uuid, ref: string, title: string, category: string | null, audience: string, score: integer }] }`,
  }),

  // ---------- escalation rules ----------
  route('GET', '/api/tickets/escalation-rules', 'Escalation rules and the conditions they can wait for', {
    tag: SL, permission: VIEW,
    response: `{ rules: [${RULE}], conditions: [{ value: string, label: string }] }`,
  }),
  route('POST', '/api/tickets/escalation-rules', 'Add an escalation rule', {
    tag: SL, permission: ADMIN,
    description: `Escalate to a person or an assignment group, not both. ${VALIDATION} Audited.`,
    body: RULE_BODY, response: RULE, status: 201,
  }),
  route('PUT', '/api/tickets/escalation-rules/:id', 'Change an escalation rule', {
    tag: SL, permission: ADMIN,
    description: `Members left out keep their current values. ${VALIDATION} Audited.`,
    body: "{ name?: string, condition?: 'unassigned' | 'no_response' | 'untouched', wait_minutes?: integer, to_user_id?: uuid | null, to_group?: string | null, enabled?: boolean }",
    response: RULE,
  }),
  route('DELETE', '/api/tickets/escalation-rules/:id', 'Remove an escalation rule', {
    tag: SL, permission: ADMIN, description: 'The rule is switched off and marked removed; escalations it already made are kept. Audited.',
    response: '{ ok: boolean }',
  }),

  // ---------- priority matrix ----------
  route('GET', '/api/tickets/priority-matrix', 'The impact and urgency matrix that sets a ticket\'s priority', {
    tag: SL, permission: VIEW, response: MATRIX,
  }),
  route('PUT', '/api/tickets/priority-matrix', 'Replace the priority matrix', {
    tag: SL, permission: ADMIN,
    description: 'Every value must be a ticket priority (400 `validation` otherwise). Stored as a setting, which is audited.',
    body: MATRIX, response: MATRIX,
  }),

  // ---------- targets, calendars and holidays ----------
  route('GET', '/api/tickets/sla/preview', 'When a ticket logged now with a priority would fall due', {
    tag: SL, permission: VIEW,
    query: { priority: 'Ticket priority value.' },
    response: '{ policy: { respond_minutes: integer, resolve_minutes: integer, calendar_name: string } | null, response_due_at: datetime | null, resolve_due_at: datetime | null }',
  }),
  route('GET', '/api/tickets/sla/policies', 'Response and resolution targets for each priority', {
    tag: SL, permission: VIEW, response: '[{ id: uuid, priority: string, respond_minutes: integer, resolve_minutes: integer, calendar_id: uuid, calendar_name: string }]',
  }),
  route('PUT', '/api/tickets/sla/policies/:priority', 'Set the targets for one priority', {
    tag: SL, permission: ADMIN,
    description: `404 when the priority is not a ticket priority. ${VALIDATION} Audited.`,
    body: '{ respond_minutes: integer "Working minutes", resolve_minutes: integer "Working minutes", calendar_id: uuid }',
    response: POLICY,
  }),
  route('GET', '/api/tickets/sla/calendars', 'Working calendars with their holidays', {
    tag: SL, permission: VIEW, response: `[${CALENDAR}]`,
  }),
  route('POST', '/api/tickets/sla/calendars', 'Add a working calendar', {
    tag: SL, permission: ADMIN,
    description: `A new calendar is open 08:00 to 17:00 on weekdays unless always open; the time zone defaults to that of the first calendar. Names must be unique. ${VALIDATION} Audited.`,
    body: '{ name: string, timezone?: string "An IANA time zone", always_open?: boolean }',
    response: CALENDAR, status: 201,
  }),
  route('PUT', '/api/tickets/sla/calendars/:id', 'Change a working calendar', {
    tag: SL, permission: ADMIN,
    description: `Days in \`hours\` are mon to sun, each an [opening, closing] pair as HH:MM or null for a closed day. Members left out keep their values. ${VALIDATION} Audited.`,
    body: `{ name?: string, timezone?: string, always_open?: boolean, hours?: ${HOURS} }`,
    response: `{ id: uuid, name: string, timezone: string, always_open: boolean, hours: ${HOURS} }`,
  }),
  route('DELETE', '/api/tickets/sla/calendars/:id', 'Retire a working calendar', {
    tag: SL, permission: ADMIN,
    description: '409 `in_use` while any priority\'s targets use the calendar. Audited.',
    response: '{ ok: boolean }',
  }),
  route('POST', '/api/tickets/sla/calendars/:id/holidays', 'Add a holiday to a calendar', {
    tag: SL, permission: ADMIN,
    description: 'A holiday on a day already listed replaces its name. Audited.',
    body: '{ day: date, name?: string }', response: HOLIDAY, status: 201,
  }),
  route('DELETE', '/api/tickets/sla/holidays/:id', 'Remove a holiday', {
    tag: SL, permission: ADMIN, description: 'Audited.', response: '{ ok: boolean }',
  }),
  route('GET', '/api/tickets/sla/settings', 'Warning threshold and assignment group members', {
    tag: SL, permission: VIEW,
    description: '`notifications` says whether notifications are available to send warnings and escalations.',
    response: SETTINGS,
  }),
  route('PUT', '/api/tickets/sla/settings', 'Change the warning threshold or assignment group members', {
    tag: SL, permission: ADMIN,
    description: `\`warning_pct\` is the share of a target used before the owner is warned (0 switches warnings off). \`group_members\` replaces all groups' members. ${VALIDATION}`,
    body: '{ warning_pct?: integer, group_members?: { [group]: [uuid] } }',
    response: SETTINGS,
  }),

  // ---------- problems and knowledge ----------
  route('POST', '/api/problems/:id/publish-known-error', 'Draft a known-error article from a problem', {
    tag: 'Problems', permission: 'tickets.edit',
    description: 'Also needs `knowledge.create`. Creates a draft agent-only article from the description, root cause and workaround, links it to the problem and marks it a known error. 409 `already_published` when the problem already has an article. Audited.',
    response: '@knowledge_article', status: 201,
  }),
  route('GET', '/api/knowledge/:id/versions', 'Versions of a knowledge article, newest first', {
    tag: 'Knowledge articles', permission: 'knowledge.view',
    description: 'The article must be visible to the caller (404 otherwise). The first entry is the current version.',
    response: '[{ version: integer, title: string, body: string | null, saved_at: datetime, saved_by_name: string | null, current: boolean }]',
  }),
  route('POST', '/api/knowledge/:id/feedback', 'Say whether a knowledge article helped', {
    tag: 'Knowledge articles', permission: 'knowledge.view',
    description: 'One vote a person for each article version; voting again replaces the earlier vote. The article must be visible to the caller (404 otherwise). Audited when the vote changes.',
    body: '{ helpful: boolean }',
    response: '{ helpful_yes: integer, helpful_no: integer, your_vote: boolean, changed: boolean }',
  }),
];
