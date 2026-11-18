-- Risk scales are data: an administrator can edit these rows or add another scale.
-- Level values are whole numbers where a higher number is worse.
create table risk_scales (
  key text primary key,
  name text not null,
  description text,
  likelihood_label text not null default 'Likelihood',
  impact_label text not null default 'Impact',
  likelihood_levels jsonb not null,               -- [{ value, label, description }]
  impact_levels jsonb not null,                   -- [{ value, label, description }]
  matrix jsonb not null,                          -- { "<likelihood>": { "<impact>": "<rating key>" } }
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), updated_by uuid
);

-- Ratings of each scale and the mapping of each rating to the common summary level
-- (lookup list risk_summary_level), so risks on different scales can share one chart.
create table risk_scale_ratings (
  scale_key text not null references risk_scales(key) on delete cascade,
  rating_key text not null,
  label text not null,
  color text not null default 'gray',
  sort int not null default 0,                    -- higher = more severe
  summary_level text not null,
  primary key (scale_key, rating_key)
);

create table risks (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  category text,
  scale_key text not null,
  affected text,
  cause text,
  consequence text,
  inherent_likelihood int,
  inherent_impact int,
  existing_controls text,
  residual_likelihood int,
  residual_impact int,
  inherent_rating text,
  inherent_score int,
  residual_rating text,
  residual_score int,
  summary_level text,
  treatment text,
  owner_id uuid,
  due_on date,
  status text,
  review_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index risks_scale_ix on risks (scale_key);

-- Acceptance decisions are kept, never edited: a new acceptance supersedes the last one.
create table risk_acceptances (
  id uuid primary key default gen_random_uuid(),
  risk_id uuid not null references risks(id),
  approver_name text not null,
  approver_title text,
  approved_on date not null,
  expires_on date not null,
  reference text,
  rationale text not null,
  rating_at_acceptance text,
  executive_required boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid
);
create index risk_acceptances_risk_ix on risk_acceptances (risk_id);

create table actions (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  status text,
  priority text,
  owner_id uuid,
  due_on date,
  completed_on date,
  source text,
  source_type text,
  source_id uuid,
  external_ref text,
  department text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index actions_source_ix on actions (source_type, source_id);
create index actions_due_ix on actions (due_on);

create table obligations (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  source text,
  requirement text,
  owner_id uuid,
  how_met text,
  evidence text,
  next_due_on date,
  status text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
