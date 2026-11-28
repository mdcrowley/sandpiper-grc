// Vehicles: the fleet list and one vehicle's page. Bulk import uses the list's Import button
// (the core import wizard): choose "Fleet number" as the matching key to update existing vehicles.
// The Condition tab (asset condition, E32) comes from the condition module when it is in the build
// and its area is on; the condition columns are offered only while the server lists their fields.
import { lazy, Suspense, useState, type ComponentType } from 'react';
import { Button, Loading, PageHeader, RecordPage, ResourceList, useAuth, useResource } from '../../core';
import type { Row } from '../../core';
import { RetireDialog, RetirementTab } from './Retirement';
import { EquipmentPanel } from './Equipment';
import { SafetyEventsCard } from './SafetyEvents';
import { FleetTabs } from './shared';
import { ListExtensionActions, useBulkExtensions, useExtensionTabs } from '../inventory/Extensions';
import { MODEL_KINDS, modelAnnotate, useFromModel } from '../inventory/models';

const annotate = modelAnnotate(MODEL_KINDS.vehicle);

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
  // Wave 26: odometer, condition and the end of useful life show by default; the asset class stays in the chooser.
  const condition = CONDITION_COLUMNS.filter((f) => resource?.fields[f]).map((field) => ({ field, hidden: field === 'asset_class_id' }));
  // "New vehicle from this model" (E39-05): the New form opens filled with the model's values.
  const fromModel = useFromModel(MODEL_KINDS.vehicle);
  const withModel = Boolean(resource?.fields.model_id);
  if (fromModel.pending) return <Loading lines={6} label="Loading the vehicle model" />;
  return (
    <div className="stack">
      <PageHeader title="Vehicles" subtitle="Every vehicle in the fleet, where it is kept and what state it is in." />
      <FleetTabs active="vehicles" />
      <ResourceList
        type="vehicle"
        urlState
        columns={['fleet_number', 'mode', 'status', 'depot_id', { field: 'make', priority: 3 }, { field: 'model', priority: 3 },
          { field: 'model_year', label: 'Model year', sortable: true, align: 'right', render: year },
          { field: 'registration', hidden: true }, { field: 'funder_interest', hidden: true }, ...(withModel ? [{ field: 'model_id', hidden: true }] : []), ...condition]}
        filters={['mode', 'status', 'depot_id', 'model_id', 'funding_source', 'funder_interest', 'in_service_date',
          ...['asset_class_id', 'condition_rating', 'useful_life_end'].filter((f) => resource?.fields[f])]}
        createInitial={fromModel.initial}
        createFields={['fleet_number', 'model_id', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
        actions={<ListExtensionActions recordType="vehicle" />}
        bulkActions={bulkActions}
      />
    </div>
  );
}

function RetireButton({ row, reload }: { row: Row; reload: () => void }) {
  const { can } = useAuth();
  const [open, setOpen] = useState(false);
  const pending = row.retirement_request_status === 'pending' || row.retirement_request_status === 'approved';
  if (!can('fleet.edit') || row.status === 'retired' || pending) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Retire</Button>
      {open && <RetireDialog vehicle={row} onClose={() => setOpen(false)} onDone={() => { setOpen(false); reload(); }} />}
    </>
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
      annotate={annotate}
      // Wave 26: retiring a vehicle needs an approval, as disposing of an asset does.
      actions={({ row, reload }) => <RetireButton row={row} reload={reload} />}
      summaryFields={['fleet_number', 'model_id', 'mode', 'status', 'depot_id', 'make', 'model', 'model_year', 'registration', 'in_service_date', 'capacity', 'funding_source', 'funder_interest', 'funder_interest_pct', 'notes']}
      tabs={[
        { key: 'equipment', label: 'Equipment', content: ({ row }) => <EquipmentPanel vehicleId={row.id} fleetNumber={row.fleet_number} retired={row.status === 'retired'} /> },
        ...(condition && LazySection ? [{
          key: 'condition', label: 'Condition',
          content: ({ row }: { row: { id: string } }) => <Suspense fallback={<Loading lines={3} />}><LazySection recordType="vehicle" recordId={row.id} /></Suspense>,
        }] : []),
        ...extensionTabs,
        ...(can('safety.view') ? [{ key: 'safety', label: 'Safety events', content: ({ row }: { row: { id: string } }) => <SafetyEventsCard url={`/api/vehicles/${row.id}/safety-events`} /> }] : []),
        { key: 'retirement', label: 'Retirement', content: ({ row, reload }: { row: Row; reload: () => void }) => <RetirementTab vehicle={row} onChanged={reload} /> },
      ]}
    />
  );
}
