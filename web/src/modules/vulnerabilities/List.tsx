// Findings list with one-click presets above the usual search, filters, saved views and export.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Button, formatDate, PageHeader, ResourceList, todayInZone, useFetch } from '../../core';
import type { Row } from '../../core';
import { hostOf, SectionTabs, SeverityChip, useAvailableFields, useVulnAccess } from './shared';
import type { Summary } from './shared';

type PresetKey = 'open' | 'overdue' | 'critical_high' | 'exploited' | 'fixed_month' | 'all';

function usePresets(summary: Summary | undefined) {
  return useMemo(() => {
    const monthStart = `${todayInZone().slice(0, 7)}-01`;
    const open = (sev: string) => summary?.openBySeverity.find((s) => s.severity === sev)?.count ?? 0;
    const presets: { key: PresetKey; label: string; count?: number; filter: Record<string, string> }[] = [
      { key: 'open', label: 'Open', count: summary?.totals.open, filter: { closed: 'false' } },
      { key: 'overdue', label: 'Overdue', count: summary?.totals.overdue, filter: { overdue: 'true' } },
      { key: 'critical_high', label: 'Critical and high', count: summary && open('critical') + open('high'), filter: { closed: 'false', severity: 'critical,high' } },
      { key: 'exploited', label: 'Known exploited', count: summary?.totals.knownExploitedOpen, filter: { closed: 'false', known_exploited: 'true' } },
      { key: 'fixed_month', label: 'Fixed this month', count: summary?.totals.fixedThisMonth, filter: { closed: 'true', 'fixed_on.gte': monthStart } },
      { key: 'all', label: 'All', filter: {} },
    ];
    return presets;
  }, [summary]);
}

export function VulnerabilityList() {
  const access = useVulnAccess();
  const [params, setParams] = useSearchParams();
  const { data: summary } = useFetch<Summary>('/api/vulnerabilities/summary');
  const presets = usePresets(summary ?? undefined);

  // A drill-down link carries its own filters; the presets then stand aside.
  const drilled = [...params.keys()].some((k) => k.startsWith('f.') || k === 'q');
  const wanted = params.get('view') as PresetKey | null;
  const active = presets.find((p) => p.key === wanted)?.key ?? (drilled ? 'all' : 'open');
  const preset = presets.find((p) => p.key === active)!;

  const filters = useAvailableFields(['severity', 'status', 'owner_id', 'known_exploited', 'system_id', 'asset_id', 'first_seen', 'due_on']);
  const createFields = useAvailableFields([
    'title', 'severity', 'host_name', 'host_ip', 'port', 'service', 'plugin_id', 'cves', 'cvss', 'known_exploited',
    'first_seen', 'owner_id', 'system_id', 'asset_id', 'description', 'solution', 'source',
  ]);

  return (
    <div className="stack">
      <PageHeader title="Vulnerabilities" subtitle="Findings from scans and assessments, from first seen to fixed." />
      <SectionTabs active="findings" />
      <div className="vuln-presets" role="group" aria-label="Quick views">
        {presets.map((p) => (
          <Button key={p.key} size="sm" aria-pressed={p.key === active} className={p.key === active ? 'vuln-preset-on' : undefined}
            onClick={() => setParams(p.key === 'open' ? {} : { view: p.key })}>
            {p.label}{p.count !== undefined && <span className="vuln-preset-count">{p.count}</span>}
          </Button>
        ))}
      </div>
      <ResourceList
        key={`${active}:${drilled ? params.toString() : ''}`}
        type="vulnerability"
        baseFilter={preset.filter}
        columns={[
          'ref',
          {
            field: 'title', label: 'Title', sortable: true,
            render: (row: Row) => (
              <span className="vuln-title-cell">
                <Link className="row-title" to={`/vulnerabilities/${row.id}`}>{row.title}</Link>
                {row.known_exploited && <Badge color="red">Known exploited</Badge>}
              </span>
            ),
          },
          { field: 'severity', label: 'Severity', sortable: true, render: (row: Row) => <SeverityChip value={row.severity} /> },
          { field: 'cvss', label: 'CVSS' },
          {
            field: 'host_name', label: 'Host', sortable: true,
            render: (row: Row) => (
              <>
                {hostOf(row)}
                {(row.port || (row.host_name && row.host_ip)) && (
                  <div className="muted vuln-sub">{[row.host_name && row.host_ip, row.port].filter(Boolean).join(' · ')}</div>
                )}
              </>
            ),
          },
          'status',
          'owner_id',
          {
            field: 'due_on', label: 'Fix by', sortable: true,
            render: (row: Row) => (row.due_on
              ? <span className="vuln-due">{formatDate(row.due_on)}{row.overdue && <Badge color="red">Overdue</Badge>}</span>
              : '—'),
          },
          { field: 'age_days', label: 'Age (days)' },
        ]}
        filters={filters}
        createFields={access.create ? createFields : undefined}
        actions={access.importFindings ? <Link className="btn btn-secondary" to="/vulnerabilities/import">Import findings</Link> : undefined}
      />
    </div>
  );
}
