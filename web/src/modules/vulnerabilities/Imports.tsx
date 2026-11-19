// Import history, and the page for one import.
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Badge, Card, EmptyState, ErrorState, formatDateTime, KeyValue, Loading, PageHeader, relativeTime, ResourceList, Stat, useFetch, useResource,
} from '../../core';
import { SectionTabs, useVulnAccess } from './shared';
import type { ImportBatch } from './shared';

const IMPORT_LABELS: Record<string, string> = { protocol: 'Protocol' };

export function ImportHistory() {
  const access = useVulnAccess();
  const { data, error, reload } = useFetch<ImportBatch[]>('/api/vulnerabilities/imports');
  const importLink = access.importFindings ? <Link className="btn btn-primary" to="/vulnerabilities/import">Import findings</Link> : undefined;
  const zero = <span className="muted">0</span>;
  return (
    <div className="stack">
      <PageHeader title="Imports" subtitle="Every file of findings that has been imported, newest first." actions={importLink}
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Imports' }]} />
      <SectionTabs active="imports" />
      {error && !data ? <ErrorState title="The import history could not be loaded" error={error} onRetry={reload} />
        : !data ? <Loading lines={5} label="Loading imports" />
        : data.length === 0 ? (
          <Card>
            <EmptyState icon="upload" title="Nothing has been imported yet"
              message="Export findings from a scanner as CSV, then import the file. Each import is listed here with what it changed." action={importLink} />
          </Card>
        ) : (
          <Card flush>
            <div className="table-wrap vuln-tw">
              <table className="table">
                <caption className="sr-only">Imports, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Imported</th><th scope="col">Source and file</th><th scope="col">By</th>
                    <th scope="col" className="num">Rows</th><th scope="col" className="num">New</th><th scope="col" className="num">Updated</th>
                    <th scope="col" className="num">Closed</th><th scope="col" className="num">Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <Link className="row-title" to={`/vulnerabilities/imports/${b.id}`}>{formatDateTime(b.imported_at)}</Link>
                        <div className="muted vuln-sub">{relativeTime(b.imported_at)}</div>
                      </td>
                      <td>
                        {b.source}
                        <div className="muted vuln-sub">{b.file_name ?? 'Pasted text'}</div>
                      </td>
                      <td>{b.imported_by_name ?? '—'}</td>
                      <td className="num">{b.total_rows}</td>
                      <td className="num">{b.created_count || zero}</td>
                      <td className="num">{b.updated_count + b.reopened_count || zero}</td>
                      <td className="num">{b.closed_count || zero}</td>
                      <td className="num">{b.error_count ? <Badge color="red">{b.error_count}</Badge> : zero}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
    </div>
  );
}

export function ImportBatchPage() {
  const { id = '' } = useParams();
  const access = useVulnAccess();
  const { data: b, error, reload } = useFetch<ImportBatch>(`/api/vulnerabilities/imports/${id}`);
  const filter = useMemo(() => ({ import_batch_id: id }), [id]);
  const resource = useResource('vulnerability');
  const crumbs = [{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Imports', to: '/vulnerabilities/imports' }, { label: 'Import' }];
  if (error && !b) {
    return (
      <div className="stack">
        <PageHeader title="Import" breadcrumbs={crumbs} />
        <SectionTabs active="imports" />
        <ErrorState title="This import could not be loaded" error={error} onRetry={reload} />
      </div>
    );
  }
  if (!b) return <div className="stack"><PageHeader title="Import" breadcrumbs={crumbs} /><SectionTabs active="imports" /><Loading lines={6} label="Loading the import" /></div>;
  const mapped = Object.entries(b.mapping ?? {});
  const fieldLabel = (field: string) => resource?.fields[field]?.label ?? IMPORT_LABELS[field] ?? field;
  return (
    <div className="stack">
      <PageHeader title={`Import from ${b.source}`} subtitle={`${formatDateTime(b.imported_at)} by ${b.imported_by_name ?? 'an unknown user'}`} breadcrumbs={crumbs}
        actions={access.importFindings ? <Link className="btn btn-secondary" to="/vulnerabilities/import">Import another file</Link> : undefined} />
      <SectionTabs active="imports" />
      <div className="grid-stats">
        <Stat label="New findings" value={b.created_count} color={b.created_count ? 'green' : undefined} icon="plus" />
        <Stat label="Updated" value={b.updated_count} color={b.updated_count ? 'blue' : undefined} icon="refresh" hint={`${b.unchanged_count} seen again with no change`} />
        <Stat label="Reopened" value={b.reopened_count} color={b.reopened_count ? 'amber' : undefined} icon="history" />
        <Stat label="Closed as fixed" value={b.closed_count} color={b.closed_count ? 'purple' : undefined} icon="check" hint={b.close_missing ? 'Close missing was on' : 'Close missing was off'} />
        <Stat label="Rows with errors" value={b.error_count} color={b.error_count ? 'red' : undefined} icon="alert-circle" hint={`Of ${b.total_rows} rows; ${b.duplicate_count} repeated`} />
      </div>
      <Card title="Details">
        <KeyValue layout="columns" items={[
          { label: 'Source', value: b.source },
          { label: 'File', value: b.file_name ?? 'Pasted text' },
          { label: 'Imported by', value: b.imported_by_name },
          { label: 'Imported', value: formatDateTime(b.imported_at) },
          { label: 'Saved mapping used', value: b.preset_name ?? 'None' },
          { label: 'Close missing findings', value: b.close_missing ? 'Yes' : 'No' },
          {
            label: 'Column mapping', wide: true,
            value: mapped.length ? (
              <span className="vuln-mapping">
                {mapped.map(([field, column]) => <span key={field} className="vuln-mapping-pair"><span className="muted">{column}</span><span aria-hidden="true"> → </span>{fieldLabel(field)}</span>)}
              </span>
            ) : null,
          },
          ...(b.unmatched_hosts?.length ? [{ label: 'Hosts not found in the asset register', wide: true, value: b.unmatched_hosts.join(', ') }] : []),
        ]} />
      </Card>
      <Card title="Findings last reported by this import" flush>
        <p className="muted vuln-pad vuln-note">A finding moves to a newer import when that import reports it again, so an old import lists only what has not been seen since.</p>
        <ResourceList type="vulnerability" baseFilter={filter} urlState={false}
          columns={['ref', 'title', 'severity', 'host_name', 'port', 'status', 'owner_id', 'due_on', 'last_seen']}
          filters={['severity', 'status', 'owner_id']} />
      </Card>
    </div>
  );
}
