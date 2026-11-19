-- Projects and portfolio.

create table projects (
  id uuid primary key default gen_random_uuid(),
  ref text,
  name text not null,
  description text,
  expected_benefits text,
  sponsor text,
  sponsor_id uuid,
  project_manager_id uuid,
  system_owner text,
  system_owner_id uuid,
  department text,
  tier text,                          -- effective tier: the override when set, otherwise the computed tier
  tier_computed text,
  tier_override text,
  tier_override_reason text,
  stage text not null default 'idea',
  status text not null default 'active',
  budget numeric,
  spend_to_date numeric,
  funding_source text,
  start_on date,
  target_on date,
  touches_payment boolean not null default false,
  touches_personal_data boolean not null default false,
  touches_operational_systems boolean not null default false,
  security_impact text,
  data_impact text,
  vendor_id uuid,                     -- vendors module (no foreign key across modules)
  contract_id uuid,                   -- vendors module
  scoring jsonb,                      -- { <criterion key>: score 0 to 5 }
  priority_score numeric,
  rag_overall text,                   -- latest status report, denormalized
  rag_schedule text,
  rag_budget text,
  rag_risk text,
  rag_trend text,                     -- improving | steady | worsening (overall, latest against previous)
  last_report_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create unique index projects_ref_uq on projects (ref) where ref is not null;
create index projects_stage_ix on projects (stage) where deleted_at is null;

-- Gate templates: one per pair of consecutive stages. Administrators edit these.
create table project_gate_defs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  from_stage text not null,
  to_stage text not null,
  sort int not null default 0,
  active boolean not null default true,
  required_documents jsonb not null default '[]',   -- ["Project charter", ...]
  approvers jsonb not null default '{}',            -- { "tier_1": ["..."], "tier_2": [...], "tier_3": [...] }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), updated_by uuid
);

create table project_gate_def_items (
  id uuid primary key default gen_random_uuid(),
  gate_def_id uuid not null references project_gate_defs(id) on delete cascade,
  label text not null,
  sort int not null default 0
);
create index project_gate_def_items_ix on project_gate_def_items (gate_def_id, sort);

-- A gate as it applies to one project, copied from the template when the project reaches the stage.
create table project_gates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  gate_def_id uuid,
  gate_key text not null,
  name text not null,
  from_stage text not null,
  to_stage text not null,
  sort int not null default 0,
  status text not null default 'open',              -- open | approved | rejected | deferred
  documents jsonb not null default '[]',            -- [{ name, received, reference }]
  approvers jsonb not null default '{}',            -- by tier, as in the template at the time
  decided_by_name text,
  decided_by_role text,
  decided_on date,
  decision_reference text,
  decision_notes text,
  opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (project_id, gate_key)
);

create table gate_checklist_items (
  id uuid primary key default gen_random_uuid(),
  project_gate_id uuid not null references project_gates(id) on delete cascade,
  label text not null,
  sort int not null default 0,
  checked boolean not null default false,
  checked_by uuid,
  checked_by_name text,
  checked_at timestamptz,
  note text,
  evidence_ref text,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index gate_checklist_items_ix on gate_checklist_items (project_gate_id, sort);

-- Every decision recorded against a gate (a gate may be deferred or rejected before it is approved).
create table project_gate_decisions (
  id uuid primary key default gen_random_uuid(),
  project_gate_id uuid not null references project_gates(id) on delete cascade,
  project_id uuid not null,
  decision text not null,                           -- approved | rejected | deferred
  approver_name text not null,
  approver_role text,
  decided_on date not null,
  reference text,
  notes text,
  recorded_by uuid,
  recorded_by_name text,
  created_at timestamptz not null default now()
);
create index project_gate_decisions_ix on project_gate_decisions (project_gate_id, created_at);

create table status_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  period_end date not null,
  overall text not null,
  schedule text not null,
  budget text not null,
  risk text not null,
  accomplishments text,
  next_steps text,
  decisions_needed text,
  author_id uuid,
  author_name text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index status_reports_ix on status_reports (project_id, period_end);

create table project_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  kind text not null,                               -- risk | issue | decision | change_request
  title text not null,
  detail text,
  owner_id uuid,
  owner text,
  status text not null default 'open',
  due_on date,
  likelihood int,
  impact int,
  escalated_risk_id uuid,                           -- risks module (no foreign key across modules)
  escalated_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index project_items_ix on project_items (project_id, kind);

create table project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id),
  name text not null,
  due_on date not null,
  done_on date,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index project_milestones_ix on project_milestones (project_id, due_on);
