// Shared pieces of the vulnerabilities screens: types, the section tabs and small helpers.
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Forbidden, lookupColor, lookupLabel, StatusChip, Tabs, useAuth, useMeta } from '../../core';

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
  trend: { week_start: string; bySeverity: Record<string, number>; total: number; overdue: number }[];
}

export interface Policy {
  days: Record<string, number | null>;
  knownExploitedSeverity: string;
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

/** Link to the findings list with filters, e.g. listLink({ severity: 'high', closed: 'false' }). */
export function listLink(filters: Record<string, string | number | undefined>): string {
  const parts = Object.entries(filters).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `f.${k}=${encodeURIComponent(String(v))}`);
  return `/vulnerabilities?view=all${parts.length ? `&${parts.join('&')}` : ''}`;
}
