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
  contacts: Contact[];
  checklists: { scenario: string; label: string; containment: string[]; recovery: string[] }[];
  severities: { value: string; label: string; meta?: { level?: number; guide?: string } }[];
}

/** The four plain-language questions that drive the notification rules. */
export const FLAG_QUESTIONS: { field: string; question: string; hint: string }[] = [
  {
    field: 'is_cyber_incident',
    question: 'Is this a cybersecurity or ransomware incident?',
    hint: 'Yes for any attack on, or unauthorised access to, the organisation\'s systems, accounts or data.',
  },
  {
    field: 'health_data_involved',
    question: 'Could health information be involved?',
    hint: 'Medical, care or other health-related details of identifiable people.',
  },
  {
    field: 'card_data_involved',
    question: 'Could payment card data be involved?',
    hint: 'Card numbers or the systems and devices that take card payments.',
  },
  {
    field: 'personal_info_involved',
    question: 'Could personal information be involved?',
    hint: 'Names with identifiers such as national identity, licence or account numbers.',
  },
];

/** "24 hours", "7 days", "Immediately", or "Not set". */
export function deadlineText(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return 'Not set';
  if (Number(hours) === 0) return 'Immediately';
  if (hours % 24 === 0 && hours >= 48) return `${hours / 24} days`;
  return `${hours} hour${Number(hours) === 1 ? '' : 's'}`;
}
