-- Approval workflows (E14-06): definitions an administrator writes per record type, the workflows
-- running on records, their steps and every decision. No foreign keys to other modules' tables:
-- records are named by `record_type` and `record_id`.

create table workflow_definitions (
  id uuid primary key default gen_random_uuid(),
  record_type text not null,
  name text not null,
  description text,
  active boolean not null default true,
  -- What starts it: `create` (a record is created), `status` (a lookup field changes to a value) or `manual`.
  trigger text not null default 'manual',
  trigger_field text,
  trigger_value text,
  -- Conditions on the record's fields that must all hold for it to start: [{ field, op, value }].
  conditions jsonb not null default '[]',
  -- Ordered steps: [{ key, name, approvers: {...}, quorum, condition, due_hours, escalate_to }].
  steps jsonb not null default '[]',
  -- Field values set at the end: [{ field, value }].
  on_approve jsonb not null default '[]',
  on_reject jsonb not null default '[]',
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  deleted_at timestamptz
);
create index workflow_definitions_type_ix on workflow_definitions (record_type) where deleted_at is null;

create table workflow_instances (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references workflow_definitions(id),
  -- The definition as it was when this workflow started: later edits do not change a running one.
  definition jsonb not null,
  name text not null,
  record_type text not null,
  record_id uuid not null,
  -- running | approved | rejected | canceled
  status text not null default 'running',
  current_step int,
  -- Who asked: the person who started it by hand or made the change that started it (null: the system).
  requested_by uuid,
  note text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- Why it was canceled, or why the outcome could not be applied.
  outcome_note text,
  outcome_error text
);
create index workflow_instances_record_ix on workflow_instances (record_type, record_id);
create index workflow_instances_running_ix on workflow_instances (status) where status = 'running';
-- One running copy of a workflow per record.
create unique index workflow_instances_one_running_uq on workflow_instances (definition_id, record_id) where status = 'running';
create index workflow_instances_requester_ix on workflow_instances (requested_by);

create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid not null references workflow_instances(id) on delete cascade,
  position int not null,
  step_key text not null,
  name text not null,
  -- waiting (not reached) | pending (waiting for decisions) | approved | rejected | skipped | canceled
  status text not null default 'pending',
  -- The people who may decide, worked out when the step started (and widened by escalation).
  approvers jsonb not null default '[]',
  required int not null default 1,
  due_at timestamptz,
  escalated_at timestamptz,
  -- Why the step was skipped, or why nobody could be found to approve it.
  note text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (instance_id, position)
);
create index workflow_steps_pending_ix on workflow_steps (status) where status = 'pending';
create index workflow_steps_approvers_ix on workflow_steps using gin (approvers);

create table workflow_decisions (
  id uuid primary key default gen_random_uuid(),
  step_id uuid not null references workflow_steps(id) on delete cascade,
  instance_id uuid not null references workflow_instances(id) on delete cascade,
  user_id uuid not null,
  -- approved | rejected
  decision text not null,
  comment text,
  -- How it was made: web, api or mcp (the token's name is on the audit event).
  via text not null default 'web',
  created_at timestamptz not null default now(),
  unique (step_id, user_id)
);
create index workflow_decisions_user_ix on workflow_decisions (user_id, created_at desc);

-- The head of each department, for steps approved by "the department head".
create table workflow_department_heads (
  department_id uuid primary key,
  user_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
