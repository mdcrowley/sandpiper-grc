-- Wave 7: modules hand their own approvals to the workflows (approval kinds: change approval,
-- catalog request approval, asset disposal, risk acceptance, project gate), and approvers name
-- stand-ins for a period (E14-32). Additive: existing workflows keep working.

-- The approval kind a workflow serves (`change_approval`, ...); null for a workflow an administrator
-- starts by hand or by a status change. A kind's workflows are started by their module (trigger `module`).
alter table workflow_definitions add column if not exists kind text;
create index if not exists workflow_definitions_kind_ix on workflow_definitions (kind) where deleted_at is null;

alter table workflow_instances add column if not exists kind text;
-- What the module stored when it started the approval (for example the expiry asked for).
alter table workflow_instances add column if not exists data jsonb not null default '{}'::jsonb;
create index if not exists workflow_instances_kind_ix on workflow_instances (kind, record_id) where kind is not null;

-- Stand-ins added to a step: { "<stand-in id>": ["<approver id>", ...] }. `approvers` holds both.
alter table workflow_steps add column if not exists standins jsonb not null default '{}'::jsonb;
-- The approvers the step needs its approvals from (stand-ins excluded); `required` is counted on these.
alter table workflow_steps add column if not exists principals jsonb;

-- The approver a stand-in decided for (E14-32): "by <user> on behalf of <on_behalf_of>".
alter table workflow_decisions add column if not exists on_behalf_of uuid;
-- How it got there when not by the approver's own request: `adopted` (taken over from a module's
-- own approvals when it moved to workflows).
alter table workflow_decisions add column if not exists origin text;

-- An approver's stand-in for a period (dates in the organization's time zone, both included).
create table if not exists workflow_standins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  standin_id uuid not null,
  starts_on date not null,
  ends_on date not null,
  note text,
  created_at timestamptz not null default now(), created_by uuid,
  deleted_at timestamptz, deleted_by uuid
);
create index if not exists workflow_standins_user_ix on workflow_standins (user_id, starts_on, ends_on) where deleted_at is null;
create index if not exists workflow_standins_standin_ix on workflow_standins (standin_id) where deleted_at is null;

-- Each approval kind installs once: its workflows (from the module's settings or defaults) and
-- the approvals that were waiting when it moved to workflows.
create table if not exists workflow_kind_installs (
  kind text primary key,
  installed_at timestamptz not null default now(),
  summary text
);
