-- Vehicle models (E39): a vehicle may point at a vehicle model (modules/models) and takes the model's
-- shared values into its own columns, so lists, filters, reports and search keep working unchanged.
-- `model_overrides` lists the inherited fields this vehicle keeps its own value for.
alter table vehicles add column if not exists model_id uuid;
alter table vehicles add column if not exists model_overrides jsonb not null default '[]';
create index if not exists vehicles_model_ix on vehicles (model_id) where deleted_at is null and model_id is not null;
