// Shapes of the strategy area's own routes, and period labels (the server's periods.ts says the same).

export interface StatusCounts { on_track: number; at_risk: number; off_track: number; not_reported: number; total: number }

export interface Summary {
  today: string;
  due_soon_days: number;
  plans_in_force: number;
  objectives: StatusCounts;
  initiatives: StatusCounts;
  measures: { met: number; near: number; missed: number; no_value: number; total: number };
  submissions: { overdue: number; due_soon: number; open: number };
  series: number;
}

export interface LatestUpdate { period: string; status: string; narrative: string | null; reported_on: string | null; reported_by: string | null }
export interface TrendPoint { period: string; target: number | null; actual: number | null; state: string | null }
export interface ScoreMeasure {
  id: string; ref: string; title: string; unit: string | null; direction: string | null; frequency: string | null; source: string | null;
  baseline_value: number | null; baseline_period: string | null; owner_name: string | null;
  latest_period: string | null; latest_value: number | null; latest_target: number | null; latest_state: string | null; trend: TrendPoint[];
}
export interface ScoreInitiative {
  id: string; ref: string; title: string; stage: string | null; status: string | null; owner_name: string | null; start_on: string | null; end_on: string | null;
  budget_amount: number | null; project_id: string | null; project: string | null; latest: LatestUpdate | null;
}
export interface ScoreObjective {
  id: string; ref: string; code: string | null; title: string; status: string | null; status_period: string | null; owner_name: string | null;
  target_date: string | null; latest: LatestUpdate | null; measures: ScoreMeasure[]; initiatives: ScoreInitiative[];
}
export interface Scorecard {
  plan: { id: string; ref: string; title: string; description: string | null; status: string; period_start: string | null; period_end: string | null; adopted_on: string | null };
  totals: { objectives: StatusCounts; initiatives: StatusCounts; measures: Summary['measures'] };
  goals: { id: string; code: string | null; title: string; description: string | null; objectives: ScoreObjective[] }[];
}
export interface MatrixCell { status: string; narrative: string | null; reported_on: string | null; reported_by: string | null }
export interface MatrixData {
  quarters: string[];
  rows: { kind: 'objective' | 'initiative'; id: string; ref: string; code: string | null; title: string; goal: string; cells: Record<string, MatrixCell | null> }[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026 Q1", "March 2026", "2026". */
export function periodLabel(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return `${q[1]} Q${q[2]}`;
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return period;
}
