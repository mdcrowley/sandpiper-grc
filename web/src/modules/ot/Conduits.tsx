// Conduits (E33-02): the ways data passes between two security zones, with their levels and whether
// they allow remote access. A conduit is restricted whenever either of its zones is.
import { EditableSummary, PageHeader, RecordPage, ResourceList, useAuth } from '../../core';
import type { RecordTab } from '../../core';
import { actionsInBuild, OtActions, OtTabs } from './shared';

const FIELDS = ['name', 'from_zone_id', 'to_zone_id', 'protocols', 'protections', 'remote_access', 'target_level', 'achieved_level', 'notes'];

export function ConduitList() {
  return (
    <div className="stack">
      <PageHeader title="Conduits" subtitle="The ways data passes between security zones: what flows, how it is protected and whether it allows remote access." />
      <OtTabs active="conduits" />
      <ResourceList
        type="ot_conduit"
        urlState
        columns={['ref', 'name', { field: 'from_zone_id', priority: 1 }, { field: 'to_zone_id', priority: 1 }, 'remote_access', 'target_level', 'achieved_level', { field: 'protocols', hidden: true }, { field: 'restricted', hidden: true }]}
        filters={['remote_access', 'from_zone_id', 'to_zone_id', 'target_level', 'achieved_level']}
        createFields={FIELDS.filter((f) => f !== 'notes')}
      />
    </div>
  );
}

export function ConduitDetail() {
  const { can } = useAuth();
  const tabs: RecordTab[] = actionsInBuild && can('actions.view')
    ? [{ key: 'actions', label: 'Actions', content: ({ row }) => <OtActions sourceType="ot_conduit" sourceId={String(row.id)} source="ot" /> }]
    : [];
  return (
    <RecordPage
      type="ot_conduit"
      status={(row) => (
        <span className="row">
          {row.remote_access && <span className="chip chip-orange">Remote access</span>}
          {row.restricted && <span className="chip chip-red" title="One of its zones is restricted">Restricted</span>}
        </span>
      )}
      summary={(rec) => (
        <EditableSummary type="ot_conduit" row={rec.row} onSaved={rec.reload} title="Conduit" fields={FIELDS} customFields />
      )}
      tabs={tabs}
    />
  );
}
