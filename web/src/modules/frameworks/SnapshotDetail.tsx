import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Chip } from '@mantine/core';
import {
  ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, HistoryPanel, Icon, Loading,
  NotFound, PageHeader, Stat, StatusChip, Tabs, api, errorMessage, formatDate, useAuth, useFetch, useToast,
} from '../../core';
import { StatusBar, StatusLegend, TargetRing } from './StatusBar';
import type { SnapshotDetail, SnapshotExtra } from './types';
import { statusColor, statusLabel } from './types';

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function SnapshotPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, error, reload } = useFetch<SnapshotDetail & SnapshotExtra>(id ? `/api/assessments/${id}` : null);
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

  const targetLabel = data.statuses.find((s) => s.value === data.target.status)?.label ?? data.target.status;

  const outcomes = (
    <div className="stack">
      <div className="fw-filters-row">
        <Chip size="xs" variant="outline" color="amber" checked={priorityOnly} onChange={setPriorityOnly}>
          <span className="fw-chip-in"><Icon name="star" size={13} />Priority only</span>
        </Chip>
        <span className="fw-filters-sep" aria-hidden="true" />
        <span className="fw-filters-label" id="fw-snap-status">Status</span>
        <div className="fw-chipset" role="group" aria-labelledby="fw-snap-status">
          {data.statuses.map((s) => (
            <Chip key={s.value} size="xs" variant="outline" checked={statuses.includes(s.value)} onChange={() => setStatuses(toggle(statuses, s.value))}>
              <span className="fw-chip-in"><span className="fw-swatch" style={{ background: `var(--c-${s.color}-solid)` }} />{s.label}</span>
            </Chip>
          ))}
        </div>
        <span className="fw-filters-end fw-shown" aria-live="polite">{rows.length} of {data.outcomes.length} shown</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon="filter" title={data.outcomes.length ? 'No outcomes match these filters' : 'This snapshot holds no outcomes'} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th scope="col">Outcome</th><th scope="col">Status at the time</th></tr></thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.outcome_id}>
                  <td style={{ whiteSpace: 'normal' }}>
                    <Link to={`/frameworks/outcomes/${o.outcome_id}`}><span className="ref">{o.code}</span></Link>
                    {o.priority && <span className="fw-star"><Icon name="star" size={13} label="Priority outcome" /></span>}{' '}
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
    <div className="stack fw-page">
      <PageHeader
        title={data.name}
        subtitle={`Snapshot of ${data.framework_name ?? 'a framework'} taken ${formatDate(data.taken_on)}`}
        breadcrumbs={[{ label: 'Assessments', to: '/assessments' }, { label: data.name }]}
        actions={
          <div className="row">
            <Button icon="file-text" onClick={() => navigate(`/assessments/${data.id}/report`)}>Printable report</Button>
            <Button icon="scale" onClick={() => navigate(`/assessments?from=${data.previous?.id ?? data.id}&to=${data.previous ? data.id : 'now'}`)}>Compare with another</Button>
            {can('frameworks.delete') && <Button variant="danger" icon="trash" onClick={() => setConfirming(true)}>Delete</Button>}
          </div>
        }
      />
      {data.notes && <div className="notice"><strong>Notes.</strong> <span className="prose">{data.notes}</span></div>}

      <section className="fw-hero" aria-label="Summary">
        <div className="fw-hero-main">
          <TargetRing tally={data.priority.total ? data.priority : data.all} size={112} label="Priority outcomes" />
          <div>
            <div className="fw-hero-figure"><strong>{(data.priority.total ? data.priority : data.all).atTarget}</strong> of {(data.priority.total ? data.priority : data.all).total}</div>
            <div className="fw-hero-label">{data.priority.total ? 'priority outcomes' : 'outcomes'} at “{targetLabel}” or better</div>
            <div className="fw-hero-sub">on {formatDate(data.taken_on)}</div>
          </div>
        </div>
        <div className="fw-hero-side">
          <StatusBar tally={data.all} scale={data.statuses} thick showCounts label="All outcomes by status" />
          <div className="grid-stats">
            <Stat label="Score, priority outcomes" value={data.priority.score} hint={`Target ${data.target.score}`} />
            <Stat label="Score, all outcomes" value={data.all.score} hint={`Target ${data.target.score}`} />
          </div>
        </div>
      </section>

      <Card title="By function">
        <div className="fw-fnrows">
          {data.functions.map((f) => (
            <div key={f.code} className="fw-fnrow" style={{ '--fw-band': `var(--c-${f.color}-solid)` } as CSSProperties}>
              <span className="fw-cmp-fn"><span className="fw-cat-code">{f.code}</span>{f.name}</span>
              <span className="fw-fnrow-score">Score <strong>{f.score}</strong></span>
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
