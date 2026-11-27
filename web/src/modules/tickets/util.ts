// Shared types and helpers for the service desk screens.
import { useMemo } from 'react';
import { ApiError, useFetch } from '../../core';
import type { Row } from '../../core';

export type StatusCategory = 'open' | 'paused' | 'resolved' | 'closed';

export interface StatusValue {
  value: string;
  label: string;
  color: string;
  active: boolean;
  meta?: { category?: string } | null;
}

/** A status with no category behaves as an open one (the same rule as the server). */
export function categoryOf(s: StatusValue | undefined): StatusCategory {
  const c = s?.meta?.category;
  return c === 'paused' || c === 'resolved' || c === 'closed' ? c : 'open';
}

/** Ticket statuses with their categories (the shared metadata does not carry `meta`). */
export function useStatuses() {
  const state = useFetch<StatusValue[]>('/api/lookups/ticket_status');
  const statuses = useMemo(() => (state.data ?? []).filter((s) => s.active), [state.data]);
  const category = (value: string | null | undefined) => categoryOf((state.data ?? []).find((s) => s.value === value));
  return { ...state, statuses, category };
}

export interface PriorityMatrix {
  default: string;
  cells: Record<string, Record<string, string>>;
}

export function priorityFor(matrix: PriorityMatrix | null | undefined, impact: string, urgency: string): string | null {
  if (!matrix) return null;
  return matrix.cells?.[impact]?.[urgency] ?? matrix.default;
}

export interface ClockView {
  state: 'none' | 'running' | 'paused' | 'met' | 'breached';
  due_at: string | null;
  projected_due_at: string | null;
  met_at: string | null;
  breached: boolean;
  remaining_minutes: number | null;
}

export interface SlaState {
  now: string;
  priority: string | null;
  status_category: StatusCategory;
  paused: boolean;
  paused_at: string | null;
  paused_minutes: number;
  policy: null | {
    respond_minutes: number;
    resolve_minutes: number;
    calendar: { id: string; key: string; name: string; timezone: string };
  };
  response: ClockView;
  resolve: ClockView;
  breach_reason: string | null;
}

export interface Group { value: string | null; label: string; color: string; count: number; breached: number }

export interface Metrics {
  range: { from: string | null; to: string | null };
  as_of: string;
  total: number;
  open: number;
  resolved: number;
  volume_by_day: { day: string; opened: number; resolved: number }[];
  by_category: Group[];
  by_department: Group[];
  by_priority: Group[];
  by_status: Group[];
  by_type: Group[];
  backlog: { total: number; buckets: { key: string; label: string; count: number; opened_after: string | null; opened_before: string }[] };
  first_response: { average_minutes: number | null; count: number };
  resolution: { average_minutes: number | null; count: number };
  sla: {
    response: { measured: number; breached: number; compliance_pct: number | null };
    resolve: { measured: number; breached: number; compliance_pct: number | null };
    compliance_pct: number | null;
    breaches: number;
  };
  satisfaction: { average: number | null; count: number };
  vendor: { held: number; tickets: number; average_response_minutes: number | null; responses: number };
}

/** "2d 4h", "3h 12m", "45m" from a number of minutes. */
export function minutesText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(Math.abs(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

/** Working time: a business day here is 9 hours, so say hours rather than days. */
export function workingText(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const m = Math.round(Math.abs(minutes));
  const h = Math.floor(m / 60);
  return h ? (m % 60 ? `${h}h ${m % 60}m` : `${h}h`) : `${m}m`;
}

export const isOpen = (row: Row) => !row.resolved_at;

export const fieldErrors = (err: unknown): Record<string, string> => (err instanceof ApiError ? err.fields ?? {} : {});

/** Address of the ticket list with filters, using the list contract's own names. */
export function ticketListHref(filters: Record<string, string | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v !== null && v !== undefined && v !== '') sp.set(`f.${k}`, v);
  const s = sp.toString();
  return s ? `/tickets?${s}` : '/tickets';
}

/* ---------- catalog ---------- */

export interface Question { key: string; label: string; type: 'text' | 'longtext' | 'choice' | 'date' | 'yes_no'; required: boolean; options?: string[]; hint?: string }
export interface Answer { key: string; label: string; value: string }
export interface Task { title: string; done: boolean; done_at?: string | null; done_by_name?: string | null }

/** The ticket fields a catalog item may pre-fill (the same list as the server). */
export const PREFILL_FIELDS = ['type', 'category', 'subcategory', 'title', 'description', 'impact', 'urgency', 'assignment_group', 'channel'];

/* ---------- queue ---------- */

export interface QueueCounts {
  open: number; mine: number; unassigned: number; at_risk: number; breaching: number; with_vendor: number; awaiting_approval: number; major: number;
}

export interface Suggestions {
  words: string[];
  tickets: { id: string; ref: string; title: string; status: string; priority: string | null; requester_name: string | null; opened_at: string; resolved_at: string | null }[];
  articles: { id: string; ref: string; title: string; category: string | null; audience: string }[];
}

/* ---------- administration ---------- */

export const DAYS: [string, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

export interface Calendar {
  id: string; key: string; name: string; timezone: string; always_open: boolean;
  hours: Record<string, [string, string] | null>;
  holidays: { id: string; day: string; name: string }[];
}
export interface Policy { id: string; priority: string; respond_minutes: number; resolve_minutes: number; calendar_id: string; calendar_name: string }
export interface EscalationRule {
  id: string; name: string; condition: string; wait_minutes: number; to_user_id: string | null; to_user_name: string | null;
  to_group: string | null; enabled: boolean; fired: number;
}
export interface DeskSettings {
  warning_pct: number;
  groups: { value: string; label: string; members: { id: string; label: string }[] }[];
  notifications: boolean;
}

/** Minutes as hours and minutes for a form: 90 -> { h: 1, m: 30 }. */
export const splitMinutes = (minutes: number) => ({ h: Math.floor(minutes / 60), m: minutes % 60 });

/** One sentence on what should happen to a ticket next. */
export function nextStep(row: Row, cat: StatusCategory): string {
  if (row.approval_status === 'pending') return 'Waiting for approval before work can start.';
  if (row.approval_status === 'rejected' && cat !== 'closed') return 'Rejected: cancel it or ask for the decision to be changed.';
  if (cat === 'closed') return row.status === 'cancelled' ? 'Canceled. Nothing more to do.' : row.satisfaction_score ? 'Finished.' : 'Finished. Record the requester\u2019s satisfaction if you have it.';
  if (cat === 'resolved') return 'Close it once the requester confirms.';
  if (cat === 'paused') return 'Clock paused. Resume when you have what you need.';
  // E18-74: the Respond target is met by starting work or by a public comment, not by assigning.
  if (!row.assignee_id) return row.first_responded_at ? 'Nobody has it yet. Assign it.' : 'Nobody has it yet. Assign it, then start work or answer the requester to meet the response target.';
  if (row.status === 'new' || row.status === 'assigned') return row.first_responded_at ? 'Start work when you pick it up.' : 'Start work, or answer the requester in a public comment, to meet the response target.';
  return 'Resolve it when fixed, or pause the clock while you wait on someone.';
}

/**
 * PUT with the same contract as the core api client, which has get, post, patch and del only.
 * The service desk settings routes are PUTs.
 */
export async function put<T = unknown>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'PUT', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-GRC-CSRF': '1' },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'The server could not be reached. Check that it is running and try again.');
  }
  const text = await res.text();
  let parsed: any;
  try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
  if (res.ok) return parsed as T;
  const error = parsed?.error ?? {};
  throw new ApiError(res.status, error.code ?? `http_${res.status}`, error.message ?? `The request failed (${res.status}).`, error.fields ?? {});
}
