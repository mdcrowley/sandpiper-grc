// Shared pieces of the vulnerabilities screens: types, the section tabs and small helpers.
import { lazy, Suspense } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Forbidden, Loading, lookupColor, lookupLabel, StatusChip, Tabs, todayInZone, useAuth, useMeta, useResource } from '../../core';

export interface Summary {
  today: string;
  severities: { value: string; label: string; color: string }[];
  totals: { open: number; overdue: number; knownExploitedOpen: number; unassignedOpen: number; fixedThisMonth: number };
  openBySeverity: { severity: string; count: number }[];
  overdueBySeverity: { severity: string; count: number }[];
  ageBuckets: { key: string; label: string; min: number; max: number | null; bySeverity: Record<string, number>; total: number }[];
  mttr: { severity: string; days: number | null; fixed: number }[];
  topHosts: { host: string; host_key: string; total: number; bySeverity: Record<string, number> }[];
  overdueByOwner: { owner_id: string | null; owner: string; count: number }[];
  /** Whether the overdue report can be grouped by system owner for this reader. */
  systemOwnerReport: boolean;
  trend: { week_start: string; bySeverity: Record<string, number>; total: number; overdue: number }[];
}

export interface OverdueGroup {
  key: string; kind: 'person' | 'unassigned' | 'no_system' | 'no_owner'; ownerId: string | null; name: string; total: number;
  bySeverity: Record<string, number>; oldestDue: string | null; systemIds: string[];
}
export interface OverdueReport { group: 'owner' | 'system_owner'; available: boolean; groups: OverdueGroup[]; total: number }

export interface Policy {
  days: Record<string, number | null>;
  knownExploitedSeverity: string;
  /** Share of the period (per cent) for a finding on a system of each criticality. */
  criticalityPercent: Record<string, number>;
  /** The criticality values of the inventory; empty when systems are not in use. */
  criticalityTiers: { value: string; label: string; color: string }[];
  recalculated?: number;
}

export interface ImportBatch {
  id: string; source: string; file_name: string | null; preset_name: string | null; close_missing: boolean;
  mapping: Record<string, string>; total_rows: number; created_count: number; updated_count: number; unchanged_count: number;
  reopened_count: number; closed_count: number; duplicate_count: number; error_count: number; unmatched_hosts: string[];
  imported_by_name: string | null; imported_at: string;
}

/** Findings are security records: both permissions are needed, as on the server. */
export function useVulnAccess() {
  const { can } = useAuth();
  const secure = can('security.view');
  return {
    view: secure && can('vulnerabilities.view'),
    create: secure && can('vulnerabilities.create'),
    edit: secure && can('vulnerabilities.edit'),
    importFindings: secure && can('vulnerabilities.create') && can('vulnerabilities.edit'),
    administer: secure && can('vulnerabilities.administer'),
  };
}

export function Guard({ children, need = 'view' }: { children: ReactNode; need?: 'view' | 'importFindings' }) {
  const access = useVulnAccess();
  return access[need] ? <>{children}</> : <Forbidden />;
}

const SECTIONS = [
  { key: 'findings', label: 'Findings', path: '/vulnerabilities' },
  { key: 'dashboard', label: 'Dashboard', path: '/vulnerabilities/dashboard' },
  { key: 'imports', label: 'Imports', path: '/vulnerabilities/imports' },
  { key: 'policy', label: 'Severity policy', path: '/vulnerabilities/settings' },
] as const;

/** The tabs under every page header that move between the parts of the module. */
export function SectionTabs({ active }: { active: (typeof SECTIONS)[number]['key'] }) {
  const navigate = useNavigate();
  return (
    <Tabs
      label="Vulnerabilities sections"
      active={active}
      tabs={SECTIONS.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/vulnerabilities')}
    />
  );
}

export function SeverityChip({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>;
  return <StatusChip color={lookupColor('vulnerability_severity', value)} label={lookupLabel('vulnerability_severity', value)} />;
}

/** Field names whose target record type exists in this installation (other modules may not be loaded). */
export function useAvailableFields(fields: string[]): string[] {
  const { resources } = useMeta();
  const own = resources.vulnerability?.fields ?? {};
  return fields.filter((f) => {
    const meta = own[f];
    return meta && (meta.type !== 'ref' || (meta.to !== undefined && meta.to in resources));
  });
}

export const hostOf = (row: Record<string, any>): string => row.host_name || row.host_ip || '—';

/** "443/tcp" from the port and protocol of a finding, as the duplicate key reads them. */
export function portOf(row: Record<string, any>): string {
  const port = String(row.port ?? '').trim();
  const protocol = String(row.protocol ?? '').trim().toLowerCase();
  return port && protocol && !port.toLowerCase().includes(protocol) ? `${port}/${protocol}` : port;
}

/** Link to the findings list with filters, e.g. listLink({ severity: 'high', closed: 'false' }). */
export function listLink(filters: Record<string, string | number | undefined>): string {
  const parts = Object.entries(filters).filter(([, v]) => v !== undefined && v !== '')
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `f.${k}=${encodeURIComponent(String(v))}`);
  return `/vulnerabilities${parts.length ? `?${parts.join('&')}` : ''}`;
}

/** A calendar day moved by a number of days: shiftDay('2026-11-18', -18) is '2026-10-31'. */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Findings fixed since the first day of this month (organisation time zone). */
export const fixedThisMonthLink = () => listLink({ closed: 'true', 'fixed_on.gt': shiftDay(`${todayInZone().slice(0, 7)}-01`, -1) });

/** Open findings first seen between `min` and `max` days ago (`max` null = no upper limit), as date filters the list can show. */
export function ageFilters(today: string, min: number, max: number | null): Record<string, string | undefined> {
  return { 'first_seen.lt': shiftDay(today, -min + 1), 'first_seen.gt': max === null ? undefined : shiftDay(today, -max - 1) };
}

/** The ready-made views of the findings list. They are put in the list's View menu once per browser. */
export const STARTER_VIEWS: { name: string; filters: Record<string, string>; labels?: Record<string, string> }[] = [
  { name: 'Open', filters: { closed: 'false' } },
  { name: 'Overdue', filters: { overdue: 'true' } },
  { name: 'Open: critical and high', filters: { closed: 'false', severity: 'critical,high' } },
  { name: 'Open: known exploited', filters: { closed: 'false', known_exploited: 'true' } },
  { name: 'Open: no owner', filters: { closed: 'false', 'owner_id.null': 'true' } },
  { name: 'Open: mine', filters: { closed: 'false', owner_id: 'me' }, labels: { owner_id: 'Me' } },
];

export function ensureStarterViews(): void {
  try {
    if (localStorage.getItem('grc.views.vulnerability.starter') === '1') return;
    const existing: { name: string }[] = JSON.parse(localStorage.getItem('grc.views.vulnerability') ?? '[]');
    const starters = STARTER_VIEWS.filter((s) => !existing.some((e) => e.name === s.name)).map((s) => ({
      name: s.name,
      view: {
        q: '', sort: '', dir: 'asc',
        filters: Object.fromEntries(Object.entries(s.filters).map(([k, v]) => [k, v.split(',')])),
        labels: s.labels ?? {},
      },
    }));
    localStorage.setItem('grc.views.vulnerability', JSON.stringify([...existing, ...starters]));
    localStorage.setItem('grc.views.vulnerability.starter', '1');
  } catch {
    // Storage unavailable: the tiles above the list still lead to the same findings.
  }
}

/* ---------- the shared Actions panel, loaded only when the risks module is part of the build ---------- */

const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>(
  '../risks/ActionsPanel.tsx',
);
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

/** Whether the Actions tab can be shown: the code is in the build and the server has the `action` type. */
export function useActionsAvailable(): boolean {
  return Boolean(useResource('action')) && LazyActions !== null;
}

export function ActionsTab({ sourceId }: { sourceId: string }) {
  if (!LazyActions) return null;
  return (
    <Suspense fallback={<Loading lines={3} label="Loading actions" />}>
      <LazyActions sourceType="vulnerability" sourceId={sourceId} />
    </Suspense>
  );
}
