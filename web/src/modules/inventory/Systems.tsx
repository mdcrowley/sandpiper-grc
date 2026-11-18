// Systems list and system record.
import { Link } from 'react-router-dom';
import { EditableSummary, LookupChip, RecordPage, ResourceList } from '../../core';
import { SystemMapTab } from './SystemMap';
import { DataHeldTab, IntegrationsTab, SitesServed, SystemAssetsTab } from './SystemTabs';

export function SystemList() {
  return (
    <ResourceList
      type="system"
      title="Systems"
      columns={['ref', 'name', 'system_group', 'vendor_name', 'status', 'criticality_tier', 'hosting_type', 'mfa_status', 'business_owner_id']}
      filters={['status', 'criticality_tier', 'hosting_type', 'mfa_status', 'business_owner_id', 'technical_owner_id']}
      createFields={['name', 'system_group', 'vendor_name', 'function', 'status', 'criticality_tier', 'hosting_type', 'business_owner_id', 'technical_owner_id']}
      actions={<Link className="btn btn-secondary" to="/systems/map">Relationship map</Link>}
      pageSize={50}
    />
  );
}

const SUMMARY = [
  'name', 'system_group', 'status', 'criticality_tier', 'function', 'users',
  'business_owner_id', 'technical_owner_id', 'vendor_name', 'vendor_id', 'contract_id',
];
const HOSTING = ['hosting_type', 'hosting_provider', 'hosting_region', 'hosting_notes'];
const RESILIENCE = ['rto_hours', 'rpo_hours', 'manual_fallback', 'authentication_method', 'mfa_status', 'planned_replacement'];
const RECORDED = ['status_outlook', 'sensitive_data_held', 'agreement_on_file', 'source', 'to_confirm', 'notes'];

export function SystemDetail() {
  return (
    <RecordPage
      type="system"
      subtitle={(row) => [row.system_group, row.vendor_name].filter(Boolean).join(' · ') || undefined}
      status={(row) => (
        <span className="row">
          {row.status && <LookupChip list="system_status" value={row.status} />}
          {row.criticality_tier && <LookupChip list="criticality_tier" value={row.criticality_tier} />}
        </span>
      )}
      actions={() => <Link className="btn btn-secondary" to="/systems/map">Relationship map</Link>}
      summaryFields={SUMMARY}
      tabs={[
        {
          key: 'overview', label: 'Overview',
          content: ({ row, reload, canEdit }) => (
            <div className="stack">
              <div className="grid-2">
                <EditableSummary type="system" row={row} fields={HOSTING} title="Hosting" onSaved={reload} />
                <EditableSummary type="system" row={row} fields={RESILIENCE} title="Recovery and sign-in" onSaved={reload} />
              </div>
              <EditableSummary type="system" row={row} fields={RECORDED} title="As recorded in the source inventory" onSaved={reload} />
              <SitesServed systemId={row.id} canEdit={canEdit} />
            </div>
          ),
        },
        { key: 'integrations', label: 'Integrations', content: ({ row, canEdit }) => <IntegrationsTab systemId={row.id} canEdit={canEdit} /> },
        { key: 'data', label: 'Data held', content: ({ row, canEdit }) => <DataHeldTab systemId={row.id} canEdit={canEdit} recorded={row.sensitive_data_held} /> },
        { key: 'assets', label: 'Assets', content: ({ row }) => <SystemAssetsTab systemId={row.id} /> },
        { key: 'map', label: 'Map', content: ({ row }) => <SystemMapTab systemId={row.id} name={row.name} /> },
      ]}
    />
  );
}
