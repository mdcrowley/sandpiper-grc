// Vehicles: the fleet list and one vehicle's page. Bulk import uses the list's Import button
// (the core import wizard): choose "Fleet number" as the matching key to update existing vehicles.
// The Condition tab (asset condition, E32) comes from the condition module when it is in the build
// and its area is on; the condition columns are offered only while the server lists their fields.
import { lazy, Suspense, type ComponentType } from 'react';
import { Loading, PageHeader, RecordPage, ResourceList, useAuth, useResource } from '../../core';
import { EquipmentPanel } from './Equipment';
import { SafetyEventsCard } from './SafetyEvents';
import { FleetTabs } from './shared';
import { ListExtensionActions, useBulkExtensions, useExtensionTabs } from '../inventory/Extensions';

const year = (row: Record<string, unknown>) => (row.model_year ? String(row.model_year) : '—');

// The condition section lives in the condition module; load it only when that file is in the build.
type SectionProps = { recordType: 'vehicle'; recordId: string };
const sectionLoaders = import.meta.glob<{ ConditionSection: ComponentType<SectionProps> }>('../condition/shared.tsx');
const loadSection = Object.values(sectionLoaders)[0];
const LazySection = loadSection ? lazy(() => loadSection().then((m) => ({ default: m.ConditionSection }))) : null;

const CONDITION_COLUMNS = ['asset_class_id', 'condition_rating', 'useful_life_end', 'odometer_miles'];

export function VehicleList() {
  const resource = useResource('vehicle');
  const bulkActions = useBulkExtensions('vehicle');
  // Columns of the condition area only while the server offers their fields (it hides them while the area is off).
  const condition = CONDITION_COLUMNS.filter((f) => resource?.fields[f]).map((field) => ({ field, hidden: true }));
  return (
    <div className="stack">
      <PageHeader title="Vehicles" subtitle="Every vehicle in the fleet, where it is kept and what state it is in." />
      <FleetTabs active="vehicles" />
      <ResourceList
        type="vehicle"
        urlState
        columns={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model',
          { field: 'model_year', label: 'Model year', sortable: true, align: 'right', render: year },
          { field: 'registration', hidden: true }, { field: 'funder_interest', hidden: true }, ...condition]}
        filters={['mode', 'status', 'depot_id', 'funding_source', 'funder_interest', 'in_service_date',
          ...['asset_class_id', 'condition_rating', 'useful_life_end'].filter((f) => resource?.fields[f])]}
        createFields={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
        actions={<ListExtensionActions recordType="vehicle" />}
        bulkActions={bulkActions}
      />
    </div>
  );
}

export function VehicleDetail() {
  const { can, areaOn } = useAuth();
  const condition = LazySection && areaOn('condition') && can('assets.view');
  // Panels of optional modules (wave 13: the Tags panel), each an extra tab.
  const extensionTabs = useExtensionTabs('vehicle');
  return (
    <RecordPage
      type="vehicle"
      title={(row) => `Vehicle ${row.fleet_number}`}
      summaryFields={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
      tabs={[
        { key: 'equipment', label: 'Equipment', content: ({ row }) => <EquipmentPanel vehicleId={row.id} fleetNumber={row.fleet_number} retired={row.status === 'retired'} /> },
        ...(condition && LazySection ? [{
          key: 'condition', label: 'Condition',
          content: ({ row }: { row: { id: string } }) => <Suspense fallback={<Loading lines={3} />}><LazySection recordType="vehicle" recordId={row.id} /></Suspense>,
        }] : []),
        ...extensionTabs,
        ...(can('safety.view') ? [{ key: 'safety', label: 'Safety events', content: ({ row }: { row: { id: string } }) => <SafetyEventsCard url={`/api/vehicles/${row.id}/safety-events`} /> }] : []),
      ]}
    />
  );
}
