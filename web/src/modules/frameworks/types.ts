// Shapes returned by the frameworks API (server/src/modules/frameworks/index.ts).
import type { ColorName } from '../../core';

export interface ScaleValue { value: string; label: string; color: ColorName; weight: number }
export interface Tally { total: number; counts: Record<string, number>; score: number; atTarget: number; atTargetPct: number }
export interface Target { status: string; weight: number; score: number }
export interface FrameworkRef { id: string; key: string; name: string; version: string | null; description?: string | null }

export interface BoardOutcome {
  id: string; code: string; title: string | null; official_text: string | null; description: string | null;
  function_code: string | null; category_code: string | null; priority: boolean; designation: string | null;
  status: string; phase: string | null; owner_id: string | null; owner_name: string | null;
  review_on: string | null; target: string | null;
}
export interface BoardCategory { code: string; name: string; description: string | null; outcomes: BoardOutcome[] }
export interface BoardFunction {
  code: string; name: string; color: ColorName; description: string | null;
  all: Tally; priority: Tally; categories: BoardCategory[];
}
export interface Board {
  framework: FrameworkRef;
  statuses: ScaleValue[];
  phases: { value: string; label: string; color: ColorName }[];
  target: Target;
  summary: { all: Tally; priority: Tally };
  functions: BoardFunction[];
}

export interface ProgressPoint { id: string | null; name: string; date: string; current: boolean; all: Tally; priority: Tally }
export interface Progress { framework: FrameworkRef; statuses: ScaleValue[]; target: Target; series: ProgressPoint[] }

export interface ChangedOutcome {
  outcome_id: string; code: string; title: string | null; function_code: string | null; priority: boolean;
  from: string | null; to: string | null; direction: 'improved' | 'declined' | 'changed' | 'added' | 'removed';
}
export interface Comparison {
  from: { id: string | null; name: string; date: string };
  to: { id: string | null; name: string; date: string };
  statuses: ScaleValue[];
  target: Target;
  overall: { from: { all: Tally; priority: Tally }; to: { all: Tally; priority: Tally } };
  functions: { code: string; name: string; color: ColorName; from: Tally; to: Tally }[];
  changed: ChangedOutcome[];
}

export interface SnapshotOutcome {
  outcome_id: string; code: string; title: string | null; function_code: string | null;
  category_code: string | null; priority: boolean; status: string;
}
export interface SnapshotDetail {
  id: string; framework_id: string; framework_name: string | null; name: string; taken_on: string; notes: string | null;
  statuses: ScaleValue[]; target: Target; all: Tally; priority: Tally;
  functions: ({ code: string; name: string; color: ColorName } & Tally)[];
  outcomes: SnapshotOutcome[];
}

export interface Evidence {
  id: string; title: string; description: string | null; location: string | null;
  collected_on: string | null; expires_on: string | null; created_at: string; created_by_name: string | null;
  state: 'current' | 'expiring' | 'expired';
}
export interface Mapping { id: string; framework_name: string; reference: string }

export const statusLabel = (scale: ScaleValue[], value: string | null) =>
  value === null ? '—' : scale.find((s) => s.value === value)?.label ?? value;
export const statusColor = (scale: ScaleValue[], value: string | null): ColorName =>
  scale.find((s) => s.value === value)?.color ?? 'gray';
