// Shapes returned by the change enablement API (server/src/modules/changes).

export interface RiskOption { value: string; label: string; score: number }
export interface RiskQuestion { key: string; label: string; help?: string; weight: number; options: RiskOption[] }
export interface RiskBand { level: string; upTo: number }
export interface Questionnaire { questions: RiskQuestion[]; bands: RiskBand[] }

export interface ApprovalRule {
  change_type: string;
  risk_level: string;
  approvals: number;
  approver_roles: string[];
  /** Named users who may approve; with `approver_role_keys`, only these may decide. */
  approver_user_ids?: string[];
  /** Roles (role keys) whose members may approve. */
  approver_role_keys?: string[];
  pir_required: boolean;
  retrospective: boolean;
}

export interface ChangeSettings {
  questionnaire: Questionnaire;
  approval_rules: ApprovalRule[];
  recalculated?: number;
  roles?: { key: string; name: string }[];
  user_names?: Record<string, string>;
}

export interface WaitingChange {
  id: string; ref: string; title: string; status: string; change_type: string; risk_level: string | null;
  planned_start: string | null; planned_end: string | null; approvals_required: number; approvals_received: number; retrospective: boolean;
}

export interface Conflict {
  key: string;
  kind: 'blackout' | 'change';
  summary: string;
  starts_at: string;
  ends_at: string;
  record: { id: string; ref: string | null; title: string; status: string | null };
  shared_systems: { id: string; label: string }[];
  acknowledged: { reason: string; by: string | null; at: string } | null;
}

export interface Decision {
  id: string;
  decision: 'approved' | 'rejected';
  approver_name: string;
  approver_role: string | null;
  decided_on: string;
  reference: string | null;
  notes: string | null;
  retrospective: boolean;
  recorded_by_name: string | null;
  /** Set when the approver recorded their own decision in the application. */
  approver_user_id: string | null;
  created_at: string;
  /** False for decisions made before the change was last returned to draft. */
  current: boolean;
}

export interface Approvals {
  required: number;
  received: number;
  outstanding: number;
  approver_roles: string[];
  retrospective_allowed: boolean;
  awaiting: boolean;
  retrospective: boolean;
  approved_retrospectively: boolean;
  /** Named approvers and roles fixed at submission; null when anyone with the approve permission may decide. */
  pool: { users: { id: string; name: string }[]; roles: { key: string; name: string }[] } | null;
  /** People who may still decide. */
  waiting_for: string[];
  /** Whether the reader may record their own decision now. */
  can_decide: boolean;
  decisions: Decision[];
}

export interface Workflow {
  status: string;
  next: string[];
  approvals: Approvals;
  conflicts: Conflict[];
  review: { required: boolean; done: boolean };
  actions_available: boolean;
}

export interface Template {
  id: string;
  name: string;
  summary: string | null;
  title: string;
  description: string | null;
  reason: string | null;
  implementation_plan: string | null;
  test_plan: string | null;
  backout_plan: string | null;
  risk_level: string;
  duration_minutes: number;
  system_id: string | null;
  system_label: string | null;
  active: boolean;
  uses: number;
  uses_90_days: number;
  last_used_at: string | null;
}

export interface Blackout {
  id: string; name: string; starts_at: string; ends_at: string; reason: string | null;
  /** Systems the period applies to; empty or missing means every change. */
  system_ids?: string[];
  systems?: { id: string; label: string }[];
  repeat?: 'none' | 'weekly' | 'monthly';
  repeat_until?: string | null;
}

export interface CalendarChange {
  id: string;
  ref: string;
  title: string;
  change_type: string;
  status: string;
  risk_level: string | null;
  planned_start: string;
  planned_end: string;
  assignee: string | null;
  systems: { id: string; label: string }[];
  conflicts: Conflict[];
  unacknowledged: number;
}

export interface CalendarData {
  from: string; to: string; changes: CalendarChange[]; blackouts: Blackout[];
  /** The system the calendar is narrowed to, when one was chosen. */
  system: { id: string; label: string } | null;
}

export interface Overview {
  awaiting_approval: number;
  in_progress: number;
  upcoming: number;
  emergency_open: number;
  review_due: number;
  this_week: number;
}

export const ANY = 'any';
