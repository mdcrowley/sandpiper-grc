// Shapes shared with the server's reporting module (server/src/modules/reports).
import type { FieldType } from '../../core';

export type Bucket = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type AggFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'pct';

export interface Condition { field: string; op: string; value?: unknown }
export interface FilterGroup { op: 'and' | 'or'; items: (Condition | FilterGroup)[] }
export const isGroup = (x: Condition | FilterGroup): x is FilterGroup => Array.isArray((x as FilterGroup).items);

export interface ReportSpec {
  type: string;
  columns?: string[];
  filters?: FilterGroup;
  groupBy?: { field: string; bucket?: Bucket }[];
  aggregates?: { fn: AggFn; field?: string }[];
  pivot?: boolean;
  sort?: { by: string; dir?: 'asc' | 'desc' }[];
  limit?: number;
}

export type ChartKind = 'table' | 'number' | 'gauge' | 'bar' | 'hbar' | 'stacked' | 'line' | 'area' | 'pie' | 'donut' | 'heatmap' | 'calendar';
export interface ChartSpec { kind: ChartKind; target?: number; max?: number; measure?: number; month?: string }

export interface ResultColumn {
  key: string; label: string; type: FieldType; role: 'column' | 'dim' | 'agg';
  field?: string; bucket?: Bucket; fn?: string; list?: string; to?: string;
}
export interface ResultRow { id?: string; v: Record<string, unknown>; d: Record<string, string>; c?: Record<string, string>; drill?: string }
export interface Pivot {
  rows: { value: string | null; label: string; drill: string }[];
  cols: { value: string | null; label: string; color?: string; drill: string }[];
  cells: ({ v: number; drill: string } | null)[][];
  rowTotals: (number | null)[]; colTotals: (number | null)[]; grand: number | null; measure: string;
}
export interface ReportResult {
  type: string; typeLabel: string; plural: string; route: string;
  mode: 'rows' | 'groups' | 'total';
  columns: ResultColumn[]; rows: ResultRow[];
  total: number; truncated: boolean; pivot?: Pivot;
  drill: string; drillExact: boolean; globalsApplied: string[];
  restricted: boolean; recordTypes: string[]; generatedAt: string;
}

export interface CatalogField {
  path: string; label: string; type: FieldType; list?: string; to?: string; via?: string; custom?: boolean;
  group: boolean; sum: boolean; column: boolean;
}
export interface CatalogType {
  type: string; label: string; plural: string; route: string; module: string; description: string;
  restricted: boolean; titleField: string; refField: string | null; canExport: boolean;
  fields: CatalogField[]; globals: Record<string, string>;
}

export type Sharing = 'private' | 'roles' | 'everyone';
export interface Shared { owner_id: string | null; sharing: Sharing; shared_roles: string[]; key?: string | null; _display?: Record<string, string> }

export interface ReportDefinition extends Shared {
  id: string; name: string; description: string | null; record_type: string; spec: ReportSpec; chart: ChartSpec; updated_at: string;
}

export type WidgetKind = 'report' | 'number' | 'gauge' | 'progress' | 'chart' | 'table' | 'list' | 'countdown' | 'calendar' | 'text';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WidgetConfig = Record<string, any>;
export interface Widget { id: string; kind: WidgetKind; title: string; x: number; y: number; w: number; h: number; config: WidgetConfig }
export type GlobalKind = 'date' | 'department' | 'site' | 'system' | 'owner';
export interface GlobalFilterDef { kind: GlobalKind; label: string; default?: unknown }
export interface Globals { from?: string; to?: string; department?: string; site?: string; system?: string; owner?: string }

export interface Dashboard extends Shared {
  id: string; name: string; description: string | null; widgets: Widget[]; filters: GlobalFilterDef[]; refresh_seconds: number | null; updated_at: string;
}

export interface WidgetData {
  status: 'ok' | 'unavailable' | 'forbidden' | 'error';
  message?: string; result?: ReportResult; chart?: ChartSpec; report?: { id: string; name: string };
  value?: number | null; denominator?: number | null; trend?: { current: number; previous: number; days: number };
}

export type PackSection = { kind: 'text'; title: string; body: string } | { kind: 'report'; reportId: string; title?: string };
export interface ReportPack extends Shared {
  id: string; name: string; description: string | null; cover_title: string | null; cover_subtitle: string | null; sections: PackSection[];
}

export interface Snapshot {
  id: string; source_type: 'report' | 'dashboard' | 'pack'; source_id: string; schedule_id: string | null; title: string;
  format: 'html' | 'csv' | 'pdf' | 'xlsx'; restricted: boolean; size_bytes: number; created_at: string;
}

export const GRID_COLUMNS = 12;
