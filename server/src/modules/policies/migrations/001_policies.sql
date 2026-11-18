create table policies (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  summary text,
  category text,
  owner_id uuid,
  approver_name text,
  approver_role text,
  status text not null default 'draft',
  audience_everyone boolean not null default false,
  audience_roles jsonb not null default '[]',        -- role keys
  audience_departments jsonb not null default '[]',  -- department ids
  ack_days numeric not null default 14,              -- days allowed to acknowledge a published version
  review_date date,
  current_version numeric,                           -- number of the published version
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Every version is kept. status: draft | approved | published | superseded
create table policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version int not null,
  body text not null default '',
  change_summary text,
  status text not null default 'draft',
  approved_by uuid,
  approved_by_name text,
  approved_on date,
  effective_on date,
  published_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (policy_id, version)
);

create table policy_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references policies(id),
  version_id uuid not null references policy_versions(id),
  user_id uuid not null,
  requested_at timestamptz not null default now(),
  due_on date not null,
  acknowledged_at timestamptz,
  reminded_at timestamptz,
  reminder_count int not null default 0,
  superseded_at timestamptz,                         -- a newer version was published, or the policy was retired
  unique (version_id, user_id)
);
create index policy_acknowledgements_user_ix on policy_acknowledgements (user_id);
create index policy_acknowledgements_policy_ix on policy_acknowledgements (policy_id);

create table policy_exceptions (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  policy_id uuid,
  description text,
  justification text,
  compensating_controls text,
  requested_by uuid,
  approver_name text,
  approver_role text,
  approved_on date,
  expires_on date,
  status text not null default 'requested',
  risk_id uuid,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index policy_exceptions_policy_ix on policy_exceptions (policy_id);
