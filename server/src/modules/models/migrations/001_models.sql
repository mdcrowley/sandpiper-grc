-- Vehicle and asset models (E39): shared specifications that vehicles and assets inherit.
-- Members keep the inherited values in their own columns (fleet/004, inventory/008); these tables hold
-- the models, the equipment a vehicle model adds to its mode's required equipment, and a log of each
-- change applied to the members. Vehicles, assets and asset classes belong to other modules: plain
-- uuid columns, no cross-module keys.

create table vehicle_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  mode text,
  make text,
  model text,
  model_year integer,
  capacity integer,
  asset_class_id uuid,
  funding_source text,
  description text,
  active boolean not null default true,
  -- Values of the vehicles' custom fields marked "Inherited from the model", by custom field key.
  inherited_custom jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index vehicle_models_name_ux on vehicle_models (lower(name)) where deleted_at is null;

create table asset_models (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  asset_type text,
  make text,
  model text,
  vendor_id uuid,
  asset_class_id uuid,
  funding_source text,
  support_end date,
  description text,
  active boolean not null default true,
  inherited_custom jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index asset_models_name_ux on asset_models (lower(name)) where deleted_at is null;

-- Equipment a vehicle model adds to the equipment its mode requires (fleet.required_equipment):
-- a kind of equipment (asset type) and how many. With asset_model_id, only assets of that model count.
create table vehicle_model_equipment (
  id uuid primary key default gen_random_uuid(),
  vehicle_model_id uuid not null references vehicle_models(id),
  asset_type text not null,
  count integer not null default 1 check (count between 1 and 50),
  asset_model_id uuid,
  position integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid
);
create index vehicle_model_equipment_model_ix on vehicle_model_equipment (vehicle_model_id);

-- One row per change of a model applied to its members (or per bulk assignment): what changed, how
-- many members took it, which kept an override, and which refused it (a rule of their own).
create table model_changes (
  id uuid primary key default gen_random_uuid(),
  model_type text not null,
  model_id uuid not null,
  kind text not null default 'change',
  fields jsonb not null default '[]',
  status text not null default 'done',
  total integer not null default 0,
  applied integer not null default 0,
  kept integer not null default 0,
  refused jsonb not null default '[]',
  job_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  finished_at timestamptz
);
create index model_changes_model_ix on model_changes (model_type, model_id, created_at desc);
