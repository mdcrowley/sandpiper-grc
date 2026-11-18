// Inventory reports: the canned reports, each opening its rows.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatCurrency, formatDate, formatDateTime, formatNumber,
  Loading, PageHeader, TextField, useAuth, useFetch, useToast,
} from '../../core';

interface Column { key: string; label: string; type?: 'text' | 'date' | 'number' | 'currency' }
interface ReportInfo { key: string; title: string; description: string; columns: Column[]; recordType: string | null }
interface ReportResult extends ReportInfo { rows: Record<string, any>[]; total: number; generatedAt: string }

function cell(col: Column, row: Record<string, any>) {
  const v = row[col.key];
  if (v === null || v === undefined || v === '') return '—';
  if (col.type === 'date') return formatDate(v);
  if (col.type === 'currency') return formatCurrency(v);
  if (col.type === 'number') return formatNumber(v);
  return String(v);
}

function ReportTile({ report, active, onOpen }: { report: ReportInfo; active: boolean; onOpen: () => void }) {
  const { data, error } = useFetch<ReportResult>(`/api/inventory/reports/${report.key}`);
  return (
    <button type="button" className="inv-report-tile" aria-pressed={active} onClick={onOpen}>
      <span className="inv-report-count">{error ? '!' : data ? formatNumber(data.total) : '…'}</span>
      <strong>{report.title}</strong>
      <span className="muted">{error ? 'Could not be counted.' : report.description}</span>
    </button>
  );
}

function ReportRows({ report }: { report: ReportInfo }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<ReportResult>(`/api/inventory/reports/${report.key}`);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [exporting, setExporting] = useState(false);
  const exportModule = report.recordType === 'system' ? 'systems' : 'assets';

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
      <Button size="sm" icon="refresh" onClick={reload}>Refresh</Button>
      {can(`${exportModule}.export`) && <Button size="sm" icon="download" loading={exporting} onClick={() => void exportCsv()}>Export CSV</Button>}
    </>
  );
  return (
    <Card title={report.title} actions={actions}>
      <p className="muted">{report.description}{data ? ` As of ${formatDateTime(data.generatedAt)}.` : ''}</p>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label="Running the report" />
        : data.rows.length === 0 ? <EmptyState icon="check" title="Nothing to report" message="No records match this report at the moment." />
        : (
          <>
            <div className="inv-narrow">
              <TextField label="Filter rows" type="search" value={q} onChange={setQ} placeholder="Type to filter" />
            </div>
            {rows.length === 0 ? <EmptyState icon="search" title="No rows match" message="Clear the filter to see every row." /> : (
              <div className="table-wrap inv-table-wrap">
                <table className="table">
                  <caption className="sr-only">{report.title}</caption>
                  <thead>
                    <tr>
                      {report.columns.map((c) => {
                        const active = sort?.key === c.key;
                        return (
                          <th key={c.key} scope="col" className={c.type === 'number' || c.type === 'currency' ? 'num' : undefined}
                            aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSort({ key: c.key, dir: active && sort!.dir === 1 ? -1 : 1 })}>
                              {c.label}{active ? (sort!.dir === 1 ? ' ↑' : ' ↓') : ''}
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
            <p className="muted">{rows.length} of {data.total} rows</p>
          </>
        )}
    </Card>
  );
}

export function ReportsPage() {
  const { data, error, reload } = useFetch<ReportInfo[]>('/api/inventory/reports');
  const [params, setParams] = useSearchParams();
  const selected = data?.find((r) => r.key === params.get('report')) ?? null;
  const header = <PageHeader title="Inventory reports" subtitle="Ready-made checks on assets and systems. Choose one to see its rows." />;

  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} /></div>;
  if (!data.length) {
    return <div className="stack">{header}<EmptyState icon="chart" title="No reports available" message="You do not have permission to see any inventory report." /></div>;
  }
  return (
    <div className="stack">
      {header}
      <div className="inv-report-list">
        {data.map((r) => (
          <ReportTile key={r.key} report={r} active={selected?.key === r.key} onOpen={() => setParams({ report: r.key })} />
        ))}
      </div>
      {selected
        ? <ReportRows key={selected.key} report={selected} />
        : <EmptyState icon="chart" title="Choose a report" message="The number on each tile is how many rows the report has now." />}
    </div>
  );
}
