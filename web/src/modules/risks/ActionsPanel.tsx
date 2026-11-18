import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, Modal, ResourceForm, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { ActionStatus, localToday } from './ActionStatus';

export interface ActionsPanelProps {
  /** Record type the actions arose from, e.g. "risk". */
  sourceType: string;
  /** Id of that record. */
  sourceId: string;
  /** Value of the `action_source` list for new actions. Default: `sourceType` when it is in the list, else "other". */
  source?: string;
}

/**
 * Actions arising from one record, with a way to add another. Any module can embed it:
 * `<ActionsPanel sourceType="security_incident" sourceId={row.id} source="incident" />`.
 */
export function ActionsPanel({ sourceType, sourceId, source }: ActionsPanelProps) {
  const { can } = useAuth();
  const toast = useToast();
  const sources = useLookup('action_source');
  const [adding, setAdding] = useState(false);
  const url = `/api/actions?f.source_type=${encodeURIComponent(sourceType)}&f.source_id=${encodeURIComponent(sourceId)}&sort=due_on&dir=asc&pageSize=200`;
  const { data, error, reload } = useFetch<ListResult>(can('actions.view') ? url : null);

  if (!can('actions.view')) return <Card title="Actions"><p className="muted">You do not have access to the action tracker.</p></Card>;

  const today = localToday();
  const sourceValue = source ?? (sources.some((s) => s.value === sourceType) ? sourceType : 'other');
  const addButton = can('actions.create') && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add action</Button>;

  return (
    <Card title="Actions" actions={addButton} flush={Boolean(data && data.rows.length > 0)}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={3} label="Loading actions" />
        : data.rows.length === 0 ? (
          <EmptyState title="No actions yet" message="Actions added here also appear in the action tracker." icon="check-square" />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Reference</th><th scope="col">Action</th><th scope="col">Status</th><th scope="col">Priority</th><th scope="col">Owner</th><th scope="col">Due</th></tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const overdue = Boolean(row.due_on) && row.due_on < today && !row.completed_on && row.status !== 'cancelled';
                  return (
                    <tr key={row.id}>
                      <td><Link className="ref" to={`/actions/${row.id}`}>{row.ref}</Link></td>
                      <td><Link to={`/actions/${row.id}`}>{row.title}</Link></td>
                      <td><ActionStatus row={row} onChanged={reload} /></td>
                      <td><LookupChip list="action_priority" value={row.priority} /></td>
                      <td>{row._display?.owner_id ?? <span className="muted">Unassigned</span>}</td>
                      <td className={overdue ? 'is-overdue' : undefined}>{formatDate(row.due_on)}{overdue ? ' (overdue)' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <Modal open={adding} title="Add action" onClose={() => setAdding(false)}>
        <ResourceForm
          type="action"
          fields={['title', 'description', 'priority', 'owner_id', 'due_on', 'department']}
          initial={{ source: sourceValue, source_type: sourceType, source_id: sourceId }}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); toast.success('Action added.'); reload(); }}
        />
      </Modal>
    </Card>
  );
}

export default ActionsPanel;
