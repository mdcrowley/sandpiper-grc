// Shapes of the /api/workflows answers, and words shared by the pages.
import type { ColorName } from '../../core';

export type Quorum = 'any' | 'all' | number;
export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'empty' | 'set';
export interface Condition { field: string; op: Op; value?: unknown }
export type ApproverSpec =
  | { kind: 'users'; users: string[] }
  | { kind: 'role'; role: string }
  | { kind: 'field'; field: string }
  | { kind: 'department_head'; from: 'requester' | 'field'; field?: string | null }
  | { kind: 'people'; users: string[]; roles: string[] }
  | { kind: 'permission'; permission: string };
/** One set of approvers with their quorum: a step, or one branch of a step that runs side by side. */
export interface ApprovalUnit {
  key?: string;
  name: string;
  approvers: ApproverSpec;
  quorum: Quorum;
  conditions: Condition[];
  due_hours: number | null;
  escalate_to: { users: string[]; role: string | null } | null;
  /** A different person per step (AZ-7): someone who decided another step of the same request may not decide this one. */
  distinct_approvers?: boolean;
}
/** After a step is approved (E14-32): the first route whose conditions hold sends the workflow to a later step (its key) or to the end. */
export interface Route { conditions: Condition[]; to: string }
export const END = 'end';
/**
 * A step. With `branches` it runs them side by side (each with its own approvers and quorum; all
 * must approve, one rejection rejects) and has no approvers of its own (`approvers` is then unused).
 */
export interface StepDef extends ApprovalUnit {
  branches?: ApprovalUnit[];
  routes?: Route[];
}
export const isGroup = (s: Pick<StepDef, 'branches'>) => Array.isArray(s.branches) && s.branches.length > 0;
export interface FieldSet { field: string; value: unknown }
export interface Definition {
  id?: string;
  record_type: string;
  /** The approval kind it serves (started by its module), set when it is made. */
  kind?: string | null;
  kind_label?: string | null;
  kind_starts_when?: string | null;
  kind_outcome?: string | null;
  name: string;
  description: string | null;
  active: boolean;
  trigger: 'create' | 'status' | 'manual' | 'module';
  trigger_field: string | null;
  trigger_value: string | null;
  conditions: Condition[];
  steps: StepDef[];
  on_approve: FieldSet[];
  on_reject: FieldSet[];
  version?: number;
  record_type_label?: string;
  available?: boolean;
  running?: number;
  started?: number;
  people?: Record<string, string>;
  /** Lifecycle status moves that wait for this workflow (E14-37). */
  moves?: number;
  updated_at?: string;
}

export interface OptionField { name: string; label: string; type: string; list: string | null; readOnly: boolean }
export interface OptionType { type: string; label: string; plural: string; module: string; restricted: boolean | 'flag'; fields: OptionField[] }
export interface Options {
  types: OptionType[];
  lookups: Record<string, { value: string; label: string; color: string | null }[]>;
  roles: { key: string; name: string; enabled: boolean }[];
  departments: { id: string; name: string; head_id: string | null; head_name: string | null }[];
  /** Approval kinds the modules hand to workflows (change approval, risk acceptance, ...). */
  kinds: ApprovalKind[];
  permissions: string[];
}
export interface ApprovalKind { key: string; record_type: string; label: string; starts_when: string; outcome: string; approver_permission: string | null }

/** An approver's stand-in for a period (E14-32). */
export interface Standin {
  id: string; user_id: string; user_name: string; standin_id: string; standin_name: string; starts_on: string; ends_on: string;
  note: string | null; active: boolean; mine: boolean; for_me: boolean; created_by_name: string | null;
}

export interface Approval {
  step_id: string;
  instance_id: string;
  workflow: string;
  step: string;
  /** For a branch of a step that runs side by side (E14-32): the step's and the branch's names. */
  group?: string | null;
  branch?: string | null;
  position: number;
  steps_total: number;
  record_type: string;
  record_type_label: string;
  record_id: string;
  record_ref: string | null;
  record_title: string;
  route: string;
  requested_by_name: string | null;
  started_at: string;
  due_at: string | null;
  overdue: boolean;
  escalated: boolean;
  approvals: number;
  required: number;
  status: string;
  step_status: string;
  decision: 'approved' | 'rejected' | null;
  decided_at: string | null;
  comment: string | null;
  kind_label: string | null;
  /** The approver this person stands in for (waiting) or decided for (decided). */
  on_behalf_of_name: string | null;
}

export interface Request {
  instance_id: string;
  workflow: string;
  status: InstanceStatus;
  record_type_label: string;
  record_ref: string | null;
  record_title: string;
  route: string;
  started_at: string;
  finished_at: string | null;
  step: string | null;
  due_at: string | null;
  approvals: number;
  required: number | null;
  steps_total: number;
  position: number | null;
  outcome_note: string | null;
  outcome_error: string | null;
}

export type InstanceStatus = 'running' | 'approved' | 'rejected' | 'canceled';
export type StepStatus = 'waiting' | 'not_reached' | 'pending' | 'approved' | 'rejected' | 'skipped' | 'canceled';

export interface InstanceStep {
  position: number;
  key: string;
  name: string;
  id: string | null;
  status: StepStatus;
  approvers: { id: string; name: string }[];
  required: number | null;
  quorum: Quorum;
  due_at: string | null;
  escalated_at: string | null;
  note: string | null;
  has_conditions: boolean;
  /** Index of the branch (a step whose branches run side by side), else null. */
  branch?: number | null;
  /** The branches of a step that runs them side by side (E14-32), each shaped like a step. */
  branches?: InstanceStep[];
  /** The step has routes chosen by condition. */
  routes?: boolean;
  standins: { id: string; name: string; for: { id: string; name: string }[] }[];
  decisions: { user_id: string; name: string; decision: 'approved' | 'rejected'; comment: string | null; at: string; on_behalf_of_name: string | null; adopted?: boolean; branch?: string }[];
  can_decide: boolean;
  /** Set when the reader would decide as a stand-in. */
  on_behalf_of_name: string | null;
}
export interface Instance {
  id: string;
  workflow: string;
  status: InstanceStatus;
  current_step: number | null;
  started_at: string;
  finished_at: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  note: string | null;
  outcome_note: string | null;
  outcome_error: string | null;
  kind_label: string | null;
  can_cancel: boolean;
  can_reassign: boolean;
  steps: InstanceStep[];
}
export interface RecordWorkflows {
  instances: Instance[];
  startable: { id: string; name: string; description: string | null; trigger: string }[];
  /** A status move waiting for one of these workflows (E14-37). */
  pending_move?: PendingMove | null;
}

export const STATUS_LOOK: Record<InstanceStatus, { label: string; color: ColorName }> = {
  running: { label: 'Waiting for approval', color: 'blue' },
  approved: { label: 'Approved', color: 'green' },
  rejected: { label: 'Rejected', color: 'red' },
  canceled: { label: 'Canceled', color: 'gray' },
};

export const OP_LABELS: Record<Op, string> = {
  eq: 'is', ne: 'is not', gt: 'is more than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  in: 'is one of', empty: 'is empty', set: 'is filled in',
};
/** Comparisons that make sense for a field type. */
export function opsFor(type: string): Op[] {
  if (['number', 'currency', 'date', 'datetime'].includes(type)) return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'set'];
  if (type === 'lookup') return ['eq', 'ne', 'in', 'empty', 'set'];
  if (type === 'boolean') return ['set', 'empty'];
  return ['eq', 'ne', 'empty', 'set'];
}

export const TRIGGER_TEXT: Record<Definition['trigger'], string> = {
  create: 'When a record is created',
  status: 'When a field changes to a value',
  manual: 'When someone asks for approval',
  module: 'When its module asks for it',
};

export const quorumText = (q: Quorum, count?: number) =>
  q === 'any' ? 'Any one approves' : q === 'all' ? (count ? `All ${count} approve` : 'Everyone approves') : `${q} must approve`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "2 days", "4 hours", "90 minutes" for a number of hours. */
export function hoursText(h: number): string {
  if (h >= 24 && h % 24 === 0) return plural(h / 24, 'day');
  if (h < 1) return plural(Math.round(h * 60), 'minute');
  return plural(h, 'hour');
}

/** A status move that waits for an approval workflow (E14-37). */
export interface PendingMove {
  instance_id: string; workflow: string; field: string; field_label: string; from: string; from_label: string; to: string; to_label: string;
}
