// Types and small pieces shared by the policy and exception screens.
import { StatusChip, formatDate } from '../../core';
import type { ColorName } from '../../core';

export interface PolicyVersion {
  id: string;
  policy_id: string;
  version: number;
  status: 'draft' | 'in_review' | 'approved' | 'published' | 'superseded';
  /** The person who wrote the version; they cannot approve it. */
  created_by?: string | null;
  change_summary: string | null;
  approved_by_name: string | null;
  approved_on: string | null;
  effective_on: string | null;
  published_at: string | null;
  created_at: string;
  author_name: string | null;
  body: string;
  body_html: string;
}

export interface AckCounts {
  total: number; acknowledged: number; outstanding: number; overdue: number;
  acknowledged_pct: number; outstanding_pct: number; overdue_pct: number;
}

export type AckState = 'acknowledged' | 'overdue' | 'outstanding' | 'superseded';

export interface AckRow {
  id: string;
  user_id: string;
  user_name: string;
  email: string;
  department: string | null;
  requested_at: string;
  due_on: string;
  acknowledged_at: string | null;
  reminded_at: string | null;
  reminder_count: number;
  state: AckState;
  days_overdue: number;
}

export interface AckTracking {
  today: string;
  version: { id: string; version: number; status: string; published_at: string | null } | null;
  counts: AckCounts;
  rows: AckRow[];
  departments: ({ department: string | null } & AckCounts)[];
}

export interface MyAck {
  id: string;
  policy_id: string;
  policy_ref: string | null;
  policy_title: string;
  policy_summary: string | null;
  version: number;
  effective_on: string | null;
  requested_at: string;
  due_on: string;
  acknowledged_at: string | null;
  state: AckState;
  days_left: number;
  change_summary?: string | null;
  body_html?: string;
}

export const VERSION_STATUS: Record<PolicyVersion['status'], { label: string; color: ColorName }> = {
  draft: { label: 'Draft', color: 'gray' },
  in_review: { label: 'In review', color: 'amber' },
  approved: { label: 'Approved', color: 'blue' },
  published: { label: 'Published', color: 'green' },
  superseded: { label: 'Superseded', color: 'gray' },
};

export function VersionChip({ status }: { status: PolicyVersion['status'] }) {
  const s = VERSION_STATUS[status] ?? VERSION_STATUS.draft;
  return <StatusChip color={s.color} label={s.label} />;
}

export const ACK_STATE: Record<AckState, { label: string; color: ColorName }> = {
  acknowledged: { label: 'Acknowledged', color: 'green' },
  outstanding: { label: 'Outstanding', color: 'blue' },
  overdue: { label: 'Overdue', color: 'red' },
  superseded: { label: 'Closed', color: 'gray' },
};

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

export function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Review-date chip for a policy: red when the review is overdue, amber inside 60 days. A retired policy needs no review. */
export function ReviewChip({ date, status }: { date: string | null | undefined; status?: string }) {
  if (status === 'retired') return <span className="muted">—</span>;
  if (!date) return <StatusChip color="gray" label="No review date" />;
  const left = daysUntil(date);
  if (left < 0) return <StatusChip color="red" label={`Overdue by ${-left} day${left === -1 ? '' : 's'}`} />;
  if (left <= 60) return <StatusChip color="amber" label={`Due ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={formatDate(date)} />;
}

/** Expiry chip for an exception, by status and date. */
export function ExpiryChip({ date, status }: { date: string | null | undefined; status?: string }) {
  if (!date) return <span className="muted">No expiry date</span>;
  const left = daysUntil(date);
  if (status === 'expired' || (status === 'approved' && left < 0)) return <StatusChip color="red" label={`Expired ${daysPhrase(left)}`} />;
  if (status !== 'approved') return <span>{formatDate(date)}</span>;
  if (left <= 30) return <StatusChip color="amber" label={`Expires ${daysPhrase(left)}`} />;
  return <StatusChip color="green" label={`Valid to ${formatDate(date)}`} />;
}

/**
 * Policy text. The HTML is produced and made safe by the server (raw HTML escaped, tags and
 * attributes rebuilt from an allow-list, unsafe addresses dropped), so it can be placed as is.
 */
export function PolicyBody({ html, empty = 'This version has no text.' }: { html: string | undefined; empty?: string }) {
  if (!html || !html.trim()) return <p className="muted">{empty}</p>;
  return <div className="pol-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
