-- Asset condition and state of good repair (E32). Asset classes carry a useful-life benchmark;
-- condition assessments rate assets, vehicles and sites on a configurable scale; yearly targets cap
-- the share of each class past its useful life. The rated records belong to the inventory and fleet
-- modules (their condition columns are added there): plain uuid columns, no cross-module keys.

create table asset_classes (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  category text,
  -- What the class rates: vehicle, asset or site.
  applies_to text not null default 'asset',
  useful_life_years numeric,
  useful_life_miles numeric,
  -- Default class suggestions: { vehicle_mode: [], asset_type: [], site_kind: [] }.
  matches jsonb not null default '{}'::jsonb,
  -- A rating at or below this counts as poor condition.
  poor_rating_at integer not null default 2,
  -- Months between assessments of its members; empty = the setting condition.assessment_every_months.
  assessment_every_months integer,
  owner_id uuid,
  active boolean not null default true,
  description text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index asset_classes_name_ux on asset_classes (lower(name)) where deleted_at is null;

create table condition_assessments (
  id uuid primary key default gen_random_uuid(),
  ref text,
  target_type text not null,
  target_id uuid not null,
  -- The rated record's name and class when the assessment was saved (for lists and filters).
  target_label text,
  class_id uuid,
  assessed_on date not null,
  rating text not null,
  assessor_id uuid,
  assessor_name text,
  method text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index condition_assessments_target_ix on condition_assessments (target_type, target_id, assessed_on desc) where deleted_at is null;

-- One class's target for one year: the most of its members that may be past their useful life.
create table condition_targets (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references asset_classes(id),
  year integer not null,
  target_pct numeric not null,
  -- draft, approved
  status text not null default 'draft',
  approved_on date,
  approved_by_name text,
  decision_ref text,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (class_id, year)
);

-- Assessment reminders already claimed: one row per rated record and due date, written before
-- anyone is told, so two runs at once never remind twice.
create table condition_reminders (
  target_type text not null,
  target_id uuid not null,
  due_on date not null,
  claimed_at timestamptz not null default now(),
  primary key (target_type, target_id, due_on)
);
