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
  pir_required: boolean;
  retrospective: boolean;
}

export interface ChangeSettings { questionnaire: Questionnaire; approval_rules: ApprovalRule[]; recalculated?: number }

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

export interface Blackout { id: string; name: string; starts_at: string; ends_at: string; reason: string | null }

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

export interface CalendarData { from: string; to: string; changes: CalendarChange[]; blackouts: Blackout[] }

export interface Overview {
  awaiting_approval: number;
  in_progress: number;
  upcoming: number;
  emergency_open: number;
  review_due: number;
  this_week: number;
}

export const ANY = 'any';
