import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the changes module's hand-written routes (server/src/modules/changes). */

const T = 'Changes';
const CAL = 'Change calendar';
const SET = 'Change settings';
const TPL = 'Standard change templates';
const NOT_FOUND = '404 `not_found` when the change does not exist or the caller may not see it.';

const CONFLICT = `{ key: string "blackout:<id> or change:<id>", kind: 'blackout' | 'change', summary: string,
  starts_at: datetime, ends_at: datetime,
  record: { id: uuid, ref: string | null, title: string, status: string | null },
  shared_systems: [{ id: uuid, label: string }],
  acknowledged: { reason: string, by: string | null, at: datetime } | null }`;

const APPROVALS = `{ required: integer, received: integer, outstanding: integer,
  approver_roles: [string], retrospective_allowed: boolean, awaiting: boolean, retrospective: boolean,
  approved_retrospectively: boolean,
  pool: { users: [{ id: uuid, name: string }], roles: [{ key: string, name: string }] } | null,
  waiting_for: [string], can_decide: boolean,
  decisions: [{ id: uuid, decision: 'approved' | 'rejected', approver_name: string, approver_role: string | null,
    decided_on: date, reference: string | null, notes: string | null, retrospective: boolean,
    recorded_by_name: string, created_at: datetime, current: boolean, ... }] }`;

const QUESTIONNAIRE = `{ questions: [{ key: string, label: string, help?: string, weight: number,
  options: [{ value: string, label: string, score: number }] }], bands: [{ level: string, upTo: number }] }`;

const RULES = `[{ change_type: string "A change type or 'any'", risk_level: string "A risk level or 'any'",
  approvals: integer, approver_roles: [string], approver_user_ids?: [uuid], approver_role_keys?: [string],
  pir_required: boolean, retrospective: boolean }]`;

const SETTINGS = `{ questionnaire: ${QUESTIONNAIRE}, approval_rules: ${RULES},
  roles: [{ key: string, name: string }], user_names: { [id]: string } }`;

const TEMPLATE = `{ id: uuid, name: string, summary: string | null, title: string, description: string | null,
  reason: string | null, implementation_plan: string, test_plan: string | null, backout_plan: string,
  risk_level: string, duration_minutes: integer, system_id: uuid | null, active: boolean, ... }`;

const TEMPLATE_BODY = (opt: string) => `{ name${opt}: string, summary?: string | null, title${opt}: string,
  description?: string | null, reason?: string | null, implementation_plan${opt}: string, test_plan?: string | null,
  backout_plan${opt}: string, risk_level?: string "A change_risk value; default low",
  duration_minutes?: integer "5 to 10080; default 60", system_id?: uuid | null, active?: boolean }`;

const BLACKOUT = `{ id: uuid, name: string, starts_at: datetime, ends_at: datetime, reason: string | null,
  repeat: 'none' | 'weekly' | 'monthly', repeat_until: date | null, system_ids: [uuid] | null, ... }`;

const BLACKOUT_BODY = (opt: string) => `{ name${opt}: string, starts_at${opt}: datetime, ends_at${opt}: datetime,
  reason?: string | null, repeat?: 'none' | 'weekly' | 'monthly', repeat_until?: date | null,
  system_ids?: [uuid] "Systems it applies to; empty for all systems" }`;

export const DOCS: RouteDoc[] = [
  // ---------- register, calendar and live conflict check ----------
  route('GET', '/api/changes/overview', 'Counts for the change register header', {
    tag: T, permission: 'changes.view',
    query: { week_from: q('datetime', 'Start of the week for `this_week`.'), week_to: q('datetime', 'End of the week (exclusive).') },
    response: '{ awaiting_approval: integer, in_progress: integer, upcoming: integer, emergency_open: integer, review_due: integer, this_week: integer }',
  }),
  route('GET', '/api/changes/calendar', 'Changes and blackout windows in a date range', {
    tag: CAL, permission: 'changes.view',
    description: 'At most 100 days at a time (400 `validation` otherwise); rejected and canceled changes are left out, at most 500 changes. A repeating blackout period gives one entry per window.',
    query: {
      from: q('datetime', 'Start of the range.'),
      to: q('datetime', 'End of the range (exclusive).'),
      system_id: q('uuid', 'Only changes affecting this system and the blackout periods that apply to it.'),
    },
    response: `{ from: datetime, to: datetime,
      changes: [{ id: uuid, ref: string, title: string, change_type: string, status: string, risk_level: string | null,
        system_id: uuid | null, assignee_id: uuid | null, assignee: string | null, planned_start: datetime, planned_end: datetime,
        systems: [{ id: uuid, label: string }], conflicts: [${CONFLICT}], unacknowledged: integer }],
      blackouts: [{ id: uuid, name: string, reason: string | null, repeat: string, starts_at: datetime, ends_at: datetime,
        systems: [{ id: uuid, label: string }] }],
      system: { id: uuid, label: string } | null }`,
  }),
  route('POST', '/api/changes/conflicts/check', 'Check a planned window for conflicts before saving', {
    tag: CAL, permission: 'changes.view',
    description: 'A read sent as POST. Returns no conflicts when the window is missing or ends before it starts. Nothing is stored.',
    body: '{ planned_start: datetime, planned_end: datetime, system_ids?: [uuid], exclude_id?: uuid "The change being edited, so it does not clash with itself" }',
    response: `{ conflicts: [${CONFLICT}] }`,
  }),

  // ---------- settings ----------
  route('GET', '/api/changes/settings', 'Risk questionnaire and approval rules', {
    tag: SET, permission: 'changes.view', response: SETTINGS,
  }),
  route('PUT', '/api/changes/settings', 'Change the risk questionnaire or approval rules', {
    tag: SET, permission: 'changes.administer',
    description: 'Partial: send either part. Invalid entries give 400 `validation` with per-field messages. When a part changes, every draft change is recalculated (each audited); `recalculated` counts them.',
    body: `{ questionnaire?: ${QUESTIONNAIRE}, approval_rules?: ${RULES} }`,
    response: `{ questionnaire: ${QUESTIONNAIRE}, approval_rules: ${RULES}, roles: [{ key: string, name: string }], user_names: { [id]: string }, recalculated: integer }`,
  }),
  route('PATCH', '/api/changes/settings', 'Change the risk questionnaire or approval rules (same as PUT)', {
    tag: SET, permission: 'changes.administer',
    description: 'The same as PUT; both take a partial body.',
    body: `{ questionnaire?: ${QUESTIONNAIRE}, approval_rules?: ${RULES} }`,
    response: `{ questionnaire: ${QUESTIONNAIRE}, approval_rules: ${RULES}, roles: [{ key: string, name: string }], user_names: { [id]: string }, recalculated: integer }`,
  }),

  // ---------- standard change templates ----------
  route('GET', '/api/changes/templates', 'Standard change templates with how often each is used', {
    tag: TPL, permission: 'changes.view',
    description: 'Active templates only, unless `all=true` and the caller holds `changes.administer`.',
    query: { all: q('boolean', 'Include inactive templates (administrators only).') },
    response: `[{ id: uuid, name: string, title: string, risk_level: string, duration_minutes: integer, active: boolean,
      uses: integer, uses_90_days: integer, last_used_at: datetime | null, system_label: string | null, ... }]`,
  }),
  route('POST', '/api/changes/templates', 'Add a standard change template', {
    tag: TPL, permission: 'changes.administer', description: 'Audited.',
    body: TEMPLATE_BODY(''), response: TEMPLATE, status: 201,
  }),
  route('PATCH', '/api/changes/templates/:templateId', 'Change a standard change template', {
    tag: TPL, permission: 'changes.administer', description: 'Audited when something changes. 404 `not_found` for an unknown template.',
    body: TEMPLATE_BODY('?'), response: TEMPLATE,
  }),
  route('DELETE', '/api/changes/templates/:templateId', 'Delete a standard change template', {
    tag: TPL, permission: 'changes.administer', description: 'Soft delete; audited. Changes raised from it keep their template name.',
    response: '{ ok: boolean }',
  }),
  route('POST', '/api/changes/templates/:templateId/raise', 'Raise a pre-approved standard change from a template', {
    tag: TPL, permission: 'changes.create',
    description: 'The change is created as `approved` with the template\'s plans and risk; the end defaults to the start plus the template\'s duration. 409 `template_inactive` when the template is no longer in use. Audited.',
    body: '{ planned_start: datetime, planned_end?: datetime, title?: string, description?: string, system_id?: uuid, asset_id?: uuid, assignee_id?: uuid, owner_id?: uuid }',
    response: '@change', status: 201,
  }),

  // ---------- blackout periods ----------
  route('GET', '/api/changes/blackouts', 'Blackout periods', {
    tag: CAL, permission: 'changes.view',
    response: `[{ id: uuid, name: string, starts_at: datetime, ends_at: datetime, reason: string | null,
      repeat: 'none' | 'weekly' | 'monthly', repeat_until: date | null, system_ids: [uuid] | null,
      systems: [{ id: uuid, label: string }], ... }]`,
  }),
  route('POST', '/api/changes/blackouts', 'Add a blackout period', {
    tag: CAL, permission: 'changes.administer',
    description: 'The end must be after the start, and a repeating period must be shorter than its repeat; systems must exist in the inventory (400 `validation`). Audited.',
    body: BLACKOUT_BODY(''), response: BLACKOUT, status: 201,
  }),
  route('PATCH', '/api/changes/blackouts/:blackoutId', 'Change a blackout period', {
    tag: CAL, permission: 'changes.administer', description: 'Audited when something changes. 404 `not_found` for an unknown period.',
    body: BLACKOUT_BODY('?'), response: BLACKOUT,
  }),
  route('DELETE', '/api/changes/blackouts/:blackoutId', 'Delete a blackout period', {
    tag: CAL, permission: 'changes.administer', description: 'Soft delete; audited.',
    response: '{ ok: boolean }',
  }),

  // ---------- one change ----------
  route('GET', '/api/changes/waiting', 'Changes waiting for your own approval decision', {
    tag: T, permission: 'changes.view',
    description: 'Empty unless the caller also holds `changes.approve`. Leaves out changes the caller raised, already decided, or whose named approvers do not include them; soonest planned start first.',
    response: `{ rows: [{ id: uuid, ref: string, title: string, status: string, change_type: string, risk_level: string | null,
      planned_start: datetime | null, planned_end: datetime | null, approvals_required: integer, approvals_received: integer,
      retrospective: boolean }] }`,
  }),
  route('GET', '/api/changes/:id/workflow', 'Where a change stands: next statuses, approvals, conflicts and review', {
    tag: T, permission: 'changes.view', description: NOT_FOUND,
    response: `{ status: string, next: [string], approvals: ${APPROVALS}, conflicts: [${CONFLICT}],
      review: { required: boolean, done: boolean }, actions_available: boolean }`,
  }),
  route('POST', '/api/changes/:id/transition', 'Move a change to another status', {
    tag: T, permission: 'changes.edit',
    description: `409 \`bad_transition\` for a move the status table does not allow (approval and rejection come from recording decisions). Submitting needs the plans, window and risk answers (400 \`incomplete\`); scheduling and starting need the approvals (409 \`approvals_missing\`) and no unacknowledged conflicts (409 \`conflicts\`); closing needs a required review (409 \`review_missing\`). Completing needs \`outcome\`. Audited; submitting notifies the approvers. ${NOT_FOUND}`,
    body: `{ to: string "The new status",
      actual_start?: datetime "When moving to in_progress", outcome?: string "Required when moving to completed",
      outcome_notes?: string, actual_end?: datetime, reason?: string "When canceling" }`,
    response: '@change',
  }),
  route('GET', '/api/changes/:id/approvals', 'Approval state and decisions of a change', {
    tag: T, permission: 'changes.view', description: NOT_FOUND, response: APPROVALS,
  }),
  route('POST', '/api/changes/:id/approvals', 'Record an approval decision', {
    tag: T, permission: 'changes.approve',
    description: `Without \`approver_name\` it records the caller's own decision; with it, a decision given outside the application. Each person decides once per submission (409 \`duplicate_approver\`); the raiser cannot decide (403 \`own_change\`); when the rule names approvers only they may (403 \`not_an_approver\`); 409 \`not_awaiting_approval\` when no decision is wanted. A rejection rejects the change; enough approvals approve it. Audited and notified. ${NOT_FOUND}`,
    body: `{ decision: 'approved' | 'rejected', approver_name?: string, by_hand?: boolean, approver_role?: string,
      decided_on?: date "Not in the future; default today", reference?: string, notes?: string }`,
    response: `{ change: @change, approvals: ${APPROVALS} }`, status: 201,
  }),
  route('GET', '/api/changes/:id/conflicts', 'Conflicts of a change with blackout periods and other changes', {
    tag: T, permission: 'changes.view',
    description: `Each conflict carries its acknowledgment when one holds for the current planned window. Empty for settled changes or without a window. ${NOT_FOUND}`,
    response: `{ conflicts: [${CONFLICT}] }`,
  }),
  route('POST', '/api/changes/:id/conflicts/acknowledge', 'Acknowledge conflicts and go ahead anyway', {
    tag: T, permission: 'changes.approve',
    description: `Acknowledges the given unacknowledged conflicts, or all of them when \`keys\` is left out, for the current planned window. 400 \`validation\` without a reason; 409 \`no_conflict\` when nothing is left to acknowledge. Audited per conflict. ${NOT_FOUND}`,
    body: '{ reason: string, keys?: [string] "Conflict keys" }',
    response: `{ conflicts: [${CONFLICT}] }`,
  }),
  route('POST', '/api/changes/:id/review', 'Record the post-implementation review', {
    tag: T, permission: 'changes.edit',
    description: `Only for a completed or reviewed change (409 \`not_completed\`); moves a completed change to reviewed. Follow-up \`actions\` are raised as action records, which needs \`actions.create\` (403) and the actions module (409 \`actions_unavailable\`). Audited. ${NOT_FOUND}`,
    body: `{ what_happened: string, cause: string, follow_up?: string,
      actions?: [{ title: string, description?: string, owner_id?: uuid, due_on?: date, priority?: string }] }`,
    response: '{ change: @change, actions: [{ id: uuid, ref: string | null, title: string, route: string }] }',
  }),
  route('POST', '/api/changes/:id/actions', 'Raise a follow-up action from a change', {
    tag: T, permission: 'changes.edit',
    description: `Also needs \`actions.create\` (403 \`forbidden\`) and the actions module (409 \`actions_unavailable\`). The action is linked back to the change. Audited. ${NOT_FOUND}`,
    body: '{ title: string, description?: string, owner_id?: uuid, due_on?: date, priority?: string }',
    response: '{ id: uuid, ref: string | null, title: string, route: string }', status: 201,
  }),
];
