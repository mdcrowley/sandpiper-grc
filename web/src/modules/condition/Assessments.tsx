// Condition assessments (E32-02): every dated rating of a vehicle, asset or site. They are recorded
// from the record's own page (its Condition section); this list finds and exports them.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Button, errorMessage, PageHeader, RecordPage, ResourceList, useAuth, useToast } from '../../core';
import type { RecordContext } from '../../core';
import { ConditionTabs, isTargetType, TARGET_INFO, useTargetWords } from './shared';

export function AssessmentList() {
  const words = useTargetWords();
  return (
    <div className="stack">
      <PageHeader title="Condition assessments" subtitle={`Every condition rating, newest first. Record one from the ${words.singularOr} page.`} />
      <ConditionTabs active="assessments" />
      <ResourceList
        type="condition_assessment"
        urlState
        columns={['ref', 'target_label', 'target_type', 'rating', 'assessed_on', 'class_id', 'method', 'assessor_id', { field: 'assessor_name', hidden: true }]}
        filters={['target_type', 'rating', 'class_id', 'method', 'assessor_id', 'assessed_on']}
        bulkFields={[]}
      />
    </div>
  );
}

function RaiseAction({ row }: { row: RecordContext['row'] }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const raise = async () => {
    setBusy(true);
    try {
      const action = await api.post<{ id: string }>(`/api/condition-assessments/${row.id}/action`, {});
      toast.success('Action raised.');
      navigate(`/actions/${action.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button icon="plus" loading={busy} onClick={raise}>Raise an action</Button>;
}

export function AssessmentDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="condition_assessment"
      title={(row) => `Condition of ${row.target_label ?? 'a record'}`}
      actions={({ row }) => (can('actions.create') ? <RaiseAction row={row} /> : null)}
      banner={({ row }) => (isTargetType(row.target_type)
        ? <p className="muted cnd-hint">Rates <Link to={`${TARGET_INFO[row.target_type].path}/${row.target_id}`}>{row.target_label ?? 'the record'}</Link>. The newest assessment of a record is shown on its page.</p>
        : null)}
      summaryFields={['target_type', 'target_label', 'class_id', 'assessed_on', 'rating', 'method', 'assessor_id', 'assessor_name', 'notes']}
    />
  );
}
