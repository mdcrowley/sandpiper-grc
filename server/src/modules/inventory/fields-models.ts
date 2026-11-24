import type { FieldDef } from '../../core/module.ts';

/**
 * Asset models (E39-02, owned by the models work): an asset's model and the inherited fields it keeps
 * its own value for. Spread into the asset definition in `inventory/index.ts`; the columns are in
 * `inventory/migrations/008_asset_models.sql`. The models module (`modules/models`) fills the
 * inherited fields from the model when the asset is saved and when the model changes.
 */
export const ASSET_MODEL_FIELDS: Record<string, FieldDef> = {
  model_id: { label: 'Asset model', type: 'ref', to: 'asset_model' },
  model_overrides: { label: 'Values kept instead of the model\'s', type: 'json' },
};
