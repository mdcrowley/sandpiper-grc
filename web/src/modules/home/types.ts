import type { ReactNode } from 'react';

/** What a widget may ask about the signed-in person before it is shown. */
export interface WidgetCtx {
  userId: string;
  can: (permission: string) => boolean;
  /**
   * True when the record type is in the metadata (so its module is loaded and the person may
   * view it, including the restricted-record rule) and the person holds `<module>.view`.
   */
  sees: (type: string) => boolean;
  /** True when a web module with this key is part of the build. */
  hasModule: (key: string) => boolean;
}

export type WidgetGroup = 'mywork' | 'dashboard';

/** Summary endpoints shared by several widgets; each is requested once, and only when needed. */
export type SourceKey =
  | 'tickets' | 'actions' | 'clocks' | 'renewals' | 'risks' | 'portfolio' | 'changes' | 'vulnerabilities' | 'training';

export interface WidgetDef {
  id: string;
  title: string;
  /** `mywork` widgets are personal lists; `dashboard` widgets also need `dashboards.view`. */
  group: WidgetGroup;
  /** One line for the Customise dialog. */
  description: string;
  /** Spans the full width of the dashboard grid. */
  wide?: boolean;
  /** Shared endpoints the widget reads (see sources.tsx). */
  sources?: SourceKey[];
  /** Whether this person can have the widget at all. Must be false whenever its requests would be refused. */
  visible: (ctx: WidgetCtx) => boolean;
  render: () => ReactNode;
}

export interface TicketMetrics { open: number; sla: { compliance_pct: number | null; breaches: number } }
export interface ActionSummary { open: number; overdue: number; due_this_week: number; unassigned: number }
export interface RiskSummary {
  total: number;
  levels: { value: string; label: string; color: string; count: number }[];
  top: { id: string; ref: string; title: string; rating_label: string; color: string; owner_name: string | null }[];
  /** Risks whose status means they need review (a value of risk_status with needs_review). Newer servers only. */
  needs_review?: number;
  /** Accepted risks whose acceptance has run out. Newer servers only. */
  acceptances_expired?: number;
}
export interface Renewals {
  contracts: { id: string; ref: string; title: string; vendor_name: string; notice_date: string; days_to_notice: number; window: string }[];
  undated: unknown[];
}
export interface Portfolio {
  register: { id: string; ref: string; name: string; rag_overall: string | null; rag_trend: string | null; stage: string }[];
  funnel: { stage: string; label: string; color: string; count: number }[];
  wipWarning?: string | null;
}
export interface Clocks {
  summary: { red: number; amber: number; green: number; open: number };
  clocks: { task_id: string; party: string; due_at: string | null; incident_id: string; state: string; incident?: { ref?: string; title?: string; discovered_at?: string } }[];
}
export interface ChangeOverview {
  awaiting_approval: number; in_progress: number; upcoming: number; emergency_open: number; review_due: number; this_week: number;
}
export interface VulnerabilitySummary {
  severities: { value: string; label: string; color: string }[];
  totals: { open: number; overdue: number; knownExploitedOpen: number; unassignedOpen: number; fixedThisMonth: number };
  openBySeverity: { severity: string; count: number }[];
  overdueBySeverity: { severity: string; count: number }[];
}
export interface TrainingSummary {
  totals: { people: number; courses: number; total: number; complete: number; due: number; overdue: number; rate: number | null };
}

export interface SourceData {
  tickets: TicketMetrics;
  actions: ActionSummary;
  clocks: Clocks;
  renewals: Renewals;
  risks: RiskSummary;
  portfolio: Portfolio;
  changes: ChangeOverview;
  vulnerabilities: VulnerabilitySummary;
  training: TrainingSummary;
}
