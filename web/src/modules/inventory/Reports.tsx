// Inventory reports: a card per ready-made check with its count, each opening its rows.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Group, Text, UnstyledButton } from '@mantine/core';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatCurrency, formatDate, formatDateTime, formatNumber,
  Icon, Loading, PageHeader, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { IconName } from '../../core';

interface Column { key: string; label: string; type?: 'text' | 'date' | 'number' | 'currency' }
interface ReportInfo {
  key: string; title: string; description: string; columns: Column[]; recordType: string | null;
  group: string; kind: 'issues' | 'summary'; list: string | null; total: number;
}
interface ReportResult extends ReportInfo { rows: Record<string, any>[]; generatedAt: string }

const ICONS: Record<string, IconName> = {
  'assets-past-support': 'alert', 'warranty-expiring': 'clock', 'assets-by-site': 'map-pin', 'assets-by-department': 'users',
  'unassigned-assets': 'user', 'systems-without-owner': 'users', 'systems-without-recovery-targets': 'history', 'sensitive-data-without-mfa': 'lock',
};

function cell(col: Column, row: Record<string, any>) {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'date') return formatDate(v);
  if (col.type === 'currency') return formatCurrency(v);
  if (col.type === 'number') return formatNumber(v);
  return String(v);
}

function ReportCard({ report, active, onOpen }: { report: ReportInfo; active: boolean; onOpen: () => void }) {
  const issues = report.kind === 'issues';
  const tone = !issues ? 'blue' : report.total === 0 ? 'green' : 'amber';
  return (
    <UnstyledButton className={`inv-report inv-report-${tone}`} aria-pressed={active} onClick={onOpen}>
      <span className="inv-report-icon" aria-hidden="true"><Icon name={ICONS[report.key] ?? 'chart'} size={18} /></span>
      <span className="inv-report-body">
        <span className="inv-report-title">{report.title}</span>
        <span className="inv-report-text">{report.description}</span>
      </span>
      <span className="inv-report-count">
        <span className="inv-report-number">{formatNumber(report.total)}</span>
        <span className="inv-report-unit">{issues ? (report.total === 0 ? 'all clear' : 'to look at') : report.total === 1 ? 'row' : 'rows'}</span>
      </span>
    </UnstyledButton>
  );
}

function ReportRows({ report, onClose }: { report: ReportInfo; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<ReportResult>(`/api/inventory/reports/${report.key}`);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportModule = report.recordType === 'system' ? 'systems' : 'assets';
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [report.key]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = (data?.rows ?? []).filter((r) => !needle || report.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(needle)));
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.key]; const y = b[sort.key];
        if (x == null || y == null) return (x == null ? 1 : 0) - (y == null ? 1 : 0);
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
      });
    }
    return out;
  }, [data, q, sort, report.columns]);

  async function exportCsv() {
    setExporting(true);
    try {
      const blob = await api.blob(`/api/inventory/reports/${report.key}?format=csv`);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `${report.key}.csv`;
      a.click();
      URL.revokeObjectURL(href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  }

  const actions = (
    <>
      {report.list && <Link className="btn btn-secondary btn-sm" to={report.list}>Open as a list</Link>}
      <Button size="sm" icon="refresh" onClick={reload}>Refresh</Button>
      {can(`${exportModule}.export`) && <Button size="sm" icon="download" loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>}
      <Button size="sm" variant="ghost" icon="x" onClick={onClose}>Close</Button>
    </>
  );
  return (
    <div ref={top}>
      <Card title={report.title} actions={actions}>
        <Text c="dimmed" size="sm">
          {report.description}{data ? ` As of ${formatDateTime(data.generatedAt)}.` : ''}
          {report.list ? ' Open as a list to filter further, save a view or change several records at once.' : ''}
        </Text>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={5} label="Running the report" />
          : data.rows.length === 0 ? <EmptyState icon="check" title="Nothing to report" message="No records match this report at the moment." />
          : (
            <>
              <Group justify="space-between" align="flex-end">
                <div className="inv-narrow">
                  <TextField label="Filter rows" type="search" value={q} onChange={setQ} placeholder="Type to filter" />
                </div>
                <Text c="dimmed" size="sm" role="status">{rows.length} of {data.total} rows</Text>
              </Group>
              {rows.length === 0 ? <EmptyState icon="search" title="No rows match" message="Clear the filter to see every row." /> : (
                <div className="table-wrap inv-wrap-cells">
                  <table className="table">
                    <caption className="sr-only">{report.title}</caption>
                    <thead>
                      <tr>
                        {report.columns.map((c) => {
                          const active = sort?.key === c.key;
                          return (
                            <th key={c.key} scope="col" className={c.type === 'number' || c.type === 'currency' ? 'num' : undefined}
                              aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
                              <button type="button" className="inv-sort" onClick={() => setSort({ key: c.key, dir: active && sort!.dir === 1 ? -1 : 1 })}>
                                {c.label}{active && <Icon name={sort!.dir === 1 ? 'arrow-up' : 'arrow-down'} size={12} />}
                              </button>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.id ?? i}>
                          {report.columns.map((c, j) => (
                            <td key={c.key} className={c.type === 'number' || c.type === 'currency' ? 'num' : undefined}>
                              {j <= 1 && r.route && (c.key === 'name' || c.key === 'site' || c.key === 'tag' || c.key === 'ref')
                                ? <Link to={r.route}>{cell(c, r)}</Link> : cell(c, r)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
      </Card>
    </div>
  );
}

export function ReportsPage() {
  const { data, error, reload } = useFetch<ReportInfo[]>('/api/inventory/reports');
  const [params, setParams] = useSearchParams();
  const selected = data?.find((r) => r.key === params.get('report')) ?? null;
  const header = <PageHeader title="Inventory reports" subtitle="Ready-made checks on assets and systems. The number on each card is what it finds now; select a card to see the rows." />;

  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;
  if (!data.length) {
    return <div className="stack">{header}<EmptyState icon="chart" title="No reports available" message="You do not have permission to see any inventory report." /></div>;
  }
  const groups = [...new Set(data.map((r) => r.group))];
  const toFix = data.filter((r) => r.kind === 'issues').reduce((s, r) => s + r.total, 0);
  return (
    <div className="stack">
      {header}
      {groups.map((g) => (
        <section key={g} className="inv-report-group" aria-label={`${g} reports`}>
          <Group gap="xs" align="center">
            <h2 className="inv-report-heading">{g}</h2>
            {(() => {
              const n = data.filter((r) => r.group === g && r.kind === 'issues').reduce((s, r) => s + r.total, 0);
              return <Badge color={n ? 'amber' : 'green'} variant="light">{n ? `${formatNumber(n)} to look at` : 'All clear'}</Badge>;
            })()}
          </Group>
          <div className="inv-report-list">
            {data.filter((r) => r.group === g).map((r) => (
              <ReportCard key={r.key} report={r} active={selected?.key === r.key}
                onOpen={() => setParams(selected?.key === r.key ? {} : { report: r.key })} />
            ))}
          </div>
        </section>
      ))}
      {selected
        ? <ReportRows key={selected.key} report={selected} onClose={() => setParams({})} />
        : <Text c="dimmed" size="sm">{toFix ? 'Select a card to see its rows, export them, or open them as a list.' : 'Nothing needs attention. Select a card to see its rows.'}</Text>}
    </div>
  );
}
