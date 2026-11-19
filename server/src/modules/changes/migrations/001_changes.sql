-- Change enablement: changes, approvals, standard change templates, blackout periods
-- and acknowledged conflicts.

create table changes (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  description text,
  reason text,
  change_type text not null default 'normal',   -- standard | normal | emergency (lookup change_type)
  status text not null default 'draft',         -- lookup change_status; moved only by the workflow
  template_id uuid,                             -- standard changes: the template it was raised from
  template_name text,
  system_id uuid,                               -- inventory module (no foreign key across modules)
  asset_id uuid,                                -- inventory module
  risk_answers jsonb,                           -- { <question key>: <option value> }
  risk_score numeric,                           -- 0 to 100
  risk_computed text,                           -- level the questionnaire gives
  risk_override text,
  risk_override_reason text,
  risk_level text,                              -- effective level: the override when set, otherwise computed
  implementation_plan text,
  test_plan text,
  backout_plan text,
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  outcome text,                                 -- lookup change_outcome
  outcome_notes text,
  owner_id uuid,
  assignee_id uuid,
  approvals_required int not null default 0,
  approvals_received int not null default 0,
  approved_retrospectively boolean not null default false,
  submitted_at timestamptz,
  pir_required boolean not null default false,
  pir_what_happened text,
  pir_cause text,
  pir_follow_up text,
  pir_completed_at timestamptz,
  pir_completed_by_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index changes_ref_uq on changes (ref) where ref is not null;
create index changes_status_ix on changes (status) where deleted_at is null;
create index changes_window_ix on changes (planned_start, planned_end) where deleted_at is null;

-- Every approval decision recorded against a change.
create table change_approvals (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references changes(id),
  decision text not null,                       -- approved | rejected
  approver_name text not null,
  approver_role text,
  decided_on date not null,
  reference text,
  notes text,
  retrospective boolean not null default false, -- recorded after the change had started
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now()
);
create index change_approvals_ix on change_approvals (change_id, created_at);

-- Pre-approved templates for standard changes. Administrators maintain these.
create table change_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  summary text,
  title text not null,
  description text,
  reason text,
  implementation_plan text,
  test_plan text,
  backout_plan text,
  risk_level text not null default 'low',
  duration_minutes int not null default 60,
  system_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Periods in which changes should not be made.
create table change_blackouts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index change_blackouts_ix on change_blackouts (starts_at, ends_at) where deleted_at is null;

-- A conflict someone has acknowledged, with the reason. It holds only for the planned
-- window it was given for: move the change and the conflict must be looked at again.
create table change_conflict_overrides (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references changes(id),
  conflict_key text not null,                   -- blackout:<id> | change:<id>
  summary text not null,
  reason text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  acknowledged_by uuid,
  acknowledged_by_name text,
  created_at timestamptz not null default now()
);
create index change_conflict_overrides_ix on change_conflict_overrides (change_id, conflict_key);
