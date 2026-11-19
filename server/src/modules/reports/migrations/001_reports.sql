-- Reporting: saved reports, dashboards, schedules, packs, stored snapshots and the delivery log.
-- No foreign keys to other modules' tables: record types are named by key and resolved at run time.

create table report_definitions (
  id uuid primary key default gen_random_uuid(),
  key text unique,                     -- set on the standard reports the seed creates, null otherwise
  name text not null,
  description text,
  record_type text not null,
  spec jsonb not null default '{}',
  chart jsonb not null default '{}',
  owner_id uuid,                       -- null = a standard (shipped) report
  sharing text not null default 'private',
  shared_roles jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table dashboards (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  description text,
  layout jsonb not null default '{}',
  widgets jsonb not null default '[]',
  filters jsonb not null default '[]',
  refresh_seconds numeric,
  owner_id uuid,
  sharing text not null default 'private',
  shared_roles jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Each person's chosen home dashboard (a personal view setting).
create table dashboard_home (
  user_id uuid primary key,
  dashboard_id uuid not null,
  updated_at timestamptz not null default now()
);

create table report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  target_type text not null default 'report',   -- report | dashboard
  target_id text not null,
  cadence text not null default 'weekly',       -- daily | weekly | monthly
  weekday numeric,                              -- 1 (Monday) to 7 (Sunday), weekly
  month_day numeric,                            -- 1 to 31, monthly (clamped to the month's length)
  hour numeric not null default 7,              -- hour of the day in the organisation time zone
  format text not null default 'html',          -- html | csv
  recipient_users jsonb not null default '[]',
  recipient_roles jsonb not null default '[]',
  active boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  owner_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table report_packs (
  id uuid primary key default gen_random_uuid(),
  key text unique,
  name text not null,
  description text,
  cover_title text,
  cover_subtitle text,
  sections jsonb not null default '[]',
  owner_id uuid,
  sharing text not null default 'private',
  shared_roles jsonb not null default '[]',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- A rendered document frozen at a moment in time. The bytes live in the attachments file store
-- when that module is loaded (storage_key), otherwise in `content`.
create table report_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,            -- report | dashboard | pack
  source_id uuid not null,
  schedule_id uuid,
  title text not null,
  format text not null default 'html',
  for_user_id uuid not null,            -- whose permissions the figures were worked out with
  record_types jsonb not null default '[]',
  restricted boolean not null default false,
  storage_driver text,
  storage_key text,
  content text,
  size_bytes numeric not null default 0,
  created_at timestamptz not null default now()
);
create index report_snapshots_user on report_snapshots (for_user_id, created_at desc);
create index report_snapshots_source on report_snapshots (source_type, source_id, created_at desc);

create table report_deliveries (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null,
  user_id uuid,
  snapshot_id uuid,
  channel text not null default 'in_app',
  status text not null,                 -- delivered | skipped | failed
  detail text,
  created_at timestamptz not null default now()
);
create index report_deliveries_schedule on report_deliveries (schedule_id, created_at desc);
