// Vehicles: the fleet list and one vehicle's page. Bulk import uses the list's Import button
// (the core import wizard): choose "Fleet number" as the matching key to update existing vehicles.
import { PageHeader, RecordPage, ResourceList, useAuth } from '../../core';
import { EquipmentPanel } from './Equipment';
import { SafetyEventsCard } from './SafetyEvents';
import { FleetTabs } from './shared';

const year = (row: Record<string, unknown>) => (row.model_year ? String(row.model_year) : '—');

export function VehicleList() {
  return (
    <div className="stack">
      <PageHeader title="Vehicles" subtitle="Every vehicle in the fleet, where it is kept and what state it is in." />
      <FleetTabs active="vehicles" />
      <ResourceList
        type="vehicle"
        urlState
        columns={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model',
          { field: 'model_year', label: 'Model year', sortable: true, align: 'right', render: year },
          { field: 'registration', hidden: true }, { field: 'funder_interest', hidden: true }]}
        filters={['mode', 'status', 'depot_id', 'funding_source', 'funder_interest', 'in_service_date']}
        createFields={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
      />
    </div>
  );
}

export function VehicleDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="vehicle"
      title={(row) => `Vehicle ${row.fleet_number}`}
      summaryFields={['fleet_number', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
      tabs={[
        { key: 'equipment', label: 'Equipment', content: ({ row }) => <EquipmentPanel vehicleId={row.id} fleetNumber={row.fleet_number} retired={row.status === 'retired'} /> },
        ...(can('safety.view') ? [{ key: 'safety', label: 'Safety events', content: ({ row }: { row: { id: string } }) => <SafetyEventsCard url={`/api/vehicles/${row.id}/safety-events`} /> }] : []),
      ]}
    />
  );
}
