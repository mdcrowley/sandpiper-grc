// Findings list: tiles that open the usual questions, then the list with search, filters,
// saved views (the ready-made ones are in the View menu), bulk edit and export.
import { useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, formatDate, PageHeader, ResourceList, Stat, useFetch } from '../../core';
import type { Row } from '../../core';
import {
  ensureStarterViews, fixedThisMonthLink, hostOf, listLink, portOf, SectionTabs, SeverityChip, useAvailableFields, useVulnAccess,
} from './shared';
import type { Summary } from './shared';

export function VulnerabilityList() {
  useMemo(ensureStarterViews, []);
  const access = useVulnAccess();
  const [params, setParams] = useSearchParams();
  const { data: summary } = useFetch<Summary>('/api/vulnerabilities/summary');

  // Arriving with no search or filter shows what still needs fixing. "All vulnerabilities" in
  // the View menu, or clearing the filters, then shows everything: this runs once per visit.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
    if ([...params.keys()].some((k) => k.startsWith('f.') || k === 'q')) return;
    const next = new URLSearchParams(params);
    next.set('f.closed', 'false');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const filters = useAvailableFields([
    'severity', 'status', 'closed', 'overdue', 'known_exploited', 'owner_id', 'system_id', 'asset_id', 'first_seen', 'last_seen', 'due_on', 'fixed_on',
  ]);
  const bulkFields = useAvailableFields(['owner_id', 'status', 'severity', 'known_exploited', 'system_id', 'asset_id']);
  const createFields = useAvailableFields([
    'title', 'severity', 'host_name', 'host_ip', 'port', 'protocol', 'service', 'plugin_id', 'cves', 'cvss', 'known_exploited',
    'first_seen', 'owner_id', 'system_id', 'asset_id', 'description', 'solution', 'source',
  ]);
  const optional = useAvailableFields(['system_id', 'asset_id']);
  const t = summary?.totals;
  const openOf = (sev: string) => summary?.openBySeverity.find((s) => s.severity === sev)?.count ?? 0;

  return (
    <div className="stack">
      <PageHeader title="Vulnerabilities" subtitle="Findings from scans and assessments, from first seen to fixed."
        actions={access.importFindings ? <Link className="btn btn-secondary" to="/vulnerabilities/import">Import findings</Link> : undefined} />
      <SectionTabs active="findings" />
      <div className="grid-stats">
        <Stat label="Open" value={t?.open ?? '–'} icon="bug" to={listLink({ closed: 'false' })} />
        <Stat label="Overdue" value={t?.overdue ?? '–'} icon="clock" color={t?.overdue ? 'red' : undefined} to={listLink({ overdue: 'true' })} />
        <Stat label="Critical and high, open" value={summary ? openOf('critical') + openOf('high') : '–'} icon="alert-circle" color="orange"
          to={listLink({ closed: 'false', severity: 'critical,high' })} />
        <Stat label="Known exploited, open" value={t?.knownExploitedOpen ?? '–'} icon="alert" color={t?.knownExploitedOpen ? 'red' : undefined}
          to={listLink({ closed: 'false', known_exploited: 'true' })} />
        <Stat label="Fixed this month" value={t?.fixedThisMonth ?? '–'} icon="check" color="green" to={fixedThisMonthLink()} />
      </div>
      <ResourceList
        type="vulnerability"
        urlState
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
          {
            field: 'host_name', label: 'Host', sortable: true,
            render: (row: Row) => (
              <>
                {hostOf(row)}
                {(row.port || (row.host_name && row.host_ip)) && (
                  <div className="muted vuln-sub">{[row.host_name && row.host_ip, portOf(row)].filter(Boolean).join(' · ')}</div>
                )}
              </>
            ),
          },
          'status',
          { field: 'owner_id', sortable: true, render: (row: Row) => row._display?.owner_id ?? <span className="muted">Unassigned</span> },
          {
            field: 'due_on', label: 'Fix by', sortable: true,
            render: (row: Row) => (row.due_on
              ? <span className="vuln-due">{formatDate(row.due_on)}{row.overdue && <Badge color="red">Overdue</Badge>}</span>
              : <span className="muted">No date</span>),
          },
          { field: 'age_days', label: 'Age (days)' },
          { field: 'cvss', label: 'CVSS', hidden: true },
          { field: 'known_exploited', hidden: true },
          { field: 'plugin_id', hidden: true },
          { field: 'cves', hidden: true },
          { field: 'service', hidden: true },
          ...optional.map((field) => ({ field, hidden: true })),
          { field: 'first_seen', hidden: true },
          { field: 'last_seen', hidden: true },
          { field: 'fixed_on', hidden: true },
          { field: 'source', hidden: true },
          { field: 'updated_at', hidden: true },
        ]}
        filters={filters}
        bulkFields={access.edit ? bulkFields : []}
        defaultSort={{ field: 'due_on', dir: 'asc' }}
        createFields={access.create ? createFields : undefined}
      />
    </div>
  );
}
