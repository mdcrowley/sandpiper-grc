// A roster person's policy acknowledgments (E29-09), for their record page in the people module.
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, StatusChip, TableWrap, useAuth, useFetch } from '../../core';
import { ACK_STATE } from './shared';

interface Ack {
  id: string; policy_id: string; policy_ref: string; policy_title: string; document_type: string | null; version: number;
  due_on: string | null; acknowledged_at: string | null; method: string | null; recorded_by_name: string | null;
  state: 'acknowledged' | 'outstanding' | 'overdue' | 'superseded';
}
const METHOD: Record<string, string> = { sign_in_sheet: 'Sign-in sheet', kiosk: 'Kiosk', recorded: 'By hand' };

export function PersonAcks({ personId }: { personId: string }) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<{ rows: Ack[] }>(can('policies.view') ? `/api/policies/person-acknowledgments/person/${personId}` : null);
  if (!can('policies.view')) return <Card><p className="muted">Policies are not open to you.</p></Card>;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading acknowledgments" />;
  if (!data.rows.length) {
    return <Card><EmptyState icon="check-square" title="Nothing asked yet" message="Documents this person is asked to acknowledge, as a member of the roster, appear here." /></Card>;
  }
  return (
    <Card title="Acknowledgments" flush>
      <TableWrap label="Documents this person was asked to acknowledge">
        <table className="table">
          <caption className="sr-only">Documents this person was asked to acknowledge</caption>
          <thead><tr><th scope="col">Document</th><th scope="col">Type</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col">Acknowledged</th><th scope="col">How</th></tr></thead>
          <tbody>
            {data.rows.map((a) => (
              <tr key={a.id}>
                <td><Link to={`/policies/${a.policy_id}`}>{a.policy_ref} {a.policy_title}</Link></td>
                <td>{a.document_type ? <LookupChip list="policy_document_type" value={a.document_type} /> : '–'}</td>
                <td>{a.version}</td>
                <td><StatusChip color={ACK_STATE[a.state].color} label={ACK_STATE[a.state].label} /></td>
                <td>{a.acknowledged_at ? formatDate(a.acknowledged_at) : a.due_on ? `Due ${formatDate(a.due_on)}` : '–'}</td>
                <td>{a.method ? <Badge color="gray">{METHOD[a.method] ?? a.method}</Badge> : '–'}{a.recorded_by_name ? <span className="muted"> by {a.recorded_by_name}</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}
