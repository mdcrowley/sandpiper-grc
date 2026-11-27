// Deficiencies a funder found in a compliance review, each corrected through a corrective action plan.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, Card, errorMessage, PageHeader, RecordPage, ResourceList, useAuth, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { capsInBuild, DeficiencyCaps, Evidence, evidenceInBuild, FundingTabs } from './shared';

export function DeficiencyList() {
  return (
    <div className="stack">
      <PageHeader title="Review deficiencies" subtitle="What funders found in their compliance reviews, and how each finding is being corrected." />
      <FundingTabs active="deficiencies" />
      <ResourceList
        type="review_deficiency"
        urlState
        columns={['ref', 'title', 'review_id', 'area_code', 'status', 'owner_id', 'due_on', 'cap_id', { field: 'closed_on', hidden: true }]}
        filters={['status', 'review_id', 'owner_id', 'due_on']}
        createFields={['title', 'review_id', 'area_code', 'description', 'required_action', 'owner_id', 'due_on']}
      />
    </div>
  );
}

function Actions({ row, canEdit, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const caps = useResource('cap');
  const [busy, setBusy] = useState(false);
  if (!canEdit || !caps || !can('actions.create') || row.cap_id || row.status === 'closed') return null;
  const raise = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ cap_id: string; route: string }>(`/api/review-deficiencies/${row.id}/cap`);
      toast.success('Corrective action plan raised. Add its actions there.');
      reload();
      navigate(r.route);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button variant="primary" loading={busy} onClick={raise}>Raise a corrective action plan</Button>;
}

export function DeficiencyDetail() {
  const caps = useResource('cap');
  const { areaOn } = useAuth();
  const evidence = evidenceInBuild && areaOn('evidence')
    ? [{ key: 'evidence', label: 'Closure evidence', content: ({ row }: RecordContext) => <Evidence recordType="review_deficiency" recordId={String(row.id)} title="Closure evidence" /> }]
    : [];
  return (
    <RecordPage
      type="review_deficiency"
      breadcrumbs={[{ label: 'Funding', to: '/funding' }, { label: 'Deficiencies', to: '/funding/deficiencies' }]}
      actions={(rec) => <Actions {...rec} />}
      banner={({ row }) => (row.status !== 'closed' && row.cap_id
        ? <p className="notice">This deficiency closes by itself when its corrective action plan closes (its actions done and verified).</p>
        : null)}
      summaryFields={['title', 'review_id', 'area_code', 'status', 'owner_id', 'due_on', 'description', 'required_action', 'cap_id', 'closed_on']}
      tabs={[
        ...(caps && capsInBuild
          ? [{ key: 'caps', label: 'Corrective action plans', content: ({ row }: RecordContext) => <DeficiencyCaps deficiencyId={row.id} /> }]
          : [{ key: 'caps', label: 'Corrective action plans', content: () => <Card title="Corrective action plans"><p className="muted">Corrective action plans are not part of this installation.</p></Card> }]),
        ...evidence,
      ]}
    />
  );
}
