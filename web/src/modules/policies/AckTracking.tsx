// Acknowledgment tracking for one policy: progress, who is outstanding, and export.
import { useState } from 'react';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, formatDateTime, Loading, ProgressBar, Select, Stat, StatusChip,
  TableWrap, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { RosterAcks } from './RecordAcknowledgments';
import { ACK_STATE, readIn, type AckRow, type AckTracking as Tracking, type PolicyVersion } from './shared';

const FILTERS = [
  { value: 'outstanding', label: 'Outstanding (including overdue)' },
  { value: 'overdue', label: 'Overdue only' },
  { value: 'acknowledged', label: 'Acknowledged' },
  { value: 'all', label: 'Everyone asked' },
];

export function AckTracking({ row, versions }: { row: Row; versions: PolicyVersion[] }) {
  const { can } = useAuth();
  const toast = useToast();
  const issued = versions.filter((v) => v.status === 'published' || v.status === 'superseded');
  const [chosen, setChosen] = useState('');
  const [show, setShow] = useState('outstanding');
  const [exporting, setExporting] = useState(false);
  const versionNumber = chosen || String(issued.find((v) => v.status === 'published')?.version ?? issued[0]?.version ?? '');
  const url = `/api/policies/${row.id}/acknowledgments${versionNumber ? `?version=${versionNumber}` : ''}`;
  const { data, error, reload } = useFetch<Tracking>(issued.length ? url : null);

  if (!issued.length) {
    return (
      <Card>
        <EmptyState
          icon="check-square" title="Nothing to acknowledge yet"
          message="Acknowledgments are requested when a version is published. Publish a version to start tracking."
        />
      </Card>
    );
  }
  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={6} label="Loading acknowledgments" /></Card>;

  const { counts } = data;
  const match = (r: AckRow) => show === 'all' || (show === 'outstanding' ? r.state === 'outstanding' || r.state === 'overdue' : r.state === show);
  const rows = data.rows.filter(match);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await api.blob(`${url}${url.includes('?') ? '&' : '?'}format=csv`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${row.ref ?? 'policy'}-acknowledgments-v${versionNumber}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="stack">
      <Card
        title={`Acknowledgment of version ${data.version?.version ?? versionNumber}`}
        actions={can('policies.export') && counts.total > 0 && <Button size="sm" icon="download" loading={exporting} onClick={exportCsv}>Export CSV</Button>}
      >
        <div className="stack">
          {issued.length > 1 && (
            <div className="row">
              <Select
                label="Version" value={versionNumber} onChange={(v) => setChosen(v)}
                options={issued.map((v) => ({ value: String(v.version), label: `Version ${v.version}${v.status === 'published' ? ' (published)' : ''}` }))}
              />
            </div>
          )}
          {counts.total === 0 ? (
            <EmptyState icon="users" title="Nobody was asked" message="No active user matched the audience when this version was published. Set who must acknowledge, then publish a new version." />
          ) : (
            <>
              <ProgressBar
                label="Acknowledged" value={counts.acknowledged} max={counts.total} color={counts.acknowledged === counts.total ? 'green' : 'blue'}
                valueText={`${counts.acknowledged} of ${counts.total} (${counts.acknowledged_pct}%)`}
              />
              <div className="grid-stats">
                <Stat label="Acknowledged" value={counts.acknowledged} color="green" hint={`${counts.acknowledged_pct}% of people asked`} />
                <Stat label="Outstanding" value={counts.outstanding} color={counts.outstanding ? 'blue' : 'green'} hint={`${counts.outstanding_pct}%, including overdue`} />
                <Stat label="Overdue" value={counts.overdue} color={counts.overdue ? 'red' : 'green'} hint={`${counts.overdue_pct}% past the due date`} />
              </div>
            </>
          )}
        </div>
      </Card>

      {counts.total > 0 && (
        <Card title="People" flush actions={<Select label="Show" hideLabel value={show} onChange={(v) => setShow(v || 'outstanding')} options={FILTERS} />}>
          {rows.length === 0 ? (
            <EmptyState
              icon="check" title={show === 'acknowledged' ? 'Nobody has acknowledged yet' : show === 'overdue' ? 'Nobody is overdue' : 'Nobody is outstanding'}
              message={show === 'outstanding' ? 'Everyone who was asked has acknowledged this version.' : undefined}
            />
          ) : (
            <TableWrap label="People asked to acknowledge this version" className="pol-tw">
              <table className="table">
                <caption className="sr-only">People asked to acknowledge this version</caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th><th scope="col">Department</th><th scope="col">Status</th>
                    <th scope="col">Due</th><th scope="col">Acknowledged</th><th scope="col">Last reminder</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="pol-rowhead">{r.user_name}</td>
                      <td>{r.department ?? <span className="muted">—</span>}</td>
                      <td>
                        <StatusChip
                          color={ACK_STATE[r.state].color}
                          label={r.state === 'overdue' ? `Overdue by ${r.days_overdue} day${r.days_overdue === 1 ? '' : 's'}` : ACK_STATE[r.state].label}
                        />
                      </td>
                      <td>{formatDate(r.due_on)}</td>
                      <td>{r.acknowledged_at ? `${formatDateTime(r.acknowledged_at)}${readIn(r.language, r.translation_sha256)}` : <span className="muted">—</span>}</td>
                      <td>{r.reminded_at ? `${formatDate(r.reminded_at)}${r.reminder_count > 1 ? ` (${r.reminder_count} sent)` : ''}` : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      )}

      {data.departments.length > 1 && (
        <Card title="By department" flush>
          <TableWrap label="Acknowledgment by department" className="pol-tw">
            <table className="table">
              <caption className="sr-only">Acknowledgment by department</caption>
              <thead>
                <tr>
                  <th scope="col">Department</th><th scope="col" className="num">Asked</th><th scope="col" className="num">Acknowledged</th>
                  <th scope="col" className="num">Outstanding</th><th scope="col" className="num">Overdue</th><th scope="col" className="num">Complete</th>
                </tr>
              </thead>
              <tbody>
                {data.departments.map((d) => (
                  <tr key={d.department ?? 'none'}>
                    <td className="pol-rowhead">{d.department ?? 'No department'}</td>
                    <td className="num">{d.total}</td><td className="num">{d.acknowledged}</td>
                    <td className="num">{d.outstanding}</td><td className="num">{d.overdue}</td><td className="num">{d.acknowledged_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      )}

      <RosterAcks policy={row} versionNumber={versionNumber} />
    </div>
  );
}
