-- Safety management: the hazard log, safety events with their investigation, the links
-- between them, safety performance indicators and the exposure figures they divide by.
-- Sites, vehicles, services and users belong to other modules: plain uuid columns.

create table hazards (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  source text,
  consequence text,
  existing_controls text,
  mode text,
  site_id uuid,
  likelihood integer,
  severity integer,
  rating text,
  score integer,
  residual_likelihood integer,
  residual_severity integer,
  residual_rating text,
  residual_score integer,
  owner_id uuid,
  review_date date,
  status text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table safety_events (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  occurred_at timestamptz not null,
  event_type text,
  severity text,
  status text,
  site_id uuid,
  vehicle_id uuid,
  service_id uuid,
  location_detail text,
  description text,
  immediate_actions text,
  injuries integer,
  reported_by_id uuid,
  investigator_id uuid,
  investigation_due date,
  root_cause text,
  root_cause_category text,
  findings text,
  closed_on date,
  restricted boolean not null default false,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index safety_events_occurred_ix on safety_events (occurred_at);

create table safety_event_hazards (
  event_id uuid not null references safety_events(id),
  hazard_id uuid not null references hazards(id),
  created_at timestamptz not null default now(), created_by uuid,
  primary key (event_id, hazard_id)
);
create index safety_event_hazards_hazard_ix on safety_event_hazards (hazard_id);

-- A named indicator: events matching the filters in each month, either as a count or as a
-- rate per `per_units` of an exposure measure (vehicle-miles, vehicle-hours or boardings).
create table safety_indicators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  event_types jsonb not null default '[]',
  severities jsonb not null default '[]',
  modes jsonb not null default '[]',
  measure text not null default 'count',
  exposure text,
  per_units numeric,
  target numeric,
  target_direction text not null default 'at_most',
  active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Operator-entered exposure per month and mode ('' = the whole operation).
create table safety_exposure (
  period date not null,
  mode text not null default '',
  vehicle_miles numeric,
  vehicle_hours numeric,
  boardings numeric,
  updated_at timestamptz not null default now(), updated_by uuid,
  primary key (period, mode)
);
