-- E41-15: the organization's records retention schedule and its destruction log. This is about the
-- organization's own business records (paper files and electronic records in its systems), not about
-- this application's data, whose retention is core (Administration > Retention).

-- One record series: a group of records kept and disposed of together ("Vehicle maintenance work
-- orders"), with how long it is kept after which event, and what happens at the end.
create table record_series (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  code text,                       -- the organization's own schedule item number, if it has one
  title text not null,
  description text,
  category text,                   -- lookup record_series_category
  medium text not null default 'paper',          -- lookup record_medium: paper | electronic | both
  status text not null default 'active',         -- lookup record_series_status: draft | active | retired
  owner_id uuid,
  department_id uuid,
  location text,                   -- where the records are kept (a file room, an off-site store, a system)
  system_id uuid,                  -- for electronic records: the system holding them
  retention_value numeric,         -- how long, in retention_unit; null with permanent
  retention_unit text not null default 'years',  -- lookup retention_unit: days | months | years
  permanent boolean not null default false,
  trigger_event text not null default 'created', -- lookup retention_trigger
  trigger_note text,
  disposition text not null default 'destroy',   -- lookup record_disposition: destroy | transfer | review
  authority text,                  -- the law, rule or policy that sets the period, as the organization cites it
  vital boolean not null default false,
  personal_data boolean not null default false,
  review_on date,                  -- when the entry is next reviewed
  notes text,
  custom jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index record_series_status_ix on record_series (status) where deleted_at is null;
create index record_series_review_ix on record_series (review_on) where deleted_at is null;

-- One destruction (or transfer) of a batch of records of a series: proposed, approved through the
-- "Records destruction" approval workflow, then carried out and recorded with its certificate.
create table records_destructions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  series_id uuid not null,
  description text,
  medium text,                     -- lookup record_medium
  records_from date,               -- the dates the records cover
  records_to date,
  trigger_date date,               -- when the series' trigger event happened for this batch
  eligible_on date,                -- trigger_date plus the series' period (set by the server)
  quantity text,                   -- "14 boxes", "3,200 files"
  location text,
  method text,                     -- lookup destruction_method
  status text not null default 'proposed',       -- lookup destruction_status
  requested_by uuid,
  approved_on date,
  approved_by_name text,
  decision_note text,
  carried_out_on date,
  carried_out_by text,             -- a person or a destruction service, as written
  witness_id uuid,
  certificate_ref text,
  notes text,
  custom jsonb not null default '{}',
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index records_destructions_series_ix on records_destructions (series_id) where deleted_at is null;
create index records_destructions_status_ix on records_destructions (status) where deleted_at is null;
