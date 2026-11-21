// Pure rules for change enablement: risk scoring, approval rule matching, the status
// lifecycle and overlap arithmetic. No database access here, so these are easy to test.

export interface RiskOption { value: string; label: string; score: number }
export interface RiskQuestion { key: string; label: string; help?: string; weight: number; options: RiskOption[] }
/** A score up to and including `upTo` (0 to 100) gives `level`. */
export interface RiskBand { level: string; upTo: number }
export interface Questionnaire { questions: RiskQuestion[]; bands: RiskBand[] }

export interface ApprovalRule {
  change_type: string;
  /** A risk level, or "any". */
  risk_level: string;
  /** How many different approvers must approve. */
  approvals: number;
  /** Titles shown to people (for example "Change manager"); informative only. */
  approver_roles: string[];
  /** Named users who may approve. With `approver_role_keys`, only these people may decide. */
  approver_user_ids?: string[];
  /** Roles (role keys) whose members may approve. */
  approver_role_keys?: string[];
  /** A post-implementation review is needed before closure. */
  pir_required: boolean;
  /** The approval workflow (kind `change_approval`) that runs when such a change is submitted (E05-13). */
  workflow_id?: string | null;
  /** Work may start before approval; the approval is then recorded afterwards and flagged. */
  retrospective: boolean;
}

export const ANY = 'any';

export const DEFAULT_QUESTIONNAIRE: Questionnaire = {
  questions: [
    {
      key: 'people_affected', label: 'How many people would notice if this went wrong?', weight: 3,
      options: [
        { value: 'few', label: 'A few people', score: 0 },
        { value: 'team', label: 'One team or site', score: 1 },
        { value: 'most', label: 'Most of the organization', score: 2 },
        { value: 'everyone', label: 'Everyone, including customers', score: 3 },
      ],
    },
    {
      key: 'downtime', label: 'Will the service be unavailable during the work?', weight: 2,
      options: [
        { value: 'none', label: 'No', score: 0 },
        { value: 'out_of_hours', label: 'Yes, outside working hours', score: 1 },
        { value: 'working_hours', label: 'Yes, during working hours', score: 3 },
      ],
    },
    {
      key: 'back_out', label: 'How easily can the change be undone?', weight: 3,
      options: [
        { value: 'quick', label: 'Quickly, and the way back has been tested', score: 0 },
        { value: 'slow', label: 'It can be undone, but slowly or with effort', score: 2 },
        { value: 'none', label: 'It cannot be undone', score: 3 },
      ],
    },
    {
      key: 'experience', label: 'Has the team made this change before?', weight: 2,
      options: [
        { value: 'routine', label: 'Yes, routinely', score: 0 },
        { value: 'some', label: 'Once or twice', score: 1 },
        { value: 'never', label: 'Never', score: 3 },
      ],
    },
    {
      key: 'testing', label: 'Has the change been tested?', weight: 2,
      options: [
        { value: 'full', label: 'Yes, in a test environment', score: 0 },
        { value: 'partial', label: 'Partly', score: 1 },
        { value: 'none', label: 'No', score: 3 },
      ],
    },
  ],
  bands: [
    { level: 'low', upTo: 30 },
    { level: 'medium', upTo: 60 },
    { level: 'high', upTo: 100 },
  ],
};

export const DEFAULT_APPROVAL_RULES: ApprovalRule[] = [
  { change_type: 'standard', risk_level: ANY, approvals: 0, approver_roles: [], pir_required: false, retrospective: false },
  { change_type: 'normal', risk_level: 'low', approvals: 1, approver_roles: ['Change manager'], pir_required: false, retrospective: false },
  { change_type: 'normal', risk_level: 'medium', approvals: 1, approver_roles: ['Change manager'], pir_required: false, retrospective: false },
  { change_type: 'normal', risk_level: 'high', approvals: 2, approver_roles: ['Change manager', 'Service owner'], pir_required: false, retrospective: false },
  { change_type: 'emergency', risk_level: ANY, approvals: 1, approver_roles: ['Change manager or duty manager'], pir_required: true, retrospective: false },
];

/** Used when no rule matches: one approval, so nothing slips through unapproved. */
export const FALLBACK_RULE: ApprovalRule = {
  change_type: ANY, risk_level: ANY, approvals: 1, approver_roles: [], pir_required: false, retrospective: false,
};

/** The most specific rule: type and risk, then type and any risk, then any type. */
export function matchRule(rules: ApprovalRule[], changeType: string, riskLevel: string | null | undefined): ApprovalRule {
  const rule = rules.find((r) => r.change_type === changeType && r.risk_level === riskLevel)
    ?? rules.find((r) => r.change_type === changeType && r.risk_level === ANY)
    ?? rules.find((r) => r.change_type === ANY && r.risk_level === riskLevel)
    ?? rules.find((r) => r.change_type === ANY && r.risk_level === ANY)
    ?? FALLBACK_RULE;
  // An emergency change never waits for more than one approver and is always reviewed afterwards.
  if (changeType === 'emergency') return { ...rule, approvals: Math.min(rule.approvals, 1), pir_required: true };
  return rule;
}

export interface RiskResult {
  /** 0 to 100, or null when nothing has been answered. */
  score: number | null;
  /** Null until every weighted question is answered. */
  level: string | null;
  complete: boolean;
  unanswered: string[];
}

export function computeRisk(answers: Record<string, unknown> | null | undefined, q: Questionnaire): RiskResult {
  let total = 0;
  let max = 0;
  let answered = 0;
  const unanswered: string[] = [];
  for (const question of q.questions) {
    const weight = Number(question.weight) > 0 ? Number(question.weight) : 0;
    const top = Math.max(0, ...question.options.map((o) => Number(o.score) || 0));
    const picked = question.options.find((o) => o.value === answers?.[question.key]);
    if (!picked) { unanswered.push(question.key); continue; }
    answered += 1;
    total += weight * (Number(picked.score) || 0);
    max += weight * top;
  }
  if (!answered) return { score: null, level: null, complete: false, unanswered };
  const score = max > 0 ? Math.round((total / max) * 100) : 0;
  const complete = unanswered.length === 0;
  return { score, level: complete ? bandFor(score, q.bands) : null, complete, unanswered };
}

export function bandFor(score: number, bands: RiskBand[]): string | null {
  const sorted = [...bands].sort((a, b) => a.upTo - b.upTo);
  return (sorted.find((b) => score <= b.upTo) ?? sorted[sorted.length - 1])?.level ?? null;
}

/** Allowed moves between statuses. A lookup value may override its row with `meta.next`. */
export const DEFAULT_TRANSITIONS: Record<string, string[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'rejected', 'in_progress', 'draft', 'cancelled'],
  approved: ['scheduled', 'in_progress', 'cancelled'],
  rejected: ['draft', 'cancelled'],
  scheduled: ['in_progress', 'approved', 'cancelled'],
  in_progress: ['completed'],
  completed: ['reviewed', 'closed'],
  reviewed: ['closed'],
  closed: [],
  cancelled: [],
};

/** Changes in these statuses hold their planned window, so they can clash with others. */
export const LIVE_STATUSES = ['submitted', 'approved', 'scheduled', 'in_progress'];
/** Conflicts no longer matter once a change is in one of these. */
export const SETTLED_STATUSES = ['rejected', 'cancelled', 'completed', 'reviewed', 'closed'];
/** Nothing may be edited in these. */
export const FINAL_STATUSES = ['closed', 'cancelled'];

export const DECISIONS = ['approved', 'rejected'];

/** Who may approve a change, fixed when it is submitted. Null: anyone with changes.approve. */
export interface ApproverPool { users: string[]; roles: string[] }

export function poolOf(rule: ApprovalRule): ApproverPool | null {
  const users = [...new Set(rule.approver_user_ids ?? [])];
  const roles = [...new Set(rule.approver_role_keys ?? [])];
  return users.length || roles.length ? { users, roles } : null;
}

/** Whether a person with these roles is in the pool (a null pool lets in everyone). */
export function inPool(pool: ApproverPool | null | undefined, userId: string, roleKeys: string[]): boolean {
  if (!pool || (!pool.users?.length && !pool.roles?.length)) return true;
  return (pool.users ?? []).includes(userId) || roleKeys.some((r) => (pool.roles ?? []).includes(r));
}

export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}
