import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, Icon, Loading, Select, Stat, StatusChip, formatDate, useFetch,
} from '../../core';
import { StatusBar, StatusLegend } from './StatusBar';
import type { ChangedOutcome, Comparison, ProgressPoint } from './types';
import { statusColor, statusLabel } from './types';

const DIRECTION: Record<ChangedOutcome['direction'], string> = {
  improved: 'Improved', declined: 'Declined', changed: 'Changed', added: 'Added since', removed: 'Removed since',
};

/** Pick two points in time and see what moved: stacked bars by function, then the outcomes that changed. */
export function ComparePanel({ points }: { points: ProgressPoint[] }) {
  const snapshots = points.filter((p) => p.id !== null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('now');
  useEffect(() => {
    // Default: the earliest snapshot against now.
    if (snapshots.length && !snapshots.some((s) => s.id === from)) setFrom(snapshots[0].id!);
  }, [snapshots, from]);

  const url = from && from !== to ? `/api/assessments/compare?from=${from}&to=${to}` : null;
  const { data, error, reload } = useFetch<Comparison>(url);
  const options = snapshots.map((s) => ({ value: s.id!, label: `${s.name} (${formatDate(s.date)})` }));

  if (!snapshots.length) {
    return (
      <Card title="Compare">
        <EmptyState icon="scale" title="Nothing to compare yet" message="Take a snapshot first. After that, any change in status will show here." />
      </Card>
    );
  }

  const delta = data ? data.overall.to.priority.atTarget - data.overall.from.priority.atTarget : 0;
  const scoreDelta = data ? data.overall.to.all.score - data.overall.from.all.score : 0;
  const trend = (n: number, unit: string) => ({
    direction: n > 0 ? 'up' as const : n < 0 ? 'down' as const : 'flat' as const,
    label: n === 0 ? 'No change' : `${n > 0 ? '+' : ''}${n} ${unit}`,
    tone: n > 0 ? 'good' as const : n < 0 ? 'bad' as const : 'neutral' as const,
  });

  return (
    <Card title="Compare">
      <div className="fw-compare-pick">
        <Select label="From" value={from} onChange={setFrom} options={options} />
        <Select label="To" value={to} onChange={(v) => setTo(v || 'now')} options={[...options, { value: 'now', label: 'Now' }]} />
      </div>

      {from === to ? <EmptyState icon="scale" title="Choose two different points in time" />
        : error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Comparing" />
        : (
          <div className="stack">
            <div className="grid-stats">
              <Stat label="Outcomes that changed" value={data.changed.length} />
              <Stat label="Priority outcomes at target" value={`${data.overall.to.priority.atTarget} of ${data.overall.to.priority.total}`}
                trend={trend(delta, 'since then')} color="green" />
              <Stat label="Score, all outcomes" value={data.overall.to.all.score} trend={trend(scoreDelta, 'points')} />
            </div>

            <div>
              <h3 className="card-title" style={{ margin: '0 0 var(--s-2)' }}>By function</h3>
              <div className="fw-compare-grid">
                {data.functions.map((f, i) => (
                  <Fragment key={f.code}>
                    {i > 0 && <span className="fw-compare-sep" />}
                    <span className="fw-compare-fn">{f.name}</span>
                    <span className="fw-compare-when">{data.from.name}</span>
                    <StatusBar tally={f.from} scale={data.statuses} label={`${f.name} at ${data.from.name}`} />
                    <span className="fw-compare-when">{data.to.name}</span>
                    <StatusBar tally={f.to} scale={data.statuses} label={`${f.name} at ${data.to.name}`} showCounts />
                  </Fragment>
                ))}
              </div>
              <div style={{ marginTop: 'var(--s-3)' }}><StatusLegend scale={data.statuses} /></div>
            </div>

            <div>
              <h3 className="card-title" style={{ margin: '0 0 var(--s-2)' }}>
                Changed outcomes ({data.changed.length})
              </h3>
              {data.changed.length === 0 ? (
                <EmptyState icon="check" title="No outcome changed status"
                  message={`Every status is the same at "${data.to.name}" as it was at "${data.from.name}".`} />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Outcome</th><th>Change</th><th>Direction</th></tr></thead>
                    <tbody>
                      {data.changed.map((c) => (
                        <tr key={c.outcome_id}>
                          <td style={{ whiteSpace: 'normal' }}>
                            <Link to={`/frameworks/outcomes/${c.outcome_id}`}><span className="ref">{c.code}</span></Link>
                            {c.priority && <Icon name="star" size={13} label="Priority outcome" />}{' '}
                            {c.title}
                          </td>
                          <td>
                            {c.from === null ? <span className="muted">—</span>
                              : <StatusChip color={statusColor(data.statuses, c.from)} label={statusLabel(data.statuses, c.from)} />}
                            <span className="fw-arrow" aria-label="to">→</span>
                            {c.to === null ? <span className="muted">—</span>
                              : <StatusChip color={statusColor(data.statuses, c.to)} label={statusLabel(data.statuses, c.to)} />}
                          </td>
                          <td>{DIRECTION[c.direction]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
    </Card>
  );
}
