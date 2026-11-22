import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import { Badge, Button, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, Stat, TableWrap, useAuth, useFetch } from '../../core';
import type { Row } from '../../core';
import { ReviewDialog } from './ReviewPanel';
import { RatedChip, RatingChip, useScales } from './scales';

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const WINDOWS = [{ value: '30', label: '30 days' }, { value: '60', label: '60 days' }, { value: '90', label: '90 days' }];

/** Two worklists for the security lead: acceptances to renew and reviews that are due. */
export function RiskReviews() {
  const { can } = useAuth();
  const { data: scales } = useScales();
  const [ahead, setAhead] = useState('60');
  const acceptances = useFetch<Row[]>(`/api/risks/acceptances-expiring?days=${ahead}`, { keepPrevious: true });
  const reviews = useFetch<Row[]>(`/api/risks/reviews-due?days=${ahead}`, { keepPrevious: true });
  const [reviewing, setReviewing] = useState<Row | null>(null);
  const scaleOf = (key: unknown) => scales?.find((s) => s.key === key);

  const acc = acceptances.data ?? [];
  const rev = reviews.data ?? [];
  const expired = acc.filter((a) => a.expired).length;
  const overdue = rev.filter((r) => r.overdue).length;

  return (
    <div className="stack rk-page">
      <PageHeader
        title="Risk reviews"
        subtitle="Risks whose acceptance is running out, and risks whose review date has arrived. Restricted: visible only to people with access to security records."
        breadcrumbs={[{ label: 'Risk register', to: '/risks' }, { label: 'Risk reviews' }]}
        actions={<SegmentedControl size="xs" aria-label="Look ahead" value={ahead} data={WINDOWS} onChange={setAhead} />}
      />
      <div className="grid-stats">
        <Stat label="Acceptances expired" value={expired} color={expired > 0 ? 'red' : 'green'} icon="alert" hint="The risk needs review" />
        <Stat label="Acceptances expiring" value={acc.length - expired} color={acc.length - expired > 0 ? 'amber' : 'green'} icon="clock" hint={`Within ${ahead} days`} />
        <Stat label="Reviews overdue" value={overdue} color={overdue > 0 ? 'red' : 'green'} icon="calendar" hint="Review date has passed" />
        <Stat label="Reviews coming up" value={rev.length - overdue} color="blue" icon="calendar" hint={`Within ${ahead} days`} />
      </div>

      <Card title="Acceptances to renew" flush={acc.length > 0}>
        {acceptances.error ? <ErrorState error={acceptances.error} onRetry={acceptances.reload} />
          : !acceptances.data ? <Loading lines={3} label="Loading acceptances" />
          : acc.length === 0 ? <EmptyState icon="check-circle" title="Nothing to renew" message={`No acceptance has expired or expires within ${ahead} days.`} />
          : (
            <TableWrap label="Acceptances to renew">
              <table className="table">
                <thead>
                  <tr><th scope="col">Risk</th><th scope="col">Rating</th><th scope="col">Status</th><th scope="col">Approved by</th><th scope="col">Expires</th><th scope="col">Owner</th><th scope="col" aria-label="Open" /></tr>
                </thead>
                <tbody>
                  {acc.map((a) => (
                    <tr key={a.id} className={a.expired ? 'is-overdue-row' : undefined}>
                      <td><Link to={`/risks/${a.risk_id}`}><span className="ref">{a.ref}</span> {a.title}</Link></td>
                      <td><RatingChip scale={scaleOf(a.scale_key)} rating={a.rating} /></td>
                      <td><LookupChip list="risk_status" value={a.status} /></td>
                      <td>{[a.approver_name, a.approver_title].filter(Boolean).join(', ')}</td>
                      <td>
                        <span className="rk-two-line">
                          <span>{formatDate(a.expires_on)}</span>
                          {a.expired ? <Badge color="red">Expired {days(-a.days_left)} ago</Badge> : <Badge color="amber">{days(a.days_left)} left</Badge>}
                        </span>
                      </td>
                      <td>{a.owner_name ?? <span className="muted">No owner</span>}</td>
                      <td><Link className="btn btn-secondary btn-sm" to={`/risks/${a.risk_id}`}>{can('risks.approve') ? 'Renew' : 'Open'}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>

      <Card title="Reviews due" flush={rev.length > 0}>
        {reviews.error ? <ErrorState error={reviews.error} onRetry={reviews.reload} />
          : !reviews.data ? <Loading lines={3} label="Loading reviews" />
          : rev.length === 0 ? <EmptyState icon="check-circle" title="No reviews due" message={`No open risk has a review date within ${ahead} days.`} />
          : (
            <TableWrap label="Reviews due">
              <table className="table">
                <thead>
                  <tr><th scope="col">Risk</th><th scope="col">Rating</th><th scope="col">Review date</th><th scope="col">Last reviewed</th><th scope="col">Owner</th><th scope="col" aria-label="Review" /></tr>
                </thead>
                <tbody>
                  {rev.map((r) => (
                    <tr key={r.id} className={r.overdue ? 'is-overdue-row' : undefined}>
                      <td><Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link></td>
                      <td><RatedChip label={r.rating_label} color={r.color} /></td>
                      <td>
                        <span className="rk-two-line">
                          <span>{formatDate(r.review_on)}</span>
                          {r.overdue ? <Badge color="red">Overdue by {days(-r.days_left)}</Badge> : r.days_left === 0 ? <Badge color="amber">Due today</Badge> : <Badge color="blue">In {days(r.days_left)}</Badge>}
                        </span>
                      </td>
                      <td>{r.last_reviewed_on ? formatDate(r.last_reviewed_on) : <span className="muted">Never</span>}</td>
                      <td>{r.owner_name ?? <span className="muted">No owner</span>}</td>
                      <td>{can('risks.edit') && <Button size="sm" icon="check" onClick={() => setReviewing(r)}>Complete review</Button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      <ReviewDialog risk={reviewing} onClose={() => setReviewing(null)} onDone={reviews.reload} />
    </div>
  );
}
