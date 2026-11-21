-- Safety performance indicators beyond event counts (wave 10, E25): values entered by hand,
-- figures computed from another module's metric (core/metrics.ts), distance between major
-- failures, and a target per year with its approval.

alter table safety_indicators add column metric_key text;

create table safety_indicator_values (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references safety_indicators(id) on delete cascade,
  period date not null,
  value numeric not null,
  note text,
  entered_by uuid,
  updated_at timestamptz not null default now(),
  unique (indicator_id, period)
);

create table safety_indicator_targets (
  id uuid primary key default gen_random_uuid(),
  indicator_id uuid not null references safety_indicators(id) on delete cascade,
  year integer not null,
  target numeric not null,
  direction text not null default 'at_most',
  -- proposed, pending_approval, approved, rejected
  status text not null default 'proposed',
  approved_by_name text,
  approved_on date,
  approval_ref text,
  -- A meeting decision (governance module) the target was decided at; a plain uuid.
  decision_id uuid,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (indicator_id, year)
);

alter table safety_exposure
  add column revenue_miles numeric,
  add column major_failures integer;
