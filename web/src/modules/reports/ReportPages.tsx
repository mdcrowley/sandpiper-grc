// Saved reports: the list, and one report opened (run, export, share, schedule, add to a dashboard).
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Forbidden, Icon, Loading, LookupChip, Menu, NotFound, PageHeader, ResourceList,
  api, errorMessage, formatDateTime, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { ApiError } from '../../core';
import { CHART_KINDS } from './BuilderParts';
import { downloadFile, fileName, openDocument } from './data';
import { AddToDashboardDialog, ScheduleDialog, ShareDialog, useCanChange } from './dialogs';
import { ResultView, useDrill } from './ResultView';
import type { ReportDefinition, ReportResult } from './types';

export function ReportsPage() {
  const { can } = useAuth();
  const { resources } = useMeta();
  return (
    <ResourceList
      type="report_definition"
      title="Reports"
      columns={[
        'name',
        { field: 'record_type', label: 'About', render: (r) => resources[r.record_type]?.plural ?? <span className="muted">Not available here</span> },
        { field: 'chart', label: 'Shown as', render: (r) => CHART_KINDS.find((k) => k.kind === r.chart?.kind)?.label ?? 'Table' },
        'sharing',
        { field: 'owner_id', label: 'Owner', render: (r) => r._display?.owner_id ?? <span className="muted">Standard report</span> },
        'updated_at',
      ]}
      filters={['sharing', 'owner_id']}
      bulkFields={[]}
      actions={can('reports.create') ? <Link className="btn btn-primary" to="/reports/new"><Icon name="plus" size={16} /> New report</Link> : undefined}
    />
  );
}

export function ReportView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const drill = useDrill();
  const def = useFetch<ReportDefinition>(`/api/reports/${id}`);
  const run = useFetch<{ result: ReportResult }>(`/api/reports/${id}/run`);
  const [dialog, setDialog] = useState<'share' | 'schedule' | 'dashboard' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);
  const canChange = useCanChange(def.data, 'reports');

  const status = (def.error as ApiError | undefined)?.status;
  if (status === 404) return <NotFound />;
  if (status === 403) return <Forbidden />;
  if (def.error) return <ErrorState title="This report could not be opened" error={def.error} onRetry={def.reload} />;
  if (!def.data) return <><PageHeader title="Report" /><Loading lines={8} label="Loading the report" /></>;
  const report = def.data;
  const result = run.data?.result;
  const runStatus = (run.error as ApiError | undefined)?.status;

  const exportAs = (format: 'csv' | 'html') => (format === 'csv'
    ? downloadFile(fileName(report.name, 'csv'), 'GET', `/api/reports/${report.id}/export?format=csv`)
    : openDocument('GET', `/api/reports/${report.id}/export?format=html`)).catch((err) => toast.error(errorMessage(err)));

  async function remove() {
    setBusy(true);
    try { await api.del(`/api/reports/${report.id}`); toast.success('Report deleted.'); navigate('/reports'); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); setDialog(null); }
  }

  return (
    <div className="stack">
      <PageHeader
        title={report.name}
        breadcrumbs={[{ label: 'Reports', to: '/reports' }, { label: report.name }]}
        subtitle={report.description || undefined}
        status={<LookupChip list="report_sharing" value={report.sharing} />}
        actions={(
          <>
            {can('reports.export') && result && (
              <Menu label="Export" icon="download" align="end" items={[
                { label: 'Spreadsheet file (CSV)', icon: 'download', onSelect: () => exportAs('csv') },
                { label: 'Print-ready document', icon: 'file-text', onSelect: () => exportAs('html') },
              ]} />
            )}
            {can('reports.create') && <Button icon="calendar" onClick={() => setDialog('schedule')}>Schedule</Button>}
            {can('dashboards.edit') && <Button icon="chart" onClick={() => setDialog('dashboard')}>Add to dashboard</Button>}
            {canChange && <Button icon="users" onClick={() => setDialog('share')}>Share</Button>}
            {canChange && <Link className="btn btn-primary" to={`/reports/${report.id}/edit`}><Icon name="edit" size={16} /> Edit</Link>}
            <Menu label="More" icon="more" iconOnly align="end" items={[
              { label: 'Refresh the figures', icon: 'refresh', onSelect: run.reload },
              ...(can('reports.create') ? [{ label: 'Save a copy', icon: 'plus' as const, onSelect: async () => {
                try {
                  const copy = await api.post<ReportDefinition>('/api/reports', { name: `${report.name} (copy)`, description: report.description, spec: report.spec, chart: report.chart });
                  toast.success('Copy saved. It is yours to change.');
                  navigate(`/reports/${copy.id}/edit`);
                } catch (err) { toast.error(errorMessage(err)); }
              } }] : []),
              ...(canChange && can('reports.delete') ? [{ label: 'Delete', icon: 'trash' as const, danger: true, separated: true, onSelect: () => setDialog('delete') }] : []),
            ]} />
          </>
        )}
      />

      <Card>
        {runStatus === 403 ? <EmptyState icon="lock" title="You cannot see these records" message="This report is about records your role does not include. Ask an administrator if you need it." />
          : runStatus === 409 ? <EmptyState icon="info" title="Not available here" message={errorMessage(run.error)} />
          : run.error ? <ErrorState title="The report could not be run" error={run.error} onRetry={run.reload} />
          : !result ? <Loading lines={8} label="Running the report" />
          : (
            <div className="stack">
              <ResultView result={result} chart={report.chart} label={report.name} height={340} withTable />
              <p className="rp-preview-foot muted">
                <button type="button" className="rp-link-num" onClick={() => drill(result, result.drill)}>
                  {result.total.toLocaleString('en-GB')} {(result.total === 1 ? result.typeLabel : result.plural).toLowerCase()}
                </button>
                {' '}as at {formatDateTime(result.generatedAt)}.
                {!result.drillExact && ' The list behind the figures uses the closest filters the list page offers.'}
                {result.restricted && <> <Icon name="lock" size={14} /> Includes restricted records: exports are marked.</>}
              </p>
            </div>
          )}
      </Card>

      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} path="/api/reports" item={report} what="report" onSaved={def.reload} />
      <ScheduleDialog open={dialog === 'schedule'} onClose={() => setDialog(null)} target={{ type: 'report', id: report.id, name: report.name }} />
      <AddToDashboardDialog open={dialog === 'dashboard'} onClose={() => setDialog(null)} report={report} />
      <ConfirmDialog open={dialog === 'delete'} danger busy={busy} title="Delete this report?" confirmLabel="Delete report"
        message="Dashboards and packs that use it will show that it has been removed. Schedules that send it will stop."
        onConfirm={remove} onCancel={() => setDialog(null)} />
    </div>
  );
}
