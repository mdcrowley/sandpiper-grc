import { useParams, useSearchParams } from 'react-router-dom';
import {
  Badge, EditableSummary, formatDateTime, LookupChip, RecordPage, Stepper, useLookup, useResource,
  type RecordContext, type Row, type Step,
} from '../../core';
import { ApprovalsPanel } from './ApprovalsPanel';
import { Banner } from './bits';
import { ChangeActions } from './ChangeActions';
import { ConflictsPanel } from './ConflictsPanel';
import { RelatedTab } from './RelatedTab';
import { ReviewTab } from './ReviewTab';
import { RiskCard } from './RiskCard';
import { LIFECYCLE, plural } from './util';
import { useWorkflow, WorkflowProvider } from './workflowContext';

function useOpenTab() {
  const [, setSearch] = useSearchParams();
  return (tab: string) => setSearch((p) => { p.set('tab', tab); return p; }, { replace: true });
}

/** The lifecycle as a stepper, with what is holding the change up underneath. */
function Lifecycle({ row }: { row: Row }) {
  const statuses = useLookup('change_status');
  const { data } = useWorkflow();
  const openTab = useOpenTab();
  const label = (value: string) => statuses.find((s) => s.value === value)?.label ?? value;
  const off = row.status === 'rejected' || row.status === 'cancelled';
  const open = data?.conflicts.filter((c) => !c.acknowledged).length ?? 0;
  const a = data?.approvals;

  const hints: Record<string, string | undefined> = {
    submitted: row.status === 'rejected' ? 'Rejected'
      : a && a.required > 0 && ['draft', 'submitted'].includes(row.status) ? `${a.received} of ${a.required} approvals` : undefined,
    approved: row.change_type === 'standard' ? 'Pre-approved' : row.approved_retrospectively ? 'After the fact' : undefined,
    scheduled: row.planned_start ? formatDateTime(row.planned_start) : undefined,
    completed: row.outcome ? String(row._display?.outcome ?? row.outcome) : undefined,
    reviewed: data && !data.review.required && !data.review.done ? 'Not required' : undefined,
  };
  const steps: Step[] = LIFECYCLE.map((key) => ({
    key, label: label(key), hint: hints[key],
    ...(row.status === 'rejected' && key === 'submitted' ? { state: 'blocked' as const } : {}),
    // A review that is not required is skipped, not outstanding.
    ...(key === 'reviewed' && row.status === 'closed' && !row.pir_completed_at ? { state: 'todo' as const } : {}),
  }));

  return (
    <div className="stack">
      <div className="chg-lifecycle">
        <Stepper label="Change lifecycle" steps={steps} current={row.status === 'rejected' ? 'submitted' : row.status === 'cancelled' ? undefined : row.status} />
      </div>
      {row.status === 'cancelled' && <Banner>This change was cancelled{row.outcome_notes ? `: ${row.outcome_notes}` : '.'}</Banner>}
      {row.status === 'rejected' && <Banner tone="danger">This change was rejected. Return it to draft to revise and resubmit it; see the Approvals tab for the reason.</Banner>}
      {!off && open > 0 && (
        <Banner tone="warn">
          {plural(open, 'conflict')} with a blackout period or another change. It cannot be scheduled or started until {open === 1 ? 'it is' : 'they are'} resolved or acknowledged.{' '}
          <button type="button" className="chg-linkbtn" onClick={() => openTab('conflicts')}>See the conflicts</button>
        </Banner>
      )}
      {row.status === 'completed' && data?.review.required && !data.review.done && (
        <Banner tone="danger">
          A post-implementation review is required before this change can be closed.{' '}
          <button type="button" className="chg-linkbtn" onClick={() => openTab('review')}>Record the review</button>
        </Banner>
      )}
      {a?.retrospective && <Banner tone="warn">Work started before approval was given. The approval must be recorded before the change is closed.</Banner>}
    </div>
  );
}

function Summary(rec: RecordContext) {
  const { row, reload } = rec;
  const { reload: reloadWorkflow } = useWorkflow();
  const hasSystems = Boolean(useResource('system'));
  const hasAssets = Boolean(useResource('asset'));
  const saved = () => { reload(); reloadWorkflow(); };
  const locked = ['closed', 'cancelled'].includes(row.status);
  return (
    <div className="grid-2">
      <div className="stack">
        <EditableSummary
          type="change"
          row={row}
          title="Change"
          editable={locked ? false : undefined}
          fields={[
            'title', 'description', 'reason', ...(row.template_id ? ['template_name'] : []),
            'owner_id', 'assignee_id', ...(hasSystems ? ['system_id'] : []), ...(hasAssets ? ['asset_id'] : []),
          ]}
          onSaved={saved}
        />
        <EditableSummary
          type="change"
          row={row}
          title="Schedule and outcome"
          editable={locked ? false : undefined}
          fields={['planned_start', 'planned_end', 'actual_start', 'actual_end', 'outcome', 'outcome_notes']}
          onSaved={saved}
        />
      </div>
      <RiskCard {...rec} onSaved={saved} />
    </div>
  );
}

function Detail() {
  const { data } = useWorkflow();
  const { reload: reloadWorkflow } = useWorkflow();
  const openTab = useOpenTab();
  const open = data?.conflicts.filter((c) => !c.acknowledged).length;
  return (
    <RecordPage
      type="change"
      status={(row) => (
        <span className="row">
          <LookupChip list="change_status" value={row.status} />
          <LookupChip list="change_type" value={row.change_type} />
          {row.risk_level && <Badge color={row.risk_level === 'high' ? 'red' : row.risk_level === 'medium' ? 'amber' : 'green'}>{row._display?.risk_level ?? row.risk_level} risk</Badge>}
        </span>
      )}
      actions={(rec) => <ChangeActions {...rec} onOpenTab={openTab} />}
      banner={(rec) => <Lifecycle row={rec.row} />}
      summary={(rec) => <Summary {...rec} />}
      tabs={[
        {
          key: 'plans', label: 'Plans',
          content: (rec) => (
            <EditableSummary
              type="change"
              row={rec.row}
              title="Implementation, test and back-out plans"
              editable={['closed', 'cancelled'].includes(rec.row.status) ? false : undefined}
              fields={['implementation_plan', 'test_plan', 'backout_plan']}
              onSaved={rec.reload}
            />
          ),
        },
        { key: 'approvals', label: 'Approvals', count: data?.approvals.outstanding || undefined, content: (rec) => <ApprovalsPanel row={rec.row} onChanged={rec.reload} /> },
        { key: 'conflicts', label: 'Conflicts', count: open || undefined, content: (rec) => <ConflictsPanel row={rec.row} /> },
        { key: 'systems', label: 'Systems and links', content: (rec) => <RelatedTab row={rec.row} canEdit={rec.canEdit} onChanged={reloadWorkflow} /> },
        { key: 'review', label: 'Review', content: (rec) => <ReviewTab row={rec.row} canEdit={rec.canEdit} onChanged={rec.reload} /> },
      ]}
    />
  );
}

/** Change record: lifecycle stepper, summary, plans, approvals, conflicts, links, review and history. */
export function ChangeDetail() {
  const { id } = useParams();
  return (
    <WorkflowProvider changeId={id}>
      <Detail />
    </WorkflowProvider>
  );
}
