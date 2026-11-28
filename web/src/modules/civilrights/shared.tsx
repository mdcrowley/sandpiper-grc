// Shapes and small parts shared by the civil rights pages.
import { lazy, type ComponentType } from 'react';
import { formatDate, StatusChip, todayInZone, useAuth, useFetch } from '../../core';
import type { ColorName } from '../../core';

export interface Attainment {
  goal_id: string; ref: string | null; title: string; period_label: string | null; period_start: string | null; period_end: string | null;
  goal_pct: number | null; awards: number; award_total: number; participation_total: number; certified_total: number;
  attainment_pct: number | null; shortfall_pct: number | null; met: boolean | null;
}

export interface Summary {
  programs: { total: number; update_overdue: number; reports_overdue: number; reports_due_soon: number };
  complaints: { open: number; overdue: number; ack_overdue: number; received_this_year: number };
  goal: Attainment | null;
}

export const pct = (v: number | null | undefined) => (v == null ? 'Not yet' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`);

/** A figure: a number over its label, colored when it needs attention. */
export function Figure({ value, label, tone }: { value: number | string; label: string; tone?: 'amber' | 'red' }) {
  return (
    <div className={`cr-figure${tone ? ` cr-${tone}` : ''}`}>
      <span className="cr-figure-value">{value}</span>
      <span className="cr-figure-label">{label}</span>
    </div>
  );
}

/** The area's figures (the same for everyone: confidential complaints are counted). */
export function useSummary() {
  return useFetch<Summary>('/api/civil-rights/summary');
}

/** A due date as a chip: red once passed, amber within the reminder window, plain otherwise. */
export function DueChip({ date, done, soonDays = 7 }: { date: string | null | undefined; done?: boolean; soonDays?: number }) {
  if (!date) return <span className="muted">None</span>;
  const d = String(date).slice(0, 10);
  const ymd = todayInZone();
  const days = Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
  const color: ColorName = done ? 'gray' : days < 0 ? 'red' : days <= soonDays ? 'amber' : 'gray';
  const label = done ? formatDate(d) : days < 0 ? `${formatDate(d)} · overdue` : formatDate(d);
  return <StatusChip size="sm" color={color} label={label} />;
}

// The evidence library supplies the panel; it is loaded only when that module is in the build.
const evidenceLoaders = import.meta.glob<{ EvidencePanel: ComponentType<{ recordType: string; recordId: string; part?: string; title?: string; bare?: boolean }> }>('../evidence/EvidencePanel.tsx');
const loadEvidence = Object.values(evidenceLoaders)[0];
export const LazyEvidence = loadEvidence ? lazy(() => loadEvidence().then((m) => ({ default: m.EvidencePanel }))) : null;

/** Whether evidence from the library can be shown: its module is built, its area on and the reader may see it. */
export function useEvidenceOn(): boolean {
  const { can, areaOn } = useAuth();
  return Boolean(LazyEvidence) && areaOn('evidence') && can('evidence.view');
}
