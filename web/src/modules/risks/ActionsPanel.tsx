import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, Loading, Modal, ProgressBar, ResourceForm, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { ListResult } from '../../core';
import { ActionRows, QuickAdd } from './ActionRows';
import { localToday } from './ActionStatus';
import './risks.css';

export interface ActionsPanelProps {
  /** Record type the actions arose from, e.g. "risk". */
  sourceType: string;
  /** Id of that record. */
  sourceId: string;
  /**
   * Value of the `action_source` list for new actions. Default: the server files the action
   * under the kind that fits `sourceType` (a security incident under "Incident", a contract under
   * "Vendor", and so on), or "Other" when nothing fits.
   */
  source?: string;
}

/**
 * Actions arising from one record, with a way to add and complete them in place. Any module can
 * embed it: `<ActionsPanel sourceType="security_incident" sourceId={row.id} />`.
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
  const canCreate = can('actions.create');
  // An explicit source wins; otherwise leave it out and the server picks the one that fits the record type.
  const initial = { ...(source && sources.some((s) => s.value === source) ? { source } : {}), source_type: sourceType, source_id: sourceId };
  const rows = data?.rows ?? [];
  const finished = rows.filter((r) => Boolean(r.completed_on) || r.status === 'cancelled').length;
  const overdue = rows.filter((r) => r.due_on && r.due_on < today && !r.completed_on && r.status !== 'cancelled').length;

  return (
    <Card
      className="rk-panel"
      title={<>Actions{rows.length > 0 && <span className="tab-count rk-panel-count">{rows.length}</span>}</>}
      actions={(
        <>
          {overdue > 0 && <span className="chip chip-red">{overdue} overdue</span>}
          <Link className="btn btn-ghost btn-sm" to="/actions">Action tracker</Link>
          {canCreate && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add action</Button>}
        </>
      )}
      flush
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rk-panel-pad"><Loading lines={3} label="Loading actions" /></div>
        : (
          <>
            {rows.length > 0 && (
              <div className="rk-panel-pad rk-panel-progress">
                <ProgressBar label="Actions finished" value={finished} max={rows.length} color="green" valueText={`${finished} of ${rows.length} finished`} />
              </div>
            )}
            {rows.length === 0
              ? <EmptyState title="No actions yet" message="Actions added here also appear in the action tracker." icon="check-square" />
              : <ActionRows rows={rows} today={today} onChanged={reload} caption="Actions for this record" />}
            {canCreate && (
              <div className="rk-panel-pad rk-panel-add">
                <QuickAdd initial={initial} onAdded={reload} />
              </div>
            )}
          </>
        )}
      <Modal open={adding} title="Add action" onClose={() => setAdding(false)}>
        <ResourceForm
          type="action"
          fields={['title', 'description', 'priority', 'owner_id', 'due_on', 'department']}
          initial={initial}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); toast.success('Action added.'); reload(); }}
        />
      </Modal>
    </Card>
  );
}

export default ActionsPanel;
