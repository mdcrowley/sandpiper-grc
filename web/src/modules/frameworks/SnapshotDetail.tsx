import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ApiError, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, HistoryPanel, Icon, Loading, MultiSelect,
  NotFound, PageHeader, Stat, StatusChip, Tabs, api, errorMessage, formatDate, useAuth, useFetch, useToast,
} from '../../core';
import { StatusBar, StatusLegend } from './StatusBar';
import type { SnapshotDetail } from './types';
import { statusColor, statusLabel } from './types';

export function SnapshotPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<SnapshotDetail>(id ? `/api/assessments/${id}` : null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [priorityOnly, setPriorityOnly] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => (data?.outcomes ?? []).filter((o) => (!priorityOnly || o.priority) && (!statuses.length || statuses.includes(o.status))),
    [data, statuses, priorityOnly],
  );

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={10} label="Loading snapshot" />;

  async function remove() {
    setBusy(true);
    try {
      await api.del(`/api/assessment-snapshots/${id}`);
      toast.success('Snapshot deleted.');
      navigate('/assessments');
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  const outcomes = (
    <div className="stack">
      <div className="fw-toolbar">
        <Checkbox label="Priority only" checked={priorityOnly} onChange={setPriorityOnly} />
        <MultiSelect label="Status" value={statuses} onChange={setStatuses}
          options={data.statuses.map((s) => ({ value: s.value, label: s.label }))} />
        <span className="fw-toolbar-end muted" aria-live="polite">{rows.length} of {data.outcomes.length} shown</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="filter" title={data.outcomes.length ? 'No outcomes match these filters' : 'This snapshot holds no outcomes'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Outcome</th><th>Status at the time</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.outcome_id}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <Link to={`/frameworks/outcomes/${o.outcome_id}`}><span className="ref">{o.code}</span></Link>
                    {o.priority && <Icon name="star" size={13} label="Priority outcome" />}{' '}
                    {o.title}
                  </td>
                  <td><StatusChip color={statusColor(data.statuses, o.status)} label={statusLabel(data.statuses, o.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  return (
    <div className="stack">
      <PageHeader
        title={data.name}
        subtitle={`Snapshot of ${data.framework_name ?? 'a framework'} taken ${formatDate(data.taken_on)}`}
        breadcrumbs={[{ label: 'Assessments', to: '/assessments' }, { label: data.name }]}
        actions={
          <div className="row">
            <Button onClick={() => navigate('/assessments')}>Compare with another</Button>
            {can('frameworks.delete') && <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>Delete</Button>}
          </div>
        }
      />
      {data.notes && <Card title="Notes"><div className="prose">{data.notes}</div></Card>}

      <div className="grid-stats">
        <Stat label="Priority outcomes at target" value={`${data.priority.atTarget} of ${data.priority.total}`} color="green" />
        <Stat label="Score, priority outcomes" value={data.priority.score} />
        <Stat label="Score, all outcomes" value={data.all.score} />
        {data.statuses.map((s) => <Stat key={s.value} label={s.label} value={data.all.counts[s.value] ?? 0} color={s.color} />)}
      </div>

      <Card title="By function">
        <div className="fw-compare-grid" style={{ gridTemplateColumns: 'minmax(120px, 180px) minmax(0, 1fr)' }}>
          {data.functions.map((f) => (
            <div key={f.code} style={{ display: 'contents' }}>
              <span style={{ fontWeight: 600 }}>{f.name}</span>
              <StatusBar tally={f} scale={data.statuses} label={`${f.name}: outcomes by status`} showCounts />
            </div>
          ))}
        </div>
        <StatusLegend scale={data.statuses} />
      </Card>

      <Card>
        <Tabs
          label="Snapshot"
          tabs={[
            { key: 'outcomes', label: 'Outcomes', count: data.outcomes.length, content: outcomes },
            { key: 'history', label: 'History', content: <HistoryPanel type="assessment_snapshot" id={data.id} /> },
          ]}
        />
      </Card>

      <ConfirmDialog
        open={confirming}
        title="Delete this snapshot?"
        message={`"${data.name}" will no longer appear in the progress chart or comparisons. The deletion is recorded in the audit log.`}
        confirmLabel="Delete" danger busy={busy}
        onConfirm={remove} onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
