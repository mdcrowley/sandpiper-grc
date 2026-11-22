-- OT and rail-systems security (E33): security zones and the conduits between them, each with a
-- target and an achieved security level. Systems and assets point at their zone through
-- `zone_id` (inventory migration 004). Sites, users and zones of other modules: plain uuid columns.

create table ot_zones (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  description text,
  site_id uuid,
  owner_id uuid,
  criticality text,
  target_level text,
  achieved_level text,
  level_assessed_on date,
  notes text,
  -- Restricted zones (and every conduit touching one) need security.view.
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table ot_conduits (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  from_zone_id uuid not null,
  to_zone_id uuid not null,
  protocols text,
  protections text,
  remote_access boolean not null default false,
  target_level text,
  achieved_level text,
  notes text,
  -- Set by the application: true when either zone is restricted.
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index ot_conduits_from_ix on ot_conduits (from_zone_id) where deleted_at is null;
create index ot_conduits_to_ix on ot_conduits (to_zone_id) where deleted_at is null;
