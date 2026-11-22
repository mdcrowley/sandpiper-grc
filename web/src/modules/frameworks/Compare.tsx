import { useEffect, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, Icon, IconButton, Loading, Select, Stat, StatusChip, cx, formatDate, TableWrap, useFetch,
} from '../../core';
import { StatusBar, StatusLegend } from './StatusBar';
import type { ChangedOutcome, Comparison, ProgressPoint } from './types';
import { statusColor, statusLabel } from './types';

const DIRECTION: Record<ChangedOutcome['direction'], string> = {
  improved: 'Improved', declined: 'Declined', changed: 'Changed', added: 'Added since', removed: 'Removed since',
};

function Delta({ value, unit = '' }: { value: number; unit?: string }) {
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  return (
    <span className={cx('fw-delta', `fw-delta-${tone}`)}>
      <Icon name={value > 0 ? 'arrow-up' : value < 0 ? 'arrow-down' : 'minus'} size={12} />
      {value === 0 ? 'No change' : `${value > 0 ? '+' : '−'}${Math.abs(value)}${unit}`}
    </span>
  );
}

function Moved({ items, direction }: { items: ChangedOutcome[]; direction: 'improved' | 'declined' }) {
  if (!items.length) return null;
  return (
    <div className={cx('fw-moved', `fw-moved-${direction}`)}>
      <span className="fw-moved-label"><Icon name={direction === 'improved' ? 'arrow-up' : 'arrow-down'} size={12} />{items.length} {direction}</span>
      {items.map((c) => (
        <Link key={c.outcome_id} to={`/frameworks/outcomes/${c.outcome_id}`} className="fw-moved-code" title={c.title ?? undefined}>{c.code}</Link>
      ))}
    </div>
  );
}

/**
 * Pick two points in time and see what moved: totals, then each function with its score and
 * status bars at both points and the outcomes that moved, then every changed outcome.
 * The two points are kept in the page address (?from=&to=).
 */
export function ComparePanel({ points }: { points: ProgressPoint[] }) {
  const snapshots = useMemo(() => points.filter((p) => p.id !== null), [points]);
  const [params, setParams] = useSearchParams();
  const known = (id: string | null) => (id && snapshots.some((s) => s.id === id) ? id : null);
  const from = known(params.get('from')) ?? snapshots[0]?.id ?? '';
  const to = params.get('to') === 'now' ? 'now' : known(params.get('to')) ?? 'now';
  const pick = (next: { from?: string; to?: string }) => {
    const p = new URLSearchParams(params);
    p.set('from', next.from ?? from);
    p.set('to', next.to ?? to);
    setParams(p, { replace: true });
  };
  // A snapshot that has been deleted is dropped from the address.
  useEffect(() => {
    if ((params.get('from') && !known(params.get('from'))) || (params.get('to') && params.get('to') !== 'now' && !known(params.get('to')))) {
      const p = new URLSearchParams(params);
      p.delete('from');
      p.delete('to');
      setParams(p, { replace: true });
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const url = from && from !== to ? `/api/assessments/compare?from=${from}&to=${to}` : null;
  const { data, error, reload } = useFetch<Comparison>(url, { keepPrevious: true });
  const options = snapshots.map((s) => ({ value: s.id!, label: `${s.name} (${formatDate(s.date)})` }));

  if (!snapshots.length) {
    return (
      <Card title="Compare two points in time">
        <EmptyState icon="scale" title="Nothing to compare yet" message="Take a snapshot first. After that, any change in status will show here." />
      </Card>
    );
  }

  const count = (d: ChangedOutcome['direction']) => data?.changed.filter((c) => c.direction === d).length ?? 0;
  const other = data ? data.changed.length - count('improved') - count('declined') : 0;
  const atTargetDelta = data ? data.overall.to.priority.atTarget - data.overall.from.priority.atTarget : 0;
  const scoreDelta = data ? data.overall.to.all.score - data.overall.from.all.score : 0;
  const trend = (n: number, unit: string) => ({
    direction: n > 0 ? 'up' as const : n < 0 ? 'down' as const : 'flat' as const,
    label: n === 0 ? 'No change' : `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`,
    tone: n > 0 ? 'good' as const : n < 0 ? 'bad' as const : 'neutral' as const,
  });

  return (
    <Card title="Compare two points in time">
      <div className="fw-compare-pick">
        <Select label="From" required value={from} onChange={(v) => v && pick({ from: v })} options={options} />
        <IconButton icon="refresh" label="Swap the two points" variant="ghost"
          onClick={() => { if (to !== 'now') pick({ from: to, to: from }); }} />
        <Select label="To" required value={to} onChange={(v) => pick({ to: v || 'now' })} options={[...options, { value: 'now', label: 'Now (not saved)' }]} />
      </div>

      {from === to ? <EmptyState icon="scale" title="Choose two different points in time" />
        : error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={6} label="Comparing" />
        : (
          <div className="stack fw-compare">
            <div className="grid-stats">
              <Stat label="Improved" value={count('improved')} color="green" icon="arrow-up" hint={other ? `${other} changed in other ways` : 'outcomes moved up the scale'} />
              <Stat label="Declined" value={count('declined')} color={count('declined') ? 'red' : 'gray'} icon="arrow-down" hint="outcomes moved down the scale" />
              <Stat label="Score, all outcomes" value={<>{data.overall.from.all.score}<span className="fw-to">→</span>{data.overall.to.all.score}</>} trend={trend(scoreDelta, 'points')} />
              <Stat label="Priority outcomes at target" value={<>{data.overall.from.priority.atTarget}<span className="fw-to">→</span>{data.overall.to.priority.atTarget}</>}
                trend={trend(atTargetDelta, `of ${data.overall.to.priority.total}`)} />
            </div>

            <section aria-label="What moved, by function">
              <h3 className="fw-section-title">What moved, by function</h3>
              <div className="fw-cmp" role="table" aria-label="Change by function">
                <div className="fw-cmp-row fw-cmp-head" role="row">
                  <span role="columnheader">Function</span>
                  <span role="columnheader">Score</span>
                  <span role="columnheader">Outcomes by status: {data.from.name}, then {data.to.name}</span>
                  <span role="columnheader">Outcomes that moved</span>
                </div>
                {data.functions.map((f) => {
                  const mine = data.changed.filter((c) => (c.function_code ?? '') === f.code);
                  return (
                    <div key={f.code} className="fw-cmp-row" role="row" style={{ '--fw-band': `var(--c-${f.color}-solid)` } as CSSProperties}>
                      <span role="cell" className="fw-cmp-fn"><span className="fw-cat-code">{f.code}</span>{f.name}</span>
                      <span role="cell" className="fw-cmp-score">
                        <span>{f.from.score}<span className="fw-to">→</span><strong>{f.to.score}</strong></span>
                        <Delta value={f.to.score - f.from.score} />
                      </span>
                      <span role="cell" className="fw-cmp-bars">
                        <StatusBar tally={f.from} scale={data.statuses} label={`${f.name} at ${data.from.name}`} />
                        <StatusBar tally={f.to} scale={data.statuses} label={`${f.name} at ${data.to.name}`} thick />
                      </span>
                      <span role="cell" className="fw-cmp-moved">
                        <Moved items={mine.filter((c) => c.direction === 'improved')} direction="improved" />
                        <Moved items={mine.filter((c) => c.direction === 'declined')} direction="declined" />
                        {!mine.some((c) => c.direction === 'improved' || c.direction === 'declined') && <span className="muted">No movement</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <StatusLegend scale={data.statuses} />
            </section>

            <section aria-label="Changed outcomes">
              <h3 className="fw-section-title">Changed outcomes ({data.changed.length})</h3>
              {data.changed.length === 0 ? (
                <EmptyState icon="check" title="No outcome changed status"
                  message={`Every status is the same at "${data.to.name}" as it was at "${data.from.name}".`} />
              ) : (
                <TableWrap label="Compare two points in time">
                  <table className="table">
                    <thead><tr><th scope="col">Outcome</th><th scope="col">{data.from.name}</th><th scope="col">{data.to.name}</th><th scope="col">Direction</th></tr></thead>
                    <tbody>
                      {data.changed.map((c) => (
                        <tr key={c.outcome_id}>
                          <td style={{ whiteSpace: 'normal' }}>
                            <Link to={`/frameworks/outcomes/${c.outcome_id}`}><span className="ref">{c.code}</span></Link>
                            {c.priority && <span className="fw-star"><Icon name="star" size={13} label="Priority outcome" /></span>}{' '}
                            {c.title}
                          </td>
                          <td>{c.from === null ? <span className="muted">—</span> : <StatusChip color={statusColor(data.statuses, c.from)} label={statusLabel(data.statuses, c.from)} />}</td>
                          <td>{c.to === null ? <span className="muted">—</span> : <StatusChip color={statusColor(data.statuses, c.to)} label={statusLabel(data.statuses, c.to)} />}</td>
                          <td>
                            <span className={cx('fw-delta', c.direction === 'improved' && 'fw-delta-up', c.direction === 'declined' && 'fw-delta-down')}>
                              {(c.direction === 'improved' || c.direction === 'declined') && <Icon name={c.direction === 'improved' ? 'arrow-up' : 'arrow-down'} size={12} />}
                              {DIRECTION[c.direction]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </section>
          </div>
        )}
    </Card>
  );
}
