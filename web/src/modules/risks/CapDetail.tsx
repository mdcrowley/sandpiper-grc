import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api, Button, Card, EmptyState, ErrorState, errorMessage, formatDate, Icon, Loading, LookupChip, Modal, ProgressBar, RecordPage,
  ResourceForm, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import type { ListResult, RecordContext, Row } from '../../core';
import { ActionRows, QuickAdd } from './ActionRows';
import { localToday } from './ActionStatus';
import { DueChip } from './scales';
import './risks.css';
import './caps.css';

// One corrective action plan (E23-01 to E23-05, /caps/:id): the problem and its root cause, the
// actions that fix it, approval through the approval workflows, and verification of each action.

interface Approval {
  available: boolean; status: string; approved_on: string | null; approved_by_name: string | null;
  request: { id: string; workflow: string; status: string; started_at: string; finished_at: string | null } | null;
}

const STEPS: { key: string; label: string }[] = [
  { key: 'draft', label: 'Draft' }, { key: 'submitted', label: 'Approval' }, { key: 'in_progress', label: 'Actions' },
  { key: 'verifying', label: 'Verification' }, { key: 'closed', label: 'Closed' },
];
const stepOf = (status: string) => (status === 'rejected' ? 1 : status === 'approved' ? 2 : Math.max(0, STEPS.findIndex((s) => s.key === status)));

/** Where the plan stands, as a row of steps. */
function PlanSteps({ status }: { status: string }) {
  const at = stepOf(status);
  return (
    <ol className="cap-steps" aria-label="Plan progress">
      {STEPS.map((s, i) => (
        <li key={s.key} className={i < at || status === 'closed' ? 'is-done' : i === at ? (status === 'rejected' ? 'is-rejected' : 'is-current') : undefined} aria-current={i === at ? 'step' : undefined}>
          <span className="cap-step-dot">{i < at || status === 'closed' ? <Icon name="check" size={12} /> : i + 1}</span>
          <span>{i === 1 && status === 'rejected' ? 'Rejected' : s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** The plan's actions, with a quick way to add one and the plan's progress. */
function PlanActions({ rec }: { rec: RecordContext }) {
  const { can } = useAuth();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const { data, error, reload } = useFetch<ListResult>(`/api/actions?f.cap_id=${rec.row.id}&sort=due_on&dir=asc&pageSize=200`);
  const statuses = useFetch<{ open_statuses: string[] }>('/api/actions/summary');
  const today = localToday();
  const changed = () => { reload(); rec.reload(); };
  const rows = data?.rows ?? [];
  const live = rows.filter((r) => r.status !== 'cancelled');
  const done = live.filter((r) => r.status === 'done').length;
  const awaiting = live.filter((r) => r.status === 'pending_verification').length;
  const closed = rec.row.status === 'closed';
  return (
    <Card
      className="rk-panel" flush
      title={<>Actions{rows.length > 0 && <span className="tab-count rk-panel-count">{rows.length}</span>}</>}
      actions={(
        <>
          {awaiting > 0 && <span className="chip chip-purple">{awaiting} awaiting verification</span>}
          {can('actions.create') && <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add action</Button>}
        </>
      )}
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <div className="rk-panel-pad"><Loading lines={3} label="Loading actions" /></div> : (
        <>
          {live.length > 0 && (
            <div className="rk-panel-pad rk-panel-progress">
              <ProgressBar label="Actions verified and done" value={done} max={live.length} color="green" valueText={`${done} of ${live.length} done`} />
            </div>
          )}
          {rows.length === 0
            ? <EmptyState icon="check-square" title="No actions yet" message="Add the actions that fix the root cause. Each one is verified once its work is finished." />
            : <ActionRows rows={rows} today={today} openStatuses={statuses.data?.open_statuses} onChanged={changed} caption="Actions in this plan" show={{ priority: true }} />}
          {can('actions.create') && !closed && (
            <div className="rk-panel-pad rk-panel-add"><QuickAdd initial={{ cap_id: rec.row.id }} onAdded={changed} /></div>
          )}
        </>
      )}
      <Modal open={adding} title="Add action to the plan" onClose={() => setAdding(false)}>
        <ResourceForm
          type="action"
          fields={['title', 'description', 'priority', 'owner_id', 'due_on', 'verification_required', 'verifier_id', 'verification_due']}
          initial={{ cap_id: rec.row.id, verification_required: true }}
          onCancel={() => setAdding(false)}
          onSaved={() => { setAdding(false); toast.success('Action added to the plan.'); changed(); }}
        />
      </Modal>
    </Card>
  );
}

/** Approval of the plan: submit it, see the workflow, and who approved it. */
function PlanApproval({ rec }: { rec: RecordContext }) {
  const { data, error, reload } = useFetch<Approval>(`/api/caps/${rec.row.id}/approval`);
  return (
    <Card title="Approval">
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} label="Loading approval" /> : (
        <div className="stack">
          {data.approved_on ? (
            <p className="cap-flush">Approved <strong>{formatDate(data.approved_on)}</strong>{data.approved_by_name ? ` by ${data.approved_by_name}` : ' (no approval workflow applied)'}.</p>
          ) : rec.row.status === 'submitted' ? (
            <p className="cap-flush">Waiting for approval{data.request ? ` through “${data.request.workflow}”` : ''}. Approvers find it under Approvals.</p>
          ) : rec.row.status === 'rejected' ? (
            <p className="cap-flush">The plan was rejected; the reason is in its history. Rework it and submit it again.</p>
          ) : (
            <p className="muted cap-flush">
              Not submitted yet. Give the root cause and add at least one action, then submit the plan.
              {data.available ? '' : ' No approval workflow is set up, so submitting approves it at once.'}
            </p>
          )}
          {data.request && (
            <p className="muted cap-flush">
              Workflow “{data.request.workflow}”: {data.request.status}, started {formatDate(data.request.started_at)}
              {data.request.finished_at ? `, finished ${formatDate(data.request.finished_at)}` : ''}.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function SubmitButton({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!rec.canEdit || !['draft', 'rejected'].includes(rec.row.status)) return null;
  const submit = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ status: string }>(`/api/caps/${rec.row.id}/submit`, {});
      toast.success(res.status === 'submitted' ? 'Plan submitted for approval.' : 'Plan approved: no approval workflow applies.');
      rec.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return <Button variant="primary" icon="check-circle" loading={busy} onClick={submit}>Submit for approval</Button>;
}

export function CapDetail() {
  const { resources } = useMeta();
  const source = (row: Row) => {
    const target = row.source_type ? resources[row.source_type] : undefined;
    if (!target || !row.source_id) return null;
    return <span>Raised on <Link to={`${target.route}/${row.source_id}`}>{target.label.toLowerCase()} record</Link></span>;
  };
  return (
    <RecordPage
      type="cap"
      breadcrumbs={[{ label: 'Corrective action plans', to: '/caps' }]}
      subtitle={source}
      status={(row) => <LookupChip list="cap_status" value={row.status} />}
      actions={(rec) => <SubmitButton rec={rec} />}
      banner={({ row }) => (
        <div className="stack">
          <PlanSteps status={row.status} />
          <div className="rk-obl-banner">
            <div>
              <span className="rk-step-label">Due</span>
              <span className="row">
                <strong>{row.due_on ? formatDate(row.due_on) : 'No due date'}</strong>
                {row.due_on && row.status !== 'closed' && row.status !== 'rejected' && <DueChip date={row.due_on} warnDays={14} />}
              </span>
            </div>
            <div>
              <span className="rk-step-label">Responsible</span>
              <span>{row._display?.responsible_id ?? <span className="muted">Not named</span>}</span>
            </div>
            <div>
              <span className="rk-step-label">Actions</span>
              <span>{row.actions_done ?? 0} of {row.actions_total ?? 0} done{row.actions_awaiting ? `, ${row.actions_awaiting} to verify` : ''}</span>
            </div>
            {row.closed_on && (
              <div>
                <span className="rk-step-label">Closed</span>
                <span>{formatDate(row.closed_on)}</span>
              </div>
            )}
            {row.restricted && (
              <div>
                <span className="rk-step-label">Visibility</span>
                <span className="chip chip-purple"><Icon name="lock" size={12} /> Restricted</span>
              </div>
            )}
          </div>
        </div>
      )}
      summaryFields={['title', 'problem_statement', 'root_cause', 'root_cause_category', 'responsible_id', 'due_on', 'source', 'effectiveness_summary']}
      tabs={[
        { key: 'actions', label: 'Actions', content: (rec: RecordContext) => <PlanActions rec={rec} /> },
        { key: 'approval', label: 'Approval', content: (rec: RecordContext) => <PlanApproval rec={rec} /> },
      ]}
    />
  );
}
