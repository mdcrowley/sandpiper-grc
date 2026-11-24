// Extension file (inventory/Extensions.tsx): "Set model" in the bulk bar of the vehicle and asset lists
// (E39-05). It gives the selected records a vehicle or asset model, after showing which of their values
// differ from the model's and letting the person keep them. The vehicle one follows Fleet and services.
import type { BulkActionDef, BulkActionProps } from './Extensions';
import { MODEL_KINDS, SetModelAction } from './models';

const SetVehicleModel = ({ rows, clear }: BulkActionProps) => <SetModelAction kind={MODEL_KINDS.vehicle} rows={rows} clear={clear} />;
const SetAssetModel = ({ rows, clear }: BulkActionProps) => <SetModelAction kind={MODEL_KINDS.asset} rows={rows} clear={clear} />;

export const bulkActions: BulkActionDef[] = [
  { key: 'set-vehicle-model', area: 'fleet', permission: 'fleet.edit', appliesTo: ['vehicle'], Action: SetVehicleModel },
  { key: 'set-asset-model', permission: 'assets.edit', appliesTo: ['asset'], Action: SetAssetModel },
];
