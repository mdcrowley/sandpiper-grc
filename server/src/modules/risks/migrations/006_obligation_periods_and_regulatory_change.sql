-- E30-01: what kind of obligation it is, how often it recurs and what it applies to.
-- `type` is a value of the list `obligation_type`, `frequency` of `obligation_frequency`
-- (its value's meta.months says how far each period moves the next due date), and `applies_to`
-- a JSON array of { label, type?, id? } entries (free text, or a record of another type).
alter table obligations add column if not exists type text;
alter table obligations add column if not exists frequency text;
alter table obligations add column if not exists applies_to jsonb default '[]';
alter table obligations add column if not exists last_attested_on date;
-- The due date of the period that the period reminders last announced (E30-03).
alter table obligations add column if not exists period_reminded_for date;

-- E30-02: one row per period of a recurring obligation, attested once it is met (or not).
create table obligation_periods (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references obligations(id),
  period_start date not null,
  period_end date not null,
  due_on date,
  status text,
  attested_by uuid,
  attested_on date,
  note text,
  evidence text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (obligation_id, period_start)
);
create index obligation_periods_obligation_ix on obligation_periods (obligation_id, period_start desc);

-- E30-04: regulatory change intake (record type `regulatory_change`, REG- numbers).
create table regulatory_changes (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  issuer text,
  citation text,
  published_on date,
  effective_on date,
  summary text,
  impact_level text,
  impact_assessment text,
  status text,
  owner_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
