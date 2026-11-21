// Findings from audits and inspections: the list across every source, and one finding with its
// response, and the corrective action plan and hazard it raised.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, Button, Card, EditableSummary, errorMessage, PageHeader, RecordPage, ResourceList, useAuth, useResource, useToast,
} from '../../core';
import type { RecordContext } from '../../core';
import { AuditTabs, FindingCaps, sourceLabel, sourceRoute } from './shared';

export function FindingList() {
  return (
    <div className="stack">
      <PageHeader title="Audit findings" subtitle="Findings from audits and inspections, with their rating, the management response and the plan that puts them right." />
      <AuditTabs active="findings" />
      <ResourceList
        type="audit_finding"
        urlState
        columns={['ref', 'title', 'rating', 'status', 'response_owner_id', 'response_due', 'cap_id', { field: 'source_type', label: 'Raised on', render: (r) => sourceLabel(r.source_type) }, { field: 'responded_on', hidden: true }]}
        filters={['rating', 'status', 'response_owner_id', 'response_due', 'source_type']}
      />
    </div>
  );
}

function Raise({ row, reload }: RecordContext) {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const cap = useResource('cap');
  const hazard = useResource('hazard');
  const [busy, setBusy] = useState<string | null>(null);
  if (!can('audits.edit')) return null;
  const raise = async (what: 'cap' | 'hazard') => {
    setBusy(what);
    try {
      const res = await api.post<{ cap?: { route: string | null }; hazard?: { route: string } }>(`/api/audit-findings/${row.id}/${what}`, {});
      toast.success(what === 'cap' ? 'Corrective action plan raised.' : 'Hazard added to the hazard log.');
      reload();
      const route = what === 'cap' ? res.cap?.route : res.hazard?.route;
      if (route) navigate(route);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(null); }
  };
  return (
    <>
      {cap && can('actions.create') && !row.cap_id && (
        <Button variant="primary" loading={busy === 'cap'} onClick={() => raise('cap')}>Raise a corrective action plan</Button>
      )}
      {hazard && can('safety.create') && !row.hazard_id && (
        <Button loading={busy === 'hazard'} onClick={() => raise('hazard')}>Add to the hazard log</Button>
      )}
    </>
  );
}

export function FindingDetail() {
  return (
    <RecordPage
      type="audit_finding"
      subtitle={(row) => <Link to={sourceRoute(row.source_type, row.source_id)}>Open the {sourceLabel(row.source_type).toLowerCase()} it was raised on</Link>}
      actions={(rec) => <Raise {...rec} />}
      summary={(rec) => (
        <div className="stack">
          <EditableSummary type="audit_finding" row={rec.row} onSaved={rec.reload} title="Finding"
            fields={['title', 'rating', 'criteria', 'condition', 'cause', 'effect', 'recommendation', 'status']} />
          <EditableSummary type="audit_finding" row={rec.row} onSaved={rec.reload} title="Management response"
            fields={['management_response', 'response_owner_id', 'response_due', 'responded_on', 'cap_id', 'hazard_id']} />
        </div>
      )}
      tabs={[{
        key: 'plan', label: 'Corrective action plan',
        content: ({ row }) => (
          <div className="stack">
            <FindingCaps findingId={row.id} source={row.source_type === 'inspection' ? 'inspection' : 'audit'} />
            <Card title="How findings are put right">
              <p className="muted">Record the management response above. For anything more than a quick fix, raise a corrective action plan: its actions, approval and verification of effectiveness are kept with the plan.</p>
            </Card>
          </div>
        ),
      }]}
    />
  );
}
