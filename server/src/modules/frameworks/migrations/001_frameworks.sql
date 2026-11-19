-- Frameworks: framework -> function -> category -> outcome, with evidence, cross-mappings
-- and point-in-time assessment snapshots.

create table frameworks (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  name text not null,
  version text,
  description text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index frameworks_key_uq on frameworks (lower(key)) where deleted_at is null;

create table framework_functions (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks (id),
  code text not null,
  name text not null,
  description text,
  color text not null default 'gray',
  sort int not null default 0,
  unique (framework_id, code)
);

create table framework_categories (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks (id),
  function_code text not null,
  code text not null,
  name text not null,
  description text,
  sort int not null default 0,
  unique (framework_id, code)
);

create table framework_outcomes (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks (id),
  function_code text,
  category_code text,
  code text not null,
  title text,                       -- kept in step with description / official_text by the module
  official_text text,
  description text,                 -- plain-language description
  priority boolean not null default false,
  designation text,
  status text not null default 'not_evidenced',
  target text,
  owner_id uuid,
  phase text,
  first_action text,
  evidence_summary text,
  also_satisfies text,
  review_on date,
  profile_applied_at timestamptz,   -- set once the seed has applied a target-profile row
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index framework_outcomes_code_uq on framework_outcomes (framework_id, code) where deleted_at is null;
create index framework_outcomes_status_ix on framework_outcomes (framework_id, status);

create table outcome_evidence (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references framework_outcomes (id),
  title text not null,
  description text,
  location text,
  collected_on date,
  expires_on date,
  created_at timestamptz not null default now(), created_by uuid
);
create index outcome_evidence_outcome_ix on outcome_evidence (outcome_id);

create table outcome_mappings (
  id uuid primary key default gen_random_uuid(),
  outcome_id uuid not null references framework_outcomes (id),
  framework_name text not null,
  reference text not null default '',
  created_at timestamptz not null default now(), created_by uuid
);
create unique index outcome_mappings_uq on outcome_mappings (outcome_id, lower(framework_name), lower(reference));

create table assessment_snapshots (
  id uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks (id),
  name text not null,
  taken_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- One row per outcome per snapshot. Code, function and priority are copied so a snapshot
-- still reads correctly after the outcome is later edited or removed.
create table snapshot_statuses (
  snapshot_id uuid not null references assessment_snapshots (id),
  outcome_id uuid not null,
  code text not null,
  title text,
  function_code text,
  category_code text,
  priority boolean not null default false,
  status text not null,
  primary key (snapshot_id, outcome_id)
);
