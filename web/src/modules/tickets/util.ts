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
