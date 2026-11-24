-- E41-06: registers an administrator defines.
--
-- One row per register (its name, numbering, place in the menu). The records of every register live
-- in one shared table, register_records, so that backups, exports and restores carry them like any
-- other rows; each register's record type reads them through a view of its own (reg_<key>, created by
-- the module when the register is defined: `select * from register_records where register_key = '<key>'`).
-- The fields an administrator adds are custom fields of that record type, kept in `custom`.
-- Never drop or rename a column of register_records without recreating those views first.

create table if not exists register_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  plural text not null,
  description text not null default '',
  prefix text not null,
  nav_group text not null default 'Governance',
  icon text not null default 'folder',
  title_label text not null default 'Title',
  evidence boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

create table if not exists register_records (
  id uuid primary key default gen_random_uuid(),
  register_key text not null,
  ref text,
  title text not null,
  status text,
  owner_id uuid,
  department_id uuid,
  site_id uuid,
  description text,
  custom jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create index if not exists register_records_key_created on register_records (register_key, created_at desc) where deleted_at is null;
create index if not exists register_records_key_ref on register_records (register_key, ref);
