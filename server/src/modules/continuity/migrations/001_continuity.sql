-- Business continuity and emergency management (E31): business processes and what they depend on,
-- impact analyses, continuity and emergency plans with processes, call trees and checklists, and
-- emergency activations with a log, roles and a checklist. Permission module `continuity`.

create table business_processes (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  name text not null,
  department text,
  owner_id uuid,
  description text,
  criticality text,                                  -- process_criticality: vital, essential, important, deferrable
  peak_periods text,
  mtd_hours numeric,                                 -- maximum tolerable downtime
  rto_target_hours numeric,
  rpo_target_hours numeric,
  minimum_staff int,
  manual_workaround text,
  status text not null default 'draft',              -- process_status: draft, active, retired
  last_bia_on date,                                  -- set when an impact analysis is signed off
  next_bia_due date,
  bia_reminded_for date,                             -- the due date already reminded about (claimed before sending)
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- What a process depends on. The source of the `depends_on` record links (mirrored).
create table process_dependencies (
  id uuid primary key default gen_random_uuid(),
  process_id uuid not null references business_processes(id),
  dep_type text not null,                            -- system, service, site, vendor, process, position
  dep_id uuid not null,
  critical boolean not null default true,
  notes text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  unique (process_id, dep_type, dep_id)
);
create index process_dependencies_dep_ix on process_dependencies (dep_type, dep_id);

create table bia_assessments (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  process_id uuid not null references business_processes(id),
  year int,
  assessed_on date,
  assessor_id uuid,
  impacts jsonb not null default '[]',               -- [{ band: 1h|4h|1d|3d|1w, operational, safety, financial, reputational, legal_regulatory: 1-5 }]
  mtd_hours numeric,
  rto_target_hours numeric,
  rpo_target_hours numeric,
  answers jsonb not null default '{}',               -- { <bia_question value>: answer }
  notes text,
  status text not null default 'draft',              -- bia_status: draft, submitted, signed_off
  signed_off_by_name text,
  signed_off_on date,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index bia_assessments_process_ix on bia_assessments (process_id) where deleted_at is null;

create table continuity_plans (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  plan_type text,                                    -- continuity_plan_type
  owner_id uuid,
  scope text,
  activation_criteria text,
  recovery_strategies text,
  policy_id uuid,                                    -- optional full text, kept as a policy document
  review_months int not null default 12,
  next_review_on date,
  review_reminded_for date,                          -- the review date already reminded about (claimed before sending)
  approved_on date,
  approved_by_name text,
  status text not null default 'draft',              -- continuity_plan_status: draft, in_review, approved, retired
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

create table continuity_plan_processes (
  plan_id uuid not null references continuity_plans(id),
  process_id uuid not null references business_processes(id),
  created_at timestamptz not null default now(), created_by uuid,
  primary key (plan_id, process_id)
);
create index continuity_plan_processes_process_ix on continuity_plan_processes (process_id);

-- A plan's call tree: who calls whom. Names and phones come from the linked person or account; the
-- typed ones are used only for an entry linked to neither.
create table call_tree_nodes (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references continuity_plans(id),
  parent_id uuid references call_tree_nodes(id),
  sort int not null default 0,
  role text,
  user_id uuid,
  person_id uuid,
  name text,
  phone text,
  alternate_phone text,
  notes text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index call_tree_nodes_plan_ix on call_tree_nodes (plan_id, parent_id, sort);

create table continuity_checklist_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references continuity_plans(id),
  phase text not null,                               -- continuity_phase: activate, respond, recover, stand_down
  item text not null,
  role text,
  sort int not null default 0,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index continuity_checklist_items_plan_ix on continuity_checklist_items (plan_id, phase, sort);

create table emergency_activations (
  id uuid primary key default gen_random_uuid(),
  ref text unique,
  title text not null,
  event_type text,                                   -- emergency_event_type
  level text,                                        -- activation_level: monitoring, partial, full
  declared_at timestamptz not null default now(),
  declared_by uuid,
  status text not null default 'active',             -- activation_status: active, stood_down, closed
  stood_down_at timestamptz,
  closed_at timestamptz,
  plan_ids jsonb not null default '[]',
  sites_affected jsonb not null default '[]',
  services_affected jsonb not null default '[]',
  summary text,
  after_action_summary text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);

-- Append-only: entries are never changed or removed (anonymizing replaces their text).
create table activation_log_entries (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references emergency_activations(id),
  at timestamptz not null default now(),
  entry text not null,
  by_id uuid,
  by_name text,
  created_at timestamptz not null default now()
);
create index activation_log_entries_ix on activation_log_entries (activation_id, at desc);

create table activation_roles (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references emergency_activations(id),
  role text not null,
  user_id uuid,
  person_id uuid,
  name text,                                         -- typed only for someone with no account or roster person
  assigned_at timestamptz not null default now(),
  created_by uuid
);
create index activation_roles_ix on activation_roles (activation_id);

create table activation_checklist (
  id uuid primary key default gen_random_uuid(),
  activation_id uuid not null references emergency_activations(id),
  item_id uuid,                                      -- the plan checklist item it was copied from
  plan_id uuid,
  phase text not null,
  item text not null,
  role text,
  sort int not null default 0,
  done_by uuid,
  done_by_name text,
  done_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);
create index activation_checklist_ix on activation_checklist (activation_id, phase, sort);
