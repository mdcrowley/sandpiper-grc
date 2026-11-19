import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Icon, IconButton, Loading, LookupChip, RecordPage, relativeTime,
  useAuth, useFetch, useMeta, UserPicker, useToast,
} from '../../core';
import type { RecordContext, Row } from '../../core';
import { ActionStatus } from './ActionStatus';
import { DueChip } from './scales';

interface Shares { restricted: boolean; shares: { user_id: string; name: string; shared_by: string | null; created_at: string }[] }

/**
 * Who a restricted action has been shared with by name. Sharing lets one person who cannot see
 * restricted records see this one action (in "My actions") and change its status and notes.
 */
function SharingPanel({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Shares>(`/api/actions/${rec.row.id}/shares`);
  const [userId, setUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const share = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      const made = await api.post<{ name: string }>(`/api/actions/${rec.row.id}/shares`, { user_id: userId });
      toast.success(`Shared with ${made.name}.`);
      setUserId(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const stop = async (id: string, name: string) => {
    try {
      await api.del(`/api/actions/${rec.row.id}/shares/${id}`);
      toast.success(`No longer shared with ${name}.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Card title="Sharing">
      <div className="notice">
        <Icon name="lock" size={18} />
        <div>
          <strong>This action is restricted</strong>
          <p>
            It arose from a restricted record, so only people with access to security records can see it. Share it with a named person
            (for example its owner) and they will see this one action under “My actions”, with its title, description, due date and notes,
            and can change its status and notes. They never see the record it arose from.
          </p>
        </div>
      </div>
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} label="Loading sharing" /> : (
        <>
          {data.shares.length === 0 ? <EmptyState icon="users" title="Not shared with anyone" message="Only people with access to security records can see this action." /> : (
            <ul className="rk-share-list">
              {data.shares.map((s) => (
                <li key={s.user_id}>
                  <Icon name="user" size={16} />
                  <span><strong>{s.name}</strong> <span className="muted">shared {relativeTime(s.created_at)}{s.shared_by ? ` by ${s.shared_by}` : ''}</span></span>
                  {rec.canEdit && <IconButton size="sm" icon="x" label={`Stop sharing with ${s.name}`} onClick={() => void stop(s.user_id, s.name)} />}
                </li>
              ))}
            </ul>
          )}
          {rec.canEdit && (
            <div className="rk-share-add">
              <UserPicker label="Share with" placeholder="Search people" value={userId} display={rec.row.owner_id === userId ? rec.row._display?.owner_id : undefined} onChange={(id) => setUserId(id)} />
              {rec.row.owner_id && !data.shares.some((s) => s.user_id === rec.row.owner_id) && userId !== rec.row.owner_id && (
                <Button variant="ghost" onClick={() => setUserId(rec.row.owner_id)}>Choose the owner</Button>
              )}
              <Button variant="primary" loading={busy} disabled={!userId} onClick={share}>Share</Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function ActionDetail() {
  const { resources } = useMeta();
  const { can } = useAuth();
  const source = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    if (!target || !row.source_id) return row.external_ref ? <span className="muted">External reference {row.external_ref}</span> : null;
    return <span>Arose from <Link to={`${target.route}/${row.source_id}`}>{target.label.toLowerCase()} record</Link></span>;
  };
  return (
    <RecordPage
      type="action"
      subtitle={source}
      status={(row) => <ActionStatus key={`${row.id}-${row.status}`} row={row} />}
      banner={({ row }) => (
        <div className="rk-obl-banner">
          <div>
            <span className="rk-step-label">Due</span>
            <span className="row">
              <strong>{row.due_on ? formatDate(row.due_on) : 'No due date'}</strong>
              {row.due_on && (row.completed_on || row.status === 'cancelled' ? null : <DueChip date={row.due_on} warnDays={7} />)}
            </span>
          </div>
          <div>
            <span className="rk-step-label">Owner</span>
            <span>{row._display?.owner_id ?? <span className="muted">Unassigned</span>}</span>
          </div>
          <div>
            <span className="rk-step-label">Priority</span>
            <LookupChip list="action_priority" value={row.priority} />
          </div>
          {row.completed_on && (
            <div>
              <span className="rk-step-label">Completed</span>
              <span>{formatDate(row.completed_on)}</span>
            </div>
          )}
          {row.restricted && (
            <div>
              <span className="rk-step-label">Visibility</span>
              <span className="chip chip-purple"><Icon name="lock" size={12} /> Restricted</span>
            </div>
          )}
        </div>
      )}
      summaryFields={['title', 'description', 'status', 'priority', 'owner_id', 'due_on', 'completed_on', 'source', 'department', 'external_ref', 'notes']}
      tabs={[
        // Offered only to people who can see restricted records; the server checks again.
        ...(can('security.view') ? [{ key: 'sharing', label: 'Sharing', content: (rec: RecordContext) => (rec.row.restricted
          ? <SharingPanel rec={rec} />
          : <Card title="Sharing"><p className="muted">This action is not restricted: everyone who can see the action tracker can see it, so there is nothing to share.</p></Card>) }] : []),
      ]}
    />
  );
}
