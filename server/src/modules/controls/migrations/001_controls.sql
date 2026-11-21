-- Control library and control testing (E26). A control's coverage (the risks, hazards, framework
-- outcomes, obligations and policies it covers) is a generic record link with relation `covers`
-- (core table record_links), so it needs no table here. Users, corrective action plans and the
-- covered records belong to other modules: plain uuid columns.

create table controls (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  objective text,
  control_type text,
  automation text,
  frequency text,
  domain text,
  owner_id uuid,
  operator_id uuid,
  key_control boolean not null default false,
  status text,
  design_rating text,
  operating_rating text,
  last_tested_on date,
  test_every_months integer,
  next_test_due date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index controls_next_test_ix on controls (next_test_due) where deleted_at is null;

create table control_tests (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  control_id uuid not null,
  test_type text,
  period_start date,
  period_end date,
  planned_on date,
  performed_on date,
  tester_id uuid,
  method text,
  population text,
  sample_size integer,
  exceptions_found integer,
  result text,
  conclusion text,
  status text,
  reviewer_id uuid,
  reviewed_on date,
  review_note text,
  cap_id uuid,
  flagged_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index control_tests_control_ix on control_tests (control_id) where deleted_at is null;

-- The items a test looked at, one row each (a ticket, a log entry, a vehicle check sheet).
create table control_test_samples (
  id uuid primary key default gen_random_uuid(),
  test_id uuid not null references control_tests (id) on delete cascade,
  item text not null,
  result text,
  note text,
  sort integer not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index control_test_samples_test_ix on control_test_samples (test_id);
