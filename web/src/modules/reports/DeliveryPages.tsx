// Scheduled delivery: the schedules list (with each one's delivery log) and the documents that
// have been delivered to, or produced by, the signed-in person.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Button, ConfirmDialog, CustomFieldsCard, Drawer, EmptyState, ErrorState, Icon, Loading, NotFound, PageHeader, ResourceList, StatusChip,
  api, errorMessage, formatDateTime, useAuth, useFetch, useToast,
} from '../../core';
import type { ApiError, Row } from '../../core';
import { downloadFile } from './data';
import { CustomFieldsLink } from './custom';
import { ScheduleDialog } from './dialogs';
import type { Snapshot } from './types';

const SOURCE: Record<string, string> = { report: 'Report', dashboard: 'Dashboard', pack: 'Report pack' };

interface Delivery { id: string; status: string; detail: string | null; created_at: string; snapshot_id: string | null; user_name: string | null }

export function SchedulesPage() {
  const [open, setOpen] = useState<Row | null>(null);
  const [tick, setTick] = useState(0);
  return (
    <>
      <ResourceList
        key={tick}
        type="report_schedule"
        title="Schedules"
        columns={['name', 'target_type', 'cadence', 'email', 'next_run_at', 'last_run_at', { field: 'last_status', label: 'Last result' }, 'active', 'owner_id']}
        filters={['cadence', 'target_type', 'email', 'active', 'owner_id']}
        bulkFields={[]}
        onRowClick={(row) => setOpen(row)}
        actions={<><span className="muted">To add one, open a report or dashboard and choose Schedule.</span><CustomFieldsLink type="report_schedule" /></>}
      />
      <ScheduleDrawer schedule={open} onClose={() => setOpen(null)} onChanged={() => setTick((n) => n + 1)} />
    </>
  );
}

function ScheduleDrawer({ schedule, onClose, onChanged }: { schedule: Row | null; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { user, can } = useAuth();
  const log = useFetch<Delivery[]>(schedule ? `/api/report-schedules/${schedule.id}/deliveries` : null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!schedule) return null;
  const mine = schedule.owner_id === user?.id || can('admin.administer');
  const target = schedule.target_type === 'dashboard' ? `/dashboards/${schedule.target_id}` : `/reports/${schedule.target_id}`;

  async function runNow() {
    setBusy(true);
    try {
      const r = await api.post<{ delivered?: number; failed?: number }>(`/api/report-schedules/${schedule!.id}/run-now`, {});
      toast.success(`Sent now${typeof r.delivered === 'number' ? ` to ${r.delivered} ${r.delivered === 1 ? 'person' : 'people'}` : ''}.`);
      log.reload();
      onChanged();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  async function remove() {
    try { await api.del(`/api/report-schedules/${schedule!.id}`); toast.success('Schedule deleted.'); onChanged(); onClose(); } catch (err) { toast.error(errorMessage(err)); }
  }

  return (
    <Drawer open title={schedule.name} onClose={onClose} size="md"
      footer={mine ? (
        <>
          {can('reports.delete') && <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>Delete</Button>}
          {can('reports.edit') && <Button icon="edit" onClick={() => setEditing(true)}>Edit</Button>}
          {can('reports.edit') && <Button variant="primary" icon="enter" loading={busy} onClick={runNow}>Send now</Button>}
        </>
      ) : undefined}>
      <div className="stack">
        <p><Link to={target}>Open the {schedule.target_type === 'dashboard' ? 'dashboard' : 'report'} <Icon name="arrow-right" size={14} /></Link></p>
        <p className="muted">{schedule.active ? `Next delivery ${formatDateTime(schedule.next_run_at)}.` : 'Switched off.'}</p>
        <CustomFieldsCard type="report_schedule" row={schedule} onSaved={() => onChanged()} />
        <h3 className="rp-h3">Deliveries</h3>
        {log.error ? <ErrorState error={log.error} onRetry={log.reload} />
          : !log.data ? <Loading lines={3} />
          : log.data.length === 0 ? <p className="muted">Nothing sent yet.</p>
          : (
            <ul className="rp-log">
              {log.data.map((d) => (
                <li key={d.id}>
                  <StatusChip color={d.status === 'delivered' ? 'green' : d.status === 'skipped' ? 'gray' : 'red'} label={d.status === 'delivered' ? 'Delivered' : d.status === 'skipped' ? 'Skipped' : 'Failed'} />
                  <span><strong>{d.user_name ?? 'A person'}</strong> · {formatDateTime(d.created_at)}{d.detail ? ` · ${d.detail}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
      </div>
      <ScheduleDialog open={editing} onClose={() => setEditing(false)} existing={schedule} onSaved={() => { onChanged(); onClose(); }} />
      <ConfirmDialog open={confirm} danger title="Delete this schedule?" confirmLabel="Delete schedule" message="Nothing more is sent. Documents already delivered are kept."
        onConfirm={remove} onCancel={() => setConfirm(false)} />
    </Drawer>
  );
}

export function SnapshotsPage() {
  const list = useFetch<Snapshot[]>('/api/reports/snapshots');
  return (
    <div className="stack">
      <PageHeader title="Delivered to me" subtitle="Scheduled reports and dashboards sent to you, and packs you produced, with the figures as they were at the time." />
      {list.error ? <ErrorState title="Documents could not be loaded" error={list.error} onRetry={list.reload} />
        : !list.data ? <Loading lines={6} />
        : list.data.length === 0 ? <EmptyState icon="file-text" title="Nothing delivered yet" message="When a report or dashboard is scheduled for you, each delivery appears here and in your notifications." />
        : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th scope="col">Document</th><th scope="col">From</th><th scope="col">Format</th><th scope="col">Produced</th></tr></thead>
              <tbody>
                {list.data.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/reports/snapshots/${s.id}`}>{s.title}</Link>{s.restricted && <> <Icon name="lock" size={14} label="Includes restricted records" /></>}</td>
                    <td>{SOURCE[s.source_type] ?? s.source_type}{s.schedule_id ? ' (scheduled)' : ''}</td>
                    <td>{s.format === 'csv' ? 'Spreadsheet (CSV)' : s.format === 'xlsx' ? 'Excel file' : s.format === 'pdf' ? 'PDF file' : 'Document'}</td>
                    <td>{formatDateTime(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

const FILE_NAMES: Record<string, string> = { csv: 'CSV', xlsx: 'Excel file', pdf: 'PDF' };

export function SnapshotPage() {
  const { id } = useParams();
  const toast = useToast();
  const meta = useFetch<Snapshot & { can_download?: boolean }>(`/api/reports/snapshots/${id}`);
  if ((meta.error as ApiError | undefined)?.status === 404) return <NotFound />;
  if (meta.error) return <ErrorState title="This document could not be opened" error={meta.error} onRetry={meta.reload} />;
  if (!meta.data) return <><PageHeader title="Document" /><Loading lines={8} /></>;
  const s = meta.data;
  const src = `/api/reports/snapshots/${s.id}/content`;
  return (
    <div className="stack">
      <PageHeader title={s.title} breadcrumbs={[{ label: 'Delivered to me', to: '/reports/snapshots' }, { label: s.title }]}
        subtitle={`Figures as at ${formatDateTime(s.created_at)}. This copy does not change.`}
        actions={!s.can_download ? undefined : s.format !== 'html'
          ? <Button variant="primary" icon="download" onClick={() => downloadFile(`${s.title}.${s.format}`, 'GET', src).catch((err) => toast.error(errorMessage(err)))}>Download {FILE_NAMES[s.format] ?? 'file'}</Button>
          : <Button variant="primary" icon="download" onClick={() => downloadFile(`${s.title}.html`, 'GET', `${src}?download=1`).catch((err) => toast.error(errorMessage(err)))}>Download to print or save as PDF</Button>} />
      {s.restricted && <p className="notice notice-warn"><Icon name="lock" size={16} /> Includes restricted records. Do not pass it to anyone who may not see them.</p>}
      {s.format !== 'html'
        ? <EmptyState icon="download" title={s.format === 'pdf' ? 'A PDF file' : 'A spreadsheet file'}
            message={s.can_download ? `Download it to open it${s.format === 'pdf' ? '' : ' in a spreadsheet program'}.` : 'Your role does not allow downloading it.'} />
        : <iframe className="rp-snapshot-frame" title={s.title} src={src} sandbox="" />}
    </div>
  );
}
