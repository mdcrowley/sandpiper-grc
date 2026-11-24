-- Vendor intake with risk tiers and required checks (E41-10), and contractor performance reviews
-- (E41-11). The questions, the tier rules and the checks each tier needs are the organization's own
-- (setting vendors.intake); nothing here is a built-in default of any jurisdiction.

-- The tier the latest completed intake set (lookup vendor_risk_tier), worked out by the application.
alter table vendors add column if not exists risk_tier text;
alter table vendors add column if not exists risk_tier_on date;

-- One completed intake questionnaire. The questions are copied in, so a later change to the
-- questionnaire never changes what this vendor was asked.
create table vendor_intakes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  questions jsonb not null,           -- [{ key, text, help, options: [{ value, label }] }]
  answers jsonb not null default '{}', -- { <question key>: <option value> }
  tier text not null,                 -- lookup vendor_risk_tier
  reasons jsonb not null default '[]', -- [{ question, question_text, answer, answer_label, tier }]
  notes text,
  completed_on date not null,
  completed_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_intakes_vendor_ix on vendor_intakes (vendor_id, completed_on desc);

-- A required check recorded as done, or waived with a reason. The latest row of each check counts.
create table vendor_checks (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references vendors(id),
  check_key text not null,            -- lookup vendor_check
  outcome text not null,              -- done | waived
  done_on date not null,              -- when it was done, or when the waiver was given
  expires_on date,                    -- after this date the check is needed again
  reference text,
  note text,                          -- what was found; for a waiver, the reason (required)
  recorded_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index vendor_checks_vendor_ix on vendor_checks (vendor_id, check_key, done_on desc);

-- A measure of a contractor's performance, with a target.
create table contract_measures (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts(id),
  name text not null,
  description text,
  unit text,                          -- "%", "hours", "count"...
  target numeric not null,
  direction text not null default 'higher',   -- higher | lower: which way is better
  frequency text not null default 'monthly',  -- monthly | quarterly | yearly
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index contract_measures_contract_ix on contract_measures (contract_id, sort);

-- One score of a measure for one period (2026-10, 2026-Q3 or 2026), with a comment.
create table contract_scores (
  id uuid primary key default gen_random_uuid(),
  measure_id uuid not null references contract_measures(id),
  contract_id uuid not null references contracts(id),
  period text not null,
  period_end date not null,
  value numeric not null,
  comment text,
  recorded_by uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index contract_scores_period_ux on contract_scores (measure_id, period) where deleted_at is null;
create index contract_scores_contract_ix on contract_scores (contract_id, period_end);
