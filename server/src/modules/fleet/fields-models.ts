import type { FieldDef } from '../../core/module.ts';

/**
 * Vehicle models (E39-02, owned by the models work): a vehicle's model and the inherited fields it
 * keeps its own value for. Spread into the vehicle definition in `fleet/index.ts`; the columns are in
 * `fleet/migrations/004_vehicle_models.sql`. The models module (`modules/models`) fills the inherited
 * fields from the model when the vehicle is saved and when the model changes.
 */
export const VEHICLE_MODEL_FIELDS: Record<string, FieldDef> = {
  model_id: { label: 'Vehicle model', type: 'ref', to: 'vehicle_model' },
  model_overrides: { label: 'Values kept instead of the model\'s', type: 'json' },
};
