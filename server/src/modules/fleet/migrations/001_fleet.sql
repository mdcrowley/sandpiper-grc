-- Fleet: vehicles, the equipment installed on them (with install and removal history),
-- services (routes and lines) and the systems each service depends on.
-- Depots, assets and systems belong to the inventory module: plain uuid columns, no cross-module keys.

create table vehicles (
  id uuid primary key default gen_random_uuid(),
  fleet_number text not null,
  mode text,
  status text,
  make text,
  model text,
  model_year integer,
  registration text,
  depot_id uuid,
  in_service_date date,
  capacity integer,
  funding_source text,
  funder_interest boolean not null default false,
  funder_interest_pct numeric,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index vehicles_fleet_number_ux on vehicles (lower(fleet_number)) where deleted_at is null;
create index vehicles_depot_ix on vehicles (depot_id);

-- One row per installation. removed_on is null while the equipment is on the vehicle;
-- a piece of equipment is on at most one vehicle at a time.
create table vehicle_equipment (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id),
  asset_id uuid not null,
  installed_on date not null,
  install_notes text,
  removed_on date,
  removal_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  removed_at timestamptz, removed_by uuid
);
create unique index vehicle_equipment_current_ux on vehicle_equipment (asset_id) where removed_on is null;
create index vehicle_equipment_vehicle_ix on vehicle_equipment (vehicle_id);

create table services (
  id uuid primary key default gen_random_uuid(),
  route_code text not null,
  name text not null,
  mode text,
  service_type text,
  status text,
  depot_id uuid,
  description text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index services_route_code_ux on services (lower(route_code)) where deleted_at is null;

-- The systems a service depends on, and for what (CAD/AVL, fares, passenger information...).
create table service_systems (
  service_id uuid not null references services(id),
  system_id uuid not null,
  dependency text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  primary key (service_id, system_id)
);
create index service_systems_system_ix on service_systems (system_id);
