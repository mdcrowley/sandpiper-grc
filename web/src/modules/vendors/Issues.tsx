// The vendor issues register (E35-03): problems with vendors, tracked to resolution, each of which may
// raise a corrective action plan.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, Button, Card, errorMessage, RecordPage, ResourceList, useAuth, useResource, useToast } from '../../core';
import type { RecordContext } from '../../core';
import { capsInBuild, CapsTab } from './Lifecycle';

export function IssueList() {
  return (
    <div className="stack">
      <ResourceList
        type="vendor_issue"
        title="Vendor issues"
        urlState
        columns={['ref', 'title', 'vendor_id', 'category', 'severity', 'status', 'owner_id', 'raised_on', { field: 'contract_id', hidden: true }, { field: 'resolved_on', hidden: true }, { field: 'cap_id', hidden: true }]}
        filters={['status', 'severity', 'category', 'vendor_id', 'owner_id', 'raised_on']}
        bulkFields={['status', 'severity', 'owner_id']}
        createFields={['title', 'vendor_id', 'contract_id', 'category', 'severity', 'owner_id', 'raised_on', 'description']}
      />
    </div>
  );
}

function RaiseCap({ row, canEdit, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const caps = useResource('cap');
  const [busy, setBusy] = useState(false);
  if (!canEdit || !caps || !can('actions.create') || row.cap_id || row.status === 'resolved' || row.status === 'closed') return null;
  const raise = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ cap: { route: string | null } }>(`/api/vendor-issues/${row.id}/cap`);
      toast.success('Corrective action plan raised. Add its actions there.');
      reload();
      if (r.cap.route) navigate(r.cap.route);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Button variant="secondary" loading={busy} onClick={raise}>Raise a corrective action plan</Button>;
}

export function IssueDetail() {
  const caps = useResource('cap');
  return (
    <RecordPage
      type="vendor_issue"
      breadcrumbs={[{ label: 'Vendors', to: '/vendors' }, { label: 'Vendor issues', to: '/vendors/issues' }]}
      subtitle={(row) => (row.vendor_id ? <>Vendor: <Link to={`/vendors/${row.vendor_id}?tab=lifecycle`}>{row._display?.vendor_id ?? 'Open vendor'}</Link></> : null)}
      actions={(rec) => <RaiseCap {...rec} />}
      summaryFields={['title', 'vendor_id', 'contract_id', 'category', 'severity', 'status', 'owner_id', 'raised_on', 'description', 'resolution', 'resolved_on', 'cap_id']}
      tabs={caps && capsInBuild
        ? [{ key: 'caps', label: 'Corrective action plans', content: ({ row }) => <CapsTab sourceType="vendor_issue" sourceId={row.id} source="vendor" /> }]
        : [{ key: 'caps', label: 'Corrective action plans', content: () => <Card title="Corrective action plans"><p className="muted">Corrective action plans are not part of this installation.</p></Card> }]}
    />
  );
}
