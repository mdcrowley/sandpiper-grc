// Types and small helpers shared by the training and exercise screens.
import { formatDate, LookupChip, StatusChip } from '../../core';
import type { ColorName } from '../../core';

/** `not_passed`: a "did not pass" completion kept as history from before failed results became attempts. */
export type RecordStatus = 'complete' | 'due' | 'overdue' | 'not_passed';

export interface TrainingRecord {
  id: string;
  course_id: string;
  course_title: string;
  course_ref: string | null;
  user_id: string | null;
  person: string;
  email: string | null;
  department: string | null;
  has_account: boolean;
  assigned_on: string | null;
  due_on: string | null;
  completed_on: string | null;
  score: number | null;
  result: string | null;
  evidence_note: string | null;
  source: 'manual' | 'import' | 'rule';
  status: RecordStatus;
  /** The day of the latest attempt that did not pass; the record is still to complete. */
  attempted_on?: string | null;
  /** Completed by the person themselves. */
  self_certified?: boolean;
  /** The course lets people mark it complete themselves. */
  self_certify?: boolean;
}

export interface Tally { total: number; complete: number; due: number; overdue: number; rate: number | null }

export interface Progress extends Tally { today: string; people: TrainingRecord[] }

export interface Summary {
  today: string;
  totals: Tally & { people: number; courses: number };
  by_course: (Tally & { course_id: string; ref: string | null; title: string; mandatory: boolean })[];
  by_department: (Tally & { department: string | null; label: string })[];
  overdue: TrainingRecord[];
  trend: { month: string; as_of: string; overdue: number }[];
}

export interface Audiences {
  roles: { id: string; name: string }[];
  departments: { id: string; name: string }[];
  /** Roster positions (people module); empty without it. */
  positions?: { id: string; name: string }[];
  department_names: string[];
}

export const STATUS: Record<RecordStatus, { label: string; color: ColorName }> = {
  complete: { label: 'Completed', color: 'green' },
  due: { label: 'To do', color: 'blue' },
  overdue: { label: 'Overdue', color: 'red' },
  not_passed: { label: 'Did not pass', color: 'gray' },
};

export const SOURCE: Record<TrainingRecord['source'], string> = { manual: 'Entered by hand', import: 'Imported', rule: 'Assignment rule' };

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "in 12 days", "today", "5 days ago". */
export function daysPhrase(today: string, date: string): string {
  const n = daysBetween(today, date);
  return n === 0 ? 'today' : n > 0 ? `in ${plural(n, 'day')}` : `${plural(-n, 'day')} ago`;
}

export function RecordStatusChip({ record, today }: { record: TrainingRecord; today: string }) {
  const s = STATUS[record.status] ?? STATUS.due;
  const title = record.status === 'overdue' && record.due_on ? `Was due ${daysPhrase(today, record.due_on)}` : undefined;
  return (
    <span className="row trn-status" title={title}>
      <StatusChip color={s.color} label={s.label} />
      {record.attempted_on && !record.completed_on && <StatusChip color="amber" label={`Retake: did not pass on ${formatDate(record.attempted_on)}`} />}
      {record.self_certified && record.completed_on && <StatusChip color="gray" label="Self-certified" />}
    </span>
  );
}

/** The date that matters for a record: when it was completed, or when it is due. */
export function WhenCell({ record, today }: { record: TrainingRecord; today: string }) {
  if (record.completed_on) return <>{formatDate(record.completed_on)}</>;
  if (!record.due_on) return <span className="muted">No due date</span>;
  return (
    <>
      {formatDate(record.due_on)}{' '}
      <span className={record.status === 'overdue' ? 'trn-late' : 'muted'}>{daysPhrase(today, record.due_on)}</span>
    </>
  );
}

export function ResultCell({ record }: { record: TrainingRecord }) {
  if (!record.completed_on && !record.attempted_on) return <span className="muted">—</span>;
  return (
    <span className="row">
      {record.result && <LookupChip list="training_result" value={record.result} />}
      {record.score !== null && <span>{record.score}%</span>}
      {!record.result && record.score === null && <span className="muted">—</span>}
    </span>
  );
}

export const rateColor = (rate: number | null): ColorName => (rate === null ? 'gray' : rate >= 90 ? 'green' : rate >= 70 ? 'amber' : 'red');

/** Address of the record list with the given filters, for drill-down links. */
export function recordsLink(filters: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
  const s = p.toString();
  return `/training/records${s ? `?${s}` : ''}`;
}
