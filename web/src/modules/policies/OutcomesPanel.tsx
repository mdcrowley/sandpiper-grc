// Framework outcomes this policy supports. The frameworks module may be absent or out of
// reach for this person; the server says so and the tab explains it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, IconButton, Loading, LookupChip, RecordPicker, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';

interface Outcome { link_id: string; id: string; code: string | null; title: string; status: string | null; status_list: string | null }
interface Data { available: boolean; route: string | null; rows: Outcome[] }

export function OutcomesPanel({ row }: { row: Row }) {
  const { can } = useAuth();
  const toast = useToast();
  const url = `/api/policies/${row.id}/outcomes`;
  const { data, error, reload } = useFetch<Data>(url);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<Outcome | null>(null);

  if (error) return <Card><ErrorState error={error} onRetry={reload} /></Card>;
  if (!data) return <Card><Loading lines={4} label="Loading mapped outcomes" /></Card>;
  if (!data.available) {
    return (
      <Card>
        <EmptyState icon="target" title="Framework outcomes are not available" message="Either the frameworks area is not in use, or your role cannot see it." />
      </Card>
    );
  }
  const canEdit = can('policies.edit');

  const add = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const res = await api.post<{ added: boolean }>(url, { outcome_id: picked });
      toast.success(res.added ? 'Outcome mapped.' : 'That outcome is already mapped.');
      setPicked(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`${url}/${removing.id}`);
      toast.success('Mapping removed.');
      setRemoving(null);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Framework outcomes this policy supports" flush={data.rows.length > 0 && !canEdit}>
      <div className="stack">
        {canEdit && (
          <div className="row" style={{ alignItems: 'end' }}>
            <RecordPicker key={data.rows.length} label="Add an outcome" type="framework_outcome" value={picked} placeholder="Search by code or words" onChange={(id) => setPicked(id)} />
            <Button variant="primary" icon="plus" disabled={!picked} loading={busy && !removing} onClick={add}>Map outcome</Button>
          </div>
        )}
        {data.rows.length === 0 ? (
          <EmptyState
            icon="target" title="No outcomes mapped"
            message={canEdit ? 'Search for a framework outcome above to show which outcomes this policy helps to meet.' : 'This policy has not been mapped to any framework outcome.'}
          />
        ) : (
          <div className="table-wrap pol-tw">
            <table className="table">
              <caption className="sr-only">Framework outcomes mapped to this policy</caption>
              <thead>
                <tr><th scope="col">Code</th><th scope="col">Outcome</th><th scope="col">Status</th>{canEdit && <th scope="col"><span className="sr-only">Remove</span></th>}</tr>
              </thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id}>
                    <td className="pol-rowhead"><Link className="ref" to={`${data.route}/${o.id}`}>{o.code ?? 'Open'}</Link></td>
                    <td className="pol-wrap"><Link to={`${data.route}/${o.id}`} style={{ maxWidth: 'none', whiteSpace: 'normal' }}>{o.title}</Link></td>
                    <td>{o.status && o.status_list ? <LookupChip list={o.status_list} value={o.status} /> : <span className="muted">—</span>}</td>
                    {canEdit && <td><IconButton icon="x" label={`Remove ${o.code ?? o.title}`} variant="ghost" size="sm" onClick={() => setRemoving(o)} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={!!removing} busy={busy} title="Remove this mapping?"
        message={`${removing?.code ?? ''} ${removing?.title ?? ''} will no longer be shown as supported by this policy. The outcome itself is not changed.`}
        confirmLabel="Remove mapping" onCancel={() => setRemoving(null)} onConfirm={remove}
      />
    </Card>
  );
}
