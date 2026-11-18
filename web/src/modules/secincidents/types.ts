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
  phase: 'containment' | 'recovery';
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
