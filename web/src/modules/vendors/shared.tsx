// Types and small pieces shared by the vendor and contract screens.
import { StatusChip, formatDate } from '../../core';
import type { ColorName } from '../../core';

export type ClauseStatus = 'present' | 'partial' | 'absent';

export interface ChecklistRow {
  clause_key: string;
  label: string;
  description: string | null;
  status: ClauseStatus | null;
  clause_text: string | null;
  note: string | null;
  updated_at: string | null;
}

export interface MatrixItem {
  contract_id: string;
  contract_ref: string | null;
  contract_title: string;
  status: ClauseStatus | null;
  clause_text: string | null;
  note: string | null;
}

export interface MatrixVendor {
  id: string;
  ref: string | null;
  name: string;
  criticality: string | null;
  criticality_label: string | null;
  criticality_color: string;
  contracts: number;
  cells: Record<string, { status: ClauseStatus | null; items: MatrixItem[] }>;
}

export interface Matrix {
  clauses: { key: string; label: string; description: string | null }[];
  vendors: MatrixVendor[];
}

export interface VendorSummary {
  today: string;
  contracts: number;
  next_notice_date: string | null;
  notice_dates_passed: number;
  terms: { present: number; partial: number; absent: number; not_assessed: number };
  evidence: number;
  evidence_expired: number;
  evidence_expiring: number;
  systems: number | null;
}

export interface ReminderState {
  threshold_days: number;
  due_on: string;
  fired_at: string | null;
  superseded: boolean;
  state: 'fired' | 'superseded' | 'due' | 'scheduled';
}

export interface RenewalRow {
  id: string;
  ref: string | null;
  title: string;
  vendor_id: string;
  vendor_name: string | null;
  status: string | null;
  status_label: string | null;
  status_color: string;
  renewal_mechanism: string | null;
  renewal_label: string | null;
  end_date: string | null;
  notice_days: number | null;
  notice_date: string | null;
  owner_name: string | null;
  term_and_renewal: string | null;
  days_to_notice?: number;
  window?: string;
  reminders?: ReminderState[];
}

export interface Renewals {
  today: string;
  thresholds: number[];
  contracts: RenewalRow[];
  undated: RenewalRow[];
}

export interface ExpiringEvidence {
  id: string;
  title: string;
  type: string | null;
  type_label: string | null;
  type_color: string;
  vendor_id: string;
  vendor_name: string;
  received_on: string | null;
  expires_on: string;
  days_left: number;
  expired: boolean;
}

/** One vocabulary for clause status everywhere: colour plus a word, never colour alone. */
export const CLAUSE_STATUS: Record<ClauseStatus | 'none', { label: string; color: ColorName }> = {
  present: { label: 'Present', color: 'green' },
  partial: { label: 'Partial', color: 'amber' },
  absent: { label: 'Absent', color: 'red' },
  none: { label: 'Not assessed', color: 'gray' },
};

export function ClauseChip({ status }: { status: ClauseStatus | null | undefined }) {
  const s = CLAUSE_STATUS[status ?? 'none'];
  return <StatusChip color={s.color} label={s.label} />;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/** "in 12 days", "today", "5 days ago". */
export function daysPhrase(left: number): string {
  if (left === 0) return 'today';
  return left > 0 ? `in ${days(left)}` : `${days(-left)} ago`;
}

/** Whole days from today (the browser's day) to a calendar date. */
export function daysUntil(date: string): number {
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.parse(`${date.slice(0, 10)}T00:00:00Z`) - today) / 86_400_000);
}

/** Expiry chip for evidence: red when expired, amber inside 90 days, green beyond, grey with no date. */
export function ExpiryChip({ date }: { date: string | null | undefined }) {
  if (!date) return <StatusChip color="gray" label="No expiry" />;
  const left = daysUntil(date);
  if (left < 0) return <StatusChip color="red" label={`Expired ${daysPhrase(left)}`} />;
  if (left <= 90) return <StatusChip color="amber" label={`Expires ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={`Valid to ${formatDate(date)}`} />;
}

/** Notice-date chip for contracts. */
export function NoticeChip({ date }: { date: string | null | undefined }) {
  if (!date) return <StatusChip color="gray" label="No notice date" />;
  const left = daysUntil(date);
  if (left < 0) return <StatusChip color="red" label={`Notice date passed ${daysPhrase(left)}`} />;
  if (left <= 30) return <StatusChip color="red" label={`Notice due ${daysPhrase(left)}`} />;
  if (left <= 120) return <StatusChip color="amber" label={`Notice due ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={`Notice due ${formatDate(date)}`} />;
}
