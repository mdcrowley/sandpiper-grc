-- Corrective action plans and verification (E23, wave 10 contracts C1 and C2).
--
-- A corrective action plan (CAP) groups the actions that answer one finding, event, failed test or
-- deficiency, from any module: the source record is named by source_type and source_id, and the plan
-- takes that record's restriction (restrictedFrom), as actions do.
create table caps (
  id uuid primary key default gen_random_uuid(),
  ref text,
  title text not null,
  source text,
  source_type text,
  source_id uuid,
  problem_statement text,
  root_cause text,
  root_cause_category text,
  responsible_id uuid,
  status text,
  due_on date,
  approved_on date,
  approved_by_name text,
  closed_on date,
  effectiveness_summary text,
  -- Counts of the plan's actions, kept by the risks module whenever an action changes (for list filters).
  actions_total int not null default 0,
  actions_done int not null default 0,
  actions_awaiting int not null default 0,
  restricted boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index caps_source_ix on caps (source_type, source_id);
create index caps_status_ix on caps (status, due_on);

-- Actions belong to at most one plan, and may need their effectiveness verified before they count as done.
alter table actions add column cap_id uuid references caps(id);
alter table actions add column verification_required boolean not null default false;
alter table actions add column verifier_id uuid;
alter table actions add column verification_due date;
alter table actions add column verified_by uuid;
alter table actions add column verified_on date;
alter table actions add column verification_method text;
alter table actions add column verification_result text;
alter table actions add column verification_note text;
alter table actions add column closure_evidence text;
-- Due-date extensions: the first due date is kept, and approved extensions are counted.
alter table actions add column original_due_on date;
alter table actions add column extension_count int not null default 0;
create index actions_cap_ix on actions (cap_id);
create index actions_verification_ix on actions (status, verification_due);

-- Requests for more time on an action, decided through the "action_extension" approval workflow.
-- Kept as history; never edited after the decision.
create table action_extensions (
  id uuid primary key default gen_random_uuid(),
  action_id uuid not null references actions(id),
  requested_by uuid,
  requested_on date not null,
  old_due_on date,
  new_due_on date not null,
  reason text not null,
  status text not null default 'pending',
  decided_by_name text,
  decided_on date,
  decision_note text,
  workflow_instance_id uuid,
  created_at timestamptz not null default now()
);
create index action_extensions_action_ix on action_extensions (action_id, created_at desc);
