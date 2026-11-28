-- Planned maintenance (wave 27, E46-71): service intervals by miles, engine hours or days for the
-- vehicles of one vehicle model or one asset class, each vehicle's odometer and hour-meter readings
-- (its mileage history), and the services done. Vehicle models (models module) and asset classes
-- (condition module) are plain uuid columns, no cross-module keys.

create table if not exists maintenance_intervals (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  name text not null,
  description text,
  model_id uuid,
  asset_class_id uuid,
  every_miles numeric,
  every_hours numeric,
  every_days integer,
  warn_miles numeric,
  warn_hours numeric,
  warn_days integer,
  owner_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists maintenance_intervals_model_ix on maintenance_intervals (model_id) where deleted_at is null;
create index if not exists maintenance_intervals_class_ix on maintenance_intervals (asset_class_id) where deleted_at is null;

create table if not exists vehicle_readings (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  vehicle_id uuid not null references vehicles(id),
  read_on date not null,
  odometer_miles numeric,
  engine_hours numeric,
  source text,
  notes text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists vehicle_readings_vehicle_ix on vehicle_readings (vehicle_id, read_on desc) where deleted_at is null;

create table if not exists maintenance_records (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  vehicle_id uuid not null references vehicles(id),
  interval_id uuid references maintenance_intervals(id),
  done_on date not null,
  odometer_miles numeric,
  engine_hours numeric,
  work_order text,
  notes text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index if not exists maintenance_records_vehicle_ix on maintenance_records (vehicle_id, interval_id, done_on desc) where deleted_at is null;
