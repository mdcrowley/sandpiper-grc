-- Vulnerability findings, import batches, saved column mappings and weekly trend snapshots.

create table vulnerabilities (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  description text,
  host_name text,
  host_ip text,
  -- Lower-case host name (or address when there is no name): half of the duplicate key.
  host_key text not null default '',
  port text,
  service text,
  plugin_id text,
  cves text,
  -- Scanner finding id, else the CVE list, else the title: the other half of the duplicate key.
  finding_key text not null default '',
  severity text not null,
  cvss numeric,
  known_exploited boolean not null default false,
  first_seen date not null,
  last_seen date,
  owner_id uuid,
  system_id uuid,
  asset_id uuid,
  status text not null default 'open',
  -- Copied from the status list (meta.closed) whenever the status changes.
  closed boolean not null default false,
  due_on date,
  due_override_on date,
  due_override_reason text,
  fixed_on date,
  exception_id uuid,
  acceptance_justification text,
  acceptance_approver_id uuid,
  false_positive_reason text,
  solution text,
  remediation_notes text,
  source text,
  import_batch_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vulnerabilities_key_idx on vulnerabilities (host_key, finding_key) where deleted_at is null;
create index vulnerabilities_open_idx on vulnerabilities (severity) where deleted_at is null and not closed;
create index vulnerabilities_batch_idx on vulnerabilities (import_batch_id);

-- The record type reads and writes through this view, which adds the two values that
-- depend on today's date. It is a simple single-table view, so inserts and updates pass
-- straight through to the table.
create view vulnerability_records as
select v.*,
  (coalesce(v.fixed_on, current_date) - v.first_seen) as age_days,
  (not v.closed and v.due_on is not null and v.due_on < current_date) as overdue
from vulnerabilities v;

create table vulnerability_import_batches (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  file_name text,
  preset_name text,
  close_missing boolean not null default false,
  mapping jsonb not null default '{}'::jsonb,
  total_rows integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  reopened_count integer not null default 0,
  closed_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  unmatched_hosts jsonb not null default '[]'::jsonb,
  imported_by uuid,
  imported_by_name text,
  imported_at timestamptz not null default now()
);
create index vulnerability_import_batches_at_idx on vulnerability_import_batches (imported_at desc);

create table vulnerability_mapping_presets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source text,
  delimiter text not null default ',',
  mapping jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index vulnerability_mapping_presets_name_idx on vulnerability_mapping_presets (lower(name)) where deleted_at is null;

-- Open findings at the end of each week (week_start is the Monday), one row per severity.
create table vulnerability_snapshots (
  week_start date not null,
  severity text not null,
  open_count integer not null default 0,
  overdue_count integer not null default 0,
  taken_at timestamptz not null default now(),
  primary key (week_start, severity)
);
