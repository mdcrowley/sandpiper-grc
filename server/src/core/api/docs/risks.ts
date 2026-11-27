import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the risks module's hand-written routes (server/src/modules/risks). */

const R = 'Risks';
const A = 'Actions';
const S = 'Risk scales';
const RESTRICTED = 'A restricted risk (`restricted` true; cybersecurity risks by default) is seen only by callers who also hold `security.view`: lists leave it out, and figures count it and show it as "Restricted risk" without its reference, title or owner (`masked` true).';
const ONE_RISK = `${RESTRICTED} 404 \`not_found\` when the risk does not exist or the caller may not see it.`;

const LEVEL = '{ value: integer, label: string, description?: string }';
const RATING = "{ key: string, label: string, color: string, sort: number, summary_level: string \"Key in the risk summary level list\" }";
const SCALE = `{ key: string, name: string, description: string | null, likelihood_label: string, impact_label: string,
  likelihood_levels: [${LEVEL}], impact_levels: [${LEVEL}],
  matrix: { [likelihood]: { [impact]: string } } "matrix[likelihood value][impact value] = rating key",
  ratings: [${RATING}], acceptance_threshold: string | null "Rating key at or above which acceptance needs a named executive", ... }`;
const SCALE_INPUT = `{ name?: string, description?: string | null, likelihood_label?: string, impact_label?: string,
  likelihood_levels?: [${LEVEL}], impact_levels?: [${LEVEL}], matrix?: { [likelihood]: { [impact]: string } },
  ratings?: [${RATING}], acceptance_threshold?: string | null }`;
const SCALE_ERRORS = '400 `validation` with field messages when the definition is incomplete (2 to 10 levels on each axis, every matrix cell a rating, threshold one of the ratings).';

const ACCEPTANCE = `{ id: uuid, risk_id: uuid, approver_name: string, approver_title: string | null, approved_on: date, expires_on: date,
  reference: string | null, rationale: string, rating_at_acceptance: string, executive_required: boolean,
  revoked_on: date | null, revoked_by: uuid | null, revoked_reason: string | null, created_by: uuid, created_at: datetime, ... }`;
const REVIEW = `{ id: uuid, risk_id: uuid, reviewed_on: date, note: string | null, next_review_on: date,
  inherent_rating: string | null, residual_rating: string | null, summary_level: string | null, status: string, created_by: uuid, ... }`;

const SHARED_ACTION = `{ id: uuid, ref: string, title: string, description: string | null, status: string, priority: string,
  owner_id: uuid | null, due_on: date | null, completed_on: date | null, notes: string | null, department: string | null,
  updated_at: datetime, shared_by: string | null, shared: true,
  _display: { status: string, priority: string, owner_id: string | null } }`;

export const DOCS: RouteDoc[] = [
  // ---- risk scales
  route('GET', '/api/risks/scales', 'Risk scales', {
    tag: S, permission: 'risks.view', response: `[${SCALE}]`,
  }),
  route('GET', '/api/risks/scales/:key', 'One risk scale', {
    tag: S, permission: 'risks.view', description: '404 `not_found` for an unknown key.', response: SCALE,
  }),
  route('POST', '/api/risks/scales', 'Add a risk scale', {
    tag: S, permission: 'risks.administer', status: 201,
    description: `The key is lower-case letters, numbers and underscores, starting with a letter. ${SCALE_ERRORS} Audited.`,
    body: `{ key: string, name: string, description?: string | null, likelihood_label?: string, impact_label?: string,
      likelihood_levels: [${LEVEL}], impact_levels: [${LEVEL}], matrix: { [likelihood]: { [impact]: string } },
      ratings: [${RATING}], acceptance_threshold?: string | null }`,
    response: SCALE,
  }),
  route('PATCH', '/api/risks/scales/:key', 'Change a risk scale', {
    tag: S, permission: 'risks.administer',
    description: `Every risk on the scale is re-rated at once. A level that a risk is scored on cannot be removed. ${SCALE_ERRORS} Audited.`,
    body: SCALE_INPUT, response: SCALE,
  }),
  route('POST', '/api/risks/scales/:key/preview', 'What changing a risk scale would do, without saving it', {
    tag: S, permission: 'risks.administer',
    description: `Runs the same validation as saving (${SCALE_ERRORS.replace(/\.$/, '')}). The counts cover every risk on the scale.`,
    body: SCALE_INPUT,
    response: '{ total: integer | null "Risks on the scale", rerated: integer | null "Risks whose rating would change", level_in_use: boolean | null "A removed level is still scored on" }',
  }),

  // ---- heat map, summary, report
  route('GET', '/api/risks/heatmap', 'Heat map of open risks on one scale', {
    tag: R, permission: 'risks.view', description: `${RESTRICTED} 404 \`not_found\` for an unknown scale.`,
    query: {
      scale: 'Scale key (default `cyber_5x5`).',
      basis: q("'inherent' | 'residual' | 'target'", 'Which scores to place (default residual); on target, movements go from the residual (else inherent) cell to the target cell.'),
      include_closed: q('boolean', 'Include closed risks (default false).'),
    },
    response: `{ scale: ${SCALE}, basis: 'inherent' | 'residual' | 'target', inherent_only: integer "On the residual basis, risks with an inherent score only",
      cells: [{ likelihood: integer, impact: integer, rating: string | null, color: string, count: integer, risk_ids: [uuid] }],
      totals: [{ rating: string, label: string, color: string, count: integer }],
      total: integer, unscored: integer, include_closed: boolean,
      movements: [{ from: { likelihood: integer, impact: integer }, to: { likelihood: integer, impact: integer }, count: integer, risk_ids: [uuid] }],
      risks: [{ id: uuid, ref: string, title: string, status: string, closed: boolean, owner_name: string | null,
        likelihood: integer | null, impact: integer | null, score: number | null,
        inherent: { likelihood: integer, impact: integer, rating: string | null } | null,
        residual: { likelihood: integer, impact: integer, rating: string | null } | null,
        target: { likelihood: integer, impact: integer, rating: string | null, on: date | null } | null, restricted: boolean, masked: boolean }] }`,
  }),
  route('GET', '/api/risks/summary', 'Open risks by summary level, the watch counts and the ten highest', {
    tag: R, permission: 'risks.view',
    description: `${RESTRICTED} Counts cover risks that are not deleted and not in a closed status. A risk's rating and score are the residual ones, else the inherent ones.`,
    response: `{
      needs_review: integer "Open risks in a needs-review status (an acceptance lapsed)",
      reviews_due: integer "Open risks whose review date is today or earlier",
      acceptances_expiring: integer "Accepted risks whose current acceptance expires within 60 days",
      acceptances_expired: integer "Accepted or needs-review risks whose current acceptance has expired",
      above_appetite: integer, with_target: integer "Open risks with a target rating", above_target: integer "Open risks still rated above their target",
      scales: [{ key: string, name: string }],
      levels: [{ value: string "Summary level key (low, medium, high, critical)", label: string, color: string, count: integer,
        by_scale: { [scaleKey]: integer } "Count on each scale, keyed by scale key" }] "In the order of the risk summary level list",
      unscored: integer "Open risks with no rating",
      total: integer "All open risks, scored or not",
      top: [{ id: uuid, ref: string, title: string, scale_key: string, status: string, summary_level: string | null,
        owner_id: uuid | null, owner_name: string | null, rating: string "Rating key on the risk's scale", score: number,
        rating_label: string, color: string }] "Up to 10 scored open risks, highest score first"
    }`,
  }),
  route('GET', '/api/risks/report', 'Board report: ratings, movement since the last review, acceptances falling due', {
    tag: R, permission: 'risks.view',
    description: `${RESTRICTED} Movement compares the rating now with the one recorded at the last review. \`actions\` per risk is null unless the caller holds \`actions.view\`.`,
    query: {
      top: q('integer', 'How many of the highest risks to list, 1 to 50 (default 10).'),
      days: q('integer', 'Window for acceptances falling due, in days (default 90).'),
    },
    response: `{ generated_on: date, window_days: integer, total: integer, unscored: integer, accepted: integer, reviews_overdue: integer,
      with_target: integer, above_target: integer,
      levels: [{ value: string, label: string, color: string, count: integer }],
      top: [{ id: uuid, ref: string, title: string, score: number | null, status: string, status_label: string, status_color: string,
        category_label: string | null, treatment_label: string | null, owner_name: string | null, summary_level: string | null,
        inherent_label: string | null, inherent_color: string, residual_label: string | null, residual_color: string,
        rating_label: string | null, color: string, review_on: date | null, last_reviewed_on: date | null, review_overdue: boolean,
        movement: 'up' | 'down' | 'same' | 'none', previous_label: string | null, previous_color: string, previous_on: date | null,
        actions: { open: integer, overdue: integer } | null, target_label: string | null, target_color: string, target_on: date | null,
        above_target: boolean | null "Null when the risk has no target or no score", restricted: boolean, masked: boolean }],
      increased: [object] "Risks whose rating went up, shaped as in top", decreased: [object] "Risks whose rating went down",
      unchanged: integer, not_reviewed: integer,
      acceptances: [{ id: uuid, risk_id: uuid, ref: string, title: string, status: string, rating: string | null, approver_name: string,
        approver_title: string | null, approved_on: date, expires_on: date, days_left: integer, expired: boolean, rating_label: string | null, color: string, ... }] }`,
  }),
  route('POST', '/api/risks/checks/run', 'Run the daily risk check now', {
    tag: R, permission: 'risks.administer',
    description: `${RESTRICTED} Moves accepted risks with no current acceptance to the needs-review status, and tells owners once about acceptances near expiry and reviews due. Safe to repeat. It also runs every six hours.`,
    response: '{ expired: integer, expiring: integer, reviews: integer }',
  }),

  // ---- acceptances
  route('GET', '/api/risks/acceptances-expiring', 'Risk acceptances expiring soon or already expired', {
    tag: R, permission: 'risks.view', description: RESTRICTED,
    query: { days: q('integer', 'Days ahead to look, 0 to 3650 (default 60).') },
    response: `[{ id: uuid, risk_id: uuid, ref: string, title: string, scale_key: string, status: string, rating: string | null,
      approver_name: string, approver_title: string | null, approved_on: date, expires_on: date, reference: string | null,
      owner_name: string | null, days_left: integer, expired: boolean }]`,
  }),
  route('GET', '/api/risks/:id/acceptances', 'Acceptances of a risk, and whether a new one needs an executive', {
    tag: R, permission: 'risks.view',
    description: `${ONE_RISK} The newest acceptance that is not revoked is the one that counts.`,
    response: `{ acceptances: [{ id: uuid, approver_name: string, approver_title: string | null, approved_on: date, expires_on: date,
        reference: string | null, rationale: string, rating_at_acceptance: string, executive_required: boolean,
        revoked_on: date | null, revoked_reason: string | null, revoked_by_name: string | null, recorded_by: string | null,
        expired: boolean, days_left: integer, state: 'current' | 'expired' | 'superseded' | 'revoked', ... }],
      rule: { rating: string | null, rating_label: string | null, threshold: string | null, threshold_label: string | null, executive_required: boolean } }`,
  }),
  route('POST', '/api/risks/:id/acceptances', 'Record the acceptance of a risk', {
    tag: R, permission: 'risks.approve', status: 201,
    description: `${ONE_RISK} Sets the risk's status to accepted and treatment to accept. 400 \`not_scored\` when the risk has no rating; 400 \`executive_approval_required\` when its rating is at or above the scale's threshold and the approver's name, title or reference is missing. Audited.`,
    body: `{ expires_on: date, rationale: string, approved_on?: date "Default today", approver_name?: string "Default the caller",
      approver_title?: string, reference?: string }`,
    response: ACCEPTANCE,
  }),
  route('POST', '/api/risks/:id/acceptances/:acceptanceId/revoke', 'Revoke an acceptance of a risk', {
    tag: R, permission: 'risks.approve',
    description: `${ONE_RISK} The risk returns to open unless another acceptance still stands, and its owner is told. 400 \`already_revoked\`. Audited.`,
    body: '{ reason: string, revoked_on?: date "Default today; not in the future nor before the approval" }',
    response: ACCEPTANCE,
  }),

  // ---- reviews
  route('GET', '/api/risks/reviews-due', 'Open risks whose review falls due soon or is overdue', {
    tag: R, permission: 'risks.view', description: RESTRICTED,
    query: { days: q('integer', 'Days ahead to look, 0 to 3650 (default 30).') },
    response: `[{ id: uuid, ref: string, title: string, status: string, scale_key: string, owner_id: uuid | null, owner_name: string | null,
      review_on: date, last_reviewed_on: date | null, days_left: integer, overdue: boolean, rating: string | null,
      rating_label: string | null, color: string }]`,
  }),
  route('GET', '/api/risks/:id/reviews', 'Completed reviews of a risk', {
    tag: R, permission: 'risks.view', description: ONE_RISK,
    response: `[{ id: uuid, reviewed_on: date, note: string | null, next_review_on: date, inherent_rating: string | null,
      residual_rating: string | null, status: string, reviewed_by: string | null, inherent_label: string | null, inherent_color: string,
      residual_label: string | null, residual_color: string }]`,
  }),
  route('POST', '/api/risks/:id/reviews', 'Complete a review of a risk', {
    tag: R, permission: 'risks.edit', status: 201,
    description: `${ONE_RISK} Records the ratings at the time, sets the last-reviewed date and moves the next review date. Audited.`,
    body: '{ next_review_on: date "After reviewed_on", reviewed_on?: date "Default today; not in the future", note?: string }',
    response: REVIEW,
  }),

  // ---- actions
  route('GET', '/api/actions/summary', 'Open actions: counts, yours, and by owner, source and department', {
    tag: A, permission: 'actions.view',
    description: 'Restricted actions are left out of every count for callers without `security.view`. "This week" runs to Sunday.',
    response: `{ open: integer, overdue: integer, due_this_week: integer, unassigned: integer, today: date, week_end: date,
      mine: { open: integer, overdue: integer, due_this_week: integer }, open_statuses: [string],
      by_owner: [{ owner_id: uuid | null, label: string, open: integer, overdue: integer }],
      by_source: [{ value: string | null, label: string, color: string, open: integer, overdue: integer }],
      by_department: [{ value: string | null, label: string, open: integer, overdue: integer }] }`,
  }),
  route('GET', '/api/actions/:id/shares', 'People a restricted action is shared with', {
    tag: A, permission: 'actions.view',
    description: '404 `not_found` when the caller may not see the action.',
    response: '{ restricted: boolean, shares: [{ user_id: uuid, name: string, shared_by: string | null, created_at: datetime }] }',
  }),
  route('POST', '/api/actions/:id/shares', 'Share a restricted action with a person', {
    tag: A, permission: 'actions.edit', status: 201,
    description: 'Lets a person without `security.view` see and update this one action, never its source record. 400 `not_restricted` for an action that is not restricted. The person is notified the first time. Audited.',
    body: '{ user_id: uuid "An active user" }',
    response: '{ user_id: uuid, name: string }',
  }),
  route('DELETE', '/api/actions/:id/shares/:userId', 'Stop sharing a restricted action with a person', {
    tag: A, permission: 'actions.edit',
    description: '404 `not_found` when it is not shared with that person. Audited.',
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/actions/shared-with-me', 'Restricted actions shared with you', {
    tag: A, permission: 'actions.view', response: `[${SHARED_ACTION}]`,
  }),
  route('GET', '/api/actions/shared/:id', 'One restricted action shared with you', {
    tag: A, permission: 'actions.view', description: '404 `not_found` unless the action is shared with the caller.',
    response: SHARED_ACTION,
  }),
  route('PATCH', '/api/actions/shared/:id', 'Update a restricted action shared with you', {
    tag: A, permission: 'actions.edit',
    description: 'Only the status and the notes can be changed; any other member gives 400 `validation`. 404 `not_found` unless shared with the caller. Audited.',
    body: '{ status?: string, notes?: string | null }',
    response: SHARED_ACTION,
  }),
];
