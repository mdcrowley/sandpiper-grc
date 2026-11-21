// Systems list and the system record (a fact sheet with its relationships).
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { LookupChip, RecordPage, ResourceList, useAuth, useFetch, useResource } from '../../core';
import { useExtensionTabs } from './Extensions';
import { RelatedWork } from './shared';
import { factChecks, FactSheet, FactStrip } from './SystemFacts';
import { SystemMapTab } from './SystemMap';
import { DataHeldTab, IntegrationsTab, SitesServed, SystemAssetsTab } from './SystemTabs';

export function SystemList() {
  return (
    <ResourceList
      type="system"
      title="Systems"
      columns={[
        'ref', 'name', 'system_group', 'status', 'criticality_tier', 'hosting_type', 'mfa_status', 'business_owner_id',
        { field: 'technical_owner_id', hidden: true },
        { field: 'vendor_name', hidden: true },
        { field: 'rto_hours', label: 'Recovery time (h)', hidden: true },
        { field: 'rpo_hours', label: 'Recovery point (h)', hidden: true },
        { field: 'updated_at', hidden: true },
      ]}
      filters={['status', 'criticality_tier', 'hosting_type', 'mfa_status', 'business_owner_id', 'technical_owner_id', 'vendor_id']}
      bulkFields={['status', 'criticality_tier', 'hosting_type', 'mfa_status', 'business_owner_id', 'technical_owner_id']}
      createFields={['name', 'function', 'system_group', 'status', 'criticality_tier', 'hosting_type', 'business_owner_id', 'technical_owner_id', 'vendor_name']}
      actions={<Link className="btn btn-secondary" to="/systems/map">Relationship map</Link>}
      defaultSort={{ field: 'name', dir: 'asc' }}
      pageSize={50}
    />
  );
}

export function SystemDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const resource = useResource('system');
  const [, setSearch] = useSearchParams();
  // Which fact card is open for editing: set from the nudges in the strip as well as the cards.
  const [editKey, setEditKey] = useState<string | null>(null);
  // Loaded here for the tab counts and the completeness check; the tabs reload them after a change.
  const integrations = useFetch<unknown[]>(id ? `/api/systems/${id}/integrations` : null);
  const data = useFetch<unknown[]>(id && can('data.view') ? `/api/systems/${id}/data-categories` : null);
  const dataCount = can('data.view') ? data.data?.length ?? 0 : undefined;
  const openTab = (tab: string) => setSearch((p) => { p.set('tab', tab); return p; }, { replace: true });
  // Tabs from optional modules (Extensions.tsx; wave 11 contract C2).
  const extensionTabs = useExtensionTabs('system');

  return (
    <RecordPage
      type="system"
      subtitle={(row) => [row.system_group, row._display?.vendor_id ?? row.vendor_name].filter(Boolean).join(' · ') || undefined}
      status={(row) => (
        <span className="row">
          {row.status && <LookupChip list="system_status" value={row.status} />}
          {row.criticality_tier && <LookupChip list="criticality_tier" value={row.criticality_tier} />}
        </span>
      )}
      actions={({ row }) => <Link className="btn btn-secondary" to={`/systems/map?focus=${row.id}`}>Show on map</Link>}
      summary={({ row, canEdit }) => (
        <FactStrip
          row={row} canEdit={canEdit} checks={factChecks(row, resource, dataCount)}
          onFill={(check) => {
            if (check.section === 'data') { openTab('data'); return; }
            openTab('facts');
            setEditKey(check.section);
          }}
        />
      )}
      tabs={[
        {
          key: 'facts', label: 'Fact sheet',
          content: ({ row, reload, canEdit }) => (
            <div className="stack">
              <FactSheet row={row} checks={factChecks(row, resource, dataCount)} editKey={editKey} setEditKey={setEditKey} onSaved={reload} />
              <SitesServed systemId={row.id} canEdit={canEdit} />
            </div>
          ),
        },
        {
          key: 'integrations', label: 'Integrations', count: integrations.data?.length || undefined,
          content: ({ row, canEdit }) => <IntegrationsTab systemId={row.id} canEdit={canEdit} onChanged={integrations.reload} />,
        },
        {
          key: 'data', label: 'Data held', count: data.data?.length || undefined,
          content: ({ row, canEdit }) => <DataHeldTab systemId={row.id} canEdit={canEdit} recorded={row.sensitive_data_held} onChanged={data.reload} />,
        },
        { key: 'assets', label: 'Assets', content: ({ row }) => <SystemAssetsTab systemId={row.id} /> },
        { key: 'work', label: 'Changes and issues', content: ({ row }) => <RelatedWork field="system_id" id={row.id} noun="system" /> },
        { key: 'map', label: 'Map', content: ({ row }) => <SystemMapTab systemId={row.id} name={row.name} /> },
        ...extensionTabs,
      ]}
    />
  );
}
