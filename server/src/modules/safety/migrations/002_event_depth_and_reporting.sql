-- Safety event depth and reporting (wave 10, E25): the figures reporting rules are written over,
-- conditions and contributing factors, the people involved, the investigation timeline, witness
-- statements, the organization's own reporting rules and the notification clocks they start.
-- People involved and statements hold personal information: their routes need security.view too.

alter table safety_events
  add column fatalities integer,
  add column people_transported integer,
  add column damage_estimate numeric,
  add column evacuation boolean,
  add column weather text,
  add column lighting text,
  add column surface text,
  add column latitude numeric,
  add column longitude numeric,
  add column contributing_factors jsonb not null default '[]',
  -- Yes or no only: test results belong in a specialist system (E25-13).
  add column post_event_testing_required boolean,
  add column reportable boolean not null default false,
  add column reportable_reasons jsonb not null default '[]';

-- Removing an event for good at the end of its retention period takes what hangs off it too.
alter table safety_event_hazards drop constraint if exists safety_event_hazards_event_id_fkey;
alter table safety_event_hazards add constraint safety_event_hazards_event_id_fkey foreign key (event_id) references safety_events(id) on delete cascade;
alter table safety_event_hazards drop constraint if exists safety_event_hazards_hazard_id_fkey;
alter table safety_event_hazards add constraint safety_event_hazards_hazard_id_fkey foreign key (hazard_id) references hazards(id) on delete cascade;

create table safety_event_people (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references safety_events(id) on delete cascade,
  role text not null,
  -- The staff roster entry (people module), when the person is on it; a plain uuid, no foreign key.
  person_id uuid,
  name text,
  injury_severity text,
  transported boolean not null default false,
  fatality boolean not null default false,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index safety_event_people_event_ix on safety_event_people (event_id);

create table safety_event_timeline (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references safety_events(id) on delete cascade,
  at timestamptz not null,
  entry text not null,
  by_id uuid,
  by_name text,
  created_at timestamptz not null default now(), created_by uuid
);
create index safety_event_timeline_event_ix on safety_event_timeline (event_id, at);

create table safety_event_statements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references safety_events(id) on delete cascade,
  statement_type text not null,
  given_by text,
  given_on date,
  text text not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index safety_event_statements_event_ix on safety_event_statements (event_id);

-- The organization's own rules: when an event must be reported, to whom and how fast. None are shipped.
create table safety_report_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  conditions jsonb not null default '[]',
  party text not null,
  deadline_hours numeric not null,
  required boolean not null default true,
  guidance text,
  active boolean not null default false,
  sort integer not null default 100,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- One clock per event and rule: who must be told, by when, and the record of telling them.
create table safety_notifications (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references safety_events(id) on delete cascade,
  rule_id uuid,
  party text not null,
  deadline_hours numeric,
  required boolean not null default true,
  guidance text,
  due_at timestamptz,
  status text not null default 'pending',
  notified_who text,
  notified_how text,
  notified_at timestamptz,
  reference_received text,
  note text,
  completed_by uuid,
  completed_at timestamptz,
  alerted_amber_at timestamptz,
  alerted_red_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, rule_id)
);
create index safety_notifications_due_ix on safety_notifications (status, due_at);
