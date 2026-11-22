// "Policies awaiting my acknowledgment": every signed-in person's own list, whatever their role.
// Each policy opens in the reader (PolicyReader), where it is acknowledged.
import { Link } from 'react-router-dom';
import {
  Card, EmptyState, ErrorState, formatDate, formatDateTime, Loading, PageHeader, Stat, StatusChip, TableWrap, useFetch,
} from '../../core';
import { daysPhrase, type MyAck } from './shared';

interface Mine { today: string; awaiting: MyAck[]; acknowledged: MyAck[] }

function DueChip({ a }: { a: MyAck }) {
  if (a.state === 'overdue') return <StatusChip color="red" label={`Overdue (due ${daysPhrase(a.days_left)})`} />;
  if (a.days_left <= 3) return <StatusChip color="amber" label={`Due ${daysPhrase(a.days_left)}`} />;
  return <StatusChip color="blue" label={`Due ${formatDate(a.due_on)}`} />;
}

export function MyAcknowledgments() {
  const { data, error, reload } = useFetch<Mine>('/api/policies/acknowledgments/mine');
  const overdue = data?.awaiting.filter((a) => a.state === 'overdue').length ?? 0;

  let body;
  if (error) body = <ErrorState error={error} onRetry={reload} />;
  else if (!data) body = <Loading lines={6} label="Loading your acknowledgments" />;
  else {
    body = (
      <>
        <div className="grid-stats">
          <Stat label="Waiting for me" icon="file-text" value={data.awaiting.length} color={data.awaiting.length ? 'blue' : undefined} />
          <Stat label="Overdue" icon="clock" value={overdue} color={overdue ? 'red' : undefined} />
          <Stat label="Acknowledged" icon="check-circle" value={data.acknowledged.length} color="green" />
        </div>
        <Card title="Awaiting my acknowledgment" flush={data.awaiting.length > 0}>
          {data.awaiting.length === 0 ? (
            <EmptyState icon="check-square" title="Nothing is waiting for you" message="When a policy that applies to you is published, it appears here for you to read and acknowledge." />
          ) : (
            <ul className="pol-ack-list">
              {data.awaiting.map((a) => (
                <li key={a.id}>
                  <div className="pol-ack-main">
                    <Link className="pol-ack-title" to={`/policies/acknowledgments/${a.id}`}>
                      {a.policy_ref && <span className="ref">{a.policy_ref}</span>} {a.policy_title}
                    </Link>
                    {a.policy_summary && <p className="muted">{a.policy_summary}</p>}
                    <p className="muted pol-ack-meta">Version {a.version} · asked {formatDate(a.requested_at)}</p>
                  </div>
                  <div className="pol-ack-side">
                    <DueChip a={a} />
                    <Link className="btn btn-primary btn-sm" to={`/policies/acknowledgments/${a.id}`}>Read and acknowledge</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {data.acknowledged.length > 0 && (
          <Card title="Already acknowledged" flush>
            <TableWrap label="Policies you have acknowledged, newest first" className="pol-tw">
              <table className="table">
                <caption className="sr-only">Policies you have acknowledged, newest first</caption>
                <thead><tr><th scope="col">Policy</th><th scope="col">Version</th><th scope="col">Acknowledged</th></tr></thead>
                <tbody>
                  {data.acknowledged.map((a) => (
                    <tr key={a.id}>
                      <td className="pol-wrap pol-rowhead">
                        <Link to={`/policies/acknowledgments/${a.id}`}><span className="ref">{a.policy_ref}</span> {a.policy_title}</Link>
                      </td>
                      <td>Version {a.version}</td>
                      <td>{formatDateTime(a.acknowledged_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <PageHeader title="My acknowledgments" subtitle="Policies you have been asked to read and acknowledge." />
      {body}
    </div>
  );
}
