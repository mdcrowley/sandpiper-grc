-- Asset models (E39): an asset may point at an asset model (modules/models) and takes the model's
-- shared values into its own columns, so lists, filters, reports and search keep working unchanged.
-- `model_overrides` lists the inherited fields this asset keeps its own value for.
alter table assets add column if not exists model_id uuid;
alter table assets add column if not exists model_overrides jsonb not null default '[]';
create index if not exists assets_model_ix on assets (model_id) where deleted_at is null and model_id is not null;
