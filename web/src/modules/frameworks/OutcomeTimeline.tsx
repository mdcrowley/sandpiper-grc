import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Timeline as Steps } from '@mantine/core';
import { Button, Card, ErrorState, Icon, Loading, formatDate, relativeTime, todayInZone, useFetch } from '../../core';
import type { Row } from '../../core';
import type { ScaleValue, Timeline } from './types';
import { statusColor, statusLabel } from './types';

const SHORT = 6;

function Status({ scale, value }: { scale: ScaleValue[]; value: string | null }) {
  return (
    <span className="fw-tl-status">
      <span className="fw-swatch" style={{ background: `var(--c-${statusColor(scale, value)}-solid)` }} />
      {statusLabel(scale, value)}
    </span>
  );
}

/** How the status got to where it is: every change from the history and every snapshot, newest first. */
export function OutcomeTimeline({ outcome, scale }: { outcome: Row; scale: ScaleValue[] }) {
  const { data, error, reload } = useFetch<Timeline>(`/api/framework-outcomes/${outcome.id}/timeline`);
  const [all, setAll] = useState(false);
  // The record page saves in place: read the timeline again when the status or review date moves.
  useEffect(() => { reload(); }, [outcome.status, outcome.review_on, reload]);

  const events = [...(data?.events ?? [])].reverse();
  const shown = all ? events : events.slice(0, SHORT);
  const review = outcome.review_on as string | null;
  const overdue = Boolean(review) && review! < todayInZone();

  return (
    <Card title="Status over time">
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} label="Loading the status timeline" />
        : (
          <>
            <Steps bulletSize={22} lineWidth={2} className="fw-tl" active={shown.length + (review ? 1 : 0) - 1}>
              {review && (
                <Steps.Item
                  lineVariant="dashed" color={overdue ? 'red' : 'gray'}
                  bullet={<Icon name="calendar" size={12} />}
                  title={overdue ? 'Review overdue' : 'Next review'}
                >
                  <span className={overdue ? 'fw-tl-meta is-overdue' : 'fw-tl-meta'}>{formatDate(review)} · {relativeTime(`${review}T12:00:00`)}</span>
                </Steps.Item>
              )}
              {shown.map((e, i) => (
                <Steps.Item
                  key={`${e.kind}-${e.at}-${i}`}
                  color={statusColor(scale, e.to)}
                  bullet={<Icon name={e.kind === 'snapshot' ? 'chart' : e.kind === 'created' ? 'plus' : 'check'} size={12} />}
                  title={
                    e.kind === 'snapshot' ? <>Snapshot <Link to={`/assessments/${e.snapshot_id}`}>{e.name}</Link></>
                      : e.kind === 'created' ? 'Outcome added'
                      : <><Status scale={scale} value={e.from} /><span className="fw-arrow" aria-label="to">→</span><Status scale={scale} value={e.to} /></>
                  }
                >
                  {e.kind !== 'change' && <Status scale={scale} value={e.to} />}
                  <span className="fw-tl-meta">
                    {e.kind === 'snapshot' ? formatDate(e.at) : `${formatDate(e.at)}${e.by ? ` · ${e.by}` : ''}`}
                  </span>
                </Steps.Item>
              ))}
            </Steps>
            {events.length > SHORT && (
              <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${events.length}`}</Button>
            )}
          </>
        )}
    </Card>
  );
}
