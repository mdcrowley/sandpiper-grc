// Safety events recorded against a vehicle or a service (served by the safety module).
import { Link } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDateTime, Loading, LookupChip, TableWrap, useFetch } from '../../core';

interface EventRow { id: string; ref: string; title: string; occurred_at: string; event_type: string; severity: string; status: string }

export function SafetyEventsCard({ url }: { url: string }) {
  const { data, error, reload } = useFetch<EventRow[]>(url);
  return (
    <Card title="Safety events" flush actions={<Link className="btn btn-ghost btn-sm" to="/safety/events">All safety events</Link>}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="fl-pad"><Loading lines={3} label="Loading safety events" /></div>
        : data.length === 0 ? <EmptyState icon="shield" title="No safety events recorded" />
        : (
          <TableWrap label="Safety events">
            <table className="table">
              <caption className="sr-only">Safety events</caption>
              <thead><tr><th scope="col">Event</th><th scope="col">When</th><th scope="col">Type</th><th scope="col">Severity</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id}>
                    <td><Link className="row-title" to={`/safety/events/${e.id}`}><span className="ref">{e.ref}</span> {e.title}</Link></td>
                    <td>{formatDateTime(e.occurred_at)}</td>
                    <td><LookupChip list="safety_event_type" value={e.event_type} /></td>
                    <td><LookupChip list="safety_event_severity" value={e.severity} /></td>
                    <td><LookupChip list="safety_event_status" value={e.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
    </Card>
  );
}
