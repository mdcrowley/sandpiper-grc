import type { RouteDoc } from '../../module.ts';
import { q, route } from './helpers.ts';

/** Descriptions of the projects module's hand-written routes (server/src/modules/projects). */

const T = 'Projects';
const PF = 'Project portfolio';
const SET = 'Project settings';
const INTAKE = 'Project requests';
const NOT_FOUND = '404 `not_found` when the project does not exist or the caller may not see it.';
const AUDITED = `Audited on the project. ${NOT_FOUND}`;
const RAG = "'red' | 'amber' | 'green'";

const DOCUMENT = `{ name: string, required: boolean, received: boolean, reference: string, attachment_id?: uuid | null,
  waived?: boolean, waive_reason?: string | null, waived_by_name?: string | null, waived_on?: date | null }`;

const GATE = `{ id: uuid, project_id: uuid, gate_key: string, name: string, from_stage: string, to_stage: string, sort: integer,
  status: 'open' | 'approved' | 'rejected' | 'deferred', documents: [${DOCUMENT}], approvers: { [tier]: [string] },
  wants_change: boolean, change_id: uuid | null, decided_by_name: string | null, decided_on: date | null, ... }`;

const ITEM = `{ id: uuid, project_gate_id: uuid, label: string, sort: integer, checked: boolean, note: string | null,
  evidence_ref: string | null, checked_by_name: string | null, checked_at: datetime | null, ... }`;

const GATE_VIEW = `{ id: uuid, gate_key: string, name: string, from_stage: string, to_stage: string, status: string,
  documents: [${DOCUMENT}], change_id: uuid | null,
  items: [${ITEM}],
  decisions: [{ id: uuid, decision: string, approver_name: string, approver_role: string | null, decided_on: date,
    reference: string | null, notes: string | null, recorded_by_name: string, created_at: datetime, ... }],
  total: integer, checked: integer, outstanding: [string], missing_documents: [string],
  blockers: [{ kind: 'status' | 'checklist' | 'document', label: string }],
  is_current: boolean, can_approve: boolean, approvers_for_tier: [string], change_available: boolean,
  change: { id: uuid, label: string, ref: string | null, route: string | null, status: string | null } | null, ... }`;

const REPORT = `{ id: uuid, project_id: uuid, period_end: date, overall: ${RAG}, schedule: ${RAG}, budget: ${RAG}, risk: ${RAG},
  accomplishments: string | null, next_steps: string | null, decisions_needed: string | null,
  author_id: uuid | null, author_name: string, created_at: datetime, ... }`;

const REPORT_BODY = (opt: string) => `{ period_end${opt}: date, overall${opt}: ${RAG}, schedule${opt}: ${RAG},
  budget${opt}: ${RAG}, risk${opt}: ${RAG}, accomplishments?: string | null, next_steps?: string | null,
  decisions_needed?: string | null }`;

const PITEM = `{ id: uuid, project_id: uuid, kind: string, title: string, detail: string | null, owner_id: uuid | null,
  owner: string | null, owner_name: string | null, status: string, due_on: date | null, likelihood: integer | null,
  impact: integer | null, score: integer | null, escalated_risk_id: uuid | null, escalated_at: datetime | null, ... }`;

const PITEM_BODY = (opt: string) => `{ kind${opt}: string "A project_item_kind value: risk, issue, decision or change request",
  title${opt}: string, detail?: string | null, owner_id?: uuid | null, owner?: string | null "Owner by name",
  status?: string "A project_item_status value; default open", due_on?: date | null,
  likelihood?: integer | null "1 to 5; risks only", impact?: integer | null "1 to 5; risks only" }`;

const MILESTONE = '{ id: uuid, project_id: uuid, name: string, due_on: date, done_on: date | null, sort: integer, ... }';

const MILESTONE_BODY = (opt: string) => `{ name${opt}: string, due_on${opt}: date, done_on?: date | null, sort?: integer "0 to 100000" }`;

const CRITERIA = '[{ key: string, label: string, weight: number, description?: string }]';

const SETTINGS = `{ tiers: { tier3Below: number, tier1Above: number }, criteria: ${CRITERIA}, wipLimit: integer,
  maxScore: integer, intakeOpenTo: 'create' | 'view' | 'everyone', reportIntervalDays: integer }`;

const SETTINGS_BODY = `{ tiers?: { tier3Below: number "Budgets below are Tier 3", tier1Above: number "Budgets above are Tier 1" },
  criteria?: ${CRITERIA}, wipLimit?: integer "1 to 500", intakeOpenTo?: 'create' | 'view' | 'everyone',
  reportIntervalDays?: integer "1 to 366" }`;

const SETTINGS_OUT = `{ tiers: { tier3Below: number, tier1Above: number }, criteria: ${CRITERIA}, wipLimit: integer,
  maxScore: integer, intakeOpenTo: 'create' | 'view' | 'everyone', reportIntervalDays: integer, recalculated: integer }`;

const SETTINGS_DESC = 'Partial body. Invalid values give 400 `validation` with per-field messages. A change to the tiers or scoring criteria recalculates every project (each audited); `recalculated` counts them.';

const GATE_DEF = `{ id: uuid, key: string, name: string, from_stage: string, to_stage: string, sort: integer, active: boolean,
  required_documents: [{ name: string, required: boolean }], checklist: [string], approvers: { [tier]: [string] },
  wants_change: boolean, approval_workflow_id: uuid | null "E11-25: the approval workflow gate decisions are asked through", ... }`;

const GATE_DEF_BODY = `{ name?: string, checklist?: [string],
  required_documents?: [string | { name: string, required?: boolean }] "A plain name is required",
  approvers?: { [tier]: [string] }, wants_change?: boolean, approval_workflow_id?: uuid | null "From GET /api/projects/gate-workflows; null: decisions recorded by hand" }`;

const GATE_DEF_DESC = 'Changes the template only; gates already opened on projects keep their copy. A new checklist replaces the old one. 404 `not_found` for an unknown key. Audited.';

export const DOCS: RouteDoc[] = [
  // ---------- portfolio and settings ----------
  route('GET', '/api/projects/portfolio', 'Portfolio: register, stage funnel, work-in-progress limit and gates due', {
    tag: PF, permission: 'projects.view',
    response: `{ register: [{ id: uuid, ref: string, name: string, tier: string | null, stage: string, status: string,
        priority_score: number | null, budget: number | null, spend_to_date: number | null, spend_pct: number | null,
        over_budget: boolean, project_manager: string | null, rag_overall: string | null, rag_trend: string | null,
        trend: [{ period_end: date, overall: string, schedule: string, budget: string, risk: string }],
        milestones: [{ id: uuid, name: string, due_on: date, done_on: date | null }],
        gate: { id: uuid, key: string, name: string, status: string, to_stage: string, checked: integer, total: integer,
          documents_missing: integer, ready: boolean } | null, ... }],
      funnel: [{ stage: string, label: string, color: string, count: integer, active: integer, budget: number }],
      wip: { limit: integer, inDelivery: integer, exceeded: boolean, stage: string }, wipWarning: string | null,
      gatesDue: [{ project_id: uuid, ref: string, name: string, tier: string | null, stage: string, target_on: date | null,
        gate_id: uuid, gate_name: string, gate_status: string, checked: integer, total: integer, ready: boolean }],
      totals: { projects: integer, active: integer, budget: number, spend: number,
        rag: { red: integer, amber: integer, green: integer, none: integer } },
      today: date, criteria: ${CRITERIA} }`,
  }),
  route('GET', '/api/projects/settings', 'Tier thresholds, scoring criteria, work-in-progress limit and intake settings', {
    tag: SET, permission: 'projects.view', response: SETTINGS,
  }),
  route('PUT', '/api/projects/settings', 'Change the project settings', {
    tag: SET, permission: 'projects.administer', description: SETTINGS_DESC, body: SETTINGS_BODY, response: SETTINGS_OUT,
  }),
  route('PATCH', '/api/projects/settings', 'Change the project settings (same as PUT)', {
    tag: SET, permission: 'projects.administer', description: `The same as PUT. ${SETTINGS_DESC}`, body: SETTINGS_BODY, response: SETTINGS_OUT,
  }),

  // ---------- requests ----------
  route('GET', '/api/projects/intake', 'The request form: whether you may submit, its choices and your own requests', {
    tag: INTAKE,
    description: 'Needs only a signed-in person; no projects permission. Who may submit follows the `intakeOpenTo` setting.',
    response: `{ allowed: boolean, can_open: boolean "Whether the caller may open project records",
      tiers: { tier3Below: number, tier1Above: number }, systems_available: boolean,
      funding_sources: [{ value: string, label: string, color: string | null }],
      requests: [{ id: uuid, ref: string, name: string, stage: string, status: string, tier: string | null,
        created_at: datetime, target_on: date | null, gate_name: string | null, gate_status: string | null,
        gate_total: integer, gate_checked: integer, stage_label: string, stage_index: integer, stage_count: integer,
        status_label: string, status_color: string }] }`,
  }),
  route('POST', '/api/projects/requests', 'Submit a project request', {
    tag: INTAKE,
    description: 'Needs a signed-in person allowed by the `intakeOpenTo` setting, or `projects.create` (403 `forbidden` otherwise). Only the request fields are taken; the project starts at the idea stage. Audited by the record engine.',
    body: `{ name: string, description?: string, expected_benefits?: string, sponsor?: string, department?: string,
      budget?: number, funding_source?: string, target_on?: date, touches_payment?: boolean,
      touches_personal_data?: boolean, touches_operational_systems?: boolean, systems_affected?: [uuid] }`,
    response: '{ id: uuid, ref: string, name: string, stage: string, status: string, can_open: boolean }', status: 201,
  }),
  route('POST', '/api/projects/reminders/run', 'Run the reminder sweep now', {
    tag: T, permission: 'projects.administer',
    description: 'Notifies managers of due status reports and approvers of gates ready for a decision, at most once a day each. Also runs on a timer.',
    response: '{ reportsDue: integer, gatesDue: integer }',
  }),

  // ---------- gate templates ----------
  route('GET', '/api/projects/gate-definitions', 'Gate templates with their checklists and documents', {
    tag: SET, permission: 'projects.view', response: `[${GATE_DEF}]`,
  }),
  route('PUT', '/api/projects/gate-definitions/:key', 'Change a gate template', {
    tag: SET, permission: 'projects.administer', description: GATE_DEF_DESC, body: GATE_DEF_BODY, response: GATE_DEF,
  }),
  route('PATCH', '/api/projects/gate-definitions/:key', 'Change a gate template (same as PUT)', {
    tag: SET, permission: 'projects.administer', description: `The same as PUT. ${GATE_DEF_DESC}`, body: GATE_DEF_BODY, response: GATE_DEF,
  }),
  route('GET', '/api/projects/gate-workflows', 'Approval workflows a gate template may name', {
    tag: SET, permission: 'projects.administer',
    description: 'The active approval workflows of the kind "Project gate decision" (E11-25), for `approval_workflow_id` on a gate template. Defined under Administration > Approval workflows.',
    response: '{ rows: [{ id: uuid, name: string, description: string | null }] }',
  }),

  // ---------- gates ----------
  route('GET', '/api/projects/:id/gates', 'Stages and gates of a project, with checklists, documents and decisions', {
    tag: T, permission: 'projects.view',
    description: `A linked change record the caller may not open is shown only as such. ${NOT_FOUND}`,
    response: `{ project_id: uuid, stage: string, status: string, tier: string | null,
      stages: [{ value: string, label: string }],
      definitions: [{ key: string, name: string, from_stage: string, to_stage: string, sort: integer }],
      gates: [${GATE_VIEW}], current_gate_id: uuid | null,
      rollback: { gate_id: uuid, gate_name: string, to_stage: string } | null }`,
  }),
  route('GET', '/api/projects/:id/systems', 'Systems a project affects', {
    tag: T, permission: 'projects.view',
    description: `Only systems the caller may see are listed; \`hidden\` counts the rest. ${NOT_FOUND}`,
    response: '{ available: boolean, systems: [{ id: uuid, label: string, ref: string | null, route: string }], hidden: integer }',
  }),
  route('POST', '/api/projects/:id/rollback', 'Move a project back a stage and reopen the gate', {
    tag: T, permission: 'projects.approve',
    description: `Reopens the last approved gate and records a \`reopened\` decision; a completed project becomes active again. 400 \`validation\` without a reason; 409 \`project_cancelled\` or \`no_earlier_stage\`. ${AUDITED}`,
    body: '{ reason: string }',
    response: `{ project: @project, gate: ${GATE} }`,
  }),
  route('POST', '/api/projects/:id/gates/:gateId/documents/:index/waive', 'Waive a required gate document, or withdraw the waiver', {
    tag: T, permission: 'projects.approve',
    description: `\`index\` is the document's position in the gate's list, from 0. Waiving needs a reason (400 \`validation\`) and a required document (400 \`not_required\`); 409 \`gate_closed\` once the gate is approved. ${AUDITED}`,
    body: '{ waived?: boolean "Default true; false withdraws the waiver", reason?: string "Required when waiving" }',
    response: GATE,
  }),
  route('PATCH', '/api/projects/:id/gates/:gateId', 'Link or unlink the change record that carries a gate', {
    tag: T, permission: 'projects.edit',
    description: `The change must exist and be visible to the caller (400 \`validation\`); 409 \`changes_unavailable\` without the changes module, \`gate_closed\` once the gate is approved. ${AUDITED}`,
    body: '{ change_id: uuid | null }',
    response: GATE,
  }),
  route('PATCH', '/api/projects/:id/gates/:gateId/items/:itemId', 'Tick or annotate a gate checklist item', {
    tag: T, permission: 'projects.edit',
    description: `409 \`gate_closed\` once the gate is approved. When the gate becomes ready, its approvers are notified. ${AUDITED}`,
    body: '{ checked?: boolean, note?: string | null, evidence_ref?: string | null }',
    response: ITEM,
  }),
  route('PATCH', '/api/projects/:id/gates/:gateId/documents/:index', 'Mark a gate document received or set its reference', {
    tag: T, permission: 'projects.edit',
    description: `\`index\` is the document's position in the gate's list, from 0. 409 \`gate_closed\` once the gate is approved. When the gate becomes ready, its approvers are notified. ${AUDITED}`,
    body: '{ received?: boolean, reference?: string | null, attachment_id?: uuid | null "A file attached to the project" }',
    response: GATE,
  }),
  route('POST', '/api/projects/:id/gates/:gateId/request-approval', 'Ask for a gate decision through its approval workflow', {
    tag: T, permission: 'projects.edit',
    description: 'Starts the approval workflow the gate\'s template names (E11-25), on the current gate of an active project once every checklist item is ticked and every required document is received or waived (409 `gate_blocked`, `not_current_gate`, `gate_closed`, `no_workflow`, `already_running`). Its approval is recorded as a gate decision and moves the project to the next stage; a rejection is recorded with the reason and the gate stays open. Follow it with GET /api/workflows/records/project/:id. Audited.',
    body: '{ note?: string }',
    response: '{ instance_id: uuid, workflow: string, status: string }',
  }),
  route('POST', '/api/projects/:id/gates/:gateId/decide', 'Record a gate decision', {
    tag: T, permission: 'projects.approve',
    description: `Only on the current gate of an active project (409 \`not_current_gate\`, \`project_not_active\`, \`gate_closed\`). Approval needs every checklist item ticked and every required document received or waived (400 \`gate_blocked\`), and moves the project to the next stage (completed after the last gate). ${AUDITED}`,
    body: `{ decision: 'approved' | 'rejected' | 'deferred', approver_name: string, approver_role?: string,
      decided_on?: date "Not in the future; default today", reference?: string, notes?: string }`,
    response: `{ project: @project, gate: ${GATE} }`,
  }),

  // ---------- status reports ----------
  route('GET', '/api/projects/:id/status-reports', 'Status reports of a project, latest first', {
    tag: T, permission: 'projects.view', description: NOT_FOUND, response: `[${REPORT}]`,
  }),
  route('POST', '/api/projects/:id/status-reports', 'Add a status report', {
    tag: T, permission: 'projects.edit',
    description: `The latest report sets the project's ratings and trend; turning red notifies the manager, sponsor and approvers. ${AUDITED}`,
    body: REPORT_BODY(''), response: REPORT, status: 201,
  }),
  route('PATCH', '/api/projects/:id/status-reports/:reportId', 'Change a status report', {
    tag: T, permission: 'projects.edit',
    description: `The project's ratings follow the latest report. 404 \`not_found\` for an unknown report. ${AUDITED}`,
    body: REPORT_BODY('?'), response: REPORT,
  }),
  route('DELETE', '/api/projects/:id/status-reports/:reportId', 'Delete a status report', {
    tag: T, permission: 'projects.edit',
    description: `Soft delete; the project's ratings follow the report that is now latest. ${AUDITED}`,
    response: '{ ok: boolean }',
  }),
  route('GET', '/api/projects/:id/status-trend', 'Ratings of every status report, oldest first, and the direction of travel', {
    tag: T, permission: 'projects.view', description: NOT_FOUND,
    response: `{ project_id: uuid,
      series: [{ id: uuid, period_end: date, overall: string, schedule: string, budget: string, risk: string, author_name: string }],
      latest: { id: uuid, period_end: date, overall: string, schedule: string, budget: string, risk: string, author_name: string } | null,
      direction: 'improving' | 'steady' | 'worsening' | null }`,
  }),

  // ---------- risks, issues, decisions and change requests ----------
  route('GET', '/api/projects/:id/items', 'Risks, issues, decisions and change requests of a project', {
    tag: T, permission: 'projects.view', description: NOT_FOUND,
    query: { kind: 'Only items of this kind (a project_item_kind value).' },
    response: `[${PITEM}]`,
  }),
  route('POST', '/api/projects/:id/items', 'Add a risk, issue, decision or change request', {
    tag: T, permission: 'projects.edit',
    description: `Likelihood and impact are kept for risks only. ${AUDITED}`,
    body: PITEM_BODY(''), response: PITEM, status: 201,
  }),
  route('PATCH', '/api/projects/:id/items/:itemId', 'Change a project item', {
    tag: T, permission: 'projects.edit',
    description: `404 \`not_found\` for an unknown item. ${AUDITED}`,
    body: PITEM_BODY('?'), response: PITEM,
  }),
  route('DELETE', '/api/projects/:id/items/:itemId', 'Delete a project item', {
    tag: T, permission: 'projects.edit', description: `Soft delete. ${AUDITED}`, response: '{ ok: boolean }',
  }),
  route('POST', '/api/projects/:id/items/:itemId/escalate', 'Escalate a project risk to the enterprise risk register', {
    tag: T, permission: 'projects.edit',
    description: `Also needs \`risks.create\` (403 \`forbidden\`). Only risks (400 \`not_a_risk\`), once (409 \`already_escalated\`); 409 \`risk_register_unavailable\` without the risks module, \`escalation_failed\` when the register rejects the data. ${AUDITED}`,
    response: `{ item: ${PITEM}, risk: { id: uuid, ref: string | null, route: string } }`, status: 201,
  }),

  // ---------- milestones ----------
  route('GET', '/api/projects/:id/milestones', 'Milestones of a project, by due date', {
    tag: T, permission: 'projects.view', description: NOT_FOUND, response: `[${MILESTONE}]`,
  }),
  route('POST', '/api/projects/:id/milestones', 'Add a milestone', {
    tag: T, permission: 'projects.edit', description: AUDITED,
    body: MILESTONE_BODY(''), response: MILESTONE, status: 201,
  }),
  route('PATCH', '/api/projects/:id/milestones/:milestoneId', 'Change a milestone', {
    tag: T, permission: 'projects.edit', description: `404 \`not_found\` for an unknown milestone. ${AUDITED}`,
    body: MILESTONE_BODY('?'), response: MILESTONE,
  }),
  route('DELETE', '/api/projects/:id/milestones/:milestoneId', 'Delete a milestone', {
    tag: T, permission: 'projects.edit', description: `Soft delete. ${AUDITED}`, response: '{ ok: boolean }',
  }),
];
