import { timeZone } from '../../core';
import type { ColorName } from '../../core';

export type Rag = 'red' | 'amber' | 'green';
export type RagTrend = 'improving' | 'steady' | 'worsening';

export interface TrendPoint {
  period_end: string;
  overall: Rag;
  schedule: Rag;
  budget: Rag;
  risk: Rag;
}

export interface Milestone {
  id: string;
  name: string;
  due_on: string;
  done_on: string | null;
}

export interface GateSummary {
  id: string;
  key: string;
  name: string;
  status: string;
  to_stage: string;
  checked: number;
  total: number;
  documents_missing: number;
  ready: boolean;
}

export interface PortfolioRow {
  funding_source: string | null;
  project_manager_id: string | null;
  id: string;
  ref: string;
  name: string;
  department: string | null;
  sponsor: string | null;
  tier: string | null;
  stage: string;
  status: string;
  priority_score: number | null;
  budget: number | null;
  spend_to_date: number | null;
  spend_pct: number | null;
  over_budget: boolean;
  start_on: string | null;
  target_on: string | null;
  project_manager: string | null;
  rag_overall: Rag | null;
  rag_schedule: Rag | null;
  rag_budget: Rag | null;
  rag_risk: Rag | null;
  rag_trend: RagTrend | null;
  last_report_on: string | null;
  trend: TrendPoint[];
  milestones: Milestone[];
  gate: GateSummary | null;
}

export interface FunnelStage {
  stage: string;
  label: string;
  color: string;
  count: number;
  active: number;
  budget: number;
}

export interface GateDue {
  project_id: string;
  ref: string;
  name: string;
  tier: string | null;
  stage: string;
  target_on: string | null;
  gate_id: string;
  gate_name: string;
  gate_status: string;
  checked: number;
  total: number;
  ready: boolean;
}

export interface Portfolio {
  register: PortfolioRow[];
  funnel: FunnelStage[];
  wip: { limit: number; inDelivery: number; exceeded: boolean; stage: string };
  wipWarning: string | null;
  gatesDue: GateDue[];
  totals: {
    projects: number; active: number; budget: number; spend: number;
    rag: { red: number; amber: number; green: number; none: number };
  };
  today: string;
}

export interface Criterion {
  key: string;
  label: string;
  weight: number;
  description?: string;
}

export interface ProjectSettings {
  tiers: { tier3Below: number; tier1Above: number };
  criteria: Criterion[];
  wipLimit: number;
  maxScore: number;
  /** Who may submit a request: 'create', 'view' or 'everyone'. */
  intakeOpenTo: string;
  reportIntervalDays: number;
}

export interface MyRequest {
  id: string;
  ref: string;
  name: string;
  stage: string;
  stage_label: string;
  stage_index: number;
  stage_count: number;
  status: string;
  status_label: string;
  status_color: string;
  created_at: string;
  gate_name: string | null;
  gate_status: string | null;
  gate_total: number | null;
  gate_checked: number | null;
}

export interface Intake {
  allowed: boolean;
  can_open: boolean;
  tiers: { tier3Below: number; tier1Above: number };
  systems_available: boolean;
  funding_sources: { value: string; label: string; color?: string }[];
  requests: MyRequest[];
}

export interface LinkedRecord {
  id: string;
  label: string;
  ref: string | null;
  route: string | null;
}

export interface ProjectSystems {
  available: boolean;
  systems: LinkedRecord[];
  hidden: number;
}

export interface Blocker {
  kind: 'status' | 'checklist' | 'document';
  label: string;
}

export interface ChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  checked_by_name: string | null;
  checked_at: string | null;
  note: string | null;
  evidence_ref: string | null;
}

export interface GateDecision {
  id: string;
  decision: string;
  approver_name: string;
  approver_role: string | null;
  decided_on: string;
  reference: string | null;
  notes: string | null;
  recorded_by_name: string | null;
}

export interface GateDocument {
  name: string;
  required: boolean;
  received: boolean;
  reference: string;
  attachment_id?: string | null;
  waived?: boolean;
  waive_reason?: string | null;
  waived_by_name?: string | null;
  waived_on?: string | null;
}

export interface Gate {
  id: string;
  gate_key: string;
  name: string;
  from_stage: string;
  to_stage: string;
  status: string;
  decided_by_name: string | null;
  decided_on: string | null;
  items: ChecklistItem[];
  decisions: GateDecision[];
  documents: GateDocument[];
  approvers: Record<string, string[]>;
  approvers_for_tier: string[];
  total: number;
  checked: number;
  outstanding: string[];
  missing_documents: string[];
  blockers: Blocker[];
  is_current: boolean;
  can_approve: boolean;
  wants_change: boolean;
  change_available: boolean;
  change: (LinkedRecord & { status: string | null }) | null;
}

export interface GateDefinitionOutline {
  key: string;
  name: string;
  from_stage: string;
  to_stage: string;
}

export interface ProjectGates {
  project_id: string;
  stage: string;
  status: string;
  tier: string | null;
  stages: { value: string; label: string }[];
  definitions: GateDefinitionOutline[];
  gates: Gate[];
  current_gate_id: string | null;
  rollback: { gate_id: string; gate_name: string; to_stage: string } | null;
}

export interface GateDefinition extends GateDefinitionOutline {
  id: string;
  checklist: string[];
  required_documents: { name: string; required: boolean }[];
  wants_change: boolean;
  approvers: Record<string, string[]>;
}

export interface StatusReport extends TrendPoint {
  id: string;
  accomplishments: string | null;
  next_steps: string | null;
  decisions_needed: string | null;
  author_name: string | null;
  created_at: string;
}

export interface ProjectItem {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  owner_id: string | null;
  owner_name: string | null;
  owner: string | null;
  status: string;
  due_on: string | null;
  likelihood: number | null;
  impact: number | null;
  score: number | null;
  escalated_risk_id: string | null;
  escalated_at: string | null;
}

export const RAG_COLOR: Record<string, ColorName> = { red: 'red', amber: 'amber', green: 'green' };
export const RAG_LABEL: Record<string, string> = { red: 'Red', amber: 'Amber', green: 'Green' };
export const RAG_OPTIONS = [
  { value: 'green', label: 'Green: on track' },
  { value: 'amber', label: 'Amber: needs attention' },
  { value: 'red', label: 'Red: needs a decision or help' },
];
export const RAG_DIMENSIONS: { key: 'overall' | 'schedule' | 'budget' | 'risk'; label: string }[] = [
  { key: 'overall', label: 'Overall' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'budget', label: 'Budget' },
  { key: 'risk', label: 'Risk' },
];

/** Whole days between two YYYY-MM-DD dates. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone() }).format(new Date());
}
