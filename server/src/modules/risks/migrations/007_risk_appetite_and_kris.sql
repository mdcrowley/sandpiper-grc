-- E30-06: the risk appetite, one statement per risk category, with the highest residual rating
-- (a rating key of the category's scale) and, optionally, the highest score the organization accepts.
create table risk_appetite (
  category text primary key,
  statement text,
  max_rating text,
  max_score int,
  approved_on date,
  approved_by_name text,
  reference text,
  updated_at timestamptz not null default now(), updated_by uuid
);

-- E30-06: a risk above its category's appetite (kept by the module on every save and re-rating).
-- E30-08: a department risk rolls up under an enterprise (parent) risk.
alter table risks add column if not exists parent_id uuid;
alter table risks add column if not exists appetite_breach boolean;
create index if not exists risks_parent_ix on risks (parent_id) where parent_id is not null;

-- E30-07: key risk indicators (record type `kri`, KRI- numbers, restricted like risks).
create table key_risk_indicators (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  description text,
  risk_id uuid,
  metric_key text,
  unit text,
  direction text,
  amber numeric,
  red numeric,
  frequency text,
  owner_id uuid,
  status text,
  last_period date,
  last_value numeric,
  last_level text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index key_risk_indicators_risk_ix on key_risk_indicators (risk_id);

-- One value per indicator and month (period = the first day of the month).
create table kri_values (
  id uuid primary key default gen_random_uuid(),
  kri_id uuid not null references key_risk_indicators(id),
  period date not null,
  value numeric,
  level text,
  note text,
  entered_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kri_id, period)
);
