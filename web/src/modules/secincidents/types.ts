// Shapes returned by the hand-written security incident routes.

export interface Clock {
  task_id: string;
  ref: string | null;
  incident_id: string;
  rule_id: string | null;
  party: string;
  title: string;
  required: boolean;
  deadline_hours: number | null;
  guidance: string | null;
  due_at: string | null;
  status: 'pending' | 'done' | 'not_required';
  state: 'green' | 'amber' | 'red' | 'met' | 'not_required';
  seconds_remaining: number | null;
  overdue: boolean;
  late: boolean;
  notified_who: string | null;
  notified_how: string | null;
  notified_at: string | null;
  reference_received: string | null;
  completed_at: string | null;
  completed_by_name: string | null;
  /** When an open clock turns (or turned) amber. */
  amber_at: string | null;
  /** Present on the list across incidents. */
  incident?: { id: string; ref: string; title: string; severity: string | null; status: string };
}

/** GET /api/security-incidents/clocks */
export interface AllClocks {
  now: string;
  amber_fraction: number;
  summary: { red: number; amber: number; green: number; open: number; done: number; not_required: number; open_incidents: number; reviews_due: number };
  clocks: Clock[];
}

export type Stage = 'reported' | 'declared' | 'contained' | 'closed';
export type ReviewStage = 'open' | 'completed' | 'not_required';

/** GET /api/security-incidents/lifecycle */
export interface Lifecycle {
  stages: { value: Stage; label: string }[];
  statuses: { value: string; label: string; color: string; sort: number; stage: Stage }[];
  review_statuses: { value: string; label: string; color: string; sort: number; stage: ReviewStage }[];
  phases: { value: string; label: string }[];
  time_zone: string;
}

/** GET /api/security-incidents/:id/report */
export interface Report {
  generated_at: string;
  generated_by: string;
  incident: {
    id: string; ref: string; title: string; summary: string | null; severity: string | null; severity_label: string | null;
    status: string; status_label: string | null; stage: Stage | null; scenario_label: string | null; lead: string | null;
    discovered_at: string; declared_at: string | null; contained_at: string | null; closed_at: string | null;
    affected_systems: string | null; affected_data: string | null; answers: { question: string; yes: boolean }[];
    ransom_status_label: string | null; ransom_applies: boolean; board_resolution_ref: string | null;
  };
  timeline: (LogEntry & { kind_label: string })[];
  decisions: LogEntry[];
  notifications: Clock[];
  checklist: { phase: string; label: string; items: { step: string; done: boolean; done_by_name: string | null; done_at: string | null }[] }[];
  roles: { role: string; person_name: string | null; contact: string | null }[];
  evidence: { item: string; where_held: string | null; collected_by: string | null; collected_at: string | null; hash_ref: string | null }[];
  review: {
    status: string; status_label: string | null; stage: ReviewStage; due_on: string | null; held_at: string | null; lead: string | null;
    attendees: string | null; skip_reason: string | null; completed_at: string | null; completed_by: string | null;
    what_happened: string | null; root_cause: string | null; went_well: string | null; to_improve: string | null;
  };
  actions: { ref: string; title: string; status_label: string; due_on: string | null; completed_on: string | null; owner: string | null }[] | null;
}

export interface ClocksResult {
  now: string;
  amber_fraction: number;
  incident: { id: string; ref: string; title: string; discovered_at: string; declared_at: string | null };
  clocks: Clock[];
}

export interface PreviewItem {
  rule_id: string;
  party: string;
  trigger_attribute: string;
  deadline_hours: number | null;
  required: boolean;
  guidance: string | null;
  due_at: string | null;
}

export interface PreviewResult {
  discovered_at: string;
  notifications: PreviewItem[];
  not_configured: PreviewItem[];
}

export interface LogEntry {
  id: string;
  at: string;
  author_name: string | null;
  entry: string;
  kind: string;
  created_at: string;
}

export interface ChecklistItem {
  id: string;
  scenario: string | null;
  /** A value of the incident_checklist_phase list. */
  phase: string;
  step: string;
  done: boolean;
  done_by_name: string | null;
  done_at: string | null;
  template_id: string | null;
}

export interface Rule {
  id: string;
  trigger_attribute: string;
  party: string;
  deadline_hours: number | null;
  required: boolean;
  guidance: string | null;
  active: boolean;
  sort: number;
  trigger_label?: string;
}

export interface Contact {
  id: string;
  role: string;
  person_name: string | null;
  contact: string | null;
  notes: string | null;
}

export interface Kit {
  generated_at: string;
  generated_by: string;
  rules: Rule[];
  questions: Question[];
  contacts: Contact[];
  checklists: { scenario: string; label: string; containment: string[]; recovery: string[] }[];
  severities: { value: string; label: string; meta?: { level?: number; guide?: string } }[];
  /** The organization and its security contact (Administration > Organization); empty strings when not set. */
  organization?: { name: string; address: string; phone: string; security_phone: string; security_email: string };
}

/**
 * A plain-language yes/no question that drives the notification rules: a built-in flag
 * (`kind: 'flag'`, `value` is the field) or a kind of data from the configurable
 * `incident_data_kind` list (`kind: 'data_kind'`, `value` goes into `data_kinds`).
 */
export interface Question {
  key: string;
  kind: 'flag' | 'data_kind';
  value: string;
  question: string;
  hint: string;
}

/** GET /api/security-incidents/questions */
export interface Questions {
  questions: Question[];
  triggers: { value: string; label: string }[];
}

/** Turns the answers (keyed by question key) into incident fields. */
export function answersToFields(questions: Question[], answers: Record<string, boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = { data_kinds: questions.filter((q) => q.kind === 'data_kind' && answers[q.key]).map((q) => q.value) };
  for (const q of questions) if (q.kind === 'flag') out[q.value] = answers[q.key] ?? false;
  return out;
}

/** "24 hours", "7 days", "Immediately", or "Not set". */
export function deadlineText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'Not set';
  if (Number(hours) === 0) return 'Immediately';
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return `${hours} hour${Number(hours) === 1 ? '' : 's'}`;
}
