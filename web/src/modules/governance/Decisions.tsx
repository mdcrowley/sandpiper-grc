// Decisions: the register of every committee decision, and one decision with the record it is about.
import { useState } from 'react';
import { api, Button, EditableSummary, errorMessage, PageHeader, RecordPage, ResourceList, useAuth, useFetch, useToast } from '../../core';
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
        columns={['ref', 'title', 'meeting_id', 'outcome', 'resolution_number', { field: 'vote_summary', priority: 3 }, { field: 'mover_name', hidden: true },
          { field: 'seconder_name', hidden: true }, { field: 'applied_at', hidden: true }, 'created_at']}
        filters={['outcome', 'meeting_id', 'closed_session', 'applied_at', 'created_at']}
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

/** An approved decision without a resolution number gets the committee's next one. */
function NumberButton({ row, reload }: { row: Row; reload: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (row.resolution_number || row.outcome !== 'approved' || !can('governance.edit')) return null;
  const give = async () => {
    setBusy(true);
    try { const r = await api.post<Row>(`/api/meeting-decisions/${row.id}/resolution-number`); toast.success(`Resolution number ${r.resolution_number} given.`); reload(); }
    catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button loading={busy} onClick={give}>Give the next resolution number</Button>;
}

export function DecisionDetail() {
  return (
    <RecordPage
      type="meeting_decision"
      actions={({ row, reload }) => <NumberButton row={row} reload={reload} />}
      summary={({ row, reload }) => (
        <div className="gv-summary">
          <EditableSummary type="meeting_decision" row={row} onSaved={reload} title="Decision" editable={row.applied_at ? false : undefined}
            fields={['title', 'meeting_id', 'outcome', 'resolution_number', 'motion_text', 'notes', 'applied_to_workflow', 'applied_at', 'applied_by']} />
          <EditableSummary type="meeting_decision" row={row} onSaved={reload} title="Motion and vote" editable={false}
            fields={['mover_name', 'seconder_name', 'vote_summary', 'closed_session', 'consent_agenda', 'recorded_by_name']} />
          <DecidedRecord decision={row} onApplied={reload} />
        </div>
      )}
    />
  );
}
