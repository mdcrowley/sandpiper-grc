// Shapes of the /api/workflows answers, and words shared by the pages.
import type { ColorName } from '../../core';

export type Quorum = 'any' | 'all' | number;
export type Op = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'empty' | 'set';
export interface Condition { field: string; op: Op; value?: unknown }
export type ApproverSpec =
  | { kind: 'users'; users: string[] }
  | { kind: 'role'; role: string }
  | { kind: 'field'; field: string }
  | { kind: 'department_head'; from: 'requester' | 'field'; field?: string | null };
export interface StepDef {
  key?: string;
  name: string;
  approvers: ApproverSpec;
  quorum: Quorum;
  conditions: Condition[];
  due_hours: number | null;
  escalate_to: { users: string[]; role: string | null } | null;
}
export interface FieldSet { field: string; value: unknown }
export interface Definition {
  id?: string;
  record_type: string;
  name: string;
  description: string | null;
  active: boolean;
  trigger: 'create' | 'status' | 'manual';
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
  updated_at?: string;
}

export interface OptionField { name: string; label: string; type: string; list: string | null; readOnly: boolean }
export interface OptionType { type: string; label: string; plural: string; module: string; restricted: boolean | 'flag'; fields: OptionField[] }
export interface Options {
  types: OptionType[];
  lookups: Record<string, { value: string; label: string; color: string | null }[]>;
  roles: { key: string; name: string; enabled: boolean }[];
  departments: { id: string; name: string; head_id: string | null; head_name: string | null }[];
}

export interface Approval {
  step_id: string;
  instance_id: string;
  workflow: string;
  step: string;
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
  decisions: { user_id: string; name: string; decision: 'approved' | 'rejected'; comment: string | null; at: string }[];
  can_decide: boolean;
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
  can_cancel: boolean;
  steps: InstanceStep[];
}
export interface RecordWorkflows {
  instances: Instance[];
  startable: { id: string; name: string; description: string | null; trigger: string }[];
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
