// Decisions: the register of every committee decision, and one decision with the record it is about.
import { EditableSummary, PageHeader, RecordPage, ResourceList, useAuth, useFetch } from '../../core';
import type { Row } from '../../core';
import { ApplyButton, mayApply } from './Meetings';
import { GovernanceTabs, RecordName, type NamedRecord } from './shared';

export function DecisionList() {
  return (
    <div className="stack">
      <PageHeader title="Decisions" subtitle="Every decision a committee has taken, with the record it is about." />
      <GovernanceTabs active="decisions" />
      <ResourceList
        type="meeting_decision"
        urlState
        columns={['ref', 'title', 'meeting_id', 'outcome', 'applied_at', 'created_at']}
        filters={['outcome', 'meeting_id', 'applied_at', 'created_at']}
        bulkFields={[]}
      />
    </div>
  );
}

function DecidedRecord({ decision, onApplied }: { decision: Row; onApplied: () => void }) {
  const { can, user } = useAuth();
  const { data } = useFetch<(Row & { record: NamedRecord | null })[]>(`/api/meetings/${decision.meeting_id}/decisions`);
  const meeting = useFetch<Row>(`/api/meetings/${decision.meeting_id}`);
  const mine = data?.find((d) => d.id === decision.id);
  const applicable = !decision.applied_at && mine?.record && !mine.record.hidden && (decision.outcome === 'approved' || decision.outcome === 'rejected')
    && mayApply(meeting.data, user?.id, can('governance.edit'));
  return (
    <div className="card">
      <div className="card-head"><h2 className="card-title">Record decided</h2></div>
      <div className="card-body stack">
        <p><RecordName record={mine?.record ?? (decision.record_type ? { hidden: !mine } : null)} /></p>
        {decision.applied_at
          ? <p className="notice notice-success">Applied to the waiting approval: {decision.applied_to_workflow}.</p>
          : applicable ? <div><ApplyButton decisionId={decision.id} onApplied={onApplied} /></div> : null}
      </div>
    </div>
  );
}

export function DecisionDetail() {
  return (
    <RecordPage
      type="meeting_decision"
      summary={({ row, reload }) => (
        <div className="gv-summary">
          <EditableSummary type="meeting_decision" row={row} onSaved={reload} title="Decision" editable={row.applied_at ? false : undefined}
            fields={['title', 'meeting_id', 'outcome', 'notes', 'applied_to_workflow', 'applied_at', 'applied_by']} />
          <DecidedRecord decision={row} onApplied={reload} />
        </div>
      )}
    />
  );
}
