// Administration > Outside reviewers (E41-09): every invitation of a person outside the organization,
// with the audit or review it opens, and a way to revoke any of them at once.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Badge, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, formatDateTime, Loading, PageHeader, TableWrap,
  useAuth, useFetch, useToast,
} from '../../core';
import { STATE_COLOR, STATE_LABEL, type Grant } from './types';
import './outsidereviews.css';

type Row = Grant & { kind: string; subject_ref: string | null; subject_title: string | null; subject_route: string | null };

export function AdminReviewers() {
  const toast = useToast();
  const { areaOn } = useAuth();
  // Named from the parts that are on (Administration > Features): a switched-off part is named nowhere.
  const kinds = [areaOn('audits') && 'an audit', areaOn('funding') && 'a funder review'].filter(Boolean) as string[];
  const places = [areaOn('audits') && 'an audit engagement', areaOn('funding') && 'a funder compliance review'].filter(Boolean) as string[];
  const { data, error, reload } = useFetch<{ today: string; rows: Row[] }>('/api/admin/outside-reviewers');
  const [revoking, setRevoking] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const header = (
    <PageHeader title="Outside reviewers"
      subtitle={`People outside the organization invited${kinds.length ? ` to ${kinds.join(' or ')}` : ''}, each until an end date. Their accounts reach nothing else.`} />
  );
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={4} label="Loading the outside reviewers" /></div>;
  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/outside-reviewers/${revoking.id}/revoke`);
      toast.success(`${revoking.name} can no longer open ${revoking.subject_ref ?? 'it'}.`);
      setRevoking(null);
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  const open = data.rows.filter((r) => r.state === 'active').length;
  return (
    <div className="stack">
      {header}
      <Card title={`Invitations (${open} open of ${data.rows.length})`}>
        {data.rows.length === 0 ? (
          <EmptyState icon="users" title="No outside reviewers" message={places.length ? `Invite one from ${places.join(' or ')}, on its Outside reviewers tab.` : 'Nobody has been invited.'} />
        ) : (
          <TableWrap label="Outside reviewer invitations" fit>
            <table className="table">
              <caption className="sr-only">Outside reviewer invitations</caption>
              <thead>
                <tr>
                  <th scope="col" data-priority="1">Reviewer</th>
                  <th scope="col" data-priority="2">Organization</th>
                  <th scope="col" data-priority="1">Opens</th>
                  <th scope="col" data-priority="1">Access ends</th>
                  <th scope="col" data-priority="1">Status</th>
                  <th scope="col" data-priority="3">Last opened</th>
                  <th scope="col" data-priority="1"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td><strong>{r.name}</strong><div className="muted or-small">{r.email} · {r.username}</div></td>
                    <td>{r.organization ?? '—'}</td>
                    <td>
                      {r.subject_route ? <Link to={r.subject_route}>{[r.subject_ref, r.subject_title].filter(Boolean).join(' ')}</Link> : 'Deleted record'}
                      <div className="muted or-small">{r.kind}</div>
                    </td>
                    <td>{formatDate(r.expires_on)}</td>
                    <td>
                      <Badge color={STATE_COLOR[r.state]}>{STATE_LABEL[r.state]}</Badge>
                      {r.account_disabled && <div className="muted or-small">Account disabled</div>}
                    </td>
                    <td>{r.last_opened_at ? formatDateTime(r.last_opened_at) : 'Not yet'}</td>
                    <td className="or-actions">
                      {r.state === 'active' && <Button size="sm" variant="danger" onClick={() => setRevoking(r)}>Revoke</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <ConfirmDialog open={Boolean(revoking)} title="Revoke this reviewer's access?" danger busy={busy} confirmLabel="Revoke access"
        message={revoking ? `${revoking.name} will no longer be able to open ${revoking.subject_ref ?? 'it'}. With nothing else open to them, they are signed out and their account is disabled.` : ''}
        onConfirm={() => void revoke()} onCancel={() => setRevoking(null)} />
    </div>
  );
}
