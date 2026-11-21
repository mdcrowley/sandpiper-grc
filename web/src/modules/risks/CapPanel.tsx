import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, formatDate, Icon, Loading, LookupChip, Modal, ResourceForm, useAuth, useFetch, useLookup, useToast,
} from '../../core';
import type { Row } from '../../core';
import { localToday } from './ActionStatus';
import './risks.css';

// Corrective action plans on a host record's page (E23-07, contract C1). Host pages load it with
// import.meta.glob('../risks/CapPanel.tsx'), as safety's shared.tsx loads ActionsPanel, so a build
// without it shows no panel:
//
//   const capLoaders = import.meta.glob<{ CapPanel: ComponentType<CapPanelProps> }>('../risks/CapPanel.tsx');
//   <CapPanel sourceType="audit_finding" sourceId={row.id} source="audit" />

export interface CapPanelProps {
  /** The host record's type, for example 'audit_finding'. */
  sourceType: string;
  /** The host record's id. */
  sourceId: string;
  /** The `action_source` value new CAPs and their actions are filed under, for example 'audit'. */
  source?: string;
}

interface RegisterRow extends Row {
  actions_total: number; actions_done: number; actions_awaiting_verification: number; actions_overdue: number; overdue: boolean;
}

/** The corrective action plans raised on one record, with a way to raise a new one. */
export function CapPanel({ sourceType, sourceId, source }: CapPanelProps) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const sources = useLookup('action_source');
  const [adding, setAdding] = useState(false);
  const url = `/api/caps/register?source_type=${encodeURIComponent(sourceType)}&source_id=${encodeURIComponent(sourceId)}`;
  const { data, error, reload } = useFetch<{ rows: RegisterRow[] }>(can('actions.view') ? url : null);

  if (!can('actions.view')) return null;

  const rows = data?.rows ?? [];
  const today = localToday();
  const initial = { ...(source && sources.some((s) => s.value === source) ? { source } : {}), source_type: sourceType, source_id: sourceId };

  return (
    <Card
      className="rk-panel"
      title={<>Corrective action plans{rows.length > 0 && <span className="tab-count rk-panel-count">{rows.length}</span>}</>}
      actions={(
        <>
          <Link className="btn btn-ghost btn-sm" to="/caps">All plans</Link>
          {can('actions.create') && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Raise a plan</Button>}
        </>
      )}
      flush
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="rk-panel-pad"><Loading lines={2} label="Loading corrective action plans" /></div>
        : rows.length === 0 ? <EmptyState icon="clipboard" title="No corrective action plans" message="Raise a plan to group the actions that fix this problem, with its root cause, approval and verification." />
        : (
          <ul className="rk-cap-list">
            {rows.map((r) => {
              const c = r as RegisterRow;
              const late = r.due_on && r.due_on < today && r.status !== 'closed' && r.status !== 'rejected';
              return (
                <li key={r.id as string}>
                  <div className="rk-cap-main">
                    <Link to={`/caps/${r.id}`}><strong>{r.ref}</strong> {r.title}</Link>
                    <span className="muted">
                      {r.due_on ? `Due ${formatDate(r.due_on)}` : 'No due date'}
                      {c ? ` · ${c.actions_done} of ${c.actions_total} actions done` : ''}
                    </span>
                  </div>
                  <span className="row">
                    {late && <span className="chip chip-red">Overdue</span>}
                    {c && c.actions_awaiting_verification > 0 && <span className="chip chip-purple"><Icon name="check-circle" size={12} /> {c.actions_awaiting_verification} to verify</span>}
                    <LookupChip list="cap_status" value={r.status} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      <Modal open={adding} title="Raise a corrective action plan" onClose={() => setAdding(false)}>
        <ResourceForm
          type="cap"
          fields={['title', 'problem_statement', 'root_cause', 'root_cause_category', 'responsible_id', 'due_on']}
          initial={initial}
          onCancel={() => setAdding(false)}
          onSaved={(row: Row) => { setAdding(false); toast.success(`${row.ref ?? 'Plan'} raised. Add its actions, then submit it for approval.`); navigate(`/caps/${row.id}`); }}
        />
      </Modal>
    </Card>
  );
}

export default CapPanel;
