import { useState } from 'react';
import {
  Badge, Button, Card, EmptyState, ErrorState, formatDate, KeyValue, Loading, Menu, ProgressBar, StatusChip, useAuth, type Row,
} from '../../core';
import { ApprovalDialog } from './ApprovalDialog';
import { Banner } from './bits';
import { plural } from './util';
import { useWorkflow } from './workflowContext';

/** Approvals a change needs and the decisions recorded so far. */
export function ApprovalsPanel({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const { can, user } = useAuth();
  const { data, error, reload } = useWorkflow();
  const [mode, setMode] = useState<'approved' | 'rejected' | 'by_hand' | null>(null);
  if (error) return <ErrorState title="The approvals could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading lines={4} label="Loading approvals" />;
  const a = data.approvals;
  const mine = a.decisions.find((d) => d.current && d.approver_user_id === user?.id);
  const why = !a.awaiting || !can('changes.approve') || a.can_decide ? null
    : row.created_by === user?.id ? 'You raised this change, so someone else must approve it.'
    : mine ? 'You have recorded your decision on this change.'
    : a.pool ? 'This change is waiting for the approvers named below; you are not one of them.'
    : 'You have recorded your decision on this change.';

  return (
    <div className="stack">
      <Card
        title="Approvals"
        actions={a.can_decide && (
          <span className="row">
            <Button size="sm" variant="primary" icon="check" onClick={() => setMode('approved')}>Approve</Button>
            <Button size="sm" icon="x" onClick={() => setMode('rejected')}>Reject</Button>
            <Menu label="More approval options" iconOnly icon="more" size="sm" align="end" items={[
              { label: 'Record a decision given outside the application…', icon: 'edit', onSelect: () => setMode('by_hand') },
            ]} />
          </span>
        )}
      >
        <div className="stack">
          {row.change_type === 'standard' ? (
            <Banner tone="success">
              This is a standard change raised from the template <strong>{row.template_name}</strong>. It is pre-approved and needs no further approval.
            </Banner>
          ) : a.required === 0 ? (
            <Banner>The approval rules ask for no approval for this type and risk.</Banner>
          ) : (
            <>
              <ProgressBar
                label="Approvals recorded"
                value={Math.min(a.received, a.required)}
                max={a.required}
                color={a.outstanding ? 'blue' : 'green'}
                valueText={`${a.received} of ${a.required}`}
              />
              <p className="muted">
                By the rules, a {String(row._display?.change_type ?? row.change_type).toLowerCase()} change
                {row.risk_level ? <> at {String(row._display?.risk_level ?? row.risk_level).toLowerCase()} risk</> : null} needs {plural(a.required, 'approval')}
                {a.approver_roles.length > 0 && <> from: {a.approver_roles.join(', ')}</>}.
                {row.status === 'draft' && ' Submit the change to ask for approval.'}
              </p>
              {row.status !== 'draft' && (
                <KeyValue compact items={[
                  {
                    label: 'Who may approve',
                    value: a.pool
                      ? [...a.pool.users.map((u) => u.name), ...a.pool.roles.map((r) => `anyone in the role ${r.name}`)].join(', ')
                      : 'Anyone with the Approve permission on Changes, other than the requester',
                  },
                  ...(a.awaiting ? [{
                    label: 'Still to decide',
                    value: a.waiting_for.length ? a.waiting_for.join(', ') : <span className="muted">Nobody else can approve it: check the approval rule</span>,
                  }] : []),
                ]} />
              )}
            </>
          )}
          {why && <Banner>{why}</Banner>}
          {a.retrospective && (
            <Banner tone="warn">Work started before approval was given. Record the approval before the change is closed; it will be flagged as given after the fact.</Banner>
          )}
          {a.approved_retrospectively && <Banner tone="warn">This change was approved after the work had started.</Banner>}
          {a.awaiting && !can('changes.approve') && <p className="muted">Approval decisions are recorded by people with the Approve permission on Changes.</p>}
        </div>
      </Card>

      <Card title="Decisions" flush>
        {a.decisions.length === 0 ? (
          <EmptyState icon="check-square" title="No decisions recorded" message="Each approval or rejection appears here with who gave it and when." />
        ) : (
          <div className="table-wrap chg-tw">
            <table className="table">
              <thead>
                <tr><th>Decision</th><th>Approver</th><th>Role</th><th>Date</th><th>Reference</th><th>Notes</th><th>Recorded by</th></tr>
              </thead>
              <tbody>
                {a.decisions.map((d) => (
                  <tr key={d.id} className={d.current ? undefined : 'chg-superseded'}>
                    <td>
                      <span className="row">
                        <StatusChip color={d.decision === 'approved' ? 'green' : 'red'} label={d.decision === 'approved' ? 'Approved' : 'Rejected'} />
                        {d.retrospective && <Badge color="amber">After the fact</Badge>}
                        {!d.current && <Badge>Earlier submission</Badge>}
                      </span>
                    </td>
                    <td>{d.approver_name}</td>
                    <td>{d.approver_role ?? '—'}</td>
                    <td>{formatDate(d.decided_on)}</td>
                    <td>{d.reference ?? '—'}</td>
                    <td className="prose">{d.notes ?? '—'}</td>
                    <td>{d.recorded_by_name ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ApprovalDialog open={mode !== null} mode={mode ?? 'approved'} changeId={row.id} approvals={a}
        onClose={() => setMode(null)} onRecorded={() => { reload(); onChanged(); }} />
    </div>
  );
}
